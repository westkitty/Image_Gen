'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
test('a delayed old poll cannot update or complete a replacement job', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/component.js'), 'utf8');
  const method = source.slice(source.indexOf('  _startPoll(jobId, onComplete) {'), source.indexOf('\n  setVersion(', source.indexOf('  _startPoll(jobId, onComplete) {')));
  const ticks = []; let resolve; const updates = [], completed = [];
  const obj = vm.runInNewContext('({' + method + '})', { setInterval: f => (ticks.push(f), ticks.length), clearInterval() {}, fetch: () => new Promise(r => { resolve = r; }), AbortSignal });
  obj.state = { backendUrl: '' }; obj.setState = p => updates.push(p); obj._jobTerminal = s => s === 'PASS';
  obj._startPoll('old', () => completed.push('old')); const pending = ticks[0]();
  obj._startPoll('new', () => completed.push('new'));
  resolve({ ok: true, json: async () => ({ id: 'old', status: 'PASS', stage: { label: 'Old result' } }) });
  await pending;
  assert.equal(updates.length, 0); assert.deepEqual(completed, []);
});

test('Create progress reads its real controlled-generation log', () => {
  const os = require('node:os'); const EC = require('../public/dexdiffusion/edit-core.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-create-stage-'));
  const dir = path.join(root, '20261002-234719-controlled-sd15'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'remote-command.log'), '[INFO ] sampling using Euler A method\n |====> | 3/4 - 1.2s/it\r');
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('function sdLogTailForJob(job) {');
  const tail = vm.runInNewContext('(' + source.slice(start, source.indexOf("\napp.get('/api/jobs/:jobId'", start)) + ')', { fs, path, Buffer, RUNS_DIR: root });
  const job = { status: 'running', commandAction: 'controlled-generate', requestParams: { target: 'sd15' }, createdAt: Date.now() };
  const stage = EC.deriveStage(job, tail(job));
  assert.equal(stage.key, 'sampling'); assert.equal(stage.percent, 75);
  fs.rmSync(root, { recursive: true, force: true });
});
