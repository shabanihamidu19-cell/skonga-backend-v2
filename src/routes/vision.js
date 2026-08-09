/**
 * src/routes/vision.js
 * POST /api/vision → image analysis + optional curriculum RAG.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');

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
  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
  });
});

module.exports = router;
