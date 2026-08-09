/**
 * src/providers/bazaarlinkProvider.js
 * BazaarLink → used as a last-resort fallback or for a specialized
 * service. BazaarLink's public docs are incomplete, so this adapter
 * uses an OpenAI-compatible shape as a safe default.
 * IMPORTANT: check BazaarLink's real docs and adjust the endpoint/payload
 * here if they differ (e.g. a "prompt" field name instead of
 * "messages", or a different auth header than Bearer).
 */
const config = require('../config');
const { callChatCompletions } = require('./_openaiCompatible');

const KEY = 'bazaarlink';

async function chat({ systemPrompt, history, message }) {
  const providerConfig = config.providers.bazaarlink;
  const model = providerConfig.models.chat;
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message });
  return { ...r, model };
}

async function vision() {
  throw new Error('BazaarLink does not support vision in the current config.');
}

async function imageGen() {
  throw new Error('BazaarLink does not support image generation in the current config.');
}

module.exports = { key: KEY, capabilities: config.providers.bazaarlink.capabilities, chat, vision, imageGen };
