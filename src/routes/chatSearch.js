/**
 * src/routes/chatSearch.js
 * POST /api/chat-search → Live Search + optional curriculum RAG + visuals.
 * Usage: action=chat (+ rag_query when Library hits).
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const tavilyService = require('../services/tavilyService');
const { shouldSearch } = require('../utils/intentDetection');
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

router.post('/chat-search', async (req, res) => {
  const {
    provider = 'auto',
    message,
    history = [],
    systemPrompt = '',
    forceSearch = false,
    userName = '',
    lang = '',
    style = '',
    identityQuestionCount = 0,
    curriculumContext = null,
    subjectHint = null,
    formHint = null,
    formLevel = null,
    combinationCode = '',
    tahasusi = '',
    preferredSubjects = [],
    subjects = [],
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
  const quota = await checkUsage({ userId, action: 'chat' });
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

  const doSearch = forceSearch || shouldSearch(message);
  let baseSystemPrompt = buildSystemPrompt({
    systemPrompt,
    userName,
    lang,
    style,
    identityQuestionCount,
    formLevel: formLevel ?? formHint,
    combinationCode: combinationCode || tahasusi,
    preferredSubjects: Array.isArray(preferredSubjects)
      ? preferredSubjects
      : Array.isArray(subjects)
        ? subjects
        : [],
  });

  const library = await getRagContext({
    query: message,
    subjectHint,
    formHint: formHint || formLevel,
  });
  baseSystemPrompt = injectCurriculumContext(baseSystemPrompt, library, curriculumContext);

  let sources = [];
  let visuals = [];
  let groundedSystemPrompt = baseSystemPrompt;

  if (doSearch) {
    try {
      const searchPayload = await tavilyService.webSearch(message);
      const results = searchPayload.results || [];
      visuals = searchPayload.visuals || [];

      sources = results.map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        kind: 'google',
        image: r.image || null,
      }));

      for (const s of sources) {
        if (s.image) continue;
        const match = visuals.find(
          (v) =>
            v.domain &&
            s.domain &&
            (v.domain === s.domain || v.sourceUrl === s.url)
        );
        if (match) s.image = match.imageUrl;
      }

      const context = results
        .map((r, i) => `[${i + 1}] ${r.title} (${r.domain}): ${r.content}`)
        .join('\n');

      const visualNote =
        visuals.length > 0
          ? `\n\nRelated images were found for this query (${visuals.length}). The app will display them to the student; you may briefly refer to a diagram/screenshot if it helps understanding.`
          : '';

      groundedSystemPrompt = `${baseSystemPrompt}\n\nHere are the latest web search results relevant to the user's question. Use them to answer accurately, and briefly cite the source when confident:\n${context}${visualNote}`;
    } catch (err) {
      sources = [];
      visuals = [];
      groundedSystemPrompt = `${baseSystemPrompt}\n\n(Note: Live Search was unavailable right now - ${err.message}. Answer from your general knowledge and let the user know the info might not be fully up to date.)`;
    }
  }

  const result = await generateAIResponse({
    provider,
    task: 'chat',
    message,
    history,
    systemPrompt: groundedSystemPrompt,
  });

  if (result.reply && !result.error && userId) {
    recordUsage({
      userId,
      action: 'chat',
      units: 1,
      metadata: { provider: result.providerUsed, route: 'chat-search', searched: !!doSearch },
    }).catch(() => {});
    if (library && library.ok) {
      recordUsage({
        userId,
        action: 'rag_query',
        units: 1,
        metadata: { route: 'chat-search', topics: library.topics_found },
      }).catch(() => {});
    }
  }

  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    sources,
    visuals,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
    usage: quota.skipped ? { skipped: true } : { plan: quota.quota?.plan, remaining: quota.quota?.remaining },
  });
});

module.exports = router;
