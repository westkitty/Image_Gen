'use strict';

// Unified Studio Phase 4: the five-master hierarchy is additive and opt-in.
// Registry tests need no DOM; the rest mount the real template, DC runtime and component in jsdom and
// operate the bars with real click and key events. The flat 14-chip row stays the default.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Nav = require('../public/dexdiffusion/studio-nav.js');
const DIR = path.join(__dirname, '..', 'public', 'dexdiffusion');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { JSDOM = null; }
const needsDom = JSDOM ? false : 'jsdom is not installed in this environment';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

// ── Registry ──────────────────────────────────────────────────────────────────────────────────
test('five masters in the exact order, four utilities, and the leaf mapping from the contract', () => {
  assert.deepEqual(Nav.MASTERS.map(m => [m.id, m.label, [...m.leaves]]), [
    ['chat', 'Chat', ['chat']],
    ['image', 'Image', ['create', 'batch', 'swap', 'edit', 'enhance']],
    ['audio', 'Audio', ['voice', 'drama', 'music']],
    ['video', 'Video', ['video']],
    ['3d', '3D', ['world', '3d']],
  ]);
  assert.deepEqual(Nav.UTILITIES.map(u => [u.id, u.label, u.leaf]), [['library', 'Library', 'library'], ['models', 'Models', 'models'], ['jobs', 'Jobs', null], ['system', 'System', 'system']]);
  // Every legacy leaf belongs to exactly one master or utility.
  for (const id of Nav.IDS) {
    const owners = Nav.MASTERS.filter(m => m.leaves.includes(id)).length + Nav.UTILITIES.filter(u => u.leaf === id).length;
    assert.equal(owners, 1, id);
  }
  assert.ok(Object.isFrozen(Nav.MASTERS) && Nav.MASTERS.every(m => Object.isFrozen(m) && Object.isFrozen(m.leaves)));
});

test('legacy registry exports are unchanged and Chat is a screen, never a fifteenth chip', () => {
  assert.equal(Nav.STUDIO_VERSION, 2);
  assert.deepEqual(Nav.IDS, ['create', 'batch', 'swap', 'voice', 'drama', 'music', 'video', 'world', '3d', 'library', 'edit', 'enhance', 'models', 'system']);
  assert.equal(Nav.CATEGORIES.length, 14);
  assert.equal(Nav.chips().length, 14);
  assert.ok(!Nav.IDS.includes('chat') && !Nav.isCategory('chat') && !Nav.chips().some(c => c.id === 'chat'));
  assert.deepEqual(Nav.SCREENS, [...Nav.IDS, 'chat']);
  assert.equal(Nav.isScreen('chat'), true);
  assert.equal(Nav.isScreen('workstation'), false);
  for (const k of ['GROUPS', 'UNAVAILABLE_EXECUTION', 'MIGRATION_MARKER', 'LEGACY_VERSION_KEY', 'resolveInitialVersion', 'migratePreferences', 'isDeveloperMode', 'resolveInitialScreen']) assert.ok(k in Nav, k);
});

test('masterOf, utilityOf and the initial-screen resolvers', () => {
  assert.equal(Nav.masterOf('swap'), 'image');
  assert.equal(Nav.masterOf('drama'), 'audio');
  assert.equal(Nav.masterOf('3d'), '3d');
  assert.equal(Nav.masterOf('chat'), 'chat');
  assert.equal(Nav.masterOf('library'), null);
  assert.equal(Nav.utilityOf('models'), 'models');
  assert.equal(Nav.utilityOf('create'), null);
  assert.equal(Nav.resolveInitialScreenV2('chat'), 'chat');
  assert.equal(Nav.resolveInitialScreenV2('world'), 'world');
  for (const bad of [null, undefined, '', 'workstation', '__proto__', 'CHAT', 42, {}]) assert.equal(Nav.resolveInitialScreenV2(bad), 'create', String(bad));
  assert.equal(Nav.resolveInitialScreen('chat'), 'create', 'the flat resolver never restores Chat');
});

test('layout flag: only exactly "masters" opts in; anything else, or broken storage, is flat', () => {
  assert.equal(Nav.resolveLayout(memStorage({ dex_studio_layout: 'masters' })), 'masters');
  for (const v of ['flat', 'Masters', 'masters ', '1', 'true', '']) assert.equal(Nav.resolveLayout(memStorage({ dex_studio_layout: v })), 'flat', v);
  assert.equal(Nav.resolveLayout(memStorage()), 'flat');
  assert.equal(Nav.resolveLayout({ getItem() { throw new Error('denied'); } }), 'flat');
  assert.equal(Nav.resolveLayout(null), 'flat');
});

test('remembered leaves: valid ones are reused, corrupted or foreign ones fall back to the first leaf', () => {
  const st = memStorage();
  assert.equal(Nav.lastLeafFor('image', st), 'create');
  Nav.rememberLeaf('edit', st);
  Nav.rememberLeaf('drama', st);
  Nav.rememberLeaf('library', st);   // a utility changes nothing
  assert.deepEqual(JSON.parse(st.getItem('dex_master_last')), { image: 'edit', audio: 'drama' });
  assert.equal(Nav.lastLeafFor('image', st), 'edit');
  assert.equal(Nav.lastLeafFor('audio', st), 'drama');
  assert.equal(Nav.lastLeafFor('nope', st), null);
  for (const raw of ['{', '[]', 'null', '"edit"', JSON.stringify({ image: 'voice', audio: 42, video: { x: 1 } })]) {
    const s = memStorage({ dex_master_last: raw });
    assert.equal(Nav.lastLeafFor('image', s), 'create', raw);
    assert.equal(Nav.lastLeafFor('audio', s), 'voice', raw);
  }
  assert.equal(Nav.lastLeafFor('image', { getItem() { throw new Error('denied'); } }), 'create');
});

test('bar items carry tab vs page semantics and a single roving tab stop', () => {
  const ms = Nav.masters({ activeScreen: 'drama' });
  assert.deepEqual(ms.map(m => m.ariaSelected), ['false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(ms.map(m => m.tabIndex), ['-1', '-1', '0', '-1', '-1']);
  assert.equal(ms.find(m => m.id === 'video').unavailable, 'true', 'Video stays visible and honest');
  assert.deepEqual(Nav.masters({ activeScreen: 'library' }).map(m => m.tabIndex), ['0', '-1', '-1', '-1', '-1'], 'a utility screen still leaves one tab stop');
  const sub = Nav.subnav('image', 'swap');
  assert.deepEqual(sub.map(l => l.label), ['Create', 'Batch', 'Swap', 'Edit', 'Enhance']);
  assert.deepEqual(sub.map(l => l.ariaCurrent), ['false', 'false', 'page', 'false', 'false']);
  assert.match(sub[2].title, /no approved backend/);
  assert.equal(sub[2].unavailable, 'true');
  assert.deepEqual(Nav.subnav('nope', 'x'), []);
  const ut = Nav.utilities({ activeScreen: 'models' });
  assert.deepEqual(ut.map(u => [u.id, u.ariaCurrent, u.drawer]), [['library', 'false', 'false'], ['models', 'page', 'false'], ['jobs', 'false', 'true'], ['system', 'false', 'false']]);
});

// ── Real mount ────────────────────────────────────────────────────────────────────────────────
function shellScriptOrder() {
  const html = read('index.html');
  const out = [];
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const src = m[1].split('?')[0];
    const abs = src.startsWith('../') ? path.join(DIR, '..', src.slice(3)) : path.join(DIR, src);
    if (fs.existsSync(abs)) out.push(abs);
  }
  return out;
}
const offline = () => Promise.resolve({ ok: false, status: 503, statusText: 'offline in test', json: () => Promise.resolve({}), text: () => Promise.resolve(''), headers: { get: () => null } });
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)), headers: { get: () => 'application/json' } });

function boot({ storage = {}, session = {}, fetch = null, confirm = () => true } = {}) {
  const html = read('index.html');
  const tpl = html.match(/<template id="dc-template">([\s\S]*?)<\/template>/)[1];
  const styles = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const dom = new JSDOM(`<!doctype html><html><head><style>${styles}</style></head><body><div id="app-root"></div><template id="dc-template">${tpl}</template></body></html>`,
    { url: 'http://127.0.0.1:31337/dexdiffusion/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  w.fetch = offline;
  w.WebSocket = function () { this.close = () => {}; };
  w.EventSource = function () { this.close = () => {}; };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.Notification = function () {}; w.Notification.permission = 'denied'; w.Notification.requestPermission = () => Promise.resolve('denied');
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  const confirms = [];
  w.confirm = msg => { confirms.push(msg); return confirm(msg); };
  for (const p of shellScriptOrder()) w.eval(fs.readFileSync(p, 'utf8'));
  if (fetch) w.fetch = fetch(w);
  const root = w.document.getElementById('dc-template').content.firstElementChild;
  const inst = w.DCRuntime.mount(w.DexDiffusionComponent, root, w.document.getElementById('app-root'));
  return { w, doc: w.document, inst, confirms, close: () => w.close() };
}
const settle = (w, ms = 80) => new Promise(r => w.setTimeout(r, ms));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const masters = { dex_studio_layout: 'masters' };
const q = (doc, sel) => doc.querySelector(sel);
const qa = (doc, sel) => [...doc.querySelectorAll(sel)];

test('default profile: the flat 14-chip row, no masters bars, and a stored Chat screen opens Create', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ session: { dex_screen: 'chat' } });
  try {
    await settle(w);
    assert.equal(qa(doc, '[data-tab]').length, 14);
    assert.equal(qa(doc, '[data-studio-nav]').length, 1);
    assert.equal(qa(doc, '[data-studio-masters], [data-master-tab], [data-studio-subnav-row], [data-studio-chat]').length, 0);
    assert.equal(q(doc, '[data-tab][data-active="true"]').textContent.trim(), 'Create');
    assert.equal(q(doc, '[data-studio-layout]').getAttribute('data-studio-layout'), 'flat');
    assert.equal(inst.setScreen('chat'), true);
    assert.equal(inst.state.screens[2], 'create', 'Chat is unreachable in the flat layout');
  } finally { close(); }
});

test('opt-in masters layout: five tabs, the Image subnav, three utilities plus the Jobs drawer, no chip row', { skip: needsDom }, async () => {
  const { w, doc, close } = boot({ storage: masters });
  try {
    await settle(w);
    assert.equal(qa(doc, '[data-tab]').length, 0);
    assert.equal(qa(doc, '[data-studio-nav]').length, 0);
    const tabs = qa(doc, '[data-master-tab]');
    assert.deepEqual(tabs.map(t => t.textContent.trim()), ['Chat', 'Image', 'Audio', 'Video', '3D']);
    assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['false', 'true', 'false', 'false', 'false']);
    assert.deepEqual(tabs.map(t => t.getAttribute('tabindex')), ['-1', '0', '-1', '-1', '-1']);
    assert.ok(tabs.every(t => t.getAttribute('role') === 'tab' && t.type === 'button'));
    assert.equal(q(doc, '[data-master-bar]').getAttribute('role'), 'tablist');
    const leaves = qa(doc, '[data-subnav-leaf]');
    assert.deepEqual(leaves.map(l => l.textContent.trim()), ['Create', 'Batch', 'Swap', 'Edit', 'Enhance']);
    assert.equal(q(doc, '[data-subnav-leaf][aria-current="page"]').textContent.trim(), 'Create');
    assert.equal(q(doc, '[data-studio-subnav]').getAttribute('aria-label'), 'Image screens');
    assert.deepEqual(qa(doc, '[data-studio-utility]').map(u => u.textContent.trim()), ['Library', 'Models', 'System']);
    assert.ok(q(doc, 'header [data-studio-jobs]'), 'the Jobs drawer button (with its count) is the Jobs utility');
    assert.equal(q(doc, '[data-studio-utilities]').getAttribute('role'), 'group');
    assert.ok(q(doc, '[data-studio-create]'), 'Create still renders its full workspace');
  } finally { close(); }
});

test('switching masters restores each master\'s remembered leaf and keeps session state consistent', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters });
  try {
    await settle(w);
    click(w, q(doc, '[data-subnav-leaf="edit"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'edit');
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'voice', 'first leaf for a master never visited');
    click(w, q(doc, '[data-subnav-leaf="drama"]')); await settle(w);
    click(w, q(doc, '[data-master-tab="3d"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'world');
    click(w, q(doc, '[data-master-tab="image"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'edit', 'Image reopens Edit');
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'drama', 'Audio reopens Drama');
    assert.equal(w.sessionStorage.getItem('dex_screen'), 'drama');
    assert.deepEqual(JSON.parse(w.sessionStorage.getItem('dex_master_last')), { image: 'edit', audio: 'drama', '3d': 'world' });
    // Clicking the already-active master keeps the current leaf.
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'drama');
    assert.equal(q(doc, '[data-master-tab][aria-selected="true"]').getAttribute('data-master-tab'), 'audio');
  } finally { close(); }
});

test('corrupted session state falls back safely: unknown leaf opens Create, bad memory opens first leaves', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters, session: { dex_screen: '<img onerror=1>', dex_master_last: '{"image":"voice","audio":' } });
  try {
    await settle(w);
    assert.equal(inst.state.screens[2], 'create');
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'voice');
    assert.deepEqual(JSON.parse(w.sessionStorage.getItem('dex_master_last')), { audio: 'voice' }, 'the corrupt map is replaced by a clean one');
  } finally { close(); }
});

test('a remembered Chat screen is restored only in the masters layout', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters, session: { dex_screen: 'chat' } });
  try {
    await settle(w);
    assert.equal(inst.state.screens[2], 'chat');
    assert.equal(inst.state.screens[1], 'create', 'V1 never receives the Chat leaf');
    assert.equal(inst.state.screens[3], 'create', 'V3 never receives the Chat leaf');
    assert.ok(q(doc, '[data-studio-chat]'));
    assert.equal(q(doc, '[data-master-tab][aria-selected="true"]').textContent.trim(), 'Chat');
  } finally { close(); }
});

test('unsaved-work protection runs once per master or leaf change and can keep the user in place', { skip: needsDom }, async () => {
  let answer = false;
  const { w, doc, inst, confirms, close } = boot({ storage: masters, confirm: () => answer });
  try {
    await settle(w);
    inst.setState({ prompt: 'a lighthouse at dusk' }); await settle(w);
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(confirms.length, 1, 'exactly one confirmation per attempt');
    assert.equal(inst.state.screens[2], 'create', 'declining keeps the draft and the screen');
    assert.equal(inst.state.prompt, 'a lighthouse at dusk');
    click(w, q(doc, '[data-subnav-leaf="batch"]')); await settle(w);
    assert.equal(confirms.length, 1, 'a leaf in the same workspace group needs no confirmation');
    click(w, q(doc, '[data-subnav-leaf="create"]')); await settle(w);
    answer = true;
    click(w, q(doc, '[data-studio-utility="library"]')); await settle(w);
    assert.equal(confirms.length, 2);
    assert.equal(inst.state.screens[2], 'library');
    assert.equal(inst.state.prompt, 'a lighthouse at dusk', 'leaving never discards the in-memory draft');
  } finally { close(); }
});

test('cross-master handoffs keep working and offer a Back control; bar navigation clears it', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters });
  try {
    await settle(w);
    click(w, q(doc, '[data-studio-utility="library"]')); await settle(w);
    assert.equal(q(doc, '[data-nav-return]'), null, 'bar navigation records no return target');
    inst.setScreen('edit'); await settle(w);   // what Library's "Open in Edit" does
    assert.equal(inst.state.screens[2], 'edit');
    assert.equal(q(doc, '[data-master-tab][aria-selected="true"]').textContent.trim(), 'Image', 'the master bar re-derives from the leaf');
    const back = q(doc, '[data-nav-return]');
    assert.equal(back.textContent.trim(), 'Back to Library');
    click(w, back); await settle(w);
    assert.equal(inst.state.screens[2], 'library');
    assert.equal(q(doc, '[data-nav-return]'), null);
    inst.setScreen('3d'); await settle(w); inst.setScreen('world'); await settle(w);
    assert.equal(q(doc, '[data-nav-return]').textContent.trim(), 'Back to Library', 'a same-master step keeps the original return target');
    click(w, q(doc, '[data-master-tab="image"]')); await settle(w);
    assert.equal(inst.state.screens[2], 'edit', 'Image reopens the Edit leaf the handoff used');
    assert.equal(q(doc, '[data-nav-return]'), null);
    // Keyboard L still opens Library.
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    await settle(w);
    assert.equal(inst.state.screens[2], 'library');
    assert.equal(q(doc, '[data-nav-return]').textContent.trim(), 'Back to Edit');
  } finally { close(); }
});

test('keyboard: arrow keys, Home and End rove within each bar; Enter or click activates', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters });
  try {
    await settle(w);
    const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    q(doc, '[data-master-tab="image"]').focus();
    key(doc.activeElement, 'ArrowRight');
    assert.equal(doc.activeElement.getAttribute('data-master-tab'), 'audio');
    assert.equal(doc.activeElement.getAttribute('tabindex'), '0');
    key(doc.activeElement, 'End');
    assert.equal(doc.activeElement.getAttribute('data-master-tab'), '3d');
    key(doc.activeElement, 'ArrowRight');
    assert.equal(doc.activeElement.getAttribute('data-master-tab'), 'chat', 'wraps around');
    key(doc.activeElement, 'Home');
    assert.equal(doc.activeElement.getAttribute('data-master-tab'), 'chat');
    assert.equal(inst.state.screens[2], 'create', 'moving focus does not navigate');
    click(w, q(doc, '[data-master-tab="audio"]')); await settle(w);
    assert.equal(doc.activeElement.getAttribute('data-master-tab'), 'audio', 'focus stays on the operated tab after the bar is rebuilt');
    q(doc, '[data-subnav-leaf="voice"]').focus();
    key(doc.activeElement, 'ArrowLeft');
    assert.equal(doc.activeElement.getAttribute('data-subnav-leaf'), 'music');
  } finally { close(); }
});

test('bars are not rebuilt by unrelated renders, and one click navigates once', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters });
  try {
    await settle(w);
    const tab = q(doc, '[data-master-tab="audio"]'), leaf = q(doc, '[data-subnav-leaf="edit"]'), create = q(doc, '[data-studio-create]');
    inst.setState({ toasts: [] }); inst.setState({ compactMode: inst.state.compactMode }); await settle(w);
    assert.equal(q(doc, '[data-master-tab="audio"]'), tab, 'same master element');
    assert.equal(q(doc, '[data-subnav-leaf="edit"]'), leaf, 'same leaf element');
    assert.equal(q(doc, '[data-studio-create]'), create, 'the open workspace is not remounted');
    let calls = 0;
    const orig = inst.setScreen.bind(inst);
    inst.setScreen = (...a) => { calls++; return orig(...a); };
    click(w, q(doc, '[data-subnav-leaf="batch"]')); await settle(w);
    assert.equal(calls, 1);
  } finally { close(); }
});

test('every screen renders in the masters layout, Swap and Video stay honest, nothing is blank', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: masters });
  try {
    await settle(w, 120);
    for (const m of Nav.MASTERS) {
      for (const leaf of m.leaves) {
        inst.setScreen(leaf, { source: 'nav' }); await settle(w, 100);
        assert.equal(inst.__renderError, null, leaf);
        const pane = q(doc, '[data-scroll-pane]');
        if (leaf !== 'create') assert.ok(pane && pane.textContent.trim().length > 20, leaf + ' has content');
        assert.equal(q(doc, '[data-master-tab][aria-selected="true"]').getAttribute('data-master-tab'), m.id);
      }
    }
    for (const u of ['library', 'models', 'system']) {
      click(w, q(doc, `[data-studio-utility="${u}"]`)); await settle(w, 100);
      assert.equal(inst.state.screens[2], u);
      assert.equal(q(doc, `[data-studio-utility="${u}"]`).getAttribute('aria-current'), 'page');
      assert.equal(qa(doc, '[data-master-tab][aria-selected="true"]').length, 0, 'no master is selected on a utility');
      assert.equal(qa(doc, '[data-master-tab][tabindex="0"]').length, 1);
    }
    inst.setScreen('swap', { source: 'nav' }); await settle(w);
    assert.match(q(doc, '[data-scroll-pane]').textContent, /Swap/);
    assert.equal(q(doc, '[data-subnav-leaf="swap"]').getAttribute('data-unavailable'), 'true');
    assert.equal(q(doc, '[data-master-tab="video"]').getAttribute('data-unavailable'), 'true');
  } finally { close(); }
});

test('Chat workspace reports connection, feature and generation separately and disables unavailable controls', { skip: needsDom }, async () => {
  const scenarios = [
    ['status ok, feature off', u => /\/api\/ollama\/status$/.test(u) ? json(200, { baseUrl: 'x', models: [{ name: 'gemma3:4b' }] }) : /\/api\/chat\/models$/.test(u) ? json(404, { error: 'chat-disabled' }) : offline(), { connection: 'available', feature: 'not_activated' }],
    ['status ok, feature on', u => /\/api\/ollama\/status$/.test(u) ? json(200, { baseUrl: 'x', models: [] }) : /\/api\/chat\/models$/.test(u) ? json(200, { models: [], default: 'gemma3:4b' }) : offline(), { connection: 'available', feature: 'activated' }],
    ['tunnel down', u => /\/api\/ollama\/status$/.test(u) ? json(502, { error: 'fetch failed' }) : /\/api\/chat\/models$/.test(u) ? json(404, { error: 'chat-disabled' }) : offline(), { connection: 'failed', feature: 'not_activated' }],
    ['everything offline', () => offline(), { connection: 'failed', feature: 'unknown' }],
  ];
  for (const [name, route, want] of scenarios) {
    const { w, doc, close } = boot({ storage: masters, fetch: () => url => route(String(url)) });
    try {
      await settle(w);
      click(w, q(doc, '[data-master-tab="chat"]')); await settle(w, 150);
      const state = k => q(doc, `[data-chat-status="${k}"] [data-chat-state]`).getAttribute('data-chat-state');
      assert.equal(state('connection'), want.connection, name);
      assert.equal(state('feature'), want.feature, name);
      assert.equal(state('generation'), 'unavailable', name + ': no installed approved model');
      const pane = q(doc, '[data-studio-chat]');
      assert.equal(pane.querySelector('[data-chat-composer]').disabled, true);
      assert.equal(pane.querySelector('[data-chat-send]').disabled, true);
      assert.equal(pane.querySelector('[data-chat-stop]').disabled, true);
      if (want.connection === 'failed') assert.match(pane.textContent, /Connection failed/);
      if (want.feature === 'not_activated') assert.match(pane.textContent, /Chat feature not activated/);
      assert.match(pane.textContent, /Unavailable until Chat is enabled/);
      assert.equal(q(doc, '[data-chat-status="connection"]').parentElement.getAttribute('role'), 'status');
    } finally { close(); }
  }
});

test('Chat-to-Create requires an explicit replace decision and never generates', { skip: needsDom }, async () => {
  const { w, inst, close } = boot({ storage: masters, confirm: () => false });
  try {
    inst.setScreen('chat');
    inst.onGenerate = () => { throw new Error('handoff launched generation'); };
    const message = { message_id: 'cm_' + 'a'.repeat(32), role: 'assistant', status: 'complete', content: 'A quiet forest' };
    inst.setState({ chatMessages: [message], prompt: 'Existing Create draft' });
    await settle(w);
    assert.equal(inst.handoffChatToCreate(message.message_id), false);
    assert.equal(inst.state.prompt, 'Existing Create draft');
    assert.equal(inst.state.screens[2], 'chat');
    assert.equal(inst.handoffChatToCreate(message.message_id, 'append'), true);
    assert.equal(inst.state.prompt, 'Existing Create draft\n\nA quiet forest');
    assert.equal(inst.state.screens[2], 'create');
    assert.equal(inst.state.jobStatus, 'idle');
  } finally { close(); }
});

test('Chat Stop leaves unverified cancellation pending and labels only verified evidence as stopped', { skip: needsDom }, async () => {
  const { w, inst, close } = boot({ storage: masters });
  try {
    inst.setState({ chatRunning: true, chatJobId: 'fixture-job' });
    let remoteStop = 'unverified';
    inst._chatJson = async (path, method) => {
      assert.equal(path, '/api/jobs/fixture-job/cancel');
      assert.equal(method, 'POST');
      return { remote_stop: remoteStop };
    };
    await inst.stopChat();
    assert.match(inst.state.chatStatus, /verification pending/);
    remoteStop = 'verified';
    await inst.stopChat();
    assert.equal(inst.state.chatStatus, 'Stopped · verified');
  } finally { close(); }
});

test('developer shells stay reachable and untouched by the masters flag', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot({ storage: Object.assign({ dex_developer: '1', dex_version: '3', dex_studio_nav_migrated: '{"at":1}' }, masters), session: { dex_screen: 'chat' } });
  try {
    await settle(w);
    assert.equal(inst.state.version, 3);
    assert.equal(inst.state.screens[3], 'create');
    assert.equal(qa(doc, '[data-master-tab]').length, 0, 'masters bars are a V2-only surface');
    inst.setVersion(2); await settle(w);
    assert.equal(qa(doc, '[data-master-tab]').length, 5);
  } finally { close(); }
});

test('template: masters markup reuses no flat-row hooks, and every new handler is bound', () => {
  const html = read('index.html');
  const start = html.indexOf('<sc-if value="{{ isV2 }}"'), end = html.indexOf('<sc-if value="{{ isV3 }}"');
  const v2 = html.slice(start, end);
  assert.equal((html.match(/data-studio-nav/g) || []).length, 1);
  assert.equal((v2.match(/data-tab="true"/g) || []).length, 1);
  for (const hook of ['isFlatLayout', 'isMastersLayout', 'navMasters', 'navSubnav', 'navUtilities', 'onMasterBarKeyDown', 'onSubnavKeyDown', 'onNavReturn', 'chatWorkspace', 'hasSubnav', 'hasNavReturn', 'studioLayout']) assert.match(v2, new RegExp('\\{\\{ ' + hook + ' \\}\\}'), hook);
  assert.match(html, /prefers-reduced-motion: reduce\)\{\[data-v="2"\] \[data-master-tab\]/);
});
