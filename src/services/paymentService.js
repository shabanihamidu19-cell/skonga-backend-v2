/**
 * paymentService.js
 * SKONGA is NOT a mobile-money wallet. PIN never collected here.
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const PLANS = Object.freeze([
  { id: 'day', name: '1 Day', priceTzs: 620, days: 1 },
  { id: 'week', name: '1 Week', priceTzs: 3500, days: 7 },
  { id: 'month', name: '1 Month', priceTzs: 5000, days: 30 },
  { id: 'year', name: '1 Year', priceTzs: 45000, days: 365 },
]);

const orders = new Map();
const entitlements = new Map();

const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'sandbox').toLowerCase();
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || '';
const PROVIDER = process.env.PAYMENT_PROVIDER || 'sandbox';

/** Maintainable prefix → label map (UX only; STK routing is PSP-side). */
const TZ_MM_PREFIX = {
  '25561': 'Yas',
  '25562': 'HaloPesa',
  '25563': 'Mobile money',
  '25564': 'Mobile money',
  '25565': 'Tigo Pesa',
  '25566': 'Yas',
  '25567': 'Tigo Pesa',
  '25568': 'Airtel Money',
  '25569': 'Airtel Money',
  '25571': 'Tigo Pesa',
  '25573': 'Mobile money',
  '25574': 'M-Pesa',
  '25575': 'M-Pesa',
  '25576': 'M-Pesa',
  '25577': 'Zantel',
  '25578': 'Airtel Money',
  '25579': 'Mobile money',
};

function listPlans() {
  return PLANS.map((p) => ({ ...p }));
}

function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || null;
}

/** Normalise TZ phone → 255XXXXXXXXX */
function normalizePhone(input) {
  let p = String(input || '').replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '255' + p.slice(1);
  if (!p.startsWith('255') && /^[67]\d{8}$/.test(p)) p = '255' + p;
  if (!p.startsWith('255') && /^\d{9}$/.test(p)) p = '255' + p;
  return p;
}

/** Valid Tanzania mobile MSISDN (255 + 9 digits starting with 6 or 7). */
function isValidTzPhone(phone) {
  return /^255[67]\d{8}$/.test(phone);
}

/** Operator label for UX / analytics — never reject payment solely on this. */
function detectNetwork(phone) {
  if (!isValidTzPhone(phone)) return null;
  const pre = phone.slice(0, 5);
  return TZ_MM_PREFIX[pre] || 'Mobile money';
}

function entitlementKey({ uid, sessionId }) {
  if (uid) return `uid:${uid}`;
  if (sessionId) return `sid:${sessionId}`;
  return null;
}

function getProStatus({ uid, sessionId }) {
  const key = entitlementKey({ uid, sessionId });
  if (!key) return { active: false, reason: 'no_identity' };
  const ent = entitlements.get(key);
  if (!ent) return { active: false };
  if (Date.now() >= ent.expiresAt) {
    entitlements.delete(key);
    return { active: false, reason: 'expired' };
  }
  return {
    active: true,
    planId: ent.planId,
    planName: ent.planName,
    expiresAt: ent.expiresAt,
    daysLeft: Math.max(0, Math.ceil((ent.expiresAt - Date.now()) / 86400000)),
  };
}

function grantPro({ uid, sessionId }, plan, orderId) {
  const key = entitlementKey({ uid, sessionId });
  if (!key) return null;
  const existing = entitlements.get(key);
  const base = existing && existing.expiresAt > Date.now() ? existing.expiresAt : Date.now();
  const expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
  const ent = {
    planId: plan.id,
    planName: plan.name,
    expiresAt,
    orderId,
    grantedAt: Date.now(),
  };
  entitlements.set(key, ent);
  return ent;
}

function createOrder({ planId, phone, uid, sessionId, clientMeta }) {
  const plan = getPlan(planId);
  if (!plan) {
    const err = new Error('Invalid plan');
    err.code = 'INVALID_PLAN';
    throw err;
  }
  const normalized = normalizePhone(phone);
  if (!isValidTzPhone(normalized)) {
    const err = new Error('Invalid Tanzania mobile number');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  // Network label is optional UX — do not block STK on unknown prefix
  const network = detectNetwork(normalized) || 'Mobile money';

  const orderId = 'skp_' + uuidv4().replace(/-/g, '').slice(0, 20);
  const order = {
    orderId,
    planId: plan.id,
    planName: plan.name,
    amountTzs: plan.priceTzs,
    days: plan.days,
    phone: normalized,
    network,
    uid: uid || null,
    sessionId: sessionId || null,
    status: 'pending',
    provider: PROVIDER,
    mode: PAYMENT_MODE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clientMeta: clientMeta ? { platform: clientMeta.platform || null } : null,
  };

  orders.set(orderId, order);

  if (PAYMENT_MODE === 'sandbox') {
    order.status = 'stk_sent';
    order.sandboxHint =
      'Sandbox: call POST /api/payments/sandbox-confirm with { orderId } to simulate successful payment. Never use this in production.';
  } else {
    order.status = 'stk_sent';
    order.providerNote =
      'Live mode requires PAYMENT_PROVIDER credentials. STK must be initiated by server, not the app.';
  }
  order.updatedAt = Date.now();
  orders.set(orderId, order);

  return publicOrder(order);
}

function publicOrder(order) {
  if (!order) return null;
  return {
    orderId: order.orderId,
    planId: order.planId,
    planName: order.planName,
    amountTzs: order.amountTzs,
    phone: maskPhone(order.phone),
    network: order.network,
    status: order.status,
    mode: order.mode,
    createdAt: order.createdAt,
    sandboxHint: order.sandboxHint || undefined,
  };
}

function maskPhone(phone) {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 5) + '***' + phone.slice(-3);
}

function getOrder(orderId) {
  return orders.get(orderId) || null;
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) {
    if (PAYMENT_MODE === 'sandbox') return true;
    return false;
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function markPaid(orderId, { providerRef } = {}) {
  const order = orders.get(orderId);
  if (!order) {
    const err = new Error('Order not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (order.status === 'paid') {
    return { order: publicOrder(order), pro: getProStatus(order), alreadyPaid: true };
  }
  const plan = getPlan(order.planId);
  order.status = 'paid';
  order.providerRef = providerRef || null;
  order.paidAt = Date.now();
  order.updatedAt = Date.now();
  orders.set(orderId, order);

  const ent = grantPro({ uid: order.uid, sessionId: order.sessionId }, plan, orderId);

  return {
    order: publicOrder(order),
    pro: ent
      ? {
          active: true,
          planId: ent.planId,
          planName: ent.planName,
          expiresAt: ent.expiresAt,
        }
      : { active: false, reason: 'no_identity_on_order' },
  };
}

function markFailed(orderId, reason) {
  const order = orders.get(orderId);
  if (!order) return null;
  if (order.status === 'paid') return publicOrder(order);
  order.status = 'failed';
  order.failReason = String(reason || 'unknown').slice(0, 120);
  order.updatedAt = Date.now();
  orders.set(orderId, order);
  return publicOrder(order);
}

module.exports = {
  listPlans,
  getPlan,
  createOrder,
  getOrder,
  publicOrder,
  markPaid,
  markFailed,
  getProStatus,
  verifyWebhookSignature,
  normalizePhone,
  isValidTzPhone,
  detectNetwork,
  PAYMENT_MODE,
};
