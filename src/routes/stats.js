/**
 * src/routes/stats.js
 * GET /api/stats → usage statistics (requests, failures, avg time, per-provider)
 */
const express = require('express');
const router = express.Router();
const statsService = require('../services/statsService');

router.get('/stats', (req, res) => {
  res.json(statsService.getSnapshot());
});

module.exports = router;
