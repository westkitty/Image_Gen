'use strict';
// Chat HTTP surface: temporary and explicitly saved sessions, plus POST /api/ollama/chat/stream.
// Off unless enabled (DEX_CHAT_ENABLED=1). Even when on, generation needs an admission grant; the default admitter refuses,
// so no live generation can bypass compute arbitration without the arbiter-backed admitter.

const Models = require('./chat-models');
const { createTemporarySessionStore } = require('./chat-sessions');
const { createChatStreamRunner, denyAllAdmission, ollamaGetJson } = require('./chat-stream');
const { createRequestGuard, defaultPolicy } = require('./request-guard');
const { createHistoryAuthenticator } = require('./chat-history-auth');

const STREAM_FIELDS = new Set(['session_id', 'request_id', 'action', 'content', 'regenerate_of', 'model', 'options']);
const SESSION_FIELDS = new Set(['mode', 'model', 'consent']);
const MAX_CONTENT = 12000;
const OPTION_RULES = {
  temperature: v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2,
  top_p: v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
  num_predict: v => Number.isInteger(v) && v >= 1 && v <= 4096,
  seed: v => Number.isSafeInteger(v),
};

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (status, error, extra) => ({ status, body: Object.assign({ error }, extra || {}) });

function unknownField(body, allowed) {
  for (const k of Object.keys(body)) if (!allowed.has(k)) return k;
  return null;
}

// -> { ok:true, value } or { ok:false, status, body }. Unknown keys (messages, role, system, tools, format, template, raw, keep_alive, think, stream, ...) are refused.
function validateStreamBody(body) {
  if (!isPlainObject(body)) return fail(400, 'invalid-body');
  const extra = unknownField(body, STREAM_FIELDS);
  if (extra) return fail(400, 'field-not-allowed', { field: extra });
  const { action } = body;
  if (action !== 'send' && action !== 'regenerate') return fail(400, 'invalid-action');
  if (typeof body.session_id !== 'string') return fail(400, 'invalid-session-id');
  if (typeof body.request_id !== 'string') return fail(400, 'invalid-request-id');
  let content;
  if (action === 'send') {
    if (body.regenerate_of !== undefined) return fail(400, 'field-not-allowed', { field: 'regenerate_of' });
    if (typeof body.content !== 'string') return fail(400, 'content-required');
    content = body.content.trim();
    if (!content) return fail(400, 'content-required');
    if (content.length > MAX_CONTENT) return fail(400, 'content-too-long');
    if (content.includes('\u0000')) return fail(400, 'content-invalid');
  } else {
    if (body.content !== undefined) return fail(400, 'field-not-allowed', { field: 'content' });
    if (typeof body.regenerate_of !== 'string') return fail(400, 'invalid-regenerate-of');
  }
  if (body.model !== undefined && !Models.isAllowlisted(body.model)) return fail(422, 'model-not-allowed');
  const options = {};
  if (body.options !== undefined) {
    if (!isPlainObject(body.options)) return fail(400, 'invalid-options');
    for (const [k, v] of Object.entries(body.options)) {
      if (!OPTION_RULES[k]) return fail(400, 'option-not-allowed', { field: k });
      if (!OPTION_RULES[k](v)) return fail(400, 'option-out-of-range', { field: k });
      options[k] = v;
    }
  }
  return { ok: true, value: { action, session_id: body.session_id, request_id: body.request_id, content, regenerate_of: body.regenerate_of, model: body.model, options } };
}

function registerChatRoutes(app, {
  enabled = false, ollamaBaseUrl, port, fetchImpl = fetch, admit = denyAllAdmission, log = () => {},
  timeouts, heartbeatMs, maxBufferedBytes, undrainedMs, guardPolicy, sessionOptions, historyAccounts, historyAuth: suppliedHistoryAuth,
} = {}) {
  const store = createTemporarySessionStore(sessionOptions);
  const historyAuth = suppliedHistoryAuth || createHistoryAuthenticator(historyAccounts);
  const runner = createChatStreamRunner({ fetchImpl, baseUrl: ollamaBaseUrl, admit, log, timeouts, heartbeatMs, maxBufferedBytes, undrainedMs });
  const guard = createRequestGuard(guardPolicy || defaultPolicy(port));
  const gate = (req, res, next) => (enabled ? next() : res.status(404).json({ error: 'chat-disabled' }));
  const send = (res, r) => res.status(r.status).json(r.body);
  const sessionError = e => fail(e.status, e.code, e.request_status ? { request_status: e.request_status, assistant_message_id: e.assistant_message_id } : null);
  const ownerOf = req => historyAuth.identify(req.headers.authorization);
  const ownerRequired = (req, res, next) => {
    if (!historyAuth.configured) return send(res, fail(503, 'saved-history-unavailable'));
    const owner = ownerOf(req);
    if (!owner) return send(res, fail(401, 'saved-history-auth-required'));
    req.chatOwner = owner;
    next();
  };
  const ownsSaved = (req, result) => result.session.mode !== 'saved' || (req.chatOwner || ownerOf(req)) === result.owner && !!result.owner;

  async function installedTags() {
    if (!Models.isLoopbackBaseUrl(ollamaBaseUrl)) return { error: fail(503, 'loopback-required') };
    const tags = await ollamaGetJson(fetchImpl, ollamaBaseUrl, '/api/tags');
    if (!tags.ok) return { error: fail(503, 'ollama-unreachable') };
    return { json: tags.json };
  }

  app.get('/api/chat/models', gate, guard, async (req, res) => {
    const tags = await installedTags();
    if (tags.error) return send(res, tags.error);
    res.json({ models: Models.describeAllowlist(tags.json), default: Models.DEFAULT_CHAT_MODEL, base_loopback: true });
  });

  app.post('/api/chat/sessions', gate, guard, (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) return send(res, fail(400, 'invalid-body'));
    const extra = unknownField(body, SESSION_FIELDS);
    if (extra) return send(res, fail(400, 'field-not-allowed', { field: extra }));
    const mode = body.mode || 'temporary';
    if (mode !== 'temporary' && mode !== 'saved') return send(res, fail(400, 'invalid-mode'));
    if (mode === 'saved' && body.consent !== true) return send(res, fail(400, 'saved-history-consent-required'));
    if (mode === 'saved' && !historyAuth.configured) return send(res, fail(503, 'saved-history-unavailable'));
    if (mode === 'saved' && !ownerOf(req)) return send(res, fail(401, 'saved-history-auth-required'));
    if (mode === 'temporary' && body.consent !== undefined) return send(res, fail(400, 'field-not-allowed', { field: 'consent' }));
    const model = body.model === undefined ? Models.DEFAULT_CHAT_MODEL : body.model;
    if (!Models.isAllowlisted(model)) return send(res, fail(422, 'model-not-allowed'));
    const r = store.create({ model, mode, owner: mode === 'saved' ? ownerOf(req) : null });
    if (r.error) return send(res, sessionError(r.error));
    const s = r.session;
    res.status(201).json({ session_id: s.session_id, mode: s.mode, model: s.model, created_at: s.created_at });
  });

  app.get('/api/chat/sessions', gate, guard, ownerRequired, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ sessions: store.listSaved(req.chatOwner) });
  });

  app.get('/api/chat/sessions/:id/export', gate, guard, (req, res) => {
    const r = store.get(req.params.id);
    if (r.error) return send(res, sessionError(r.error));
    if (r.session.mode !== 'saved') return send(res, fail(409, 'temporary-session-not-exportable'));
    if (!ownsSaved(req, r)) return send(res, fail(404, 'session-not-found'));
    const format = req.query.format || 'json';
    if (format !== 'json' && format !== 'md') return send(res, fail(400, 'invalid-export-format'));
    res.set('Cache-Control', 'no-store');
    if (format === 'md') {
      const lines = ['# DexDiffusion Chat export', ''];
      for (const m of r.session.messages) {
        const content = String(m.content || '');
        const fence = '~'.repeat(Math.max(4, ...Array.from(content.matchAll(/~+/g), x => x[0].length + 1)));
        lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'} · ${m.status}`, '', fence, content, fence, '');
      }
      res.set('Content-Disposition', `attachment; filename="dexdiffusion-chat-${r.session.session_id}.md"`);
      return res.type('text/markdown; charset=utf-8').send(lines.join('\n'));
    }
    res.set('Content-Disposition', `attachment; filename="dexdiffusion-chat-${r.session.session_id}.json"`);
    res.json({ schema: 'dex.chat.export.v1', exported_at: new Date().toISOString(), session: r.session });
  });

  app.get('/api/chat/sessions/:id', gate, guard, (req, res) => {
    const r = store.get(req.params.id);
    if (r.error) return send(res, sessionError(r.error));
    if (!ownsSaved(req, r)) return send(res, fail(404, 'session-not-found'));
    res.set('Cache-Control', 'no-store');
    res.json(r.session);
  });

  app.delete('/api/chat/sessions/:id', gate, guard, (req, res) => {
    const found = store.get(req.params.id);
    if (found.error) return send(res, sessionError(found.error));
    if (!ownsSaved(req, found)) return send(res, fail(404, 'session-not-found'));
    const r = store.remove(req.params.id);
    if (r.error) return send(res, sessionError(r.error));
    res.status(204).end();
  });

  app.post('/api/ollama/chat/stream', gate, guard, async (req, res) => {
    const v = validateStreamBody(req.body);
    if (!v.ok) return send(res, v);
    const b = v.value;
    const existing = store.get(b.session_id);
    if (existing.error) return send(res, sessionError(existing.error));
    if (!ownsSaved(req, existing)) return send(res, fail(404, 'session-not-found'));
    const tags = await installedTags();
    if (tags.error) return send(res, tags.error);
    const resolved = Models.resolveChatModel(b.model === undefined ? existing.session.model : b.model, tags.json);
    if (!resolved.ok) return send(res, fail(resolved.status, resolved.code));
    const begun = b.action === 'send'
      ? store.beginSend(b.session_id, { request_id: b.request_id, content: b.content, model: resolved.model })
      : store.beginRegenerate(b.session_id, { request_id: b.request_id, regenerate_of: b.regenerate_of, model: resolved.model });
    if (begun.error) return send(res, sessionError(begun.error));
    await runner.run({ res, store, turn: begun.turn, resourceClass: resolved.resource_class, options: b.options, owner: existing.owner || null });
  });

  return { store, runner };
}

module.exports = { registerChatRoutes, validateStreamBody };
