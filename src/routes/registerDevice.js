/**
 * src/routes/registerDevice.js
 * POST /api/register-device → stores (or logs) a push device token.
 * Phase 1: log only. Later wire to FCM/APNs + a real store.
 */
const express = require('express');
const router = express.Router();

router.post('/register-device', (req, res) => {
  const { sessionId, deviceToken, platform } = req.body || {};
  if (!deviceToken || typeof deviceToken !== 'string') {
    return res.status(400).json({ ok: false, error: 'Field "deviceToken" is required.' });
  }
  console.log(
    `[REGISTER-DEVICE] platform=${platform || 'unknown'} session=${(sessionId || '').slice(0, 24)} token=${deviceToken.slice(0, 12)}…`
  );
  res.json({ ok: true });
});

module.exports = router;
