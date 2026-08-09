/**
 * src/services/statsService.js
 * Records: request count, failed requests, average response time,
 * and usage per provider. For real production use (thousands of
 * students), swap this storage for Redis/Postgres - here we use
 * in-memory + a JSON snapshot for quick testing.
 */
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', '..', 'stats-snapshot.json');

const state = {
  totalRequests: 0,
  failedRequests: 0,
  totalResponseTimeMs: 0,
  providerUsage: {}, // { groq: { count, fails, totalTimeMs } }
};

function loadSnapshot() {
  try {
    if (!fs.existsSync(STATS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return;
    state.totalRequests = Number(raw.totalRequests) || 0;
    state.failedRequests = Number(raw.failedRequests) || 0;
    // Reconstruct totals from per-provider averages when possible
    const usage = raw.providerUsage || {};
    let summedTime = 0;
    for (const [key, v] of Object.entries(usage)) {
      const count = Number(v.count) || 0;
      const fails = Number(v.fails) || 0;
      const avg = Number(v.avgTimeMs) || 0;
      state.providerUsage[key] = {
        count,
        fails,
        totalTimeMs: count * avg,
      };
      summedTime += count * avg;
    }
    state.totalResponseTimeMs = summedTime || Number(raw.avgResponseTimeMs || 0) * state.totalRequests;
  } catch (err) {
    console.warn('[stats] could not load snapshot:', err.message || err);
  }
}
loadSnapshot();

function ensureProvider(key) {
  if (!state.providerUsage[key]) {
    state.providerUsage[key] = { count: 0, fails: 0, totalTimeMs: 0 };
  }
  return state.providerUsage[key];
}

function recordSuccess(providerKey, durationMs) {
  state.totalRequests += 1;
  state.totalResponseTimeMs += durationMs;
  const p = ensureProvider(providerKey);
  p.count += 1;
  p.totalTimeMs += durationMs;
  persistDebounced();
}

function recordFailure(providerKey, durationMs) {
  state.totalRequests += 1;
  state.failedRequests += 1;
  state.totalResponseTimeMs += durationMs;
  const p = ensureProvider(providerKey);
  p.count += 1;
  p.fails += 1;
  p.totalTimeMs += durationMs;
  persistDebounced();
}

function getSnapshot() {
  const avgResponseTimeMs = state.totalRequests ? Math.round(state.totalResponseTimeMs / state.totalRequests) : 0;
  const providerUsage = {};
  for (const [key, v] of Object.entries(state.providerUsage)) {
    providerUsage[key] = {
      count: v.count,
      fails: v.fails,
      avgTimeMs: v.count ? Math.round(v.totalTimeMs / v.count) : 0,
    };
  }
  return {
    totalRequests: state.totalRequests,
    failedRequests: state.failedRequests,
    successRate: state.totalRequests ? Number((((state.totalRequests - state.failedRequests) / state.totalRequests) * 100).toFixed(1)) : 100,
    avgResponseTimeMs,
    providerUsage,
  };
}

let persistTimer = null;
function persistDebounced() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    fs.writeFile(STATS_FILE, JSON.stringify(getSnapshot(), null, 2), () => {});
  }, 2000);
}

module.exports = { recordSuccess, recordFailure, getSnapshot };
