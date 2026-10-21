'use strict';

// G4 — V2 Studio is the sole normal product shell, with exactly one 14-category chip row.
// These are real DOM tests: the actual template, the actual DC runtime and the actual component are
// mounted in jsdom, and the chips are activated with real click events (not by calling setScreen).
// Browser-level pixel/responsive evidence (E3) still requires a real Chromium and is recorded separately.

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

// ── The registry itself (no DOM needed) ───────────────────────────────────────────────────────
test('the canonical 14 categories exist in the fixed product order', () => {
  assert.deepEqual(Nav.IDS, [
    'create', 'batch', 'swap', 'voice', 'drama', 'music', 'video',
    'world', '3d', 'library', 'edit', 'enhance', 'models', 'system'
  ]);
  assert.deepEqual(Nav.CATEGORIES.map(c => c.label), [
    'Create', 'Batch', 'Swap', 'Voice', 'Drama', 'Music', 'Video',
    'World', '3D', 'Library', 'Edit', 'Enhance', 'Models', 'System'
  ]);
  assert.equal(Nav.CATEGORIES.length, 14);
});

test('chips carry a visible group tint and a real active state, not colour-only meaning', () => {
  const chips = Nav.chips({ activeScreen: 'library' });
  assert.equal(chips.length, 14);
  const groups = new Set(chips.map(c => c.group));
  assert.deepEqual([...groups].sort(), ['image', 'motion', 'ops', 'sound']);
  for (const c of chips) assert.match(c.tint, /^#[0-9a-f]{6}$/i);
  const active = chips.filter(c => c.active === 'true');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'library');
  assert.equal(active[0].ariaCurrent, 'page');
  assert.equal(chips.filter(c => c.ariaCurrent === 'false').length, 13, 'inactive chips are explicitly not current');
});

test('Swap and Video stay navigable but advertise that execution is unavailable', () => {
  const chips = Nav.chips({ activeScreen: 'create' });
  const swap = chips.find(c => c.id === 'swap');
  const video = chips.find(c => c.id === 'video');
  assert.equal(swap.unavailable, 'true');
  assert.match(swap.title, /no approved backend/i);
  assert.equal(video.unavailable, 'true');
  assert.match(video.title, /no verified video generator/i);
  assert.equal(chips.find(c => c.id === 'create').unavailable, 'false');
});

test('normal users resolve to Studio; developer mode alone may honour an older shell', () => {
  assert.equal(Nav.resolveInitialVersion('4'), 2);
  assert.equal(Nav.resolveInitialVersion(null), 2);
  assert.equal(Nav.resolveInitialVersion('1'), 2);
  assert.equal(Nav.resolveInitialVersion('4', { developerMode: true }), 4);
  assert.equal(Nav.resolveInitialVersion('nonsense', { developerMode: true }), 2);
});

test('preference migration is idempotent and never deletes saved work', () => {
  const store = new Map([['dex_version', '4'], ['dex_target', 'mflux-flux2-klein'], ['dex_favorite_presets', '[{"name":"x"}]'], ['dex_save_prompts', 'true']]);
  const storage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  const first = Nav.migratePreferences(storage, { now: 123 });
  assert.equal(first.migrated, true);
  assert.equal(first.previousVersion, 4);
  assert.equal(store.get('dex_version'), '2');
  assert.equal(store.get('dex_legacy_version'), '4');
  assert.equal(store.get('dex_target'), 'mflux-flux2-klein', 'model selection preserved');
  assert.equal(store.get('dex_favorite_presets'), '[{"name":"x"}]', 'recipes preserved');
  assert.equal(store.get('dex_save_prompts'), 'true', 'prompt-saving preference preserved');

  const second = Nav.migratePreferences(storage);
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'already-migrated');
  assert.equal(store.get('dex_version'), '2');
});

test('the remembered screen is only reused when it is a real Studio destination', () => {
  assert.equal(Nav.resolveInitialScreen('library'), 'library');
  assert.equal(Nav.resolveInitialScreen('swap'), 'swap');
  assert.equal(Nav.resolveInitialScreen('workstation'), 'create', 'a Workstation screen never becomes the Studio default');
  assert.equal(Nav.resolveInitialScreen(null), 'create');
});

// ── The shipped template ──────────────────────────────────────────────────────────────────────
function v2Shell() {
  const html = read('index.html');
  const start = html.indexOf('<sc-if value="{{ isV2 }}"');
  const end = html.indexOf('<sc-if value="{{ isV3 }}"');
  assert.ok(start > -1 && end > start, 'the V2 shell section is present');
  return { html, v2: html.slice(start, end) };
}

test('the template has one chip row built from the registry and no static duplicate tab list', () => {
  const { html, v2 } = v2Shell();
  assert.equal((html.match(/data-studio-nav/g) || []).length, 1, 'exactly one primary navigation row');
  assert.match(v2, /<sc-for list="\{\{ navChips \}\}" as="chip">/);
  assert.equal((v2.match(/data-tab="true"/g) || []).length, 1, 'chips are rendered from the registry, not hand-listed');
  assert.match(v2, /data-studio-category="\{\{ chip\.id \}\}"/);
  assert.match(v2, /aria-current="\{\{ chip\.ariaCurrent \}\}"/);
  assert.match(v2, /data-nav-scroll="back"/);
  assert.match(v2, /data-nav-scroll="forward"/);
  // the old static labels must be gone from the primary row
  assert.doesNotMatch(v2, />Batch \/ Sweep</);
  assert.doesNotMatch(v2, />Edit \(img2img\)</);
});

test('the version picker is developer-only, so a first run never offers a shell choice', () => {
  const html = read('index.html');
  assert.match(html, /data-version-buttons data-dev-only="\{\{ devModeStr \}\}"/);
  assert.match(html, /\[data-dev-only="false"\]\{display:none!important\}/);
  const component = read('component.js');
  assert.match(component, /devModeStr:/);
});

test('the component no longer defaults to the Workstation shell', () => {
  const component = read('component.js');
  assert.doesNotMatch(component, /v === 1 \|\| v === 2 \|\| v === 3 \|\| v === 4 \? v : 4/, 'hardcoded V4 default removed');
  assert.match(component, /migratePreferences\(localStorage\)/);
  assert.match(component, /navSwap:/);
  assert.match(component, /isSwapStr:/);
  assert.match(component, /buildSwapWorkspace\(\)/);
});

// ── A real mount of the actual application ───────────────────────────────────────────────────
function boot({ storage = {}, screen = null } = {}) {
  const html = read('index.html');
  const tpl = html.match(/<template id="dc-template">([\s\S]*?)<\/template>/)[1];
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app-root"></div><template id="dc-template">${tpl}</template></body></html>`,
    { url: 'http://127.0.0.1:31337/dexdiffusion/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  if (screen) w.sessionStorage.setItem('dex_screen', screen);

  const loadErrors = [];
  // A resolved "service unreachable" response: the shell must render its offline state rather than
  // hanging on a pending spinner or surfacing an unhandled rejection.
  w.fetch = () => Promise.resolve({
    ok: false, status: 503, statusText: 'offline in test',
    json: () => Promise.resolve({}), text: () => Promise.resolve(''), headers: { get: () => null }
  });
  w.WebSocket = function () { this.close = () => {}; };
  w.EventSource = function () { this.close = () => {}; };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.Notification = function () {}; w.Notification.permission = 'denied';
  w.Notification.requestPermission = () => Promise.resolve('denied');
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.confirm = () => true;  // stands in for the native WKUIDelegate confirm (T-201)

  // Load the shipped scripts in the exact order the page loads them, so extensions see their
  // prerequisites (xyz-plot before workstation-ui, etc.).
  for (const src of shellScriptOrder()) {
    try { w.eval(fs.readFileSync(src.path, 'utf8')); }
    catch (e) { loadErrors.push(path.basename(src.path) + ': ' + e.message); }
  }
  assert.deepEqual(loadErrors, [], 'every shell script the page loads also loads here');

  const root = w.document.getElementById('dc-template').content.firstElementChild;
  const inst = w.DCRuntime.mount(w.DexDiffusionComponent, root, w.document.getElementById('app-root'));
  return { w, doc: w.document, inst, close: () => w.close() };
}


// The page's script order, minus the analytics-free service worker bootstrap.
function shellScriptOrder() {
  const html = read('index.html');
  const out = [];
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    const src = m[1].split('?')[0];
    const abs = src.startsWith('../')
      ? path.join(DIR, '..', src.slice(3))
      : path.join(DIR, src);
    if (fs.existsSync(abs)) out.push({ src, path: abs });
  }
  return out;
}

const settle = (w, ms = 60) => new Promise(r => w.setTimeout(r, ms));
const tabs = doc => [...doc.querySelectorAll('[data-tab]')];

test('a real mount opens Studio > Create with exactly 14 clickable chips', { skip: needsDom }, async () => {
  const { w, doc, close } = boot();
  try {
    await settle(w);
    const row = doc.querySelectorAll('[data-studio-nav]');
    assert.equal(row.length, 1, 'one navigation row');
    const chips = tabs(doc);
    assert.deepEqual(chips.map(c => c.textContent.trim()), Nav.CATEGORIES.map(c => c.label));
    const active = doc.querySelector('[data-tab][data-active="true"]');
    assert.equal(active.textContent.trim(), 'Create');
    assert.equal(active.getAttribute('aria-current'), 'page');
    assert.equal(w.localStorage.getItem('dex_version'), '2');
    for (const c of chips) {
      assert.equal(c.tagName, 'BUTTON');
      assert.equal(c.type, 'button');
      assert.ok(c.getAttribute('title'), 'every chip has a readable title');
      assert.equal(c.tabIndex, 0, 'chips are keyboard reachable in document order');
    }
    assert.equal(doc.querySelectorAll('[data-rail]').length, 0, 'no competing global rail is rendered');
  } finally { close(); }
});

test('every one of the 14 chips navigates by real click, in order', { skip: needsDom }, async () => {
  const { w, doc, close } = boot();
  try {
    await settle(w);
    for (const cat of Nav.CATEGORIES) {
      const chip = doc.querySelector(`[data-studio-category="${cat.id}"]`);
      assert.ok(chip, cat.id + ' chip exists');
      chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle(w);
      const active = doc.querySelector('[data-tab][data-active="true"]');
      assert.ok(active, cat.id + ' leaves exactly one active chip');
      assert.equal(active.textContent.trim(), cat.label, cat.id + ' activates its own chip');
      assert.equal(active.getAttribute('data-studio-category'), cat.id);
      assert.equal(tabs(doc).filter(c => c.getAttribute('data-active') === 'true').length, 1);
      // a destination always renders readable content, never a blank screen
      const pane = doc.querySelector('[data-scroll-pane]');
      assert.ok(pane, cat.id + ' renders a scrollable screen');
      assert.ok(pane.textContent.trim().length > 20, cat.id + ' screen has readable content');
      assert.equal(w.sessionStorage.getItem('dex_screen'), cat.id);
    }
  } finally { close(); }
});

test('Swap is an honest destination: it explains, it never starts or downloads anything', { skip: needsDom }, async () => {
  const { w, doc, close } = boot();
  try {
    await settle(w);
    let requests = 0;
    w.fetch = () => {
      requests++;
      return Promise.resolve({ ok: false, status: 503, statusText: 'offline in test', json: () => Promise.resolve({}), text: () => Promise.resolve(''), headers: { get: () => null } });
    };
    doc.querySelector('[data-studio-category="swap"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await settle(w);
    const pane = doc.querySelector('[data-scroll-pane]');
    const text = pane.textContent;
    assert.match(text, /Swap/);
    assert.match(text, /isn't enabled yet/i);
    assert.match(text, /no Swap button will pretend to work/i);
    assert.equal(requests, 0, 'opening Swap issues no worker or job request');
    const buttons = [...pane.querySelectorAll('button')];
    assert.ok(buttons.length >= 1, 'the screen still offers real next steps');
    for (const b of buttons) {
      assert.doesNotMatch(b.textContent, /start|generate|swap faces|begin/i, 'no fake execution control');
      assert.equal(b.disabled, false);
    }
  } finally { close(); }
});

test('an existing Workstation profile lands on Create and keeps its saved settings', { skip: needsDom }, async () => {
  const { w, doc, close } = boot({ storage: { dex_version: '4', dex_target: 'sdcpp-sd15' }, screen: 'workstation' });
  try {
    await settle(w);
    const active = doc.querySelector('[data-tab][data-active="true"]');
    assert.equal(active.textContent.trim(), 'Create', 'a Workstation profile is not restored into Workstation');
    assert.equal(w.localStorage.getItem('dex_version'), '2');
    assert.equal(w.localStorage.getItem('dex_legacy_version'), '4');
    assert.equal(w.localStorage.getItem('dex_target'), 'sdcpp-sd15', 'model choice survives the migration');
    assert.ok(JSON.parse(w.localStorage.getItem(Nav.MIGRATION_MARKER)).studioVersion === 2);
  } finally { close(); }
});

// ── T-202: the V2 primary action and its dedicated Cancel ────────────────────────────────────
function jsonResponse(w, body, status = 200) {
  return w.Promise.resolve({
    ok: status < 400, status, statusText: 'stub',
    json: () => w.Promise.resolve(body), text: () => w.Promise.resolve(JSON.stringify(body)),
    headers: { get: () => 'application/json' }
  });
}

function apiStub(w, { cancel = { status: 200, body: { ok: true, status: 'CANCELLED', remote_stop: 'verified' } }, job = null } = {}) {
  const calls = [];
  w.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    calls.push({ url: u, method, body: opts && opts.body });
    if (u.indexOf('/api/actions/generate-controlled') > -1) return jsonResponse(w, { job_id: 'job-abc', seeds: [42] });
    if (u.indexOf('/cancel') > -1) return jsonResponse(w, cancel.body, cancel.status);
    if (/\/api\/jobs\/[^/]+$/.test(u)) {
      return jsonResponse(w, job || { id: 'job-abc', status: 'RUNNING', stage: { label: 'Generating', percent: 10, determinate: true } });
    }
    return jsonResponse(w, {});
  };
  return calls;
}

const clickIt = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const byLabel = (doc, label) => [...doc.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);

async function startGeneration(w, inst, doc) {
  inst.setState({ prompt: 'a quiet harbour at dawn' });
  await settle(w, 80);
  clickIt(w, byLabel(doc, 'Generate image'));
  await settle(w, 250);
}

test('Generate starts one job and never doubles as a hidden cancel', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    const calls = apiStub(w);
    await startGeneration(w, inst, doc);

    const starts = calls.filter(c => c.url.indexOf('generate-controlled') > -1);
    assert.equal(starts.length, 1, 'exactly one generation request');
    assert.equal(JSON.parse(starts[0].body).prompt, 'a quiet harbour at dawn');
    assert.equal(inst._ws().activeJobId, 'job-abc', 'the exact job id is retained for Cancel');

    const before = inst.state.jobStatus;
    clickIt(w, byLabel(doc, 'Generate image'));
    await settle(w, 80);
    assert.equal(calls.filter(c => c.url.indexOf('generate-controlled') > -1).length, 1, 'no duplicate job');
    assert.equal(inst.state.jobStatus, before, 'the running job is not hidden by a fake local reset');
    assert.equal(inst._ws().activeJobId, 'job-abc', 'the job is still tracked after the second click');
  } finally { close(); }
});

test('Cancel is a separate control bound to the exact job id', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    assert.equal(byLabel(doc, 'Cancel job'), undefined, 'nothing to cancel before a job starts');
    const calls = apiStub(w);
    await startGeneration(w, inst, doc);

    const cancel = byLabel(doc, 'Cancel job');
    assert.ok(cancel, 'a Cancel button appears while a job runs');
    assert.equal(cancel.getAttribute('data-cancel-job'), 'job-abc');
    clickIt(w, cancel);
    await settle(w, 200);

    const cancels = calls.filter(c => c.url.indexOf('/cancel') > -1);
    assert.equal(cancels.length, 1, 'exactly one cancel request');
    assert.match(cancels[0].url, /\/api\/jobs\/job-abc\/cancel$/);
    assert.equal(cancels[0].method, 'POST');
  } finally { close(); }
});

test('an unverified remote stop is reported as unverified, never as a clean cancel', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    apiStub(w, { cancel: { status: 202, body: { ok: false, status: 'CANCELLED', remote_stop: 'unverified', quarantine: true, error: 'Cancelled locally, but the Big Mac side could not be verified stopped.' } } });
    await startGeneration(w, inst, doc);
    clickIt(w, byLabel(doc, 'Cancel job'));
    await settle(w, 250);

    const text = doc.body.textContent;
    assert.match(text, /could not be verified/i, 'the unverified stop is stated plainly');
    assert.doesNotMatch(text, /Big Mac stop verified/, 'no verified-stop claim without proof');
    assert.equal(inst._ws().interruptState, 'unverified');
  } finally { close(); }
});

test('a verified stop de-duplicates repeated clicks and names the verified outcome', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    const calls = apiStub(w);
    await startGeneration(w, inst, doc);
    const cancel = byLabel(doc, 'Cancel job');
    clickIt(w, cancel);
    clickIt(w, cancel);
    clickIt(w, cancel);
    await settle(w, 250);
    assert.equal(calls.filter(c => c.url.indexOf('/cancel') > -1).length, 1, 'repeated clicks do not fire concurrent stops');
    assert.equal(inst._ws().interruptState, 'verified');
  } finally { close(); }
});

test('a refused stop keeps the job running and explains why', { skip: needsDom }, async () => {
  const { w, doc, inst, close } = boot();
  try {
    await settle(w);
    apiStub(w, { cancel: { status: 409, body: { ok: false, gate: 'cancel-unsafe', cancelState: 'refused_unsafe', status: 'RUNNING', error: 'Cancellation refused: no process owner is registered.' } } });
    await startGeneration(w, inst, doc);
    clickIt(w, byLabel(doc, 'Cancel job'));
    await settle(w, 250);
    assert.equal(inst.state.jobStatus, 'generating', 'the job is still running after a refusal');
    assert.equal(inst._ws().activeJobId, 'job-abc');
    assert.match(doc.body.textContent, /refused/i);
  } finally { close(); }
});

// ── T-504: zero enabled no-ops in the Studio shell ───────────────────────────────────────────
test('every enabled button in the V2 shell has a real handler', () => {
  const { v2 } = v2Shell();
  const inert = [...v2.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .filter(m => !/onClick|disabled|data-/.test(m[0]))
    .map(m => m[1].replace(/<[^>]+>/g, '').trim());
  assert.deepEqual(inert, [], 'buttons that only look clickable are not shipped in the shell');
});

test('the formerly inert Models actions are gone instead of silently enabled', () => {
  const html = read('index.html');
  for (const label of ['Check stage', 'SDXL smoke', 'Flux smoke', 'Inventory', 'Discover']) {
    assert.equal(html.indexOf('>' + label + '</button>'), -1, label + ' no longer pretends to act');
  }
  assert.match(html, /onClick="\{\{ onLoadModels \}\}"/, 'the real model refresh remains wired');
});
