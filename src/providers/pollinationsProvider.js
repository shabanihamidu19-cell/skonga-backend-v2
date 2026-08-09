/**
 * src/providers/pollinationsProvider.js
 * Pollinations.ai → genuinely free image generation, NO API KEY REQUIRED.
 * Hits a simple GET endpoint that returns the image bytes directly
 * (not JSON like the other providers), so this adapter converts the
 * response into base64 to match our standard { imageBase64 } shape.
 *
 * Anonymous requests are rate-limited (~1 every 15s). Setting
 * POLLINATIONS_API_KEY in .env (free to obtain, no payment card) raises
 * the limit and removes the watermark - see https://pollinations.ai
 */
const config = require('../config');

const KEY = 'pollinations';

const BLOCKED_TERMS = ['nude', 'naked', 'sex', 'gore', 'violence graphic', 'weapon build'];

async function imageGen({ prompt, size }) {
  const providerConfig = config.providers.pollinations;
  const lower = (prompt || '').toLowerCase();
  if (BLOCKED_TERMS.some(t => lower.includes(t))) {
    throw new Error('This request is not allowed - this platform is for educational purposes only.');
  }
  const safePrompt = `Educational illustration, safe for students, classroom-appropriate: ${prompt}`;

  const [width, height] = (size || '1024x1024').split('x').map(Number);
  const params = new URLSearchParams({
    width: String(width || 1024),
    height: String(height || 1024),
    model: providerConfig.models.imageGen,
    nologo: 'true',
    seed: String(Math.floor(Math.random() * 1e9)),
  });
  if (providerConfig.apiKey) params.set('key', providerConfig.apiKey);

  const url = `${providerConfig.baseURL}/${encodeURIComponent(safePrompt)}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[POLLINATIONS ERROR] status=${res.status} body=${errText.slice(0, 300)}`);
      throw new Error(`${KEY} HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    return { imageUrl: null, imageBase64, model: providerConfig.models.imageGen };
  } finally {
    clearTimeout(timeout);
  }
}

async function chat() {
  throw new Error('Pollinations adapter here only supports image generation.');
}
async function vision() {
  throw new Error('Pollinations adapter here only supports image generation.');
}

module.exports = { key: KEY, capabilities: config.providers.pollinations.capabilities, chat, vision, imageGen };
