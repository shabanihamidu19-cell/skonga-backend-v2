/**
 * src/routes/feedback.js
 * POST /api/feedback → records 👍/👎 from users (logs for now;
 * later connect it to a database if you need to analyze bad replies).
 */
const express = require('express');
const router = express.Router();

router.post('/feedback', (req, res) => {
  const { type, message, ts } = req.body || {};
  console.log(`[FEEDBACK] ${type} @ ${new Date(ts || Date.now()).toISOString()}: ${(message || '').slice(0, 200)}`);
  res.json({ ok: true });
});

module.exports = router;
