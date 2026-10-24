'use strict';
// Server-owned Chat sessions. Temporary sessions stay in process memory and vanish on restart.
// Saved sessions require explicit opt-in and persist only in a private runtime-state file.
// The server alone builds upstream context: one constant system message, then the active branch's complete messages in seq order.
// Incomplete, stopped and failed assistant text is never fed back.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_ID = /^cs_[0-9a-f]{32}$/;
const MESSAGE_ID = /^cm_[0-9a-f]{32}$/;
const REQUEST_ID = /^cr_[0-9a-f]{32}$/;
const OWNER = /^[a-zA-Z0-9_-]{1,64}$/;
const SYSTEM_PROMPT = 'You are a helpful local assistant inside DexDiffusion. Answer in plain text. You cannot run tools, commands or code, fetch URLs, or read or write files.';
const ASSISTANT_TERMINAL = new Set(['complete', 'stopped', 'failed']);

const newId = prefix => prefix + crypto.randomBytes(16).toString('hex');

function createTemporarySessionStore({
  now = () => Date.now(), idleTtlMs = 2 * 60 * 60 * 1000, maxSessions = 20, maxMessages = 64,
  maxContextMessages = 64, maxContextChars = 48000, systemPrompt = SYSTEM_PROMPT,
  savedFile = null, maxSavedSessions = 100,
} = {}) {
  const sessions = new Map();
  function privateDirectory(dir) {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('chat-state-symlink');
    if ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('chat-state-not-private');
  }

  function save() {
    if (!savedFile) return;
    const dir = path.dirname(savedFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    privateDirectory(dir);
    const records = [...sessions.values()].filter(s => s.mode === 'saved').map(s => ({
      session_id: s.session_id, mode: s.mode, owner: s.owner, model: s.model, created_at: s.created_at, touched: s.touched,
      seq: s.seq, messages: s.messages, requests: [...s.requests],
    }));
    const tmp = savedFile + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ schema: 'dex.chat.saved.v1', sessions: records }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, savedFile);
      fs.chmodSync(savedFile, 0o600);
    } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  }

  if (savedFile && fs.existsSync(savedFile)) {
    privateDirectory(path.dirname(savedFile));
    if (fs.lstatSync(savedFile).isSymbolicLink()) throw new Error('chat-state-symlink');
    if ((fs.statSync(savedFile).mode & 0o077) !== 0) throw new Error('chat-state-not-private');
    const data = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
    if (data.schema !== 'dex.chat.saved.v1' || !Array.isArray(data.sessions) || data.sessions.length > maxSavedSessions) throw new Error('invalid-chat-state');
    for (const item of data.sessions) {
      if (!item || !SESSION_ID.test(item.session_id) || item.mode !== 'saved' || !Array.isArray(item.messages) || item.messages.length > maxMessages || !Array.isArray(item.requests)) throw new Error('invalid-chat-state');
      // Old ownerless records are preserved on disk but are inaccessible through authenticated routes.
      if (item.owner !== undefined && !OWNER.test(item.owner)) throw new Error('invalid-chat-state');
      const s = { ...item, requests: new Map(item.requests), inflight: null };
      for (const m of s.messages) if (m.status === 'incomplete') { m.status = 'failed'; m.done_reason = 'interrupted'; m.finished_at = new Date(now()).toISOString(); }
      sessions.set(s.session_id, s);
    }
  }

  function sweep() {
    const t = now();
    for (const [id, s] of sessions) if (s.mode === 'temporary' && !s.inflight && t - s.touched > idleTtlMs) sessions.delete(id);
  }

  function lookup(id) {
    sweep();
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return { error: { status: 400, code: 'invalid-session-id' } };
    const s = sessions.get(id);
    if (!s) return { error: { status: 404, code: 'session-not-found' } };
    return { session: s };
  }

  function create({ model, mode = 'temporary', owner = null }) {
    sweep();
    if (mode !== 'temporary' && mode !== 'saved') return { error: { status: 400, code: 'invalid-mode' } };
    if (mode === 'saved' && !savedFile) return { error: { status: 400, code: 'saved-history-unavailable' } };
    if (mode === 'saved' && (typeof owner !== 'string' || !OWNER.test(owner))) return { error: { status: 401, code: 'saved-history-owner-required' } };
    if ([...sessions.values()].filter(s => s.mode === mode).length >= (mode === 'saved' ? maxSavedSessions : maxSessions)) return { error: { status: 429, code: 'session-limit' } };
    const t = now();
    const s = { session_id: newId('cs_'), mode, owner: mode === 'saved' ? owner : null, model, created_at: new Date(t).toISOString(), touched: t, seq: 0, messages: [], requests: new Map(), inflight: null };
    sessions.set(s.session_id, s);
    if (mode === 'saved') {
      try { save(); } catch (_) { sessions.delete(s.session_id); return { error: { status: 503, code: 'saved-history-write-failed' } }; }
    }
    return { session: view(s) };
  }

  function listSaved(owner) {
    return [...sessions.values()].filter(s => s.mode === 'saved' && s.owner === owner).sort((a, b) => b.touched - a.touched)
      .map(s => ({ session_id: s.session_id, model: s.model, created_at: s.created_at, updated_at: new Date(s.touched).toISOString(), message_count: s.messages.length }));
  }

  function view(s) {
    return {
      session_id: s.session_id, mode: s.mode, model: s.model, created_at: s.created_at, updated_at: new Date(s.touched).toISOString(),
      busy: !!s.inflight, messages: s.messages.map(m => Object.assign({}, m)),
    };
  }

  function get(id) {
    const r = lookup(id);
    return r.error ? r : { session: view(r.session), owner: r.session.owner };
  }

  function remove(id) {
    const r = lookup(id);
    if (r.error) return r;
    if (r.session.inflight) return { error: { status: 409, code: 'session-busy' } };
    sessions.delete(id);
    if (r.session.mode === 'saved') {
      try { save(); } catch (_) { sessions.set(id, r.session); return { error: { status: 503, code: 'saved-history-write-failed' } }; }
    }
    return { removed: true };
  }

  // Active variant of each assistant turn is the highest variant for its parent user message.
  function activeBranch(s) {
    const latest = new Map();
    for (const m of s.messages) if (m.role === 'assistant') {
      const cur = latest.get(m.parent_message_id);
      if (!cur || m.variant > cur.variant) latest.set(m.parent_message_id, m);
    }
    return s.messages.filter(m => m.role === 'user' || latest.get(m.parent_message_id) === m);
  }

  // Newest first until a bound is hit; the newest user turn is always kept. Returns the count dropped.
  function buildContext(s, uptoSeq) {
    const eligible = activeBranch(s).filter(m => m.seq <= uptoSeq && m.status === 'complete');
    const kept = [];
    let chars = 0;
    for (let i = eligible.length - 1; i >= 0; i--) {
      const m = eligible[i];
      if (kept.length && (kept.length >= maxContextMessages || chars + m.content.length > maxContextChars)) break;
      kept.unshift(m); chars += m.content.length;
    }
    // A trimmed window never opens on an assistant turn.
    while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
    return {
      messages: [{ role: 'system', content: systemPrompt }, ...kept.map(m => ({ role: m.role, content: m.content }))],
      dropped: eligible.length - kept.length,
    };
  }

  function admitRequest(s, requestId) {
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return { status: 400, code: 'invalid-request-id' };
    const seen = s.requests.get(requestId);
    if (seen) return { status: 409, code: 'duplicate-request', request_status: seen.status, assistant_message_id: seen.assistant_message_id };
    if (s.inflight) return { status: 409, code: 'session-busy' };
    return null;
  }

  function assistantRecord(s, { requestId, parent, variant, model }) {
    return {
      message_id: newId('cm_'), session_id: s.session_id, seq: ++s.seq, role: 'assistant', content: '', model,
      request_id: requestId, parent_message_id: parent.message_id, variant, status: 'incomplete', done_reason: null,
      eval_count: null, prompt_eval_count: null, context_dropped: 0, created_at: new Date(now()).toISOString(), finished_at: null,
    };
  }

  function start(s, requestId, user, assistant) {
    const ctx = buildContext(s, user.seq);
    assistant.context_dropped = ctx.dropped;
    s.messages.push(assistant);
    s.requests.set(requestId, { status: 'running', assistant_message_id: assistant.message_id });
    s.inflight = { request_id: requestId, assistant };
    s.touched = now();
    if (s.mode === 'saved') {
      try { save(); } catch (_) { const e = new Error('saved-history-write-failed'); e.code = 'saved-history-write-failed'; throw e; }
    }
    return { turn: { session_id: s.session_id, request_id: requestId, user_message_id: user.message_id, assistant_message_id: assistant.message_id, assistant_seq: assistant.seq, model: assistant.model, context: ctx.messages, context_dropped: ctx.dropped } };
  }

  function transactionalStart(s, fn) {
    const before = { seq: s.seq, length: s.messages.length, touched: s.touched, inflight: s.inflight, requests: new Map(s.requests) };
    try { return fn(); }
    catch (e) {
      s.seq = before.seq; s.messages.length = before.length; s.touched = before.touched;
      s.inflight = before.inflight; s.requests = before.requests;
      if (e.code !== 'saved-history-write-failed') throw e;
      return { error: { status: 503, code: 'saved-history-write-failed' } };
    }
  }

  function beginSend(id, { request_id, content, model }) {
    const r = lookup(id);
    if (r.error) return r;
    const s = r.session;
    const bad = admitRequest(s, request_id);
    if (bad) return { error: bad };
    if (s.messages.length + 2 > maxMessages) return { error: { status: 409, code: 'session-full' } };
    return transactionalStart(s, () => {
      const t = new Date(now()).toISOString();
      const user = { message_id: newId('cm_'), session_id: s.session_id, seq: ++s.seq, role: 'user', content, model: null, request_id, parent_message_id: null, variant: 0, status: 'complete', done_reason: null, eval_count: null, prompt_eval_count: null, created_at: t, finished_at: t };
      s.messages.push(user);
      return start(s, request_id, user, assistantRecord(s, { requestId: request_id, parent: user, variant: 0, model: model || s.model }));
    });
  }

  function beginRegenerate(id, { request_id, regenerate_of, model }) {
    const r = lookup(id);
    if (r.error) return r;
    const s = r.session;
    const bad = admitRequest(s, request_id);
    if (bad) return { error: bad };
    if (typeof regenerate_of !== 'string' || !MESSAGE_ID.test(regenerate_of)) return { error: { status: 400, code: 'invalid-regenerate-of' } };
    const branch = activeBranch(s);
    const lastAssistant = [...branch].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant || lastAssistant.message_id !== regenerate_of) return { error: { status: 409, code: 'not-last-assistant-message' } };
    if (s.messages.length + 1 > maxMessages) return { error: { status: 409, code: 'session-full' } };
    const parent = s.messages.find(m => m.message_id === lastAssistant.parent_message_id);
    const variant = Math.max(...s.messages.filter(m => m.parent_message_id === parent.message_id).map(m => m.variant)) + 1;
    return transactionalStart(s, () => start(s, request_id, parent, assistantRecord(s, { requestId: request_id, parent, variant, model: model || s.model })));
  }

  function appendDelta(id, requestId, text) {
    const s = sessions.get(id);
    if (!s || !s.inflight || s.inflight.request_id !== requestId) return false;
    s.inflight.assistant.content += text;
    s.touched = now();
    return true;
  }

  // Only the stream runner calls this, once. 'complete' is only ever set from a verified upstream done line.
  function finish(id, requestId, { status, done_reason = null, eval_count = null, prompt_eval_count = null }) {
    if (!ASSISTANT_TERMINAL.has(status)) throw new Error('invalid terminal status ' + status);
    const s = sessions.get(id);
    if (!s || !s.inflight || s.inflight.request_id !== requestId) return false;
    const a = s.inflight.assistant;
    Object.assign(a, { status, done_reason, eval_count, prompt_eval_count, finished_at: new Date(now()).toISOString() });
    s.requests.set(requestId, { status, assistant_message_id: a.message_id });
    s.inflight = null;
    s.touched = now();
    if (s.mode === 'saved') {
      try { save(); }
      catch (_) {
        Object.assign(a, { status: 'failed', done_reason: 'persistence_failed' });
        s.requests.set(requestId, { status: 'failed', assistant_message_id: a.message_id });
        return { error: 'saved-history-write-failed' };
      }
    }
    return true;
  }

  return { create, get, remove, listSaved, beginSend, beginRegenerate, appendDelta, finish, size: () => sessions.size, _sweep: sweep };
}

module.exports = { createTemporarySessionStore, SESSION_ID, MESSAGE_ID, REQUEST_ID, SYSTEM_PROMPT };
