/**
 * src/routes/chat.js
 * POST /api/chat            → full JSON response (standardized)
 * POST /api/chat/stream      → Server-Sent Events streaming
 * Usage: chat|scan (+ rag_query when Library hits).
 * Semantic cache: educational non-personal queries cached (TTL + Jaccard).
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');
const { checkUsage, recordUsage } = require('../services/usageClient');
const semanticCache = require('../services/semanticCache');

function resolveUserId(req) {
  const body = req.body || {};
  if (body.userId && typeof body.userId === 'string') return body.userId.slice(0, 128);
  const h = req.headers['x-skonga-user-id'];
  if (h && typeof h === 'string') return h.slice(0, 128);
  return null;
}

function usageActionForTask(task) {
  if (task === 'vision' || task === 'scan') return 'scan';
  if (task === 'image' || task === 'image_generation') return 'image_generation';
  return 'chat';
}

function profileFromBody(body) {
  return {
    formLevel: body.formLevel ?? body.form ?? body.formHint ?? null,
    combinationCode: body.combinationCode || body.tahasusi || body.combination || '',
    preferredSubjects: Array.isArray(body.preferredSubjects)
      ? body.preferredSubjects
      : Array.isArray(body.subjects)
        ? body.subjects
        : [],
  };
}

function recordSuccessUsage(userId, action, result, library, extraMeta = {}) {
  if (!userId || !result || result.error) return;
  if (action === 'chat' && !result.reply) return;
  if (action === 'scan' && !result.reply) return;
  recordUsage({
    userId,
    action,
    units: 1,
    metadata: { provider: result.providerUsed, task: extraMeta.task, ...extraMeta },
  }).catch(() => {});
  if (library && library.ok) {
    recordUsage({
      userId,
      action: 'rag_query',
      units: 1,
      metadata: { route: extraMeta.route || 'chat', topics: library.topics_found },
    }).catch(() => {});
  }
}

function canUseSemanticCache(task, history, images) {
  if (task && task !== 'chat') return false;
  if (images && images.length) return false;
  return true;
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
  const profile = profileFromBody(req.body || {});

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

  let cacheHit = null;
  if (canUseSemanticCache(task, history, images)) {
    try {
      cacheHit = semanticCache.lookup(message);
    } catch (_) {
      cacheHit = { hit: false };
    }
  }

  if (cacheHit && cacheHit.hit && cacheHit.reply) {
    return res.status(200).json({
      reply: cacheHit.reply,
      providerUsed: 'cache',
      modelUsed: 'semantic-cache',
      tokens: null,
      error: null,
      cacheHit: true,
      cacheScore: cacheHit.score,
      citations: (cacheHit.meta && cacheHit.meta.citations) || [],
      curriculumAligned: !!(cacheHit.meta && cacheHit.meta.curriculumAligned),
      usage: quota.skipped
        ? { skipped: true }
        : { plan: quota.quota?.plan, remaining: quota.quota?.remaining },
    });
  }

  const baseSystemPrompt = buildSystemPrompt({
    systemPrompt,
    userName,
    lang,
    style,
    identityQuestionCount,
    formLevel: profile.formLevel,
    combinationCode: profile.combinationCode,
    preferredSubjects: profile.preferredSubjects,
  });
  const library = await getRagContext({
    query: message,
    subjectHint,
    formHint: formHint || profile.formLevel,
  });
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

  if (result.reply && !result.error) {
    recordSuccessUsage(userId, action, result, library, { task, route: 'chat' });
    if (canUseSemanticCache(task, history, images)) {
      try {
        semanticCache.put(message, result.reply, {
          citations: library?.citations || [],
          curriculumAligned: !!library?.curriculum_aligned,
          provider: result.providerUsed,
        });
      } catch (_) {}
    }
  }

  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    cacheHit: false,
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
  const profile = profileFromBody(req.body || {});

  const quota = await checkUsage({ userId, action });
  if (!quota.allowed) {
    return res.status(403).json({
      error: quota.error || 'Daily limit reached. Upgrade to Pro.',
      code: 'QUOTA_EXCEEDED',
      quota: quota.quota || null,
    });
  }

  if (canUseSemanticCache(task, history, [])) {
    try {
      const hit = semanticCache.lookup(message);
      if (hit && hit.hit && hit.reply) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const chunkSize = 48;
        for (let i = 0; i < hit.reply.length; i += chunkSize) {
          const token = hit.reply.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
        res.write(
          `data: ${JSON.stringify({
            done: true,
            providerUsed: 'cache',
            modelUsed: 'semantic-cache',
            cacheHit: true,
            cacheScore: hit.score,
            error: null,
            citations: (hit.meta && hit.meta.citations) || [],
            curriculumAligned: !!(hit.meta && hit.meta.curriculumAligned),
          })}\n\n`
        );
        return res.end();
      }
    } catch (_) {}
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
    formLevel: profile.formLevel,
    combinationCode: profile.combinationCode,
    preferredSubjects: profile.preferredSubjects,
  });
  const library = await getRagContext({
    query: message,
    subjectHint,
    formHint: formHint || profile.formLevel,
  });
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

    if (result.reply !== false && !result.error) {
      recordSuccessUsage(userId, action, result, library, { task, route: 'chat/stream', stream: true });
      if (result.reply && canUseSemanticCache(task, history, [])) {
        try {
          semanticCache.put(message, result.reply, {
            citations: library?.citations || [],
            curriculumAligned: !!library?.curriculum_aligned,
            provider: result.providerUsed,
          });
        } catch (_) {}
      }
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
