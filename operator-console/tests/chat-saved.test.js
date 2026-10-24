'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemporarySessionStore } = require('../chat-sessions');
const { chatRig } = require('./helpers/chat-rig');

test('saved history requires the explicit store, survives restart, exports its exact messages, and deletes privately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const saved = store.create({ mode: 'saved', model: 'gemma3:4b' }).session;
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
    assert.deepEqual(loaded.listSaved().map(s => s.session_id), [saved.session_id]);
    assert.equal(loaded.get(saved.session_id).session.messages[1].message_id, turn.assistant_message_id);
    loaded.remove(saved.session_id);
    assert.equal(fs.readFileSync(file, 'utf8').includes('private canary'), false);
    assert.equal(createTemporarySessionStore({ savedFile: file }).listSaved().length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a saved in-flight reply reloads as failed, never as complete context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  try {
    const file = path.join(root, 'private-chat', 'sessions.json');
    const first = createTemporarySessionStore({ savedFile: file });
    const sid = first.create({ mode: 'saved', model: 'gemma3:4b' }).session.session_id;
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
    assert.equal((await rig.request('DELETE', '/api/chat/sessions/' + sid)).status, 204);
    assert.deepEqual((await rig.request('GET', '/api/chat/sessions')).body.sessions, []);
  } finally { await rig.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed private write rolls back admission and never leaves a busy saved session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-saved-'));
  const file = path.join(root, 'private-chat', 'sessions.json');
  const originalRename = fs.renameSync;
  try {
    const store = createTemporarySessionStore({ savedFile: file });
    const sid = store.create({ mode: 'saved', model: 'gemma3:4b' }).session.session_id;
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
    const sid = store.create({ mode: 'saved', model: 'gemma3:4b' }).session.session_id;
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
