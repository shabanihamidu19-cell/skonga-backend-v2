/**
 * routes/payments.js
 *
 * Security rules:
 *  - Never accept PIN / password / biometric material from the client.
 *  - Plan prices come from server only.
 *  - Webhook path verifies HMAC before granting Pro.
 *  - Sandbox confirm disabled when PAYMENT_MODE=live.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const paymentService = require('../services/paymentService');

const router = express.Router();

const payLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please wait a moment.' },
});

// GET /api/payments/plans
router.get('/payments/plans', (req, res) => {
  res.json({ plans: paymentService.listPlans(), mode: paymentService.PAYMENT_MODE });
});

// GET /api/payments/pro?uid=&sessionId=
router.get('/payments/pro', (req, res) => {
  const uid = (req.query.uid || '').toString().slice(0, 128);
  const sessionId = (req.query.sessionId || '').toString().slice(0, 128);
  const status = paymentService.getProStatus({ uid, sessionId });
  res.json(status);
});

// POST /api/payments/initiate
// Body: { planId, phone, uid?, sessionId? }
router.post('/payments/initiate', payLimiter, (req, res) => {
  try {
    const { planId, phone, uid, sessionId } = req.body || {};
    if (!planId || !phone) {
      return res.status(400).json({ error: 'planId and phone are required.' });
    }
    // Reject any attempt to send PIN-like fields
    if (req.body.pin || req.body.password || req.body.otp || req.body.secret) {
      return res.status(400).json({
        error: 'PIN/OTP must never be sent to SKONGA. Complete payment on your phone via STK.',
      });
    }

    const order = paymentService.createOrder({
      planId: String(planId),
      phone: String(phone),
      uid: uid ? String(uid).slice(0, 128) : null,
      sessionId: sessionId ? String(sessionId).slice(0, 128) : null,
      clientMeta: { platform: req.headers['x-skonga-platform'] || null },
    });

    res.status(201).json({
      ok: true,
      message:
        'STK Push will be sent to your phone. Enter your mobile-money PIN on the phone only — never in this app.',
      order,
    });
  } catch (err) {
    const code = err.code || 'ERROR';
    const status =
      code === 'INVALID_PLAN' || code === 'INVALID_PHONE' || code === 'UNKNOWN_NETWORK'
        ? 400
        : 500;
    res.status(status).json({ error: err.message || 'Could not start payment.', code });
  }
});

// GET /api/payments/status/:orderId
router.get('/payments/status/:orderId', (req, res) => {
  const order = paymentService.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({
    order: paymentService.publicOrder(order),
    pro: paymentService.getProStatus({
      uid: order.uid,
      sessionId: order.sessionId,
    }),
  });
});

// POST /api/payments/webhook
// Aggregator calls this after payment. Signature required in live mode.
router.post(
  '/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      const raw =
        Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body || {});

      const sig =
        req.headers['x-skonga-signature'] ||
        req.headers['x-signature'] ||
        '';

      if (!paymentService.verifyWebhookSignature(raw, sig)) {
        console.warn('[PAYMENTS] Webhook signature rejected');
        return res.status(401).json({ error: 'Invalid signature.' });
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body.' });
      }

      const orderId = payload.orderId || payload.reference;
      const status = (payload.status || '').toLowerCase();

      if (!orderId) return res.status(400).json({ error: 'orderId required.' });

      if (status === 'paid' || status === 'success' || status === 'completed') {
        const result = paymentService.markPaid(orderId, {
          providerRef: payload.providerRef || payload.transactionId || null,
        });
        return res.json({ ok: true, ...result });
      }

      if (status === 'failed' || status === 'cancelled') {
        paymentService.markFailed(orderId, payload.reason || status);
        return res.json({ ok: true, status: 'failed' });
      }

      return res.json({ ok: true, ignored: true });
    } catch (err) {
      console.error('[PAYMENTS] webhook error', err.message);
      res.status(500).json({ error: 'Webhook processing failed.' });
    }
  }
);

// POST /api/payments/sandbox-confirm — DEV ONLY
router.post('/payments/sandbox-confirm', payLimiter, (req, res) => {
  if (paymentService.PAYMENT_MODE !== 'sandbox') {
    return res.status(403).json({ error: 'Sandbox confirm is disabled in live mode.' });
  }
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required.' });
    const result = paymentService.markPaid(orderId, { providerRef: 'sandbox' });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
