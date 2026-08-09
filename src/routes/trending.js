/**
 * src/routes/trending.js
 * GET /api/trending → "Today's Trending Topics" carousel on the welcome screen.
 * We use AI (Groq, fast and cheap) to generate 6 educational topics,
 * and cache them for one day (in-memory) so we don't call the AI on every request.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');

let cache = { cards: null, generatedAt: 0 };
const CACHE_MS = 24 * 60 * 60 * 1000; // 1 day

const SYSTEM_PROMPT = `You generate educational topics for Tanzanian students (primary/secondary/university).
Return ONLY JSON (no other text, no markdown fences), as an array of 6 items shaped like:
[{"emoji":"📚","subject":"Subject (e.g. Mathematics, Biology, History)","topic":"A short, engaging topic","blurb":"A 1-2 sentence explanation of why this topic matters to learn"}]
Cover a mix of subjects (science, math, languages, history, geography, civics). Write in simple, clear English.`;

router.get('/trending', async (req, res) => {
  const isFresh = cache.cards && (Date.now() - cache.generatedAt) < CACHE_MS;
  if (isFresh) return res.json({ cards: cache.cards, cached: true });

  try {
    const result = await generateAIResponse({
      provider: 'auto',
      task: 'chat',
      systemPrompt: SYSTEM_PROMPT,
      message: 'Generate 6 topics for today.',
    });
    if (!result.reply) throw new Error(result.error || 'No response from AI');

    const cleaned = result.reply.trim().replace(/^```json\s*|```$/g, '');
    const cards = JSON.parse(cleaned);
    if (!Array.isArray(cards) || !cards.length) throw new Error('AI did not return valid JSON structure');

    cache = { cards, generatedAt: Date.now() };
    res.json({ cards, cached: false });
  } catch (err) {
    console.error('[TRENDING ROUTE ERROR]', err.message || err);
    // If it fails and we have no old cache, send a static fallback instead of breaking
    const fallback = cache.cards || [
      { emoji: '📚', subject: 'Education', topic: 'Keep learning every day', blurb: 'Ask SKONGA AI any question about your studies right now.' },
    ];
    res.json({ cards: fallback, cached: true, error: err.message });
  }
});

module.exports = router;
