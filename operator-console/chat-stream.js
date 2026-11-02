'use strict';
// Streaming Chat runner: Ollama /api/chat NDJSON in, framed SSE out (Phase 0 contract D.4).
// Exactly one terminal event (done | stopped | error) per request; 'done' only after an upstream done:true line with every line parsed.
// Generation never starts without an admission grant. Until the Phase 3 arbiter supplies one, the default admitter refuses (fail closed).
// No transcript text is logged or handed to the admitter: it sees ids, model and resource class only.

const { createNdjsonParser } = require('./ollama-ndjson');

const SCHEMA = 'dex.chat.v1';
// The only upstream routes this client may call; pull/push/create/copy/delete/embed are unreachable from here.
const UPSTREAM_ROUTES = new Set(['/api/tags', '/api/ps', '/api/version', '/api/chat']);
const DEFAULT_TIMEOUTS = Object.freeze({ headersMs: 15000, firstTokenLightMs: 120000, firstTokenHeavyMs: 600000, idleMs: 60000, wallMs: 15 * 60 * 1000 });
// Server-constant context window; the client can never raise it.
const NUM_CTX = 4096;

// Phase 2 default: no arbiter exists yet, so nothing is admitted.
async function denyAllAdmission() {
  return { admitted: false, code: 'compute_unavailable', reason: 'compute-admission-not-installed' };
}

function upstreamUrl(baseUrl, route) {
  if (!UPSTREAM_ROUTES.has(route)) throw new Error('upstream route not allowed: ' + route);
  return new URL(route, baseUrl);
}

// Small JSON GET for /api/tags and friends. -> { ok, status, json } with no upstream error text passed through.
async function ollamaGetJson(fetchImpl, baseUrl, route, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(upstreamUrl(baseUrl, route), { signal: ctl.signal });
    if (!r.ok) { try { await r.arrayBuffer(); } catch (_) {} return { ok: false, status: r.status }; }
    return { ok: true, status: r.status, json: await r.json() };
  } catch (_) {
    return { ok: false, status: 502 };
  } finally { clearTimeout(timer); }
}

function createChatStreamRunner({
  fetchImpl = fetch, baseUrl, admit = denyAllAdmission, log = () => {}, timeouts = DEFAULT_TIMEOUTS,
  heartbeatMs = 15000, maxBufferedBytes = 256 * 1024, undrainedMs = 30000, now = () => Date.now(),
} = {}) {
  const active = new Map();

  async function run({ res, store, turn, resourceClass, options = {}, owner = null }) {
    const t0 = now();
    const base = { v: SCHEMA, session_id: turn.session_id, request_id: turn.request_id, job_id: null, user_message_id: turn.user_message_id, assistant_message_id: turn.assistant_message_id };
    const upstream = new AbortController();
    let n = 0, terminalSent = false, clientGone = false, abortCode = null, stopReason = null, partialChars = 0, lease = null, reader = null, readerClosed = false, notStarted = false;
    const timers = new Set();

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const write = (type, payload = {}) => {
      if (clientGone || res.destroyed || res.writableEnded) return true;
      return res.write(`id: ${turn.assistant_seq}.${n++}\nevent: ${type}\ndata: ${JSON.stringify(Object.assign({}, base, payload))}\n\n`);
    };
    const abort = (code) => { if (!abortCode) abortCode = code; upstream.abort(); };
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };

    const onGone = () => { if (!terminalSent) { clientGone = true; stopReason = stopReason || 'client_disconnected'; abort('client_disconnected'); } };
    res.on('close', onGone);
    // The client may have left while the route was still validating; then nothing is admitted or generated.
    if (res.destroyed || (res.socket && res.socket.destroyed)) onGone();
    const heartbeat = setInterval(() => write('heartbeat'), heartbeatMs);
    active.set(turn.request_id, { stop: () => { stopReason = stopReason || 'user'; abort('user'); } });

    // Pull-based backpressure: the next upstream chunk is read only once the client has drained.
    const drained = () => new Promise(resolve => {
      if (!res.writableNeedDrain && res.writableLength <= maxBufferedBytes) return resolve(true);
      const t = later(undrainedMs, () => { res.off('drain', ok); resolve(false); });
      function ok() { cancel(t); resolve(true); }
      res.once('drain', ok);
    });

    let outcome = null;
    try {
      if (!abortCode) {
        try {
          lease = await admit({
            session_id: turn.session_id, request_id: turn.request_id, model: turn.model, resource_class: resourceClass, owner,
            operation: 'chat-stream', signal: upstream.signal,
            onQueued: (position, blocked_reason) => write('queued', { position, blocked_reason }),
          });
        } catch (_) { lease = null; }
      }
      // A refusal that proves nothing reached Ollama (left the queue, cancelled before the upstream call) is a verified stop.
      if (lease && lease.admitted !== true) { notStarted = lease.not_started === true; if (lease.code === 'cancelled' && !abortCode) { stopReason = stopReason || 'user'; abortCode = 'user'; } lease = null; }
      if (abortCode) {
        outcome = { event: 'stopped', status: 'stopped' };
      } else if (!lease || lease.admitted !== true) {
        lease = null;
        outcome = { event: 'error', status: 'failed', code: 'compute_unavailable' };
      } else {
        base.job_id = typeof lease.job_id === 'string' ? lease.job_id : null;
        outcome = await generate();
      }
    } catch (_) {
      outcome = abortCode === 'user' || abortCode === 'client_disconnected' ? { event: 'stopped', status: 'stopped' } : { event: 'error', status: 'failed', code: 'internal' };
    } finally {
      clearInterval(heartbeat);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (outcome && outcome.event === 'done') readerClosed = true; // Ollama's explicit done marker is terminal evidence.
      if (reader && !readerClosed) {
        upstream.abort();
        try {
          const closed = await Promise.race([
            Promise.resolve(reader.cancel()).then(() => true, () => false),
            new Promise(resolve => setTimeout(() => resolve(false), 300)),
          ]);
          readerClosed = closed;
        } catch (_) { readerClosed = false; }
      } else if (reader) {
        try { reader.cancel().catch(() => {}); } catch (_) {}
      }
    }

    // Verified only when the lease (Phase 3) proves the owned model is gone; otherwise always unverified.
    if (outcome.event === 'stopped') {
      let verdict = notStarted ? 'verified' : 'unverified';
      if (lease && typeof lease.verifyStop === 'function') { try { verdict = (await lease.verifyStop({ upstreamClosed: !reader || readerClosed })) === 'verified' ? 'verified' : 'unverified'; } catch (_) {} }
      outcome.payload = { stop: verdict, reason: stopReason || 'user', partial_chars: partialChars };
    } else if (outcome.event === 'error') {
      outcome.payload = { code: outcome.code, partial_chars: partialChars };
    }
    const persisted = store.finish(turn.session_id, turn.request_id, { status: outcome.status, done_reason: outcome.done_reason || null, eval_count: outcome.eval_count ?? null, prompt_eval_count: outcome.prompt_eval_count ?? null });
    if (persisted !== true) {
      const code = persisted && persisted.error || 'session-finalization-failed';
      outcome = { event: 'error', status: 'failed', code, payload: { code, partial_chars: partialChars } };
    }
    if (!terminalSent) {
      terminalSent = true;
      write(outcome.event, outcome.payload);
      if (!res.writableEnded) res.end();
    }
    active.delete(turn.request_id);
    log(`chat-stream ${turn.request_id} ${outcome.event}${outcome.code ? ' ' + outcome.code : ''} model=${turn.model} chars=${partialChars}`);
    if (lease && typeof lease.release === 'function') {
      try { await lease.release({ outcome: outcome.event, code: outcome.code || null, stop: outcome.payload && outcome.payload.stop || null, upstreamClosed: !reader || readerClosed }); } catch (_) { log(`chat-stream ${turn.request_id} release-failed`); }
    }
    return outcome.event;

    async function generate() {
      const firstTokenMs = resourceClass === 'heavy' ? timeouts.firstTokenHeavyMs : timeouts.firstTokenLightMs;
      later(timeouts.wallMs, () => abort('upstream_timeout'));
      const body = {
        model: turn.model, messages: turn.context, stream: true, think: false,
        keep_alive: lease.keep_alive === undefined ? 0 : lease.keep_alive,
        options: Object.assign({}, options, { num_ctx: NUM_CTX }),
      };
      // Ollama may hold response headers until a cold model has loaded, so the header wait gets at least the first-token budget.
      const headersTimer = later(Math.max(timeouts.headersMs, firstTokenMs), () => abort('upstream_timeout'));
      let response;
      try {
        response = await fetchImpl(upstreamUrl(baseUrl, '/api/chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: upstream.signal });
      } catch (_) { return failure(abortCode || 'upstream_error'); }
      cancel(headersTimer);
      if (!response.ok || !response.body) {
        try { await response.arrayBuffer(); } catch (_) {}
        return failure('upstream_error');
      }
      write('started', { model: turn.model, started_at: new Date(now()).toISOString() });

      const parser = createNdjsonParser();
      reader = response.body.getReader();
      let index = 0, sawToken = false;
      let idle = later(firstTokenMs, () => abort('first_token_timeout'));
      const handle = async (obj) => {
        if (typeof obj.error === 'string' || (obj.error && typeof obj.error === 'object')) return failure('upstream_error');
        const text = obj.message && typeof obj.message.content === 'string' ? obj.message.content : '';
        if (text) {
          sawToken = true;
          store.appendDelta(turn.session_id, turn.request_id, text);
          partialChars += text.length;
          const ok = write('delta', { index: index++, text });
          if (!ok || res.writableLength > maxBufferedBytes) {
            if (!(await drained())) { stopReason = stopReason || 'client_disconnected'; abort('client_disconnected'); clientGone = true; res.destroy(); return stoppedOrFailure(); }
          }
        }
        if (obj.done === true) {
          if (obj.done_reason !== 'stop') return failure('upstream_done_reason_unverified');
          return {
            event: 'done', status: 'complete', done_reason: typeof obj.done_reason === 'string' ? obj.done_reason : null,
            eval_count: Number.isFinite(obj.eval_count) ? obj.eval_count : null, prompt_eval_count: Number.isFinite(obj.prompt_eval_count) ? obj.prompt_eval_count : null,
            payload: null,
          };
        }
        return null;
      };
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch (_) { readerClosed = true; return stoppedOrFailure(); }
        if (chunk.done) readerClosed = true;
        if (abortCode) return stoppedOrFailure();
        cancel(idle);
        const parsed = chunk.done ? parser.end() : parser.push(Buffer.from(chunk.value));
        for (const obj of parsed.objects) {
          const r = await handle(obj);
          if (abortCode) return stoppedOrFailure();
          if (r) {
            // A done marker must not hide malformed bytes already received in
            // this batch, including a final unterminated line. Earlier deltas
            // remain visible, but their turn must fail rather than enter context.
            if (r.event === 'done' && (parsed.error || parser.end().error)) return failure('parse_error');
            if (r.event === 'done') r.payload = { done_reason: r.done_reason, eval_count: r.eval_count, prompt_eval_count: r.prompt_eval_count, total_ms: now() - t0 };
            return r;
          }
        }
        if (parsed.error) return failure('parse_error');
        if (chunk.done) return failure('upstream_closed_early');
        idle = later(sawToken ? timeouts.idleMs : firstTokenMs, () => abort(sawToken ? 'idle_timeout' : 'first_token_timeout'));
      }
    }

    function failure(code) {
      upstream.abort();
      if (abortCode === 'user' || abortCode === 'client_disconnected') return { event: 'stopped', status: 'stopped' };
      return { event: 'error', status: 'failed', code: abortCode && abortCode !== code && code === 'upstream_error' ? abortCode : code };
    }
    function stoppedOrFailure() { return failure(abortCode || 'upstream_closed_early'); }
  }

  return {
    run,
    // Internal stop hook for Phase 3's cancel manager; there is no HTTP Stop route in Phase 2.
    stop(requestId) { const a = active.get(requestId); if (!a) return false; a.stop(); return true; },
    activeCount: () => active.size,
  };
}

module.exports = { createChatStreamRunner, denyAllAdmission, ollamaGetJson, UPSTREAM_ROUTES, DEFAULT_TIMEOUTS, NUM_CTX, SCHEMA };
