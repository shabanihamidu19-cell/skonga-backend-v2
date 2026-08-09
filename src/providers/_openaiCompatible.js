/**
 * src/providers/_openaiCompatible.js
 * Groq, OpenRouter, AIMLAPI (and BazaarLink by default) all follow the
 * OpenAI /chat/completions shape, so we share one piece of logic here
 * to keep each provider "adapter" short and easy to maintain (DRY).
 */
const config = require('../config');

/**
 * Turns a raw provider HTTP error into a clear, safe message.
 * NEVER includes the API key itself - only the provider name and status.
 * Auth errors (401/403) are called out specifically since "invalid key"
 * is the single most common real-world failure mode once keys are rotated.
 */
function buildProviderError(providerKey, status, errText) {
  if (status === 401 || status === 403) {
    return new Error(`${providerKey}: invalid or expired API key (HTTP ${status}). Check that ${providerKey.toUpperCase()}_API_KEY / ${providerKey.toUpperCase()}_KEY is set correctly and hasn't been revoked.`);
  }
  if (status === 429) {
    return new Error(`${providerKey}: rate limit or quota exceeded (HTTP 429).`);
  }
  return new Error(`${providerKey} HTTP ${status}: ${(errText || '').slice(0, 300)}`);
}

function buildMessages({ systemPrompt, history, message, images }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && h.role && h.content) messages.push({ role: h.role, content: h.content });
    }
  }
  if (images && images.length) {
    // Vision-style content array: text + image_url parts (OpenAI/OpenRouter/AIMLAPI standard)
    const content = [{ type: 'text', text: message || 'Describe this image.' }];
    for (const img of images) {
      // img can be a data URL (base64) or an https URL
      content.push({ type: 'image_url', image_url: { url: img } });
    }
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: message });
  }
  return messages;
}

async function callChatCompletions({ providerKey, providerConfig, model, systemPrompt, history, message, images, stream, extraHeaders }) {
  const url = `${providerConfig.baseURL}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({
        model,
        messages: buildMessages({ systemPrompt, history, message, images }),
        stream: !!stream,
        temperature: 0.6,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[${providerKey.toUpperCase()} ERROR] status=${res.status} model=${model}`); // never logs the key or full body
      throw buildProviderError(providerKey, res.status, errText);
    }

    // NOTE: for clarity, this endpoint returns the full reply (non-stream) for
    // non-streaming routes. For real streaming, the /api/chat route
    // uses callChatCompletionsStream instead (see below).
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    const tokens = data?.usage?.total_tokens ?? null;
    return { reply, tokens, raw: data };
  } finally {
    clearTimeout(timeout);
  }
}

async function callChatCompletionsStream({ providerKey, providerConfig, model, systemPrompt, history, message, images, extraHeaders, onToken }) {
  const url = `${providerConfig.baseURL}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({
        model,
        messages: buildMessages({ systemPrompt, history, message, images }),
        stream: true,
        temperature: 0.6,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      console.error(`[${providerKey.toUpperCase()} STREAM ERROR] status=${res.status} model=${model}`);
      throw buildProviderError(providerKey, res.status, errText);
    }

    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          if (onToken) onToken(delta);
        }
      } catch (_) { /* skip malformed SSE chunk */ }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) handleLine(line);
    }
    // Flush any trailing incomplete line left in the buffer
    if (buffer.trim()) handleLine(buffer);
    return { reply: fullText, tokens: null };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callChatCompletions, callChatCompletionsStream };
