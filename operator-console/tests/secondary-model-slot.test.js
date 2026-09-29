'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-secondary-slot.sh');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-slot-'));
  const slot = path.join(base, 'slot');
  const a = path.join(base, 'a.safetensors');
  const b = path.join(base, 'b.safetensors');
  fs.writeFileSync(a, Buffer.alloc(1024 * 1024 + 1, 1));
  fs.writeFileSync(b, Buffer.alloc(1024 * 1024 + 2, 2));
  const env = { ...process.env, DEX_SECONDARY_SLOT_LOCAL: '1', DEX_SECONDARY_SLOT_ROOT: slot };
  const run = (args) => JSON.parse(execFileSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' }));
  return { base, slot, a, b, env, run };
}

test('secondary slot switches A to B atomically and keeps exactly one active record', () => {
  const h = fixture();
  assert.equal(h.run(['activate', 'sd15', h.a]).activeSecondaryModel, 'sd15');
  const state = h.run(['activate', 'sdxl-base', h.b]);
  assert.equal(state.primaryModel.id, 'flux2-klein-4b');
  assert.equal(state.activeSecondaryModel, 'sdxl-base');
  assert.equal(state.sourcePath, fs.realpathSync(h.b));
  assert.equal(state.secondaryModelState, 'active');
  assert.equal(state.lastSwitchResult.status, 'pass');
  assert.equal(fs.realpathSync(path.join(h.slot, 'current', 'model.safetensors')), fs.realpathSync(h.b));
  const versions = fs.readdirSync(path.join(h.slot, 'versions')).filter(x => !x.startsWith('.'));
  assert.equal(versions.length, 1, 'only the current secondary slot version remains');
});

test('failed replacement preserves the current secondary and records truthful failure', () => {
  const h = fixture();
  h.run(['activate', 'sd15', h.a]);
  let failed;
  try { execFileSync('bash', [SCRIPT, 'activate', 'sdxl-base', path.join(h.base, 'missing.safetensors')], { env: h.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { failed = JSON.parse(String(e.stdout)); }
  assert.equal(failed.activeSecondaryModel, 'sd15');
  assert.equal(failed.lastSwitchResult.status, 'fail');
  assert.equal(fs.realpathSync(path.join(h.slot, 'current', 'model.safetensors')), fs.realpathSync(h.a));
});

test('protected FLUX primary cannot enter or be replaced by the secondary slot', () => {
  const h = fixture();
  let failed;
  try { execFileSync('bash', [SCRIPT, 'activate', 'flux2-klein-4b', h.a], { env: h.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { failed = JSON.parse(String(e.stdout)); }
  assert.equal(failed.lastSwitchResult.status, 'fail');
  assert.match(failed.lastSwitchResult.error, /protected primary/i);
  assert.equal(fs.existsSync(path.join(h.slot, 'current', 'model.safetensors')), false);
});

test('generation and API wiring use the managed slot and existing heavy lease', () => {
  const controlled = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-controlled-generate.sh'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'operator-console', 'server.js'), 'utf8');
  assert.match(controlled, /sdcpp-secondary-slot\.sh" activate/);
  assert.match(controlled, /SECONDARY_ACTIVE_MODEL/);
  assert.match(server, /app\.post\('\/api\/models\/secondary\/activate'/);
  assert.match(server, /arbiter\.acquire\(switchId/);
  assert.match(server, /return res\.status\(409\).*model switch.*busy/i);
});
