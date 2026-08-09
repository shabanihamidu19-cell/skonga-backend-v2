/**
 * src/routes/image.js
 * POST /api/image → image generation (Educational purposes ONLY).
 * Currently AIMLAPI and Gemini support this in the config; if you add
 * this capability to BazaarLink later, it'll join the auto fallback automatically.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');

router.post('/image', async (req, res) => {
  const { provider = 'auto', prompt, size = '1024x1024' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'Field "prompt" is required.' });
  }
  const result = await generateAIResponse({ provider, task: 'imageGen', message: prompt, prompt, size });
  if (result.error) console.error('[IMAGE ROUTE ERROR]', result.error);
  const statusCode = result.error && !result.imageUrl && !result.imageBase64 ? 502 : 200;
  res.status(statusCode).json(result);
});

module.exports = router;
