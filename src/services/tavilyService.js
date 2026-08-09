/**
 * src/services/tavilyService.js
 * Tavily → used for "Live Search": it searches the web and returns
 * results that we inject into the AI's systemPrompt so it can answer
 * using real current information (instead of guessing).
 */
const config = require('../config');

async function webSearch(query, { maxResults = 5 } = {}) {
  if (!config.tavily.enabled) {
    throw new Error('TAVILY_API_KEY is not set - Live Search cannot work.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${config.tavily.baseURL}/search`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.tavily.apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Tavily HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map(r => ({
      title: r.title || 'Source',
      url: r.url || '#',
      content: (r.content || '').slice(0, 600),
      domain: (() => { try { return new URL(r.url).hostname.replace('www.', ''); } catch (_) { return ''; } })(),
    }));
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { webSearch };
