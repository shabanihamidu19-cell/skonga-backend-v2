/**
 * src/providers/groqProvider.js
 * Groq → very high speed (LPU inference), great for regular chat and quick
 * questions. Doesn't support vision or image generation yet.
 */
const config = require('../config');
const { callChatCompletions, callChatCompletionsStream } = require('./_openaiCompatible');

const KEY = 'groq';

function pickModel(task) {
  const m = config.providers.groq.models;
  if (task === 'reasoning') return m.reasoning;
  if (task === 'fast') return m.fast;
  return m.chat;
}

async function chat({ task, systemPrompt, history, message, stream, onToken }) {
  const providerConfig = config.providers.groq;
  const model = pickModel(task);
  if (stream) {
    const r = await callChatCompletionsStream({ providerKey: KEY, providerConfig, model, systemPrompt, history, message, onToken });
    return { ...r, model };
  }
  const r = await callChatCompletions({ providerKey: KEY, providerConfig, model, systemPrompt, history, message });
  return { ...r, model };
}

async function vision() {
  throw new Error('Groq does not support vision/image analysis yet.');
}

async function imageGen() {
  throw new Error('Groq does not support image generation.');
}

module.exports = { key: KEY, capabilities: config.providers.groq.capabilities, chat, vision, imageGen };
