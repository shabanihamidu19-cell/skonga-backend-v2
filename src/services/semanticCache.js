/**
 * src/services/semanticCache.js
 * Lightweight in-memory semantic-ish cache for educational Q&A.
 * - Exact + normalized key match (fast path)
 * - Optional soft similarity via shared token Jaccard (no external deps)
 * - Only caches non-personal, general educational replies
 * - TTL + max size to protect memory on free-tier hosts
 */

const crypto = require('crypto');

const TTL_MS = Number(process.env.SEMANTIC_CACHE_TTL_MS || 6 * 60 * 60 * 1000); // 6h
const MAX_ENTRIES = Number(process.env.SEMANTIC_CACHE_MAX || 400);
const SIM_THRESHOLD = Number(process.env.SEMANTIC_CACHE_THRESHOLD || 0.82);

/** @type {Map<string, { reply: string, ts: number, meta: object, tokens: Set<string> }>} */
const store = new Map();

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return new Set(normalize(text).split(' ').filter((w) => w.length > 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function isCacheable(message, reply) {
  if (!message || !reply) return false;
  const m = String(message).toLowerCase();
  // Skip personal / private context
  if (/\b(my name is|ninaishi|namba yangu|password|pin|account|email@|phone|simu yangu)\b/i.test(m)) {
    return false;
  }
  // Prefer educational-looking content
  if (reply.length < 40) return false;
  return true;
}

function hashKey(normalized) {
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function prune() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.ts > TTL_MS) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

/**
 * Lookup cached reply for a user message.
 * @returns {{ hit: boolean, reply?: string, score?: number, key?: string }}
 */
function lookup(message) {
  prune();
  const norm = normalize(message);
  if (norm.length < 8) return { hit: false };

  const exactKey = hashKey(norm);
  const exact = store.get(exactKey);
  if (exact && Date.now() - exact.ts <= TTL_MS) {
    return { hit: true, reply: exact.reply, score: 1, key: exactKey, meta: exact.meta };
  }

  // Soft similarity scan (capped for performance)
  const qTokens = tokenize(norm);
  let best = null;
  let bestScore = 0;
  let scanned = 0;
  for (const [k, v] of store) {
    if (Date.now() - v.ts > TTL_MS) continue;
    const score = jaccard(qTokens, v.tokens);
    if (score > bestScore) {
      bestScore = score;
      best = { key: k, entry: v };
    }
    if (++scanned > 120) break; // free-tier safety
  }

  if (best && bestScore >= SIM_THRESHOLD) {
    return {
      hit: true,
      reply: best.entry.reply,
      score: bestScore,
      key: best.key,
      meta: best.entry.meta,
    };
  }
  return { hit: false };
}

/**
 * Store a reply if it is safe / educational.
 */
function put(message, reply, meta = {}) {
  if (!isCacheable(message, reply)) return false;
  prune();
  const norm = normalize(message);
  const key = hashKey(norm);
  store.set(key, {
    reply: String(reply),
    ts: Date.now(),
    meta: { ...meta, cachedAt: new Date().toISOString() },
    tokens: tokenize(norm),
  });
  return true;
}

function stats() {
  prune();
  return { size: store.size, ttlMs: TTL_MS, threshold: SIM_THRESHOLD, max: MAX_ENTRIES };
}

module.exports = { lookup, put, stats, normalize };
