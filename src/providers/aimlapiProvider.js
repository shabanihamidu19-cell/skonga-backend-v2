/**
 * src/providers/aimlapiProvider.js
 * AIMLAPI → aggregator with vision AND image generation - the main
 * provider for image OCR and generating educational images.
 */
const config = require('../config');
const { callChatCompletions } = require('./_openaiCompatible');

const KEY = 'aimlapi';

async function chat({ task, systemPrompt, history, message, images }) {
  const providerConfig = config.providers.aimlapi;
  const model = images && images.length ? providerConfig.models.vision : (task === 'reasoning' ? providerConfig.models.reasoning : providerConfig.models.chat);
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, images });
  return { ...r, model };
}

async function vision({ systemPrompt, history, message, images }) {
  const providerConfig = config.providers.aimlapi;
  const model = providerConfig.models.vision;
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, images });
  return { ...r, model };
}

/**
 * Image generation - EDUCATIONAL PURPOSES ONLY.
 * Every request gets a "safe/educational" framing added, and we block
 * risky terms with a simple filter (defense-in-depth; the frontend also warns).
 */
const BLOCKED_TERMS = ['nude', 'naked', 'sex', 'gore', 'violence graphic', 'weapon build'];

async function imageGen({ prompt, size }) {
  const providerConfig = config.providers.aimlapi;
  const lower = (prompt || '').toLowerCase();
  if (BLOCKED_TERMS.some(t => lower.includes(t))) {
    throw new Error('This request is not allowed - this platform is for educational purposes only.');
  }
  const safePrompt = `Educational illustration, safe for students, classroom-appropriate: ${prompt}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);
  try {
    const res = await fetch(`${providerConfig.baseURL}/images/generations`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: providerConfig.models.imageGen,
        prompt: safePrompt,
        size: size || '1024x1024',
        n: 1,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[AIMLAPI IMAGE GEN ERROR] status=${res.status} model=${providerConfig.models.imageGen} body=${errText.slice(0, 500)}`);
      throw new Error(`${KEY} image HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    // AIMLAPI/OpenAI-style: data.data[0].url or .b64_json
    const item = data?.data?.[0] || {};
    return {
      imageUrl: item.url || null,
      imageBase64: item.b64_json || null,
      model: providerConfig.models.imageGen,
      raw: data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { key: KEY, capabilities: config.providers.aimlapi.capabilities, chat, vision, imageGen };
