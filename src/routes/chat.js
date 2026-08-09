/**
 * src/routes/chat.js
 * POST /api/chat            → full JSON response (standardized)
 * POST /api/chat/stream      → Server-Sent Events streaming
 *
 * Curriculum RAG: before calling the LLM, we optionally fetch context
 * from SKONGA Library API (server-side only). Client may also send
 * curriculumContext as a fallback string; server-fetched context wins.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');

router.post('/chat', async (req, res) => {
  const {
    provider = 'auto',
    message,
    history = [],
    systemPrompt = '',
    task = 'chat',
    images = [],
    userName = '',
    lang = '',
    style = '',
    identityQuestionCount = 0,
    curriculumContext = null,
    subjectHint = null,
    formHint = null,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'Field "message" is required.' });
  }

  const baseSystemPrompt = buildSystemPrompt({ systemPrompt, userName, lang, style, identityQuestionCount });
  const library = await getRagContext({ query: message, subjectHint, formHint });
  const finalSystemPrompt = injectCurriculumContext(baseSystemPrompt, library, curriculumContext);

  const result = await generateAIResponse({ provider, task, message, history, systemPrompt: finalSystemPrompt, images });
  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
  });
});

router.post('/chat/stream', async (req, res) => {
  const {
    provider = 'auto',
    message,
    history = [],
    systemPrompt = '',
    task = 'chat',
    userName = '',
    lang = '',
    style = '',
    identityQuestionCount = 0,
    curriculumContext = null,
    subjectHint = null,
    formHint = null,
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Field "message" is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const onToken = (token) => {
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  };

  const baseSystemPrompt = buildSystemPrompt({ systemPrompt, userName, lang, style, identityQuestionCount });
  const library = await getRagContext({ query: message, subjectHint, formHint });
  const finalSystemPrompt = injectCurriculumContext(baseSystemPrompt, library, curriculumContext);

  try {
    const result = await generateAIResponse({ provider, task, message, history, systemPrompt: finalSystemPrompt, stream: true, onToken });
    res.write(`data: ${JSON.stringify({
      done: true,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      error: result.error,
      citations: library?.citations || [],
      curriculumAligned: !!library?.curriculum_aligned,
    })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ done: true, error: err.message || String(err) })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
