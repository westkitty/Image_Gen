'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemporarySessionStore } = require('../chat-sessions');
const { chatRig } = require('./helpers/chat-rig');
const { createHistoryAuthenticator, accountsFromEnvironment } = require('../chat-history-auth');

test('history credentials are configured as digests and never accept malformed account settings', () => {
  const digest = require('node:crypto').createHash('sha256').update('a'.repeat(32)).digest('hex');
  const auth = createHistoryAuthenticator(accountsFromEnvironment(JSON.stringify({ andrew: digest })));
  assert.equal(auth.identify('Bearer ' + 'a'.repeat(32)), 'andrew');
  assert.equal(auth.identify('Bearer ' + 'b'.repeat(32)), null);
  assert.equal(auth.identify('Bearer ' + digest), null, 'the configured digest is not itself a bearer credential');
  assert.throws(() => createHistoryAuthenticator({ andrew: 'a'.repeat(32) }), /invalid-chat-history-account/);
  assert.throws(() => createHistoryAuthenticator({ andrew: digest, other: digest }), /duplicate-chat-history-credential/);
});

test('saved history requires the explicit store, survives restart, exports its exact messages, and deletes privately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const saved = store.create({ mode: 'saved', owner: 'andrew', model: 'gemma3:4b' }).session;
    const temp = store.create({ model: 'gemma3:4b' }).session;
    const rid = 'cr_' + 'a'.repeat(32);
    const turn = store.beginSend(saved.session_id, { request_id: rid, content: 'private canary', model: 'gemma3:4b' }).turn;
    store.appendDelta(saved.session_id, rid, 'reply canary');
    store.finish(saved.session_id, rid, { status: 'complete' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    const loaded = createTemporarySessionStore({ savedFile: file });
    assert.equal(loaded.get(saved.session_id).session.messages[1].content, 'reply canary');
    assert.equal(loaded.get(temp.session_id).error.code, 'session-not-found');
    assert.deepEqual(loaded.listSaved('andrew').map(s => s.session_id), [saved.session_id]);
    assert.equal(loaded.get(saved.session_id).session.messages[1].message_id, turn.assistant_message_id);
    loaded.remove(saved.session_id);
    assert.equal(fs.readFileSync(file, 'utf8').includes('private canary'), false);
    assert.equal(createTemporarySessionStore({ savedFile: file }).listSaved('andrew').length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a saved in-flight reply reloads as failed, never as complete context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  try {
    const file = path.join(root, 'private-chat', 'sessions.json');
    const first = createTemporarySessionStore({ savedFile: file });
    const sid = first.create({ mode: 'saved', owner: 'andrew', model: 'gemma3:4b' }).session.session_id;
    first.beginSend(sid, { request_id: 'cr_' + 'b'.repeat(32), content: 'question', model: 'gemma3:4b' });
    const restarted = createTemporarySessionStore({ savedFile: file });
    const session = restarted.get(sid).session;
    assert.equal(session.messages[1].status, 'failed');
    assert.equal(session.busy, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('saved routes require consent, list without text, export on demand, and delete permanently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const rig = await chatRig({ savedFile: file });
  try {
    assert.deepEqual((await rig.request('POST', '/api/chat/sessions', { mode: 'saved' })).body, { error: 'saved-history-consent-required' });
    const made = await rig.request('POST', '/api/chat/sessions', { mode: 'saved', consent: true });
    assert.equal(made.status, 201);
    const sid = made.body.session_id;
    const listed = await rig.request('GET', '/api/chat/sessions');
    assert.equal(listed.body.sessions[0].session_id, sid);
    assert.equal(JSON.stringify(listed.body).includes('content'), false);
    const exported = await rig.request('GET', '/api/chat/sessions/' + sid + '/export');
    assert.equal(exported.body.schema, 'dex.chat.export.v1');
    assert.equal(exported.body.session.mode, 'saved');
    const markdown = await rig.request('GET', '/api/chat/sessions/' + sid + '/export?format=md');
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers['content-type'], /text\/markdown/);
    assert.match(markdown.text, /DexDiffusion Chat export/);
    assert.equal((await rig.request('DELETE', '/api/chat/sessions/' + sid)).status, 204);
    assert.deepEqual((await rig.request('GET', '/api/chat/sessions')).body.sessions, []);
  } finally { await rig.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('saved history is scoped to an authenticated owner, even with forged same-origin headers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-owners-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const rig = await chatRig({ savedFile: file });
  try {
    const made = await rig.request('POST', '/api/chat/sessions', { mode: 'saved', consent: true });
    const sid = made.body.session_id;
    assert.equal((await rig.request('GET', '/api/chat/sessions', undefined, { token: null })).status, 401);
    assert.deepEqual((await rig.request('GET', '/api/chat/sessions', undefined, { token: 'b'.repeat(32) })).body.sessions, []);
    for (const path of ['/api/chat/sessions/' + sid, '/api/chat/sessions/' + sid + '/export', '/api/chat/sessions/' + sid + '/export?format=md']) {
      assert.equal((await rig.request('GET', path, undefined, { token: 'b'.repeat(32) })).status, 404, path);
      assert.equal((await rig.request('GET', path, undefined, { token: null })).status, 404, path);
    }
    assert.equal((await rig.request('DELETE', '/api/chat/sessions/' + sid, undefined, { token: 'b'.repeat(32) })).status, 404);
    assert.equal((await rig.request('DELETE', '/api/chat/sessions/' + sid, undefined, { token: null, headers: { Origin: rig.fake.url, 'X-Dex-Request': '1' } })).status, 403);
    assert.equal((await rig.request('GET', '/api/chat/sessions', undefined, { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await rig.request('POST', '/api/ollama/chat/stream', { session_id: sid, request_id: 'cr_' + 'f'.repeat(32), action: 'send', content: 'private canary' }, { token: 'b'.repeat(32) })).status, 404);
    assert.equal((await rig.request('POST', '/api/ollama/chat/stream', { session_id: sid, request_id: 'cr_' + 'd'.repeat(32), action: 'send', content: 'private canary' }, { token: null })).status, 404);
    assert.equal((await rig.request('POST', '/api/chat/sessions', { mode: 'saved', consent: true }, { token: null, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await rig.request('GET', '/api/chat/sessions/' + sid)).status, 200);
    const restarted = createTemporarySessionStore({ savedFile: file });
    assert.deepEqual(restarted.listSaved('other'), []);
    assert.equal(restarted.listSaved('andrew').length, 1);
  } finally { await rig.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('unconfigured history fails closed; ownerless legacy records remain preserved but inaccessible', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-legacy-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const legacyId = 'cs_' + 'e'.repeat(32);
  fs.mkdirSync(path.dirname(file), { mode: 0o700 });
  const legacy = JSON.stringify({ schema: 'dex.chat.saved.v1', sessions: [{ session_id: legacyId, mode: 'saved', model: 'gemma3:4b', created_at: '2026-10-23T00:00:00Z', touched: 1, seq: 0, messages: [], requests: [] }] });
  fs.writeFileSync(file, legacy, { mode: 0o600 });
  const rig = await chatRig({ savedFile: file, historyAccounts: {} });
  try {
    assert.equal((await rig.request('POST', '/api/chat/sessions', { mode: 'saved', consent: true })).status, 503);
    assert.equal((await rig.request('GET', '/api/chat/sessions')).status, 503);
    assert.equal((await rig.request('POST', '/api/chat/sessions', { mode: 'temporary' })).status, 201);
    const owned = createTemporarySessionStore({ savedFile: file });
    assert.deepEqual(owned.listSaved('andrew'), []);
    assert.equal((await rig.request('GET', '/api/chat/sessions/' + legacyId)).status, 404);
    assert.equal(fs.readFileSync(file, 'utf8'), legacy);
  } finally { await rig.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('an existing shared saved-history directory is refused without changing its permissions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-perms-'));
  const dir = path.join(root, 'private-chat');
  fs.mkdirSync(dir, { mode: 0o755 });
  const file = path.join(dir, 'sessions.json');
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const result = store.create({ mode: 'saved', owner: 'andrew', model: 'gemma3:4b' });
    assert.deepEqual(result.error, { status: 503, code: 'saved-history-write-failed' });
    assert.equal(fs.statSync(dir).mode & 0o777, 0o755);
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed private write rolls back admission and never leaves a busy saved session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const originalRename = fs.renameSync;
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const sid = store.create({ mode: 'saved', owner: 'andrew', model: 'gemma3:4b' }).session.session_id;
    fs.renameSync = () => { throw new Error('simulated disk failure'); };
    const refused = store.beginSend(sid, { request_id: 'cr_' + 'c'.repeat(32), content: 'private write canary', model: 'gemma3:4b' });
    assert.deepEqual(refused.error, { status: 503, code: 'saved-history-write-failed' });
    assert.equal(store.get(sid).session.busy, false);
    assert.equal(store.get(sid).session.messages.length, 0);
    assert.equal(fs.readFileSync(file, 'utf8').includes('private write canary'), false);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['sessions.json']);
  } finally { fs.renameSync = originalRename; fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed final save marks the reply failed and cannot become context after restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const originalRename = fs.renameSync;
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const sid = store.create({ mode: 'saved', owner: 'andrew', model: 'gemma3:4b' }).session.session_id;
    const rid = 'cr_' + 'd'.repeat(32);
    store.beginSend(sid, { request_id: rid, content: 'question', model: 'gemma3:4b' });
    store.appendDelta(sid, rid, 'not durable');
    fs.renameSync = () => { throw new Error('simulated disk failure'); };
    assert.deepEqual(store.finish(sid, rid, { status: 'complete' }), { error: 'saved-history-write-failed' });
    assert.equal(store.get(sid).session.messages[1].status, 'failed');
    fs.renameSync = originalRename;
    assert.equal(createTemporarySessionStore({ savedFile: file }).get(sid).session.messages[1].status, 'failed');
  } finally { fs.renameSync = originalRename; fs.rmSync(root, { recursive: true, force: true }); }
});
