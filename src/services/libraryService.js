/**
 * src/services/libraryService.js
 * Client for SKONGA Library API v2 (FastAPI, JSON-based, no database).
 *
 * Called by the AI backend BEFORE LLM generation so answers can be
 * grounded in the official TIE curriculum (subjects/topics).
 *
 * Security: the service token lives ONLY on this backend (env var).
 * The mobile/web client must NEVER call the Library API directly.
 *
 * Failures are non-fatal: if Library is down or not configured,
 * chat continues without curriculum context.
 */
const config = require('../config');

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {string|null} [opts.subjectHint]
 * @param {number|null} [opts.formHint]  1–6
 * @param {number} [opts.topK=5]
 * @returns {Promise<{context_text:string, citations:Array, curriculum_aligned:boolean, topics_found:number}|null>}
 */
async function getRagContext({ query, subjectHint = null, formHint = null, topK = 5 } = {}) {
  if (!config.library.enabled || !config.library.baseURL || !config.library.serviceToken) {
    return null;
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return null;
  }

  // Sanitize form_hint — Library API rejects values outside 1–6 (422)
  let form = formHint != null && formHint !== '' ? Number(formHint) : null;
  if (form != null && (!Number.isInteger(form) || form < 1 || form > 6)) {
    form = null;
  }

  // Build GET query params (Library API v2 uses GET /v1/rag/context)
  const base = config.library.baseURL.replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('q', query.trim().slice(0, 500));
  params.set('top_k', String(topK));
  if (subjectHint) params.set('subject_id', subjectHint);
  if (form != null) params.set('form', String(form));

  const url = `${base}/v1/rag/context?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.library.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.library.serviceToken}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[LIBRARY] RAG HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    return {
      context_text:       data.context_text || '',
      citations:          Array.isArray(data.citations) ? data.citations : [],
      curriculum_aligned: !!data.curriculum_aligned,
      topics_found:       data.topics_found ?? 0,
    };
  } catch (err) {
    console.warn('[LIBRARY] RAG fetch failed (non-critical):', err.message || err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Merge Library context into the system prompt.
 * Prefers server-fetched context; falls back to client-supplied text if any.
 */
function injectCurriculumContext(systemPrompt, libraryResult, clientCurriculumContext) {
  const block =
    (libraryResult && libraryResult.context_text && libraryResult.context_text.trim()) ||
    (typeof clientCurriculumContext === 'string' && clientCurriculumContext.trim()) ||
    '';

  if (!block) return systemPrompt || '';
  return `${systemPrompt || ''}\n\n${block}`.trim();
}

module.exports = { getRagContext, injectCurriculumContext };
