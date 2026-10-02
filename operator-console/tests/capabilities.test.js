'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { CAPABILITIES, deriveStatus, createEvidenceStore, targetModelMap, targetRuntime } = require('../capabilities');
const { chooseInitialTarget, targetOptionLabel, capabilityBadge } = require('../public/dexdiffusion/client-helpers.js');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'sdcpp-workflow', 'bin');
const cap = id => CAPABILITIES.find(c => c.id === id);
const ALL = { reachable: true, mfluxRuntime: true, mfluxModel: true, sdCli: true, sd15Model: true, esrganModel: true };

test('status is derived: dormant / available / proven / broken / unavailable', () => {
  assert.equal(deriveStatus(cap('img2img'), { ...ALL, sdCli: false }, {}).status, 'dormant');
  assert.equal(deriveStatus(cap('upscale-esrgan'), { ...ALL, esrganModel: false }, {}).status, 'dormant');
  assert.equal(deriveStatus(cap('img2img'), ALL, {}).status, 'available', 'assets alone never mean proven');
  const pass = { lastPass: { at: '2026-09-25T10:00:00Z', runId: 'r' } };
  assert.equal(deriveStatus(cap('img2img'), ALL, { img2img: pass }).status, 'proven');
  assert.equal(deriveStatus(cap('img2img'), { ...ALL, sd15Model: false }, { img2img: pass }).status, 'dormant', 'a proof cannot outlive a missing asset');
  const broke = { img2img: { ...pass.lastPass && pass, lastFail: { at: '2026-09-25T11:00:00Z', gate: 'generator-exit' } } };
  assert.equal(deriveStatus(cap('img2img'), ALL, broke).status, 'broken');
  assert.equal(deriveStatus({ id: 'x', needs: [], implemented: false }, ALL, {}).status, 'unavailable');
  assert.equal(deriveStatus(cap('img2img'), null, {}).status, 'available', 'unknown assets never produce proven');
});

test('evidence comes only from finished real jobs; validation failures do not mark BROKEN', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ev-')), 'ev.json');
  const store = createEvidenceStore(file);
  assert.equal(store.record({ commandAction: 'controlled-generate', status: 'PASS', runId: 'a', completedAt: 1 }, 'mflux'), 'txt2img-mflux');
  assert.equal(store.record({ commandAction: 'controlled-generate', controlledTarget: 'sd15', status: 'PASS', runId: 'b', completedAt: 2 }, 'sdcpp'), 'txt2img-sdcpp');
  assert.equal(store.record({ commandAction: 'img2img', status: 'FAIL', firstFailedGate: 'args', completedAt: 3 }, 'sdcpp'), null);
  assert.equal(store.record({ commandAction: 'discover-assets', status: 'PASS', completedAt: 4 }), null);
  store.record({ commandAction: 'inpaint', status: 'FAIL', firstFailedGate: 'generator-exit', completedAt: 5 });
  const ev = store.read();
  assert.equal(ev['txt2img-mflux'].lastPass.runId, 'a');
  assert.equal(ev['txt2img-sdcpp'].lastPass.runId, 'b');
  assert.equal(ev.img2img, undefined);
  assert.equal(deriveStatus(cap('inpaint'), ALL, ev).status, 'broken');
});

test('targets: missing model or runtime can never look ready; MFLUX stays primary', () => {
  const models = targetModelMap(path.join(BIN, 'sdcpp-controlled-generate.sh'), '$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors');
  assert.equal(models.sd15, '$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors');
  assert.match(models['sdxl-base'], /^\$HOME\/sdcpp-staging\/models\/sd_xl_base_1\.0\.safetensors$/);
  const assets = { ...ALL, models: { [models.sd15]: true, [models['sdxl-base']]: false } };
  assert.equal(targetRuntime({ id: 'sd15' }, assets, models), 'available');
  assert.equal(targetRuntime({ id: 'sdxl-base' }, assets, models), 'model-missing');
  assert.equal(targetRuntime({ id: 'sd15' }, { ...assets, sdCli: false }, models), 'dormant');
  assert.equal(targetRuntime({ id: 'sd15' }, { reachable: false }, models), 'unknown');
  assert.equal(targetRuntime({ id: 'flux2-klein-4b', backend: 'mflux' }, assets, models), 'available');
  const targets = [
    { id: 'sdxl-base', status: 'proofed', runtime: 'model-missing' },
    { id: 'flux2-klein-4b', status: 'proofed', primary: true, runtime: 'available' },
  ];
  assert.equal(chooseInitialTarget(targets, 'sdxl-base', 'sd15'), 'flux2-klein-4b', 'saved model-missing target is not restored');
  assert.equal(targetOptionLabel(targets[0]), 'sdxl-base — model missing');
  assert.equal(capabilityBadge('available').label, 'Available · unproven');
  assert.equal(CAPABILITIES.filter(c => c.primary).map(c => c.id).join(), 'txt2img-mflux');
});

test('UI truth status is data-driven (no hard-coded Proven/gate lists)', () => {
  const comp = fs.readFileSync(path.join(ROOT, 'operator-console/public/dexdiffusion/component.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'operator-console/public/dexdiffusion/index.html'), 'utf8');
  assert.doesNotMatch(comp, /gateRows/);
  assert.match(comp, /s\.systemInfo && s\.systemInfo\.capabilities/);
  assert.doesNotMatch(html, /requires backend tunnel|requires BigMac server|✓ txt2img — controlled/);
});

test('SDCPP edit/upscale scripts accept canonical-store inputs but nothing arbitrary', () => {
  for (const f of ['sdcpp-img2img.sh', 'sdcpp-inpaint.sh', 'sdcpp-esrgan-upscale.sh']) {
    const src = fs.readFileSync(path.join(BIN, f), 'utf8');
    // img2img/inpaint additionally accept the temporary mask-uploads area (prepared sources, outpaint canvases)
    const allowed = f !== 'sdcpp-esrgan-upscale.sh'
      ? /"\$SDCPP_RUNS_DIR\/"\*\|"\$DEX_IMAGES_ROOT\/"\*\|"\$\(dirname "\$SDCPP_RUNS_DIR"\)\/mask-uploads\/"\*\) ;;/
      : /"\$SDCPP_RUNS_DIR\/"\*\|"\$DEX_IMAGES_ROOT\/"\*\) ;;/;
    assert.match(src, allowed, f);
    assert.match(src, /\*\) fail "init-img"/, f);
  }
});

test('nested run cells are recorded as their top-level run', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-rec-'));
  const out = execFileSync('bash', ['-c', `. "${path.join(BIN, 'sdcpp-lib.sh')}"; SDCPP_RUNS_DIR="${base}/runs"; DEX_RUN_DIRS_FILE="${base}/list"; record_run_dir "${base}/runs/20260925-000000-hires-fix/base"; record_run_dir "${base}/runs/20260925-000001-img2img"; cat "${base}/list"`], { encoding: 'utf8' });
  assert.deepEqual(out.trim().split('\n'), [`${base}/runs/20260925-000000-hires-fix`, `${base}/runs/20260925-000001-img2img`]);
});

test('lifecycle helper backgrounds only node with detached stdio (no lingering helper)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'dexdiffusion'), 'utf8');
  assert.match(src, /\( cd "\$CONSOLE_DIR" \|\| exit 1; nohup node server\.js <\/dev\/null >>"\$LOG" 2>&1 & echo \$! >"\$PIDFILE" \)/);
  assert.doesNotMatch(src, /cd "\$CONSOLE_DIR" && nohup/);
});

test('a custom SDCPP target failure is never recorded against SD1.5 txt2img', () => {
  const { capabilityForJob } = require('../capabilities');
  const custom = capabilityForJob({ commandAction: 'controlled-generate', controlledTarget: 'sd15-homofidelis' }, 'sdcpp');
  assert.equal(custom, null);
  assert.equal(capabilityForJob({ commandAction: 'controlled-generate', controlledTarget: 'sd15' }, 'sdcpp').id, 'txt2img-sdcpp');
  assert.equal(capabilityForJob({ commandAction: 'controlled-generate', requestParams: { target: 'sdxl-photonic' } }, 'sdcpp').id, 'txt2img-sdxl-photonic');
});

test('each model requires its own canonical real-job result; partial results never prove it', () => {
  const { targetVerification } = require('../capabilities');
  const store = createEvidenceStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-model-ev-')), 'evidence.json'));
  const target = { id: 'sdxl-pony' };
  const models = { 'sdxl-pony': '/models/pony.safetensors' };
  const assets = { ...ALL, models: { [models['sdxl-pony']]: true } };
  const job = { commandAction: 'controlled-generate', requestParams: { target: target.id }, status: 'PASS', runId: 'real-run', id: 'job', completedAt: 1 };
  store.record(job, 'sdcpp');
  assert.equal(targetVerification(target, assets, models, store.read()).status, 'available');
  store.record({ ...job, status: 'PARTIAL', controlledOutputImageUrl: '/api/images/result.png' }, 'sdcpp');
  assert.equal(targetVerification(target, assets, models, store.read()).status, 'available');
  store.record({ ...job, controlledOutputImageUrl: '/api/images/result.png' }, 'sdcpp');
  assert.equal(targetVerification(target, assets, models, store.read()).status, 'proven');
  assert.equal(targetVerification({ id: 'sdxl-homochi' }, assets, {}, store.read()).status, 'available');
  assert.equal(targetVerification(target, { ...assets, models: { [models['sdxl-pony']]: false } }, models, store.read()).status, 'dormant');
  assert.equal(targetVerification(target, { reachable: false }, models, store.read()).status, 'unknown');
  store.record({ ...job, status: 'FAIL', completedAt: 2, firstFailedGate: 'generator-exit' }, 'sdcpp');
  assert.equal(targetVerification(target, assets, models, store.read()).status, 'broken');
});
