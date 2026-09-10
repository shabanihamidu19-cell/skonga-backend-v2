/**
 * proSyncClient.js
 * After payment marks Pro on this backend (device session), also push
 * plan=pro to skonga-auth-content-service so usage quotas unlock.
 *
 * Uses same USAGE_API_URL + USAGE_SERVICE_TOKEN as usageClient.
 * Fail-soft: payment still succeeds if auth-content is down.
 */
const USAGE_ENABLED = String(process.env.USAGE_ENABLED || 'false').toLowerCase() === 'true';
const USAGE_API_URL = (process.env.USAGE_API_URL || '').replace(/\/$/, '');
const USAGE_SERVICE_TOKEN = process.env.USAGE_SERVICE_TOKEN || '';
const USAGE_TIMEOUT_MS = Number(process.env.USAGE_TIMEOUT_MS || 4000);

function enabled() {
  return USAGE_ENABLED && !!USAGE_API_URL && !!USAGE_SERVICE_TOKEN;
}

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), USAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {{
 *   userId: string,
 *   days?: number,
 *   planId?: string,
 *   expiresAt?: number,
 *   orderId?: string,
 * }}
 */
async function syncProGrant({
  userId,
  days,
  planId,
  expiresAt,
  orderId,
} = {}) {
  if (!enabled()) {
    return { skipped: true, reason: 'usage_disabled' };
  }
  if (!userId) {
    return { skipped: true, reason: 'no_user_id' };
  }
  try {
    const { ok, status, data } = await fetchJson(`${USAGE_API_URL}/api/internal/pro/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': USAGE_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        userId: String(userId).slice(0, 128),
        days: days || undefined,
        planId: planId || undefined,
        expiresAt: expiresAt || undefined,
        orderId: orderId || undefined,
      }),
    });
    if (!ok) {
      console.warn('[pro-sync] grant failed', status, data);
      return { ok: false, status, data };
    }
    console.log('[pro-sync] granted', userId, planId || 'pro', data?.subscription?.expiresAt);
    return { ok: true, data };
  } catch (err) {
    console.warn('[pro-sync] error', err.message);
    return { ok: false, error: err.message };
  }
}

async function fetchProStatus(userId) {
  if (!enabled() || !userId) return { skipped: true };
  try {
    const q = new URLSearchParams({ userId: String(userId) });
    const { ok, status, data } = await fetchJson(
      `${USAGE_API_URL}/api/internal/pro/status?${q}`,
      {
        method: 'GET',
        headers: {
          'X-Service-Token': USAGE_SERVICE_TOKEN,
          Accept: 'application/json',
        },
      }
    );
    if (!ok) return { ok: false, status, data };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { syncProGrant, fetchProStatus, enabled };
