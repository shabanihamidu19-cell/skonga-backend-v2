/**
 * src/utils/intentDetection.js
 * MIRROR of the logic in index.html (shouldSearch/shouldGenerateImage).
 * This is an extra safeguard on the server side (defense-in-depth) - in
 * case the frontend sends forceSearch=false but the message genuinely
 * needs a search, the backend can still decide to search the web.
 * NOTE: the keyword lists below intentionally include Swahili phrases
 * (e.g. "tafuta", "tengeneza picha") because students may type in
 * Swahili — these are detection data, not UI text, so they stay as-is.
 */
const LIVE_INFO_KEYWORDS = [
  'latest', 'today', 'currently', 'breaking', 'update on', 'recent', 'this week',
  'this year', 'score', 'match result', 'election result', 'weather', 'forecast',
  'exchange rate', 'stock price', 'news about', 'who is the current', 'who won',
  'live', 'right now', 'tafuta', 'habari za leo', 'habari mpya', 'matokeo ya',
  'necta', 'tamisemi', 'hali ya hewa', 'bei ya', 'kiwango cha ubadilishaji',
  'uchaguzi', 'rais wa sasa', 'sasa hivi kuna',
];

const IMAGE_GEN_KEYWORDS = [
  'tengeneza picha', 'chora picha', 'unda picha', 'picha ya', 'niundie picha',
  'create an image', 'generate an image', 'generate image', 'create image',
  'draw a picture', 'draw an image', 'make an image', 'make a picture',
  'design an image', 'nichorie', 'tengenezea picha', 'weza kutengeneza picha',
  'unaweza kutengeneza picha', 'toa picha', 'nipe picha', 'onyesha picha',
  'mchoro wa', 'chora mchoro', 'tengeneza mchoro', 'draw me', 'show me an image',
  'show me a picture', 'make a photo', 'generate a photo', 'create a photo',
];

function shouldSearch(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.trim().toLowerCase();
  if (!lower) return false;
  return LIVE_INFO_KEYWORDS.some(kw => lower.includes(kw));
}

function shouldGenerateImage(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.trim().toLowerCase();
  if (!lower) return false;
  return IMAGE_GEN_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { shouldSearch, shouldGenerateImage };
