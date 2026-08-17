/**
 * server.js
 * SKONGA AI Backend — entry point.
 */
const express = require('express');
const cors = require('cors');
const config = require('./src/config');

const chatRoutes = require('./src/routes/chat');
const chatSearchRoutes = require('./src/routes/chatSearch');
const visionRoutes = require('./src/routes/vision');
const imageRoutes = require('./src/routes/image');
const trendingRoutes = require('./src/routes/trending');
const feedbackRoutes = require('./src/routes/feedback');
const verifyRoutes = require('./src/routes/verify');
const statsRoutes = require('./src/routes/stats');
const chatTitleRoutes = require('./src/routes/chatTitle');
const registerDeviceRoutes = require('./src/routes/registerDevice');
const paymentRoutes = require('./src/routes/payments');
const paymentService = require('./src/services/paymentService');
const { aiRateLimiter } = require('./src/middleware/rateLimiter');
const { getLibraryStatus } = require('./src/services/libraryService');

const app = express();

// Render sits behind a proxy and sets X-Forwarded-For — required for rate-limit
app.set('trust proxy', 1);

// Security headers (anti-MITM hygiene + clickjacking / MIME sniffing)
// TLS is terminated by Render; HSTS tells browsers to stay on HTTPS.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=()'
  );
  // Only meaningful over HTTPS (Render production)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  next();
});

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-SKONGA-Signature', 'X-Skonga-Platform'],
}));

// Payment webhook: capture raw body for HMAC before JSON parser
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      const raw = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : String(req.body || '');
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
        payload = JSON.parse(raw || '{}');
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body.' });
      }

      const orderId = payload.orderId || payload.reference;
      const status = String(payload.status || '').toLowerCase();
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
      return res.status(500).json({ error: 'Webhook processing failed.' });
    }
  }
);

app.use(express.json({ limit: '15mb' }));

app.get('/health', (req, res) => {
  const lib = getLibraryStatus();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    library: lib.configured ? 'configured' : 'off',
    libraryUrl: lib.baseURL,
    libraryLastError: lib.lastError,
    libraryLastOkAt: lib.lastOkAt,
    payments: {
      mode: paymentService.PAYMENT_MODE,
    },
  });
});

app.use('/api', aiRateLimiter, chatRoutes);
app.use('/api', aiRateLimiter, chatSearchRoutes);
app.use('/api', aiRateLimiter, visionRoutes);
app.use('/api', aiRateLimiter, imageRoutes);
app.use('/api', aiRateLimiter, trendingRoutes);
app.use('/api', aiRateLimiter, verifyRoutes);
app.use('/api', aiRateLimiter, chatTitleRoutes);
app.use('/api', registerDeviceRoutes);
app.use('/api', feedbackRoutes);
app.use('/api', statsRoutes);
app.use('/api', paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = config.port || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SKONGA AI Backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  const lib = getLibraryStatus();
  console.log(`   Library RAG: ${lib.configured ? lib.baseURL : 'disabled'}`);
  console.log(`   Payments: mode=${paymentService.PAYMENT_MODE}`);
  if (lib.configured && !process.env.LIBRARY_SERVICE_TOKEN) {
    console.warn('   ⚠️  LIBRARY_ENABLED=true but LIBRARY_SERVICE_TOKEN is empty');
  }
});
