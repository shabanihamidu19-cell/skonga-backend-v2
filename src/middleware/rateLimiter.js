/**
 * src/middleware/rateLimiter.js
 * Per-IP rate limit for AI routes (chat/vision/image) to protect the
 * API key budget against abuse or spam.
 */
const rateLimit = require('express-rate-limit');
const config = require('../config');

const aiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'You have reached the request limit. Please wait a bit before trying again.' },
});

module.exports = { aiRateLimiter };
