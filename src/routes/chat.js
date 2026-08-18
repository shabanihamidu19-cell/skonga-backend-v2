/**
 * src/routes/chat.js
 * POST /api/chat            → full JSON response (standardized)
 * POST /api/chat/stream      → Server-Sent Events streaming
 *
 * Usage: before AI, check quota via auth-content-service (optional).
 * Client should send userId (from auth-content JWT sub) when logged in.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');
const { checkUsage, recordUsage } = require('../services/usageClient');

function resolveUserId(req) {
  const body = req.body || {};
  // Prefer explicit userId from app (auth-content user id)
  if (body.userId && typeof body.userId === 'string') return body.userId.slice(0, 128);
  // Optional: Authorization Bearer from auth-content (decode not done here — app sends userId)
  const h = req.headers['x-skonga-user-id'];
  if (h && typeof h === 'string') return h.slice(0, 128);
  return null;
}

function usageActionForTask(task) {
  if (task === 'vision' || task === 'scan') return 'scan';
  if (task === 'image' || task === 'image_generation') return 'image_generation';
  return 'chat';
}

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
    return res.status(400).json({
      reply: null,
      providerUsed: null,
      modelUsed: null,
      tokens: null,
      error: 'Field "message" is required.',
    });
  }

  const userId = resolveUserId(req);
  const action = usageActionForTask(task);

  const quota = await checkUsage({ userId, action });
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

  const baseSystemPrompt = buildSystemPrompt({
    systemPrompt,
    userName,
    lang,
    style,
    identityQuestionCount,
  });
  const library = await getRagContext({ query: message, subjectHint, formHint });
  const finalSystemPrompt = injectCurriculumContext(
    baseSystemPrompt,
    library,
    curriculumContext
  );

  const result = await generateAIResponse({
    provider,
    task,
    message,
    history,
    systemPrompt: finalSystemPrompt,
    images,
  });

  // Count only successful replies
  if (result.reply && !result.error && userId) {
    recordUsage({
      userId,
      action,
      units: 1,
      metadata: { provider: result.providerUsed, task },
    }).catch(() => {});
  }

  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
    usage: quota.skipped ? { skipped: true } : { plan: quota.quota?.plan, remaining: quota.quota?.remaining },
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

  const userId = resolveUserId(req);
  const action = usageActionForTask(task);

  const quota = await checkUsage({ userId, action });
  if (!quota.allowed) {
    return res.status(403).json({
      error: quota.error || 'Daily limit reached. Upgrade to Pro.',
      code: 'QUOTA_EXCEEDED',
      quota: quota.quota || null,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const onToken = (token) => {
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  };

  const baseSystemPrompt = buildSystemPrompt({
    systemPrompt,
    userName,
    lang,
    style,
    identityQuestionCount,
  });
  const library = await getRagContext({ query: message, subjectHint, formHint });
  const finalSystemPrompt = injectCurriculumContext(
    baseSystemPrompt,
    library,
    curriculumContext
  );

  try {
    const result = await generateAIResponse({
      provider,
      task,
      message,
      history,
      systemPrompt: finalSystemPrompt,
      stream: true,
      onToken,
    });

    if (result.reply !== false && !result.error && userId) {
      recordUsage({
        userId,
        action,
        units: 1,
        metadata: { provider: result.providerUsed, task, stream: true },
      }).catch(() => {});
    }

    res.write(
      `data: ${JSON.stringify({
        done: true,
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
        error: result.error,
        citations: library?.citations || [],
        curriculumAligned: !!library?.curriculum_aligned,
      })}\n\n`
    );
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({ done: true, error: err.message || String(err) })}\n\n`
    );
  } finally {
    res.end();
  }
});

module.exports = router;
