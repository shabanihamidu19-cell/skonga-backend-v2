/**
 * src/services/aiService.js
 * CORE PIECE: this is the "single AI service layer" that unifies
 * Groq, OpenRouter, AIMLAPI, and BazaarLink under one function.
 *
 * Behavior:
 *  - provider === "auto"  → try in the order given by config.fallbackOrder,
 *                           skipping providers that lack the capability
 *                           needed for the given task (e.g. vision).
 *  - provider === "groq" | "openrouter" | "aimlapi" | "bazaarlink"
 *                         → use ONLY that provider (retries internally,
 *                           without moving to another provider).
 */
const config = require('../config');
const statsService = require('./statsService');

const adapters = {
  groq: require('../providers/groqProvider'),
  openrouter: require('../providers/openrouterProvider'),
  aimlapi: require('../providers/aimlapiProvider'),
  bazaarlink: require('../providers/bazaarlinkProvider'),
  gemini: require('../providers/geminiProvider'),
  pollinations: require('../providers/pollinationsProvider'),
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function providerReady(key) {
  const cfg = config.providers[key];
  return !!(cfg && cfg.enabled);
}

function supportsCapability(key, capability) {
  const cfg = config.providers[key];
  return !!(cfg && cfg.capabilities && cfg.capabilities[capability]);
}

/**
 * Try a single provider, with internal retries (e.g. for a brief network hiccup).
 */
async function tryProvider(key, method, args) {
  const adapter = adapters[key];
  const maxRetries = config.retry.maxRetries;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();
    try {
      const result = await adapter[method](args);
      statsService.recordSuccess(key, Date.now() - start);
      return { ...result, providerUsed: key };
    } catch (err) {
      statsService.recordFailure(key, Date.now() - start);
      lastErr = err;
      if (attempt < maxRetries) await sleep(400 * (attempt + 1)); // simple backoff
    }
  }
  throw lastErr;
}

function resolveCapabilityForTask(task) {
  // task: 'chat' | 'vision' | 'imageGen' | 'reasoning' | 'longContext'
  if (task === 'vision') return 'vision';
  if (task === 'imageGen') return 'imageGen';
  return 'chat'; // reasoning/longContext still need the base 'chat' capability
}

function methodForTask(task) {
  if (task === 'vision') return 'vision';
  if (task === 'imageGen') return 'imageGen';
  return 'chat';
}

/**
 * generateAIResponse — the main unified function.
 * @param {object} opts
 * @param {'auto'|'groq'|'openrouter'|'aimlapi'|'bazaarlink'} opts.provider
 * @param {'chat'|'vision'|'imageGen'|'reasoning'|'longContext'} [opts.task='chat']
 * @param {string} opts.message
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.images] - data URLs or https URLs (for vision)
 * @param {boolean} [opts.stream]
 * @param {function} [opts.onToken] - callback(token) if stream=true
 * @returns {Promise<{reply:string, providerUsed:string, modelUsed:string, tokens:number|null, error:string|null}>}
 */
async function generateAIResponse(opts) {
  const {
    provider = 'auto',
    task = 'chat',
    message,
    history = [],
    systemPrompt = '',
    images = [],
    stream = false,
    onToken,
    prompt, // for imageGen
    size,
  } = opts;

  const capability = resolveCapabilityForTask(task);
  const method = methodForTask(task);

  const args = { task, systemPrompt, history, message, images, stream, onToken, prompt: prompt || message, size };

  // ── A specific provider chosen directly (no fallback) ──
  if (provider !== 'auto') {
    if (!providerReady(provider)) {
      return { reply: null, providerUsed: null, modelUsed: null, tokens: null, error: `Provider "${provider}" has no API key configured (not ready).` };
    }
    if (!supportsCapability(provider, capability)) {
      return { reply: null, providerUsed: null, modelUsed: null, tokens: null, error: `Provider "${provider}" does not support "${capability}".` };
    }
    try {
      const r = await tryProvider(provider, method, args);
      return { reply: r.reply ?? null, providerUsed: r.providerUsed, modelUsed: r.model || null, tokens: r.tokens ?? null, error: null, imageUrl: r.imageUrl, imageBase64: r.imageBase64 };
    } catch (err) {
      return { reply: null, providerUsed: provider, modelUsed: null, tokens: null, error: err.message || String(err) };
    }
  }

  // ── AUTO mode: fallback chain following the order in config.fallbackOrder ──
  const candidates = config.fallbackOrder.filter(key => providerReady(key) && supportsCapability(key, capability));

  if (!candidates.length) {
    return { reply: null, providerUsed: null, modelUsed: null, tokens: null, error: `No provider with a configured key supports "${capability}".` };
  }

  const errors = [];
  for (const key of candidates) {
    try {
      const r = await tryProvider(key, method, args);
      return { reply: r.reply ?? null, providerUsed: r.providerUsed, modelUsed: r.model || null, tokens: r.tokens ?? null, error: null, imageUrl: r.imageUrl, imageBase64: r.imageBase64 };
    } catch (err) {
      errors.push(`${key}: ${err.message || err}`);
      // move on to the next provider
    }
  }

  return {
    reply: null,
    providerUsed: null,
    modelUsed: null,
    tokens: null,
    error: `All providers failed → ${errors.join(' | ')}`,
  };
}

module.exports = { generateAIResponse };
