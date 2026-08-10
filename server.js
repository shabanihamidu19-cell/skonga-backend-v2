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
const { aiRateLimiter } = require('./src/middleware/rateLimiter');
const { getLibraryStatus } = require('./src/services/libraryService');

const app = express();

// Render sits behind a proxy and sets X-Forwarded-For — required for rate-limit
app.set('trust proxy', 1);

app.use(cors());
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

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(config.port, () => {
  console.log(`✅ SKONGA AI Backend running on port ${config.port} (${config.nodeEnv})`);
  console.log(`   Providers enabled: ${config.fallbackOrder.filter(k => config.providers[k]?.enabled).join(', ') || 'NONE — set API keys in .env'}`);
  console.log(`   Library RAG: ${config.library.enabled && config.library.baseURL ? config.library.baseURL : 'disabled'}`);
  if (config.library.enabled && !config.library.serviceToken) {
    console.warn('   ⚠️  LIBRARY_ENABLED=true but LIBRARY_SERVICE_TOKEN is empty');
  }
});
