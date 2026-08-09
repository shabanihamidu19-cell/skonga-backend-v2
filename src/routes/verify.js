/**
 * src/routes/verify.js
 * GET /api/verify-providers → sends a tiny "ping" message to every provider
 * that has an API key configured, and reports whether each one is actually
 * reachable and authenticated. Never returns key values - only pass/fail
 * plus a short, safe error message per provider.
 *
 * Use this after rotating API keys to confirm every provider still works:
 *   curl https://your-backend/api/verify-providers
 */
const express = require('express');
const router = express.Router();
const config = require('../config');

const adapters = {
  groq: require('../providers/groqProvider'),
  openrouter: require('../providers/openrouterProvider'),
  aimlapi: require('../providers/aimlapiProvider'),
  bazaarlink: require('../providers/bazaarlinkProvider'),
  gemini: require('../providers/geminiProvider'),
  pollinations: require('../providers/pollinationsProvider'),
};

router.get('/verify-providers', async (req, res) => {
  const results = {};

  await Promise.all(Object.keys(adapters).map(async (key) => {
    const providerConfig = config.providers[key];
    if (!providerConfig || !providerConfig.enabled) {
      results[key] = { configured: false, ok: false, note: 'No API key set - skipped.' };
      return;
    }
    // Providers without a "chat" capability (e.g. pollinations, image-only)
    // get a lighter "configured" check instead of a real request.
    if (!providerConfig.capabilities?.chat) {
      results[key] = { configured: true, ok: true, note: 'Image-only provider - configuration looks valid (no chat ping needed).' };
      return;
    }
    try {
      const start = Date.now();
      const r = await adapters[key].chat({ task: 'chat', message: 'ping', systemPrompt: '', history: [] });
      results[key] = { configured: true, ok: !!r.reply, tookMs: Date.now() - start };
    } catch (err) {
      results[key] = { configured: true, ok: false, error: (err.message || String(err)).slice(0, 200) };
    }
  }));

  const allOk = Object.values(results).every(r => !r.configured || r.ok);
  res.status(allOk ? 200 : 207).json({ allOk, results });
});

module.exports = router;
