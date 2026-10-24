'use strict';
// The pre-Chat Ollama consumers, brought under AUTH-6 (Phase 0 contract D.1, D.6):
//   POST /api/ollama/enhance, POST /api/ollama/chat and the Drama LLM parse.
// Each generation uses only the approved allowlist (default gemma3:4b), queues on the shared Big Mac lease with image
// and Chat jobs (bounded wait, then 503 compute-busy), generates only into a CLEAR Ollama with keep_alive 0, and keeps
// the lease until model cleanup is verified (chat-compute.js runExclusive). Success response shapes are unchanged.
// No request or reply text is logged or written to a job.

const ChatModels = require('./chat-models');

// Same refusal shape as the other compute admissions: the Big Mac lease was not obtained within the bounded wait.
const OLLAMA_COMPUTE_BUSY = Object.freeze({ error: 'Big Mac compute is busy', gate: 'compute-busy' });
const LEGACY_WAIT_MS = 20000;
const DRAMA_WAIT_MS = 60000;

function createOllamaRequest(baseUrl, fetchImpl = fetch) {
  return async function ollamaRequest(route, body = null, timeoutMs = 90000, externalSignal = null) {
    const controller = new AbortController();
    // A caller that goes away (browser Cancel, timeout, closed tab) aborts the upstream request so Big Mac stops generating.
    if (externalSignal) { if (externalSignal.aborted) controller.abort(); else externalSignal.addEventListener('abort', () => controller.abort(), { once: true }); }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const options = { signal: controller.signal };
      if (body) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      const response = await fetchImpl(new URL(route, baseUrl), options);
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
      if (!response.ok) {
        const message = json && json.error ? json.error : (json && json.raw ? json.raw : text);
        return { ok: false, status: response.status, error: message || response.statusText };
      }
      return { ok: true, json };
    } catch (err) {
      return { ok: false, status: 502, error: err.name === 'AbortError' ? 'Ollama request timed out' : err.message };
    } finally {
      clearTimeout(timer);
    }
  };
}

// The default is gemma3:4b, never whatever /api/tags lists first, and no error suggests downloading a model.
function createModelResolver(ollamaRequest) {
  return async function resolveOllamaModel(requestedModel) {
    const tags = await ollamaRequest('/api/tags', null, 10000);
    if (!tags.ok) return { model: '', error: 'Ollama unreachable' };
    const explicit = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    const r = ChatModels.resolveChatModel(explicit || undefined, tags.json);
    if (r.ok) return { model: r.model, resource_class: r.resource_class, error: null };
    const name = explicit || ChatModels.DEFAULT_CHAT_MODEL;
    return { model: '', error: r.code === 'model-not-allowed' ? `Model "${name}" is not on the approved local model list` : `Model "${name}" is not installed` };
  };
}

function registerLegacyOllamaRoutes(app, { ollamaRequest, resolveModel, runPromptEnhance, getCompute, waitMs = LEGACY_WAIT_MS }) {
  app.post('/api/ollama/enhance', async (req, res) => {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (prompt.length > 12000) return res.status(400).json({ error: 'Prompt is too long' });
    const { model, resource_class, error: modelErr } = await resolveModel(req.body.model);
    if (modelErr) return res.status(503).json({ error: modelErr });

    const gone = new AbortController();
    res.on('close', () => { if (!res.writableFinished) gone.abort(); });
    const run = await getCompute().runExclusive({ operation: 'enhance', model, resource_class, signal: gone.signal, waitMs, call: signal => runPromptEnhance({
      prompt,
      negativePrompt: req.body.negative_prompt || req.body.negativePrompt || '',
      mode: req.body.mode || 'balanced',
      target: req.body.target || 'flux2-klein-4b',
      generatorId: req.body.generatorId || '',
      modality: req.body.modality || 'image',
      operation: req.body.operation || 'txt2img',
      ollamaRequester: (route, body, ms) => ollamaRequest(route, body, ms, signal),
      ollamaModel: model,
      savePrompts: !!req.body.save_prompts
    }) });

    if (gone.signal.aborted) return;   // the client already left; nothing to send
    if (!run.ok) return res.status(503).json(OLLAMA_COMPUTE_BUSY);
    const result = run.value;
    if (!result.ok) {
      return res.status(500).json({
        error: result.error,
        model,
        prompt,
        enhanced_prompt: prompt,
        profile: result.profile
      });
    }

    res.json({
      ok: true,
      model,
      prompt: result.enhanced_prompt,
      enhanced_prompt: result.enhanced_prompt,
      original_prompt: result.original_prompt,
      negative_prompt: result.negative_prompt,
      setting_suggestions: result.setting_suggestions,
      notes: result.notes,
      profile: result.profile,
      mode: result.mode
    });
  });

  app.post('/api/ollama/chat', async (req, res) => {
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > 12000) return res.status(400).json({ error: 'Message is too long' });
    const { model, resource_class, error: modelErr } = await resolveModel(req.body.model);
    if (modelErr) return res.status(503).json({ error: modelErr });
    // A closed client aborts the upstream request; the lease still waits for verified cleanup.
    const gone = new AbortController();
    res.on('close', () => { if (!res.writableFinished) gone.abort(); });
    const run = await getCompute().runExclusive({ operation: 'chat-legacy', model, resource_class, signal: gone.signal, waitMs, call: signal => ollamaRequest('/api/chat', {
      model,
      stream: false,
      keep_alive: 0,
      messages: [{ role: 'user', content: message }]
    }, 120000, signal) });
    if (gone.signal.aborted) return;
    if (!run.ok) return res.status(503).json(OLLAMA_COMPUTE_BUSY);
    const result = run.value;
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const reply = result.json && result.json.message && typeof result.json.message.content === 'string'
      ? result.json.message.content.trim()
      : '';
    res.json({ model, reply });
  });
}

// Drama's optional local intelligent parse: strict-schema JSON (never rewrites dialogue; see drama.js). A busy or
// failed call throws, which Drama reports through its existing error path.
function createLegacyLlmChat({ ollamaRequest, resolveModel, getCompute, waitMs = DRAMA_WAIT_MS }) {
  return async messages => {
    const { model, resource_class, error } = await resolveModel();
    if (error) throw new Error(error);
    const run = await getCompute().runExclusive({ operation: 'drama-parse', model, resource_class, waitMs, call: signal => ollamaRequest('/api/chat', { model, stream: false, format: 'json', keep_alive: 0, options: { temperature: 0 }, messages }, 180000, signal) });
    if (!run.ok) throw new Error(OLLAMA_COMPUTE_BUSY.error);
    const r = run.value;
    if (!r.ok) throw new Error(r.error || 'ollama request failed');
    return r.json && r.json.message && r.json.message.content || '';
  };
}

module.exports = { createOllamaRequest, createModelResolver, registerLegacyOllamaRoutes, createLegacyLlmChat, OLLAMA_COMPUTE_BUSY, LEGACY_WAIT_MS, DRAMA_WAIT_MS };
