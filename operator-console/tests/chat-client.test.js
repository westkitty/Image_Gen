'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const Client = require('../public/dexdiffusion/chat-client');

function response(chunks) {
  return { ok: true, body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(Buffer.from(chunk)); controller.close(); } }) };
}
const frame = (event, extra = {}) => `event: ${event}\ndata: ${JSON.stringify({ v: 'dex.chat.v1', request_id: 'cr_test', session_id: 'cs_test', ...extra })}\n\n`;

test('browser SSE transport reassembles UTF-8 and split frames, then requires one terminal', async () => {
  const bytes = Buffer.from(frame('delta', { text: 'é' }) + frame('done'));
  const chunks = [...bytes].map(b => Buffer.from([b]));
  const events = [];
  const terminal = await Client.readSse(response(chunks), item => events.push(item));
  assert.deepEqual(events.map(x => x.event), ['delta', 'done']);
  assert.equal(events[0].payload.text, 'é');
  assert.equal(terminal.event, 'done');
  await assert.rejects(Client.readSse(response([frame('delta', { text: 'partial' })]), () => {}), /without-terminal/);
  await assert.rejects(Client.readSse(response([frame('done') + frame('error')]), () => {}), /event-after-terminal/);
});

test('request IDs meet the server-owned format and are distinct', () => {
  const a = Client.requestId(), b = Client.requestId();
  assert.match(a, /^cr_[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});
