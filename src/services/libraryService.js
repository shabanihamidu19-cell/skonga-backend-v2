/**
 * src/services/libraryService.js
 * Client for SKONGA Library API (FastAPI, JSON files — no SQL DB).
 *
 * Pipeline: AI backend GET /v1/rag/context → inject context into system prompt
 * → return citations to app. App never calls Library directly.
 */
const config = require('../config');

let lastLibraryError = null;
let lastLibraryOkAt = null;

function getLibraryStatus() {
  return {
    configured: !!(config.library.enabled && config.library.baseURL && config.library.serviceToken),
    enabled: !!config.library.enabled,
    baseURL: config.library.baseURL || null,
    timeoutMs: config.library.timeoutMs,
    lastError: lastLibraryError,
    lastOkAt: lastLibraryOkAt,
  };
}

/**
 * @returns {Promise<{context_text:string, citations:Array, curriculum_aligned:boolean, topics_found:number, ok:boolean, error?:string}|null>}
 */
async function getRagContext({ query, subjectHint = null, formHint = null, topK = 5 } = {}) {
  if (!config.library.enabled || !config.library.baseURL || !config.library.serviceToken) {
    lastLibraryError = 'Library not configured (LIBRARY_ENABLED / LIBRARY_API_URL / LIBRARY_SERVICE_TOKEN)';
    return null;
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return null;
  }

  let form = formHint != null && formHint !== '' ? Number(formHint) : null;
  if (form != null && (!Number.isInteger(form) || form < 1 || form > 6)) {
    form = null;
  }

  const base = config.library.baseURL.replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('q', query.trim().slice(0, 500));
  params.set('top_k', String(topK));
  if (subjectHint) params.set('subject_id', String(subjectHint));
  // Pass form when known — Library v2.3 also parses form from q text
  if (form != null) {
    params.set('form', String(form));
  }

  const url = `${base}/v1/rag/context?${params.toString()}`;
  const controller = new AbortController();
  const timeoutMs = config.library.timeoutMs || 25000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.library.serviceToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastLibraryError = `HTTP ${res.status}: ${errText.slice(0, 200)}`;
      console.warn(`[LIBRARY] RAG ${lastLibraryError}`);
      if (res.status === 401 || res.status === 403) {
        console.warn('[LIBRARY] Auth failed — LIBRARY_SERVICE_TOKEN vs Library key/REQUIRE_AUTH');
      }
      return {
        context_text: '',
        citations: [],
        curriculum_aligned: false,
        topics_found: 0,
        ok: false,
        error: lastLibraryError,
      };
    }

    const data = await res.json();
    const citations = Array.isArray(data.citations) ? data.citations : [];
    const topicsFound = data.topics_found ?? citations.length;
    const aligned = !!(data.curriculum_aligned ?? data.curriculumAligned ?? topicsFound > 0);
    const ms = Date.now() - started;

    if (topicsFound === 0) {
      lastLibraryError = `No topics matched (${ms}ms)`;
      console.warn(`[LIBRARY] No topics matched for q="${query.trim().slice(0, 80)}" (${ms}ms)`);
    } else {
      lastLibraryOkAt = new Date().toISOString();
      lastLibraryError = null;
      console.log(`[LIBRARY] RAG ok — ${topicsFound} topic(s) in ${ms}ms`);
    }

    return {
      context_text: data.context_text || '',
      citations,
      curriculum_aligned: aligned,
      topics_found: topicsFound,
      ok: topicsFound > 0,
      form: data.form ?? form,
      subject_id: data.subject_id ?? subjectHint,
    };
  } catch (err) {
    const name = err && err.name;
    if (name === 'AbortError') {
      lastLibraryError = `Timeout after ${timeoutMs}ms (Library cold start?). Increase LIBRARY_TIMEOUT_MS.`;
    } else {
      lastLibraryError = err.message || String(err);
    }
    console.warn('[LIBRARY] RAG fetch failed (non-critical):', lastLibraryError);
    return {
      context_text: '',
      citations: [],
      curriculum_aligned: false,
      topics_found: 0,
      ok: false,
      error: lastLibraryError,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function injectCurriculumContext(systemPrompt, libraryResult, clientCurriculumContext) {
  const block =
    (libraryResult && libraryResult.context_text && libraryResult.context_text.trim()) ||
    (typeof clientCurriculumContext === 'string' && clientCurriculumContext.trim()) ||
    '';

  if (!block) return systemPrompt || '';
  return `${systemPrompt || ''}\n\n${block}`.trim();
}

module.exports = { getRagContext, injectCurriculumContext, getLibraryStatus };
