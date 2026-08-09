/**
 * src/providers/openrouterProvider.js
 * OpenRouter → aggregator of many models (a solid backup), has vision and
 * reasoning models, also great for long-context conversations.
 */
const config = require('../config');
const { callChatCompletions, callChatCompletionsStream } = require('./_openaiCompatible');

const KEY = 'openrouter';

function extraHeaders() {
  const c = config.providers.openrouter;
  const h = {};
  if (c.siteUrl) h['HTTP-Referer'] = c.siteUrl;
  if (c.siteName) h['X-Title'] = c.siteName;
  return h;
}

function pickModel(task) {
  const m = config.providers.openrouter.models;
  if (task === 'vision') return m.vision;
  if (task === 'reasoning') return m.reasoning;
  if (task === 'longContext') return m.longContext;
  return m.chat;
}

async function chat({ task, systemPrompt, history, message, images, stream, onToken }) {
  const providerConfig = config.providers.openrouter;
  const model = images && images.length ? providerConfig.models.vision : pickModel(task);
  if (stream) {
    const r = await callChatCompletionsStream({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, images, extraHeaders: extraHeaders(), onToken });
    return { ...r, model };
  }
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, images, extraHeaders: extraHeaders() });
  return { ...r, model };
}

async function vision({ systemPrompt, history, message, images }) {
  const providerConfig = config.providers.openrouter;
  const model = providerConfig.models.vision;
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, images, extraHeaders: extraHeaders() });
  return { ...r, model };
}

async function imageGen() {
  throw new Error('OpenRouter does not support image generation directly in this adapter.');
}

module.exports = { key: KEY, capabilities: config.providers.openrouter.capabilities, chat, vision, imageGen };
