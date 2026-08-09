/**
 * src/providers/geminiProvider.js
 * Google AI Studio (Gemini) — free tier, no payment card needed.
 * The API shape is different from OpenAI-compatible providers, so this
 * adapter talks directly to Gemini's generateContent endpoint.
 * Get a free API key: https://aistudio.google.com/apikey
 */
const config = require('../config');

const KEY = 'gemini';

function buildContents({ systemPrompt, history, message, images }) {
  const contents = [];

  // Gemini requires strict alternation of user/model roles.
  // Merge consecutive same-role messages instead of sending invalid sequences.
  function pushPart(role, parts) {
    if (!parts || !parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts: [...parts] });
    }
  }

  if (Array.isArray(history)) {
    for (const h of history) {
      if (!h || !h.role || !h.content) continue;
      const role = h.role === 'assistant' ? 'model' : 'user';
      pushPart(role, [{ text: h.content }]);
    }
  }

  const parts = [{ text: message || '' }];
  if (images && images.length) {
    for (const img of images) {
      const match = /^data:(.+?);base64,(.+)$/.exec(img);
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      } else {
        parts.push({ text: `[Image: ${img}]` });
      }
    }
  }
  pushPart('user', parts);

  // API also requires the first content role to be "user"
  if (contents.length && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(context)' }] });
  }

  return contents;
}

async function callGenerateContent({ model, systemPrompt, history, message, images, responseModalities }) {
  const providerConfig = config.providers.gemini;
  const url = `${providerConfig.baseURL}/models/${model}:generateContent?key=${providerConfig.apiKey}`;

  const body = {
    contents: buildContents({ systemPrompt, history, message, images }),
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  if (responseModalities) {
    body.generationConfig = { responseModalities };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[GEMINI ERROR] status=${res.status} model=${model} body=${errText.slice(0, 500)}`);
      throw new Error(`${KEY} HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function chat({ systemPrompt, history, message }) {
  const providerConfig = config.providers.gemini;
  const model = providerConfig.models.chat;
  const data = await callGenerateContent({ model, systemPrompt, history, message });
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') ?? '';
  const tokens = data?.usageMetadata?.totalTokenCount ?? null;
  return { reply, tokens, model };
}

async function vision({ systemPrompt, history, message, images }) {
  const providerConfig = config.providers.gemini;
  const model = providerConfig.models.vision;
  const data = await callGenerateContent({ model, systemPrompt, history, message, images });
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') ?? '';
  const tokens = data?.usageMetadata?.totalTokenCount ?? null;
  return { reply, tokens, model };
}

/**
 * Image generation - EDUCATIONAL PURPOSES ONLY.
 * Gemini's image model (Nano Banana) returns the image as inline_data (base64)
 * inside the response parts, unlike the OpenAI-style /images/generations.
 */
const BLOCKED_TERMS = ['nude', 'naked', 'sex', 'gore', 'violence graphic', 'weapon build'];

async function imageGen({ prompt }) {
  const providerConfig = config.providers.gemini;
  const model = providerConfig.models.imageGen;
  const lower = (prompt || '').toLowerCase();
  if (BLOCKED_TERMS.some(t => lower.includes(t))) {
    throw new Error('This request is not allowed - this platform is for educational purposes only.');
  }
  const safePrompt = `Educational illustration, safe for students, classroom-appropriate: ${prompt}`;

  const data = await callGenerateContent({
    model,
    message: safePrompt,
    responseModalities: ['TEXT', 'IMAGE'],
  });

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inline_data || p.inlineData);
  const inline = imagePart?.inline_data || imagePart?.inlineData;

  if (!inline?.data) {
    throw new Error('Gemini did not return an image - try a different prompt.');
  }

  return {
    imageUrl: null,
    imageBase64: inline.data,
    model,
    raw: data,
  };
}

module.exports = { key: KEY, capabilities: config.providers.gemini.capabilities, chat, vision, imageGen };
