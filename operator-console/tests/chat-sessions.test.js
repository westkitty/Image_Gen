'use strict';
// Server-owned temporary sessions (contract D.3, E.1, C-04): ordering, context building and trimming, regenerate variants, idempotency.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTemporarySessionStore, SESSION_ID, MESSAGE_ID, SYSTEM_PROMPT } = require('../chat-sessions');

const rid = (n) => 'cr_' + String(n).padStart(32, '0');
function turn(store, id, n, content, status = 'complete', reply = 'reply ' + n) {
  const b = store.beginSend(id, { request_id: rid(n), content });
  assert.ok(b.turn, JSON.stringify(b.error));
  store.appendDelta(id, rid(n), reply);
  store.finish(id, rid(n), { status });
  return b.turn;
}

test('create issues regex-valid ids and only temporary sessions', () => {
  const store = createTemporarySessionStore();
  const s = store.create({ model: 'gemma3:4b' }).session;
  assert.match(s.session_id, SESSION_ID);
  assert.equal(s.mode, 'temporary');
  assert.deepEqual(s.messages, []);
  assert.deepEqual(store.get('cs_nope'), { error: { status: 400, code: 'invalid-session-id' } });
  assert.deepEqual(store.get('cs_' + 'f'.repeat(32)), { error: { status: 404, code: 'session-not-found' } });
});

test('seq is strictly increasing and context is system + complete turns in order, newest user last', () => {
  const store = createTemporarySessionStore();
  const id = store.create({ model: 'gemma3:4b' }).session.session_id;
  turn(store, id, 1, 'first');
  const t2 = store.beginSend(id, { request_id: rid(2), content: 'second' }).turn;
  assert.deepEqual(t2.context, [
    { role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'reply 1' }, { role: 'user', content: 'second' },
  ]);
  store.finish(id, rid(2), { status: 'complete' });
  const seqs = store.get(id).session.messages.map(m => m.seq);
  assert.deepEqual(seqs, [1, 2, 3, 4]);
  assert.ok(store.get(id).session.messages.every(m => MESSAGE_ID.test(m.message_id)));
});

test('incomplete, stopped and failed assistant text is never fed back', () => {
  const store = createTemporarySessionStore();
  const id = store.create({ model: 'gemma3:4b' }).session.session_id;
  turn(store, id, 1, 'a', 'stopped', 'PARTIAL-STOPPED');
  turn(store, id, 2, 'b', 'failed', 'PARTIAL-FAILED');
  const t3 = store.beginSend(id, { request_id: rid(3), content: 'c' }).turn;
  const sent = JSON.stringify(t3.context);
  assert.ok(!sent.includes('PARTIAL'));
  assert.deepEqual(t3.context.map(m => m.role), ['system', 'user', 'user', 'user']);
  // The in-flight assistant itself is 'incomplete' until finish(), and never 'complete' without it.
  const live = store.get(id).session.messages.at(-1);
  assert.equal(live.status, 'incomplete');
  assert.throws(() => store.finish(id, rid(3), { status: 'done' }));
});

test('context is trimmed oldest-first by message count and by characters, never opening on an assistant turn', () => {
  const store = createTemporarySessionStore({ maxContextMessages: 4, maxContextChars: 1000, maxMessages: 64 });
  const id = store.create({ model: 'gemma3:4b' }).session.session_id;
  for (let i = 1; i <= 4; i++) turn(store, id, i, 'u' + i);
  const t = store.beginSend(id, { request_id: rid(5), content: 'u5' }).turn;
  assert.deepEqual(t.context.slice(1).map(m => m.content), ['u4', 'reply 4', 'u5']);
  assert.equal(t.context_dropped, 6);
  assert.equal(store.get(id).session.messages.at(-1).context_dropped, 6);
  store.finish(id, rid(5), { status: 'complete' });

  const s2 = createTemporarySessionStore({ maxContextChars: 25 });
  const id2 = s2.create({ model: 'gemma3:4b' }).session.session_id;
  turn(s2, id2, 1, 'x'.repeat(10), 'complete', 'y'.repeat(10));
  const t2 = s2.beginSend(id2, { request_id: rid(2), content: 'z'.repeat(10) }).turn;
  assert.deepEqual(t2.context.slice(1).map(m => m.content), ['z'.repeat(10)]);
  assert.equal(t2.context_dropped, 2);
});

test('regenerate replaces only the last assistant turn as a new variant with its own model', () => {
  const store = createTemporarySessionStore();
  const id = store.create({ model: 'gemma3:4b' }).session.session_id;
  const t1 = turn(store, id, 1, 'q1');
  const t2 = turn(store, id, 2, 'q2');
  assert.deepEqual(store.beginRegenerate(id, { request_id: rid(3), regenerate_of: t1.assistant_message_id }), { error: { status: 409, code: 'not-last-assistant-message' } });
  const r = store.beginRegenerate(id, { request_id: rid(4), regenerate_of: t2.assistant_message_id, model: 'qwen3.8:27b-mlx' }).turn;
  assert.equal(r.user_message_id, t2.user_message_id);
  assert.deepEqual(r.context.slice(1).map(m => m.content), ['q1', 'reply 1', 'q2']);
  store.appendDelta(id, rid(4), 'regen');
  store.finish(id, rid(4), { status: 'complete' });
  const msgs = store.get(id).session.messages;
  const variants = msgs.filter(m => m.parent_message_id === t2.user_message_id);
  assert.deepEqual(variants.map(m => [m.variant, m.model, m.content]), [[0, 'gemma3:4b', 'reply 2'], [1, 'qwen3.8:27b-mlx', 'regen']]);
  // The next send continues from the active (newest) variant only.
  const t5 = store.beginSend(id, { request_id: rid(5), content: 'q3' }).turn;
  assert.deepEqual(t5.context.slice(1).map(m => m.content), ['q1', 'reply 1', 'q2', 'regen', 'q3']);
  store.finish(id, rid(5), { status: 'complete' });
  // A failed last turn may be regenerated too.
  const t6 = turn(store, id, 6, 'q4', 'failed');
  assert.ok(store.beginRegenerate(id, { request_id: rid(7), regenerate_of: t6.assistant_message_id }).turn);
});

test('one request in flight per session; a seen request_id returns its status instead of generating again', () => {
  const store = createTemporarySessionStore();
  const id = store.create({ model: 'gemma3:4b' }).session.session_id;
  const t = store.beginSend(id, { request_id: rid(1), content: 'a' }).turn;
  assert.deepEqual(store.beginSend(id, { request_id: rid(2), content: 'b' }), { error: { status: 409, code: 'session-busy' } });
  assert.deepEqual(store.beginSend(id, { request_id: rid(1), content: 'a' }).error, { status: 409, code: 'duplicate-request', request_status: 'running', assistant_message_id: t.assistant_message_id });
  assert.deepEqual(store.remove(id), { error: { status: 409, code: 'session-busy' } });
  store.finish(id, rid(1), { status: 'failed' });
  assert.equal(store.beginSend(id, { request_id: rid(1), content: 'a' }).error.request_status, 'failed');
  assert.deepEqual(store.beginSend(id, { request_id: 'cr_bad', content: 'a' }), { error: { status: 400, code: 'invalid-request-id' } });
  assert.equal(store.finish(id, rid(1), { status: 'complete' }), false, 'a finished request cannot be finished again');
});

test('bounds: 64 messages per session, 20 sessions, 2 h idle TTL (busy sessions are kept)', () => {
  let t = 0;
  const store = createTemporarySessionStore({ now: () => t, maxSessions: 2, maxMessages: 5 });
  const a = store.create({ model: 'gemma3:4b' }).session.session_id;
  store.create({ model: 'gemma3:4b' });
  assert.deepEqual(store.create({ model: 'gemma3:4b' }), { error: { status: 429, code: 'session-limit' } });
  turn(store, a, 1, 'x'); turn(store, a, 2, 'y');
  assert.deepEqual(store.beginSend(a, { request_id: rid(3), content: 'z' }), { error: { status: 409, code: 'session-full' } });
  assert.ok(store.beginRegenerate(a, { request_id: rid(4), regenerate_of: store.get(a).session.messages.at(-1).message_id }).turn);
  t += 3 * 60 * 60 * 1000;
  store._sweep();
  assert.equal(store.size(), 1, 'the idle session expired, the busy one stayed');
  store.finish(a, rid(4), { status: 'stopped' });
  t += 3 * 60 * 60 * 1000;
  assert.equal(store.get(a).error.code, 'session-not-found');
  const defaults = createTemporarySessionStore();
  for (let i = 0; i < 20; i++) assert.ok(defaults.create({ model: 'gemma3:4b' }).session);
  assert.equal(defaults.create({ model: 'gemma3:4b' }).error.code, 'session-limit');
});
