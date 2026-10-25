'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(opts = {}) {
  function Component() {}
  const timers = new Map(); let nextTimer = 0; const intervals = new Map();
  const context = { window: { DexDiffusionComponent: Component, DexUI: { css: {}, tone: {} }, confirm: () => true },
    React: { createElement() {} }, document: { activeElement: null }, sessionStorage: { setItem() {}, removeItem() {} },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => intervals.delete(id) };
  vm.createContext(context);
  for (const f of ['drama-ui.js'].concat(opts.studio ? ['drama-studio-ui.js'] : [])) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/dexdiffusion', f), 'utf8'), context);
  const app = new Component();
  app.state = {}; app.setState = () => {}; app.toast = () => {}; app._vp = () => ({ profiles: [] });
  app.dm = { currentId: 'project-A', current: { id: 'project-A', saved: true }, pending: {} }; app._dmText = {};
  const calls = [];
  app._dmApi = async (route, body, method) => {
    calls.push({ route, body, method });
    return { ok: true, data: { project: { id: route.includes('project-B') ? 'project-B' : 'project-A', saved: true, scenes: [] } } };
  };
  app._vpApi = (route, body, method) => app._dmApi(route, body, method);
  return { app, calls, timers, intervals, context };
}

test('confirmed discard on switching projects cancels queued edits from the old project', async () => {
  const { app, calls, timers } = fixture();
  app._dmQueue('ln-001', { text: 'synthetic edit belonging to A' });
  await app.openDramaProject('project-B');
  await app._dmFlush();
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
  assert.equal(timers.size, 0, 'old debounce cancelled');
  assert.equal(app.dm.current.id, 'project-B');
});

test('declining project discard preserves the current draft and its pending edits', async () => {
  const { app, calls, context } = fixture();
  app._dmQueue('ln-001', { text: 'synthetic retained edit' });
  context.window.confirm = () => false;
  assert.equal(await app.openDramaProject('project-B'), false);
  await app._dmFlush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/api/drama/projects/project-A/lines/ln-001');
});

for (const result of ['success', 'failure']) {
  test(`an in-flight ${result} from A cannot consume or restore B pending edits`, async () => {
    const { app, calls } = fixture();
    const original = app._dmApi; let finishOld;
    app._dmApi = (route, body, method) => {
      if (method === 'PATCH' && route.includes('project-A') && !finishOld) {
        calls.push({ route, body, method });
        return new Promise(resolve => { finishOld = resolve; });
      }
      return original(route, body, method);
    };
    app._dmQueue('ln-001', { text: 'old A first' });
    app._dmQueue('ln-002', { text: 'old A second' });
    const oldFlush = app._dmFlush();
    await app.openDramaProject('project-B');
    app._dmQueue('ln-001', { text: 'new B edit' });
    finishOld(result === 'success' ? { ok: true, data: { project: { id: 'project-A' } } } : { ok: false, data: { error: 'old failure' } });
    await oldFlush;
    await app._dmFlush();
    const patches = calls.filter(c => c.method === 'PATCH');
    assert.deepEqual(patches.map(c => c.route), ['/api/drama/projects/project-A/lines/ln-001', '/api/drama/projects/project-B/lines/ln-001']);
    assert.equal(patches[1].body.text, 'new B edit');
    assert.equal(app.dm.current.id, 'project-B');
  });
}

test('a delayed run poll cannot replace the newly opened project', async () => {
  const { app } = fixture();
  const original = app._dmApi; let finishPoll;
  app._dmApi = (route, body, method) => route.includes('/api/drama/runs/')
    ? new Promise(resolve => { finishPoll = resolve; }) : original(route, body, method);
  app._followDramaRun('old-run');
  await app.openDramaProject('project-B');
  finishPoll({ ok: true, data: { run: { status: 'running' }, project: { id: 'project-A' } } });
  await new Promise(setImmediate);
  assert.equal(app.dm.currentId, 'project-B');
  assert.equal(app.dm.current.id, 'project-B');
  assert.equal(app.dm.run, null);
});

test('a failed pending edit flush prevents a later line action', async () => {
  const { app, calls } = fixture();
  app._dmFlush = async () => false;
  await app.dramaLine('ln-001', { direction: 'synthetic direction' });
  assert.equal(calls.length, 0);
});

test('a project change during flush prevents the original line action', async () => {
  const { app, calls } = fixture();
  app._dmFlush = async () => { await app.openDramaProject('project-B'); return true; };
  await app.dramaLine('ln-001', { direction: 'old project action' });
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});

for (const action of ['line', 'delete-line', 'bind', 'select-take', 'take-action']) {
  test(`a delayed ${action} response cannot replace a new project`, async () => {
    const { app } = fixture();
    app.dm.current.scenes = [{ lines: [{ id: 'ln-001', active_take_id: 'take-A', takes: [] }] }];
    app._dmFlush = async () => true;
    let finish;
    app._dmApi = () => new Promise(resolve => { finish = resolve; });
    const pending = action === 'line' ? app.dramaLine('ln-001', { direction: 'synthetic' })
      : action === 'delete-line' ? app.dramaDeleteLine('ln-001')
      : action === 'bind' ? app.dramaBind({ id: 'actor-A' }, 'profile-A')
      : action === 'select-take' ? app.dramaSelectTake('ln-001', 'take-A')
      : app.dramaTakeAction('ln-001', 'take-A', 'pin');
    await new Promise(setImmediate);
    app._dmResetEdits();
    app.dm.currentId = 'project-B'; app.dm.current = { id: 'project-B' };
    finish({ ok: true, data: { project: { id: 'project-A' } } });
    await pending;
    assert.equal(app.dm.current.id, 'project-B');
  });
}

test('a delayed production poll cannot replace a newly opened project, and switching stops the poll', async () => {
  const { app, intervals } = fixture({ studio: true });
  const original = app._dmApi; let finishPoll;
  app._dmApi = (route, body, method) => route.includes('/api/drama/productions/')
    ? new Promise(resolve => { finishPoll = resolve; }) : original(route, body, method);
  app.dmFollowProduction('prod-A');
  const prodTimer = app._dmProdTimer;
  assert.ok(intervals.has(prodTimer), 'production poll scheduled');
  await app.openDramaProject('project-B');
  assert.equal(intervals.has(prodTimer), false, 'production poll cleared on project switch');
  finishPoll({ ok: true, data: { production: { id: 'prod-A', status: 'running' }, project: { id: 'project-A' } } });
  await new Promise(setImmediate);
  assert.equal(app.dm.current.id, 'project-B');
  assert.equal(app.dm.production, undefined);
});

for (const action of ['render', 'produce', 'assemble']) {
  test(`a failed pending edit flush prevents ${action}`, async () => {
    const { app, calls } = fixture({ studio: true });
    app._dmFlush = async () => false;
    await (action === 'render' ? app.dramaRender({ scope: 'project' }) : action === 'produce' ? app.dmProduce() : app.dramaAssemble());
    assert.equal(calls.length, 0);
  });
}

test('queueing an edit after a reset does not discard an in-flight same-project response', async () => {
  const { app } = fixture();
  app._dmResetEdits();
  let finish;
  app._dmApi = () => new Promise(resolve => { finish = resolve; });
  const pending = app.dramaBind({ id: 'actor-A' }, 'profile-A');
  await new Promise(setImmediate);
  app._dmQueue('ln-001', { text: 'same-project edit' });
  finish({ ok: true, data: { project: { id: 'project-A', bound: true } } });
  await pending;
  assert.equal(app.dm.current.bound, true);
  assert.deepEqual(Object.keys(app.dm.pending), ['ln-001']);
});

test('resetting edits cancels a debounced actor-direction save', () => {
  const { app, timers, context } = fixture();
  app._dmDirT = context.setTimeout(() => {}, 700);
  const id = app._dmDirT;
  app._dmResetEdits();
  assert.equal(timers.has(id), false);
});

// A late response for project A must not land on project B (and must not trigger follow-ups against A).
const lateHandlers = {
  addTrack: app => app.dramaAddTrack({ role: 'music' }),
  removeTrack: app => app.dramaRemoveTrack('trk-1'),
  directSelection: app => app.dramaDirectSelection({ id: 'ln-001', text: 'hello', performance_score: { phrases: [] } }, '*'),
  phraseDirection: app => { app.window = null; return app.dramaUsePhraseDirection({ id: 'ln-001', performance_score: { phrases: [{ id: 'ph', delivery: '' }] } }, { id: 'ph', delivery: '' }); },
  runQa: app => app.dmRunQa(false),
  reparse: app => { app._dmText.script = 'A: hi'; return app.reparseDrama(); },
  history: app => app.dmLoadHistory(),
};
for (const [name, start] of Object.entries(lateHandlers)) {
  test(`late ${name} response for project A leaves project B untouched`, async () => {
    const { app, calls, context } = fixture({ studio: true });
    context.window.prompt = () => 'warmer';
    let finish; const original = app._dmApi;
    app._dmApi = (route, body, method) => /project-A\/(tracks|lines|qa|reparse|history)/.test(route) ? new Promise(r => { finish = r; }) : original(route, body, method);
    const pending = start(app);
    await new Promise(setImmediate);
    await app.openDramaProject('project-B');
    const callsBefore = calls.length;
    finish({ ok: true, data: { productions: [{ id: 'A-prod' }], project: { id: 'project-A', late: true, scenes: [] }, summary: { hard_failures: [], asr: { state: 'OK' } } } });
    await pending;
    assert.equal(app.dm.current.id, 'project-B');
    assert.equal(app.dm.current.late, undefined, 'A payload not applied');
    assert.equal(calls.slice(callsBefore).filter(c => c.route.includes('project-A')).length, 0, 'no follow-up requests against A');
    if (name === 'history') assert.ok(!app.dm.history, 'A history not shown on B');
    if (name === 'runQa') { assert.equal(app.dm.qaBusy, false); assert.ok(!app.dm.qa, 'A QA result not shown on B'); }
  });
}

test('positive control: without a switch the same responses are applied', async () => {
  const { app } = fixture({ studio: true });
  await app.dramaAddTrack({ role: 'music' });
  assert.equal(app.dm.current.id, 'project-A');
  app._dmApi = async () => ({ ok: true, data: { project: { id: 'project-A', scenes: [] }, summary: { hard_failures: [], asr: { state: 'OK' } } } });
  await app.dmRunQa(false);
  assert.equal(app.dm.qaBusy, false);
  assert.ok(app.dm.qa, 'QA result applied when the project did not change');
});
