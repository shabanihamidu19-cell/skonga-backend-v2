/**
 * src/routes/chatTitle.js
 * POST /api/chat-title → short AI-generated title for a new chat session.
 */
const express = require('express');
const router = express.Router();
const { generateAIResponse } = require('../services/aiService');

router.post('/chat-title', async (req, res) => {
  const { firstMessage } = req.body || {};
  if (!firstMessage || typeof firstMessage !== 'string') {
    return res.status(400).json({ title: null, error: 'Field "firstMessage" is required.' });
  }

  try {
    const result = await generateAIResponse({
      provider: 'auto',
      task: 'chat',
      systemPrompt:
        'You generate very short chat titles for a student study app. ' +
        'Reply with ONLY the title text — no quotes, no punctuation at the end, max 6 words. ' +
        'Prefer the student\'s language (Swahili or English).',
      message: `Create a short title for this student message:\n${firstMessage.slice(0, 400)}`,
      history: [],
    });

    let title = (result.reply || '').trim().replace(/^["']|["']$/g, '');
    if (title.length > 48) title = title.slice(0, 45).trim() + '…';
    if (!title) title = firstMessage.trim().slice(0, 40) || 'Chat mpya';

    res.json({ title, providerUsed: result.providerUsed || null });
  } catch (err) {
    res.status(200).json({
      title: firstMessage.trim().slice(0, 40) || 'Chat mpya',
      error: err.message || String(err),
    });
  }
});

module.exports = router;
