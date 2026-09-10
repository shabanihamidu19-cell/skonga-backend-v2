/**
 * src/routes/vision.js
 * POST /api/vision → image analysis + optional curriculum RAG.
 * Usage: action=scan (+ rag_query when Library returns topics).
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');
const { checkUsage, recordUsage } = require('../services/usageClient');

function resolveUserId(req) {
  const body = req.body || {};
  if (body.userId && typeof body.userId === 'string') return body.userId.slice(0, 128);
  const h = req.headers['x-skonga-user-id'];
  if (h && typeof h === 'string') return h.slice(0, 128);
  return null;
}

router.post('/vision', async (req, res) => {
  const {
    provider = 'auto',
    message,
    prompt,
    images,
    imageBase64,
    systemPrompt = '',
    history = [],
    userName = '',
    lang = '',
    style = '',
    identityQuestionCount = 0,
    curriculumContext = null,
    subjectHint = null,
    formHint = null,
  } = req.body || {};

  const resolvedImages = Array.isArray(images) && images.length
    ? images
    : (imageBase64 ? [imageBase64] : []);
  const resolvedMessage = message || prompt || 'Analyze this image in detail.';

  if (!resolvedImages.length) {
    return res.status(400).json({ reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'An image is required (send it as "imageBase64" or "images").' });
  }

  const userId = resolveUserId(req);
  const quota = await checkUsage({ userId, action: 'scan' });
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

  let baseSystemPrompt = buildSystemPrompt({ systemPrompt, userName, lang, style, identityQuestionCount });
  const library = await getRagContext({ query: resolvedMessage, subjectHint, formHint });
  baseSystemPrompt = injectCurriculumContext(baseSystemPrompt, library, curriculumContext);

  const result = await generateAIResponse({
    provider,
    task: 'vision',
    message: resolvedMessage,
    images: resolvedImages,
    systemPrompt: baseSystemPrompt,
    history,
  });

  if (result.reply && !result.error && userId) {
    recordUsage({
      userId,
      action: 'scan',
      units: 1,
      metadata: { provider: result.providerUsed, route: 'vision' },
    }).catch(() => {});
    if (library && library.ok) {
      recordUsage({
        userId,
        action: 'rag_query',
        units: 1,
        metadata: { route: 'vision', topics: library.topics_found },
      }).catch(() => {});
    }
  }

  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
    usage: quota.skipped ? { skipped: true } : { plan: quota.quota?.plan, remaining: quota.quota?.remaining },
  });
});

module.exports = router;
