/**
 * Phase 5 — revenue / payments analytics from in-process payment store.
 * Note: default store is /tmp — set PAYMENT_DATA_DIR to durable disk in production.
 */
const paymentService = require('./paymentService');

const MS_DAY = 86400000;

function startOfUtcDay(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function maskPhone(phone) {
  if (!phone || String(phone).length < 8) return '***';
  const p = String(phone);
  return p.slice(0, 5) + '***' + p.slice(-3);
}

function getRevenueOverview({ days = 30 } = {}) {
  const n = Math.min(90, Math.max(1, Number(days) || 30));
  const since = startOfUtcDay(Date.now() - (n - 1) * MS_DAY);
  const todayStart = startOfUtcDay();

  const allOrders = paymentService.listOrdersInternal();
  const entitlements = paymentService.listEntitlementsInternal();

  const byStatus = {};
  const byPlan = {};
  const byNetwork = {};
  let grossAll = 0;
  let grossWindow = 0;
  let grossToday = 0;
  let paidCount = 0;
  let paidWindow = 0;
  let paidToday = 0;

  const dailyMap = new Map();
  for (let i = 0; i < n; i++) {
    const t = todayStart - (n - 1 - i) * MS_DAY;
    const key = new Date(t).toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, paidOrders: 0, revenueTzs: 0 });
  }

  for (const o of allOrders) {
    const st = o.status || 'unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;

    if (st === 'paid') {
      paidCount += 1;
      const amt = Number(o.amountTzs) || 0;
      grossAll += amt;
      const paidAt = Number(o.paidAt || o.updatedAt || o.createdAt) || 0;

      if (paidAt >= since) {
        paidWindow += 1;
        grossWindow += amt;
        const dayKey = new Date(startOfUtcDay(paidAt)).toISOString().slice(0, 10);
        if (dailyMap.has(dayKey)) {
          const row = dailyMap.get(dayKey);
          row.paidOrders += 1;
          row.revenueTzs += amt;
        }
      }
      if (paidAt >= todayStart) {
        paidToday += 1;
        grossToday += amt;
      }

      const plan = o.planId || 'unknown';
      if (!byPlan[plan]) byPlan[plan] = { orders: 0, revenueTzs: 0 };
      byPlan[plan].orders += 1;
      byPlan[plan].revenueTzs += amt;

      const net = o.network || 'unknown';
      if (!byNetwork[net]) byNetwork[net] = { orders: 0, revenueTzs: 0 };
      byNetwork[net].orders += 1;
      byNetwork[net].revenueTzs += amt;
    }
  }

  const now = Date.now();
  let activePro = 0;
  for (const ent of entitlements) {
    if (ent.expiresAt && ent.expiresAt > now) activePro += 1;
  }

  const recentPaid = allOrders
    .filter((o) => o.status === 'paid')
    .sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0))
    .slice(0, 25)
    .map((o) => ({
      orderId: o.orderId,
      planId: o.planId,
      amountTzs: o.amountTzs,
      network: o.network,
      phone: maskPhone(o.phone),
      uid: o.uid ? String(o.uid).slice(0, 12) + '…' : null,
      paidAt: o.paidAt || null,
      createdAt: o.createdAt || null,
    }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    timezone: 'UTC',
    days: n,
    storage: {
      note:
        'Orders live in PAYMENT_DATA_DIR (default /tmp — ephemeral on Render unless set to durable path)',
      mode: paymentService.PAYMENT_MODE,
      provider: paymentService.PROVIDER,
      clickpesa: paymentService.clickpesaConfigured(),
    },
    totals: {
      ordersAll: allOrders.length,
      paidAll: paidCount,
      grossTzsAll: grossAll,
      paidInWindow: paidWindow,
      grossTzsInWindow: grossWindow,
      paidToday,
      grossTzsToday: grossToday,
      activeDevicePro: activePro,
    },
    byStatus,
    byPlan,
    byNetwork,
    daily: Array.from(dailyMap.values()),
    recentPaid,
  };
}

module.exports = { getRevenueOverview };
