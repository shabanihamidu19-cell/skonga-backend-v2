/**
 * src/services/tavilyService.js
 * Tavily → Live Search: web results + related images for the chat UI.
 */
const config = require('../config');

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function normalizeImageEntry(img, fallbackTitle, fallbackUrl) {
  if (!img) return null;
  if (typeof img === 'string') {
    if (!/^https?:\/\//i.test(img)) return null;
    return {
      imageUrl: img,
      caption: fallbackTitle || 'Visual',
      sourceUrl: fallbackUrl || '',
      sourceTitle: fallbackTitle || '',
      domain: hostFromUrl(fallbackUrl || img),
    };
  }
  const imageUrl = img.url || img.image_url || img.src || '';
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  return {
    imageUrl,
    caption: img.description || img.caption || fallbackTitle || 'Visual',
    sourceUrl: img.source_url || fallbackUrl || '',
    sourceTitle: img.title || fallbackTitle || '',
    domain: hostFromUrl(img.source_url || fallbackUrl || imageUrl),
  };
}

function isLikelyJunkImage(url) {
  const u = String(url || '').toLowerCase();
  // Skip tiny icons, tracking pixels, common non-content assets
  if (/favicon|sprite|logo[_-]?small|1x1|pixel\.|tracking|badge\.svg|icon[_-]16|icon[_-]32/.test(u)) return true;
  if (/\.(svg)(\?|$)/.test(u) && /logo|icon|badge/.test(u)) return true;
  return false;
}

async function webSearch(query, { maxResults = 5, includeImages = true } = {}) {
  if (!config.tavily.enabled) {
    throw new Error('TAVILY_API_KEY is not set - Live Search cannot work.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const body = {
      api_key: config.tavily.apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      search_depth: 'basic',
      include_images: !!includeImages,
      include_image_descriptions: !!includeImages,
    };

    const res = await fetch(`${config.tavily.baseURL}/search`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Tavily HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    const mappedResults = results.map((r) => {
      const domain = hostFromUrl(r.url);
      const title = r.title || 'Source';
      const url = r.url || '#';
      // Per-result images (if API provides them)
      let resultImage = null;
      if (Array.isArray(r.images) && r.images.length) {
        resultImage = normalizeImageEntry(r.images[0], title, url);
      } else if (r.image) {
        resultImage = normalizeImageEntry(r.image, title, url);
      }
      return {
        title,
        url,
        content: (r.content || '').slice(0, 600),
        domain,
        image: resultImage ? resultImage.imageUrl : null,
      };
    });

    // Top-level Tavily images array
    const topImages = Array.isArray(data.images) ? data.images : [];
    const visuals = [];
    const seen = new Set();

    function pushVisual(v) {
      if (!v || !v.imageUrl || seen.has(v.imageUrl) || isLikelyJunkImage(v.imageUrl)) return;
      seen.add(v.imageUrl);
      visuals.push(v);
    }

    for (const img of topImages) {
      pushVisual(normalizeImageEntry(img, query, ''));
    }
    for (const r of mappedResults) {
      if (r.image) {
        pushVisual({
          imageUrl: r.image,
          caption: r.title,
          sourceUrl: r.url,
          sourceTitle: r.title,
          domain: r.domain,
        });
      }
    }

    // Cap visuals so the mobile UI stays light
    return {
      results: mappedResults,
      visuals: visuals.slice(0, 6),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { webSearch };
