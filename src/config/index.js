/**
 * src/config/index.js
 * Central configuration: API keys, capability matrix, model choices.
 * Update the model IDs here if a provider deprecates a given model.
 */
require('dotenv').config();

const KNOWN_PROVIDER_KEYS = ['groq', 'openrouter', 'aimlapi', 'bazaarlink', 'gemini', 'pollinations'];

const PROVIDER_FALLBACK_ORDER = (process.env.PROVIDER_FALLBACK_ORDER || 'groq,openrouter,aimlapi,pollinations,bazaarlink,gemini')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .filter(k => {
    const isKnown = KNOWN_PROVIDER_KEYS.includes(k);
    if (!isKnown) {
      console.warn(`[CONFIG WARNING] Ignoring unknown provider "${k}" found in PROVIDER_FALLBACK_ORDER - check for typos or a broken paste in your .env / Render env vars.`);
    }
    return isKnown;
  });

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  fallbackOrder: PROVIDER_FALLBACK_ORDER,

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30),
  },

  retry: {
    maxRetries: Number(process.env.PROVIDER_MAX_RETRIES || 1),
    timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 25000),
  },

  // Tavily is used for Live Search (searching the web before the AI replies)
  tavily: {
    enabled: !!process.env.TAVILY_API_KEY,
    apiKey: process.env.TAVILY_API_KEY,
    baseURL: 'https://api.tavily.com',
  },

  // SKONGA Library API — internal curriculum RAG (TIE syllabus).
  // Only this backend calls it (Bearer service token). Client never talks to it.
  library: {
    enabled: process.env.LIBRARY_ENABLED === 'true' || process.env.LIBRARY_ENABLED === '1',
    baseURL: (process.env.LIBRARY_API_URL || '').replace(/\/$/, ''),
    serviceToken: process.env.LIBRARY_SERVICE_TOKEN || '',
    timeoutMs: Number(process.env.LIBRARY_TIMEOUT_MS || 5000),
  },

  providers: {
    groq: {
      enabled: !!process.env.GROQ_API_KEY,
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      capabilities: { chat: true, vision: false, imageGen: false, streaming: true, reasoning: true },
      models: {
        chat: 'llama-3.3-70b-versatile',
        reasoning: 'deepseek-r1-distill-llama-70b',
        fast: 'llama-3.1-8b-instant',
      },
    },
    openrouter: {
      enabled: !!process.env.OPENROUTER_API_KEY,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      siteUrl: process.env.OPENROUTER_SITE_URL || '',
      siteName: process.env.OPENROUTER_SITE_NAME || 'SKONGA AI',
      capabilities: { chat: true, vision: true, imageGen: false, streaming: true, reasoning: true },
      models: {
        chat: 'meta-llama/llama-3.3-70b-instruct',
        vision: 'qwen/qwen-2.5-vl-72b-instruct',
        reasoning: 'deepseek/deepseek-r1',
        longContext: 'google/gemini-2.0-flash-001',
      },
    },
    aimlapi: {
      enabled: !!process.env.AIMLAPI_KEY,
      apiKey: process.env.AIMLAPI_KEY,
      baseURL: 'https://api.aimlapi.com/v1',
      capabilities: { chat: true, vision: true, imageGen: true, streaming: true, reasoning: true },
      models: {
        chat: 'gpt-4o-mini',
        vision: 'gpt-4o-mini',
        reasoning: 'o3-mini',
        imageGen: process.env.AIMLAPI_IMAGE_MODEL || 'flux/schnell',
      },
    },
    // BazaarLink: its API details aren't fully documented publicly — this adapter
    // uses an "OpenAI-compatible" shape as a safe default. Check
    // BazaarLink's real docs and adjust the baseURL/payload if they differ.
    bazaarlink: {
      enabled: !!process.env.BAZAARLINK_API_KEY,
      apiKey: process.env.BAZAARLINK_API_KEY,
      baseURL: process.env.BAZAARLINK_BASE_URL || 'https://api.bazaarlink.ai/v1',
      capabilities: { chat: true, vision: false, imageGen: false, streaming: false, reasoning: false },
      models: {
        chat: 'default',
      },
    },
    // Google AI Studio (Gemini) — free tier, no payment card needed, ~50 requests/day.
    // This is essentially the "free backup" for image generation if AIMLAPI
    // credit runs out. Get a free key at https://aistudio.google.com/apikey
    gemini: {
      enabled: !!process.env.GEMINI_API_KEY,
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      capabilities: { chat: true, vision: true, imageGen: true, streaming: false, reasoning: false },
      models: {
        chat: 'gemini-2.0-flash',
        vision: 'gemini-2.0-flash',
        imageGen: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
      },
    },
    // Pollinations.ai — genuinely free, NO API KEY REQUIRED for basic use.
    // Anonymous requests are rate-limited (~1 every 15s); registering a free
    // account (no payment card) raises the limit and removes the watermark.
    // This is the most friction-free image-gen backup available right now.
    pollinations: {
      enabled: true, // always available - no key required for basic access
      apiKey: process.env.POLLINATIONS_API_KEY || null, // optional, raises rate limit
      baseURL: 'https://image.pollinations.ai/prompt',
      capabilities: { chat: false, vision: false, imageGen: true, streaming: false, reasoning: false },
      models: {
        imageGen: process.env.POLLINATIONS_MODEL || 'flux',
      },
    },
  },
};
