/**
 * src/routes/tahasusi.js
 * Public read-only endpoints for A-Level combinations (2025).
 */
const express = require('express');
const router = express.Router();
const tahasusi = require('../services/tahasusiService');

// GET /api/tahasusi — categories + all combinations (for UI picker)
router.get('/tahasusi', (req, res) => {
  try {
    const q = req.query.q || req.query.search || '';
    if (q) {
      return res.json({ ok: true, results: tahasusi.search(q) });
    }
    return res.json({
      ok: true,
      version: '2025.1',
      categories: tahasusi.listCategories(),
      combinations: tahasusi.listAll(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/tahasusi/:code — single combination e.g. HGE, PCM
router.get('/tahasusi/:code', (req, res) => {
  const found = tahasusi.getByCode(req.params.code);
  if (!found) {
    return res.status(404).json({ ok: false, error: 'Combination not found.' });
  }
  return res.json({ ok: true, combination: found });
});

module.exports = router;
