/**
 * Phase 5 — admin revenue analytics (protected).
 */
const express = require('express');
const { requireServiceToken } = require('../middleware/serviceToken');
const { getRevenueOverview } = require('../services/revenueAnalytics');

const router = express.Router();

router.get('/admin/analytics/revenue', requireServiceToken, (req, res) => {
  try {
    const days = req.query.days;
    res.json(getRevenueOverview({ days }));
  } catch (err) {
    console.error('[admin revenue]', err.message);
    res.status(500).json({ error: err.message || 'Revenue analytics failed' });
  }
});

module.exports = router;
