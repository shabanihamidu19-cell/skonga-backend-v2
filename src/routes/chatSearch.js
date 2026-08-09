/**
 * src/routes/chatSearch.js
 * POST /api/chat-search → Live Search + optional curriculum RAG.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');
const tavilyService = require('../services/tavilyService');
const { shouldSearch } = require('../utils/intentDetection');
const { buildSystemPrompt } = require('../utils/personalize');
const { getRagContext, injectCurriculumContext } = require('../services/libraryService');

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
  } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: null, providerUsed: null, modelUsed: null, tokens: null, error: 'Field "message" is required.' });
  }

  const doSearch = forceSearch || shouldSearch(message);
  let baseSystemPrompt = buildSystemPrompt({ systemPrompt, userName, lang, style, identityQuestionCount });

  const library = await getRagContext({ query: message, subjectHint, formHint });
  baseSystemPrompt = injectCurriculumContext(baseSystemPrompt, library, curriculumContext);

  let sources = [];
  let groundedSystemPrompt = baseSystemPrompt;

  if (doSearch) {
    try {
      const results = await tavilyService.webSearch(message);
      sources = results.map(r => ({ title: r.title, url: r.url, domain: r.domain, kind: 'google' }));
      const context = results.map((r, i) => `[${i + 1}] ${r.title} (${r.domain}): ${r.content}`).join('\n');
      groundedSystemPrompt = `${baseSystemPrompt}\n\nHere are the latest web search results relevant to the user's question. Use them to answer accurately, and briefly cite the source when confident:\n${context}`;
    } catch (err) {
      sources = [];
      groundedSystemPrompt = `${baseSystemPrompt}\n\n(Note: Live Search was unavailable right now - ${err.message}. Answer from your general knowledge and let the user know the info might not be fully up to date.)`;
    }
  }

  const result = await generateAIResponse({ provider, task: 'chat', message, history, systemPrompt: groundedSystemPrompt });
  const statusCode = result.error && !result.reply ? 502 : 200;
  res.status(statusCode).json({
    ...result,
    sources,
    citations: library?.citations || [],
    curriculumAligned: !!library?.curriculum_aligned,
  });
});

module.exports = router;
