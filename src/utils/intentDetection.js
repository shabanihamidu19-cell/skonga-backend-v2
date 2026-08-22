/**
 * src/utils/intentDetection.js
 * MIRROR of www/index.html shouldSearch / image keywords.
 */
const LIVE_INFO_KEYWORDS = [
  'latest', 'today', 'currently', 'breaking', 'update on', 'recent', 'this week',
  'this year', 'score', 'match result', 'election result', 'weather', 'forecast',
  'exchange rate', 'stock price', 'news about', 'who is the current', 'who won',
  'live', 'right now', 'tafuta', 'habari za leo', 'habari mpya', 'matokeo ya',
  'necta', 'tamisemi', 'hali ya hewa', 'bei ya', 'kiwango cha ubadilishaji',
  'uchaguzi', 'rais wa sasa', 'sasa hivi kuna',
  // explicit web / news intents (were missing → no Tavily, no source cards)
  'from net', 'from the net', 'from internet', 'from the internet', 'on the internet',
  'search the web', 'search online', 'google', 'kutoka mtandao', 'kutoka net',
  'what is new', "what's new", 'whats new', 'nini kipya', 'news', 'current events',
  'current news', 'trending', 'habari za sasa', 'ripoti mpya',
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
  if (/\bfrom\s+(the\s+)?(net|internet|web)\b/.test(lower)) return true;
  if (/\b(search|find)\s+(online|the\s+web|on\s+the\s+web)\b/.test(lower)) return true;
  if (/\bwhat'?s?\s+new\b/.test(lower) || /\bnini\s+kipya\b/.test(lower)) return true;
  return LIVE_INFO_KEYWORDS.some(kw => lower.includes(kw));
}

function shouldGenerateImage(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.trim().toLowerCase();
  if (!lower) return false;
  return IMAGE_GEN_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { shouldSearch, shouldGenerateImage };
