/**
 * paymentService.js
 * SKONGA Pro unlock is device-bound (sessionId), not email.
 * After USSD pay: webhook OR status/sync polls ClickPesa query API.
 *
 * ClickPesa orderReference: alphanumeric, max 20 chars.
 * Phone: always 255XXXXXXXXX (never 06...).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PLANS = Object.freeze([
  { id: 'day', name: '1 Day', priceTzs: 620, days: 1 },
  { id: 'week', name: '1 Week', priceTzs: 3500, days: 7 },
  { id: 'month', name: '1 Month', priceTzs: 5000, days: 30 },
  { id: 'year', name: '1 Year', priceTzs: 45000, days: 365 },
]);

const DATA_DIR = process.env.PAYMENT_DATA_DIR || path.join('/tmp', 'skonga-payments');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ENT_FILE = path.join(DATA_DIR, 'entitlements.json');

const orders = new Map();
const entitlements = new Map();

const PROVIDER = (process.env.PAYMENT_PROVIDER || process.env.SKONGA_PAYMENT_PROVIDER || 'sandbox').toLowerCase();
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || process.env.SKONGA_PAYMENT_WEBHOOK_SECRET || '';
const _modeEnv = (process.env.PAYMENT_MODE || process.env.SKONGA_PAYMENT_MODE || '').toLowerCase();
const PAYMENT_MODE =
  PROVIDER === 'clickpesa'
    ? 'live'
    : (_modeEnv === 'live' || _modeEnv === 'sandbox' ? _modeEnv : 'sandbox');

const CLICKPESA = {
  clientId: (process.env.CLICKPESA_CLIENT_ID || '').trim(),
  apiKey: (process.env.CLICKPESA_API_KEY || '').trim(),
  baseUrl: (process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com/third-parties').replace(/\/$/, ''),
};

let cachedToken = null;
let tokenExpiresAt = 0;

const TZ_MM_PREFIX = {
  '25561': 'Yas', '25562': 'HaloPesa', '25563': 'Mobile money', '25564': 'Mobile money',
  '25565': 'Tigo Pesa', '25566': 'Yas', '25567': 'Tigo Pesa', '25568': 'Airtel Money',
  '25569': 'Airtel Money', '25571': 'Tigo Pesa', '25573': 'Mobile money', '25574': 'M-Pesa',
  '25575': 'M-Pesa', '25576': 'M-Pesa', '25577': 'Zantel', '25578': 'Airtel Money',
  '25579': 'Mobile money',
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function loadStore() {
  ensureDataDir();
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
      Object.entries(raw || {}).forEach(([k, v]) => orders.set(k, v));
    }
  } catch (e) { console.warn('[PAY] load orders', e.message); }
  try {
    if (fs.existsSync(ENT_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ENT_FILE, 'utf8'));
      Object.entries(raw || {}).forEach(([k, v]) => entitlements.set(k, v));
    }
  } catch (e) { console.warn('[PAY] load entitlements', e.message); }
}

function saveOrders() {
  ensureDataDir();
  try {
    const obj = {};
    orders.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(obj));
  } catch (e) { console.warn('[PAY] save orders', e.message); }
}

function saveEntitlements() {
  ensureDataDir();
  try {
    const obj = {};
    entitlements.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(ENT_FILE, JSON.stringify(obj));
  } catch (e) { console.warn('[PAY] save entitlements', e.message); }
}

loadStore();

function listPlans() {
  return PLANS.map((p) => ({ ...p }));
}

function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || null;
}

/** Always output 255XXXXXXXXX (never 06...). */
function normalizePhone(input) {
  let p = String(input || '').replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '255' + p.slice(1);
  if (!p.startsWith('255') && /^[67]\d{8}$/.test(p)) p = '255' + p;
  if (!p.startsWith('255') && /^\d{9}$/.test(p)) p = '255' + p;
  return p;
}

function isValidTzPhone(phone) {
  return /^255[67]\d{8}$/.test(phone);
}

function detectNetwork(phone) {
  if (!isValidTzPhone(phone)) return null;
  return TZ_MM_PREFIX[phone.slice(0, 5)] || 'Mobile money';
}

function entitlementKey({ uid, sessionId }) {
  if (sessionId) return `sid:${sessionId}`;
  if (uid) return `uid:${uid}`;
  return null;
}

function getProStatus({ uid, sessionId }) {
  const key = entitlementKey({ uid, sessionId });
  if (!key) return { active: false, reason: 'no_identity' };
  const ent = entitlements.get(key);
  if (!ent) return { active: false };
  if (Date.now() >= ent.expiresAt) {
    entitlements.delete(key);
    saveEntitlements();
    return { active: false, reason: 'expired' };
  }
  return {
    active: true,
    planId: ent.planId,
    planName: ent.planName,
    expiresAt: ent.expiresAt,
    daysLeft: Math.max(0, Math.ceil((ent.expiresAt - Date.now()) / 86400000)),
    orderId: ent.orderId || null,
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
  saveEntitlements();
  return ent;
}

function clickpesaConfigured() {
  return !!(CLICKPESA.clientId && CLICKPESA.apiKey);
}

async function getClickpesaToken(force = false) {
  if (!clickpesaConfigured()) {
    const err = new Error('ClickPesa not configured');
    err.code = 'CLICKPESA_CONFIG';
    throw err;
  }
  const now = Date.now();
  if (!force && cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;
  const res = await fetch(`${CLICKPESA.baseUrl}/generate-token`, {
    method: 'POST',
    headers: { 'client-id': CLICKPESA.clientId, 'api-key': CLICKPESA.apiKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    const err = new Error(data.message || data.error || 'ClickPesa token failed');
    err.code = 'CLICKPESA_TOKEN';
    throw err;
  }
  let token = String(data.token).trim();
  if (!token.toLowerCase().startsWith('bearer ')) token = `Bearer ${token}`;
  cachedToken = token;
  tokenExpiresAt = now + 55 * 60 * 1000;
  return cachedToken;
}

async function clickpesaUssdPush({ amount, orderReference, phoneNumber }) {
  const token = await getClickpesaToken();
  const ref = String(orderReference).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  const body = {
    amount: String(amount),
    currency: 'TZS',
    orderReference: ref,
    phoneNumber: String(phoneNumber),
  };
  async function doPush(authHeader) {
    const res = await fetch(`${CLICKPESA.baseUrl}/payments/initiate-ussd-push-request`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }
  let { res, data } = await doPush(token);
  if (res.status === 401) {
    ({ res, data } = await doPush(await getClickpesaToken(true)));
  }
  if (!res.ok) {
    console.error('[ClickPesa] USSD push failed', res.status, data);
    const err = new Error(data.message || data.error || 'ClickPesa USSD push failed');
    err.code = 'CLICKPESA_PUSH';
    throw err;
  }
  return data;
}

/** GET /third-parties/payments/{orderReference} */
async function queryClickpesaPayment(orderReference) {
  const token = await getClickpesaToken();
  const ref = String(orderReference).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  const res = await fetch(`${CLICKPESA.baseUrl}/payments/${encodeURIComponent(ref)}`, {
    method: 'GET',
    headers: { Authorization: token },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.warn('[ClickPesa] query failed', res.status, data);
    return null;
  }
  // API may return array or object
  if (Array.isArray(data)) return data[0] || null;
  return data;
}

function makeOrderId() {
  return ('SK' + uuidv4().replace(/-/g, '')).slice(0, 20);
}

async function createOrder({ planId, phone, uid, sessionId, clientMeta }) {
  const plan = getPlan(planId);
  if (!plan) {
    const err = new Error('Invalid plan');
    err.code = 'INVALID_PLAN';
    throw err;
  }
  const normalized = normalizePhone(phone);
  if (!isValidTzPhone(normalized)) {
    const err = new Error('Invalid Tanzania mobile number (use 06/07… — we send as 255…)');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  const network = detectNetwork(normalized) || 'Mobile money';
  const orderId = makeOrderId();
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
    clickpesaId: null,
  };
  orders.set(orderId, order);
  saveOrders();

  if (PROVIDER === 'clickpesa' && clickpesaConfigured()) {
    try {
      const result = await clickpesaUssdPush({
        amount: plan.priceTzs,
        orderReference: orderId,
        phoneNumber: normalized,
      });
      order.status = result.status === 'SUCCESS' ? 'paid' : 'stk_sent';
      order.clickpesaId = result.id || null;
      order.channel = result.channel || network;
      if (order.status === 'paid') {
        grantPro({ uid: order.uid, sessionId: order.sessionId }, plan, orderId);
        order.paidAt = Date.now();
      }
    } catch (e) {
      order.status = 'failed';
      order.failReason = String(e.message || 'ussd_failed').slice(0, 120);
      orders.set(orderId, order);
      saveOrders();
      throw e;
    }
  } else if (PROVIDER === 'clickpesa' && !clickpesaConfigured()) {
    const err = new Error('ClickPesa credentials missing on server');
    err.code = 'CLICKPESA_CONFIG';
    throw err;
  } else {
    order.status = 'stk_sent';
    order.sandboxHint = 'Sandbox: POST /api/payments/sandbox-confirm';
  }
  order.updatedAt = Date.now();
  orders.set(orderId, order);
  saveOrders();
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
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function markPaid(orderId, { providerRef, sessionId, uid } = {}) {
  let order = orders.get(orderId);
  if (!order) {
    const err = new Error('Order not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (sessionId && !order.sessionId) order.sessionId = sessionId;
  if (uid && !order.uid) order.uid = uid;

  if (order.status === 'paid') {
    const pro = getProStatus(order);
    if (!pro.active) {
      const plan = getPlan(order.planId);
      if (plan) grantPro({ uid: order.uid, sessionId: order.sessionId }, plan, orderId);
    }
    return { order: publicOrder(order), pro: getProStatus(order), alreadyPaid: true };
  }
  const plan = getPlan(order.planId);
  order.status = 'paid';
  order.providerRef = providerRef || null;
  order.paidAt = Date.now();
  order.updatedAt = Date.now();
  orders.set(orderId, order);
  saveOrders();
  const ent = grantPro({ uid: order.uid, sessionId: order.sessionId }, plan, orderId);
  return {
    order: publicOrder(order),
    pro: ent
      ? { active: true, planId: ent.planId, planName: ent.planName, expiresAt: ent.expiresAt }
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
  saveOrders();
  return publicOrder(order);
}

/** Poll ClickPesa; if SUCCESS/SETTLED mark paid + grant Pro */
async function reconcileOrder(orderId, { sessionId, uid } = {}) {
  let order = orders.get(orderId);
  if (!order) return null;
  if (order.status === 'paid') {
    if (sessionId || uid) markPaid(orderId, { sessionId, uid });
    return { order: publicOrder(order), pro: getProStatus(order) };
  }
  if (!clickpesaConfigured()) {
    return { order: publicOrder(order), pro: getProStatus(order) };
  }
  const pay = await queryClickpesaPayment(orderId);
  if (!pay) return { order: publicOrder(order), pro: getProStatus(order) };
  const st = String(pay.status || '').toUpperCase();
  if (st === 'SUCCESS' || st === 'SETTLED') {
    return markPaid(orderId, {
      providerRef: pay.id || pay.paymentReference || null,
      sessionId: sessionId || order.sessionId,
      uid: uid || order.uid,
    });
  }
  if (st === 'FAILED') {
    markFailed(orderId, pay.message || 'failed');
  }
  return { order: publicOrder(orders.get(orderId)), pro: getProStatus(order) };
}

function handleClickpesaWebhook(payload) {
  const event = payload.event || payload.type || '';
  const data = payload.data || payload;
  const orderReference = data.orderReference || data.order_reference;
  if (!orderReference) {
    return { ok: true, ignored: true, reason: 'no_orderReference' };
  }
  console.log('[ClickPesa webhook]', event, orderReference, data.status);

  let order = orders.get(orderReference);
  if (!order) {
    // Remember orphan success so a later sync with sessionId can claim it
    orders.set(orderReference, {
      orderId: orderReference,
      planId: 'day',
      planName: '1 Day',
      amountTzs: Number(data.collectedAmount) || 620,
      days: 1,
      phone: data.paymentPhoneNumber || data.customer?.customerPhoneNumber || null,
      network: data.channel || 'Mobile money',
      uid: null,
      sessionId: null,
      status: 'stk_sent',
      provider: 'clickpesa',
      mode: 'live',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      orphanWebhook: true,
    });
    saveOrders();
    order = orders.get(orderReference);
    console.warn('[ClickPesa webhook] order was unknown — stored as orphan', orderReference);
  }

  const statusRaw = String(data.status || '').toUpperCase();
  const isSuccess =
    event === 'PAYMENT RECEIVED' || statusRaw === 'SUCCESS' || statusRaw === 'SETTLED';
  const isFailed = event === 'PAYMENT FAILED' || statusRaw === 'FAILED';

  if (isSuccess) {
    try {
      return {
        ok: true,
        ...markPaid(orderReference, {
          providerRef: data.id || data.paymentReference || null,
        }),
      };
    } catch (e) {
      return { ok: true, error: e.message };
    }
  }
  if (isFailed) {
    markFailed(orderReference, data.message || 'failed');
    return { ok: true, status: 'failed' };
  }
  return { ok: true, ignored: true, status: statusRaw || 'unknown' };
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
  handleClickpesaWebhook,
  reconcileOrder,
  queryClickpesaPayment,
  normalizePhone,
  isValidTzPhone,
  detectNetwork,
  clickpesaConfigured,
  PAYMENT_MODE,
  PROVIDER,
};
