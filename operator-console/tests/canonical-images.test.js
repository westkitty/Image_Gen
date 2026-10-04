'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { CANONICAL_IMAGE_ROOT, createImageStore } = require('../image-store');
const { resolveBackendBase, jobProgressPercent } = require('../public/dexdiffusion/client-helpers.js');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_BIN = path.join(ROOT, '..', 'sdcpp-workflow', 'bin');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-images-'));
  const store = createImageStore({ root: path.join(base, 'images_made') });
  store.ensureRoot();
  const runDir = path.join(base, 'runs', '20260925-120000-controlled-sd15');
  fs.mkdirSync(runDir, { recursive: true });
  return { base, store, runDir };
}

test('canonical image root is exactly /Users/andrew/images_made and the server uses it', () => {
  assert.equal(CANONICAL_IMAGE_ROOT, '/Users/andrew/images_made');
  assert.equal(createImageStore().root, '/Users/andrew/images_made');
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /const imageStore = createImageStore\(\);/);
  const lib = fs.readFileSync(path.join(WORKFLOW_BIN, 'sdcpp-lib.sh'), 'utf8');
  assert.match(lib, /^DEX_IMAGES_ROOT="\$\{DEX_IMAGES_ROOT_OVERRIDE:-\/Users\/andrew\/images_made\}"$/m);
});

test('completed run keeps metadata only; image bytes move to the canonical root', () => {
  const { store, runDir } = sandbox();
  fs.writeFileSync(path.join(runDir, 'controlled-sd15.png'), PNG);
  fs.mkdirSync(path.join(runDir, 'upscaled'));
  fs.writeFileSync(path.join(runDir, 'upscaled', 'x-2x.png'), PNG);
  fs.writeFileSync(path.join(runDir, 'controlled-manifest.json'), '{}');

  const adopted = store.adoptRunImages(runDir, { seed: '42' });
  assert.equal(adopted.length, 2);
  assert.deepEqual(store.findRunImageFiles(runDir), [], 'no image bytes left in run dir');
  assert.ok(fs.existsSync(path.join(runDir, 'controlled-manifest.json')));
  for (const e of adopted) {
    assert.equal(path.dirname(e.image_path), store.root);
    assert.equal(e.image_url, '/api/images/' + e.image_id);
    assert.ok(e.image_id.includes('20260925-120000-controlled-sd15-s42'));
  }
  assert.equal(store.resolveRunImage(runDir, 'controlled-sd15.png').path, adopted[0].image_path);
  assert.deepEqual(store.listRunImageNames(runDir).sort(), ['controlled-sd15.png', 'upscaled/x-2x.png']);
  assert.deepEqual(fs.readdirSync(store.root).filter(f => f.startsWith('.incoming')), []);
});

test('adoption never overwrites an existing canonical image', () => {
  const { store, runDir } = sandbox();
  const taken = '20260925-120000-controlled-sd15-controlled-sd15.png';
  fs.writeFileSync(path.join(store.root, taken), 'keep');
  fs.writeFileSync(path.join(runDir, 'controlled-sd15.png'), PNG);
  const [entry] = store.adoptRunImages(runDir);
  assert.notEqual(entry.image_id, taken);
  assert.equal(fs.readFileSync(path.join(store.root, taken), 'utf8'), 'keep');
});

test('non-image and non-signature files are not adopted', () => {
  const { store, runDir } = sandbox();
  fs.writeFileSync(path.join(runDir, 'broken.png'), 'not a png');
  assert.throws(() => store.adoptRunImages(runDir), /image-format-invalid/);
  assert.ok(fs.existsSync(path.join(runDir, 'broken.png')));
  assert.equal(store.readRunIndex(runDir).length, 0);
});

test('image lookup cannot escape the canonical root', () => {
  const { base, store } = sandbox();
  fs.writeFileSync(path.join(store.root, 'ok.png'), PNG);
  fs.writeFileSync(path.join(base, 'outside.png'), PNG);
  fs.symlinkSync(path.join(base, 'outside.png'), path.join(store.root, 'link.png'));
  fs.writeFileSync(path.join(store.root, '.incoming-x.png'), PNG);
  assert.ok(store.resolveImage('ok.png'));
  for (const bad of [
    '../outside.png', '..%2Foutside.png', decodeURIComponent('..%2Foutside.png'), '%2e%2e/outside.png',
    path.join(base, 'outside.png'), '/etc/hosts', 'sub/ok.png', '..\\outside.png', 'ok.png\0.png',
    '.incoming-x.png', 'link.png', 'missing.png', 'notes.txt', '', null,
  ]) {
    assert.equal(store.resolveImage(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('frontend API calls are same-origin (no hardcoded loopback backend)', () => {
  const files = ['public/dexdiffusion/component.js', 'public/dexdiffusion/index.html', 'public/app.js', 'public/index.html'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/, f);
  }
  assert.equal(resolveBackendBase(null), '');
  assert.equal(resolveBackendBase('http://127.0.0.1:31337'), '');
  assert.equal(resolveBackendBase('http://localhost:31337/'), '');
  assert.equal(resolveBackendBase('https://other.example.ts.net:8443/'), 'https://other.example.ts.net:8443');
});

test('progress formatting never yields NaN and stays within 0-100', () => {
  assert.equal(jobProgressPercent({ totalRuns: 1, totalPercent: 37, currentRunPercent: 37 }), 37);
  assert.equal(jobProgressPercent({ currentRunPercent: 12.6 }), 13);
  assert.equal(jobProgressPercent(55), 55);
  assert.equal(jobProgressPercent(250), 100);
  assert.equal(jobProgressPercent(-4), 0);
  for (const v of [null, undefined, {}, 'abc', NaN, { totalPercent: 'x' }]) {
    assert.equal(jobProgressPercent(v), null);
  }
});

test('MFLUX bridge streams into the canonical root and keeps Big Mac images ephemeral', () => {
  const src = fs.readFileSync(path.join(WORKFLOW_BIN, 'mflux-controlled-generate.sh'), 'utf8')
    + fs.readFileSync(path.join(WORKFLOW_BIN, 'mflux-remote-generate.sh'), 'utf8');
  assert.match(src, /INCOMING="\$DEX_IMAGES_ROOT\/\.incoming-\$RUN_ID\.png"/);
  assert.match(src, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/dexdiffusion-mflux\.XXXXXXXX"/);
  assert.match(src, /rm -rf -- "\$tmp"/);
  assert.match(src, /trap finish EXIT/);
  assert.match(src, /MFLUX_REMOTE_CLEANUP/);
  assert.doesNotMatch(src, /\bscp\b/);
  assert.doesNotMatch(src, /\$RUN_DIR\/controlled-\$ARG_TARGET\.png/);
});

test('SDCPP scripts register their Big Mac images for exit cleanup', () => {
  for (const f of ['sdcpp-cli-generate.sh', 'sdcpp-controlled-generate.sh', 'sdcpp-img2img.sh', 'sdcpp-inpaint.sh',
    'sdcpp-esrgan-upscale.sh', 'sdcpp-flux-smoke.sh', 'sdcpp-sdxl-smoke.sh', 'sdcpp-sdxl-turbo-smoke.sh']) {
    assert.match(fs.readFileSync(path.join(WORKFLOW_BIN, f), 'utf8'), /^register_remote_ephemeral /m, f);
  }
});

// Runs a real bash entrypoint that sources sdcpp-lib.sh, exactly like a
// hand-run SDCPP script, against an isolated images root.
function runDirectScript(body) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-direct-'));
  const images = path.join(base, 'images_made');
  const runs = path.join(base, 'runs');
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(runs, { recursive: true });
  const fixture = path.join(base, 'fixture.png');
  fs.writeFileSync(fixture, PNG);
  const script = path.join(base, 'direct.sh');
  fs.writeFileSync(script, `#!/usr/bin/env bash
set -euo pipefail
. ${JSON.stringify(path.join(WORKFLOW_BIN, 'sdcpp-lib.sh'))}
SDCPP_RUNS_DIR=${JSON.stringify(runs)}
${body}
`);
  const env = { ...process.env, DEX_IMAGES_ROOT_OVERRIDE: images, TMPDIR: base };
  delete env.DEX_TOP_PID;
  delete env.DEX_RUN_DIRS_FILE;
  let out = '';
  try { out = execFileSync('bash', [script], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || ''); }
  return { base, images, runs, fixture, out };
}

test('direct (hand-run) SDCPP completion leaves no image in the run dir', () => {
  const { images, runs } = runDirectScript(`
RUN_DIR="$(make_run_dir controlled-sd15)"
cp "$(dirname "$0")/fixture.png" "$RUN_DIR/controlled-sd15.png"
printf '{"seed_label":"77 (fixed)"}' > "$RUN_DIR/controlled-manifest.json"
touch "$(dirname "$0")/images_made/$(basename "$RUN_DIR")-s77-controlled-sd15.png"
pass_banner "done"
`);
  const [runId] = fs.readdirSync(runs);
  const runDir = path.join(runs, runId);
  const store = createImageStore({ root: images });
  assert.deepEqual(store.findRunImageFiles(runDir), [], 'run dir still holds image bytes');
  const [entry] = store.readRunIndex(runDir);
  assert.equal(entry.run_file, 'controlled-sd15.png');
  assert.equal(path.dirname(entry.image_path), images);
  assert.ok(fs.existsSync(entry.image_path));
  assert.equal(fs.statSync(path.join(images, `${runId}-s77-controlled-sd15.png`)).size, 0, 'existing file overwritten');
  assert.equal(entry.image_id, `${runId}-s77-controlled-sd15-2.png`);
  assert.deepEqual(fs.readdirSync(images).filter(f => f.startsWith('.incoming')), []);
});

test('nested scripts defer finalization to the top-level entrypoint', () => {
  const { images, runs } = runDirectScript(`
PARENT="$(make_run_dir hires-fix)"
bash -c '. "$1"; SDCPP_RUNS_DIR="$2"; D="$(make_run_dir controlled-sd15)"; cp "$3" "$D/base.png"; pass_banner child; test -f "$D/base.png"' _ \\
  ${JSON.stringify(path.join(WORKFLOW_BIN, 'sdcpp-lib.sh'))} "$SDCPP_RUNS_DIR" "$(dirname "$0")/fixture.png"
echo CHILD_KEPT_INPUT
pass_banner "parent"
`);
  const store = createImageStore({ root: images });
  for (const r of fs.readdirSync(runs)) {
    assert.deepEqual(store.findRunImageFiles(path.join(runs, r)), [], r);
  }
  assert.equal(fs.readdirSync(images).filter(f => f.endsWith('.png')).length, 1);
});
