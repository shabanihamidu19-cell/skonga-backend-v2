/**
 * src/routes/image.js
 * POST /api/image → image generation (Educational purposes ONLY).
 * Usage: action=image_generation when USAGE_ENABLED + userId.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { checkUsage, recordUsage } = require('../services/usageClient');

function resolveUserId(req) {
  const body = req.body || {};
  if (body.userId && typeof body.userId === 'string') return body.userId.slice(0, 128);
  const h = req.headers['x-skonga-user-id'];
  if (h && typeof h === 'string') return h.slice(0, 128);
  return null;
}

router.post('/image', async (req, res) => {
  const { provider = 'auto', prompt, size = '1024x1024' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'Field "prompt" is required.' });
  }

  const userId = resolveUserId(req);
  const quota = await checkUsage({ userId, action: 'image_generation' });
  if (!quota.allowed) {
    return res.status(403).json({
      reply: null,
      providerUsed: null,
      modelUsed: null,
      tokens: null,
      error: quota.error || 'Daily limit reached. Upgrade to Pro.',
      code: 'QUOTA_EXCEEDED',
      quota: quota.quota || null,
    });
  }

  const result = await generateAIResponse({ provider, task: 'imageGen', message: prompt, prompt, size });
  if (result.error) console.error('[IMAGE ROUTE ERROR]', result.error);

  if ((result.imageUrl || result.imageBase64) && !result.error && userId) {
    recordUsage({
      userId,
      action: 'image_generation',
      units: 1,
      metadata: { provider: result.providerUsed, route: 'image' },
    }).catch(() => {});
  }

  const statusCode = result.error && !result.imageUrl && !result.imageBase64 ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    usage: quota.skipped ? { skipped: true } : { plan: quota.quota?.plan, remaining: quota.quota?.remaining },
  });
});

module.exports = router;
