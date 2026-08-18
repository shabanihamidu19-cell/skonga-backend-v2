/**
 * usageClient.js
 * Talks to skonga-auth-content-service (server-to-server).
 *
 * Auth-content endpoints (X-Service-Token):
 *   GET  /api/internal/usage/check?userId=&action=
 *   POST /api/internal/usage/record  { userId, action, units?, metadata? }
 *
 * If USAGE_ENABLED is false or URL/token missing → allow all (dev mode).
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
 * @param {{ userId: string, action?: string }}
 * @returns {{ allowed: boolean, skipped?: boolean, quota?: object, error?: string }}
 */
async function checkUsage({ userId, action = 'chat' }) {
  if (!enabled()) {
    return { allowed: true, skipped: true, reason: 'usage_disabled' };
  }
  if (!userId) {
    // No identity → treat as free anonymous: allow but do not record against a user
    return { allowed: true, skipped: true, reason: 'no_user_id' };
  }
  try {
    const q = new URLSearchParams({ userId: String(userId), action: String(action) });
    const { ok, status, data } = await fetchJson(
      `${USAGE_API_URL}/api/internal/usage/check?${q}`,
      {
        method: 'GET',
        headers: {
          'X-Service-Token': USAGE_SERVICE_TOKEN,
          Accept: 'application/json',
        },
      }
    );
    if (status === 403 || data.code === 'QUOTA_EXCEEDED' || data.allowed === false) {
      return {
        allowed: false,
        quota: data.quota || data,
        error: data.error || 'Daily limit reached',
      };
    }
    if (!ok) {
      console.warn('[usage] check failed', status, data);
      // Fail-open so AI stays up if auth-content is down
      return { allowed: true, skipped: true, reason: 'check_error', status };
    }
    return {
      allowed: data.allowed !== false,
      quota: data,
    };
  } catch (err) {
    console.warn('[usage] check error', err.message);
    return { allowed: true, skipped: true, reason: 'network_error' };
  }
}

/**
 * Record one unit after a successful AI action.
 */
async function recordUsage({ userId, action = 'chat', units = 1, metadata = null }) {
  if (!enabled() || !userId) return { skipped: true };
  try {
    const { ok, status, data } = await fetchJson(`${USAGE_API_URL}/api/internal/usage/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': USAGE_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        userId: String(userId),
        action: String(action),
        units: units || 1,
        metadata: metadata || undefined,
      }),
    });
    if (!ok) {
      console.warn('[usage] record failed', status, data);
      return { ok: false, status, data };
    }
    return { ok: true, data };
  } catch (err) {
    console.warn('[usage] record error', err.message);
    return { ok: false, error: err.message };
  }
}

function getUsageStatus() {
  return {
    enabled: enabled(),
    url: USAGE_API_URL || null,
    hasToken: !!USAGE_SERVICE_TOKEN,
  };
}

module.exports = {
  checkUsage,
  recordUsage,
  getUsageStatus,
  enabled,
};
