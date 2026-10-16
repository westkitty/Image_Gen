'use strict';

// The secondary model slot refuses symlink sources on purpose. A pre-migration config (REMOTE_MODEL pointing at the
// legacy staging symlink) used to make every sd15 activation fail with "source checkpoint is missing, unsafe...".
// The worker now resolves exactly one level of that legacy symlink before asking the slot; the slot still validates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin');
const SLOT = path.join(BIN, 'sdcpp-secondary-slot.sh');
const SCRIPT = fs.readFileSync(path.join(BIN, 'sdcpp-controlled-generate.sh'), 'utf8');

function slot(root, source) {
  const r = spawnSync('bash', [SLOT, 'activate', 'sd15', source], {
    env: { ...process.env, DEX_SECONDARY_SLOT_LOCAL: '1', DEX_SECONDARY_SLOT_ROOT: root }, encoding: 'utf8',
  });
  let state = null; try { state = JSON.parse(r.stdout); } catch (_) {}
  return { status: r.status, state };
}

test('slot: a symlink source is refused, its resolved regular file is accepted (rule unchanged)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-slot-'));
  try {
    const real = path.join(dir, 'external', 'v1-5.safetensors');
    fs.mkdirSync(path.dirname(real));
    fs.writeFileSync(real, Buffer.alloc(2 * 1024 * 1024, 7));
    const legacy = path.join(dir, 'legacy.safetensors');
    fs.symlinkSync(real, legacy);
    const viaLink = slot(path.join(dir, 'slot-a'), legacy);
    assert.notEqual(viaLink.status, 0);
    assert.match(viaLink.state.lastSwitchResult.error, /missing, unsafe, or not a \.safetensors/);
    const direct = slot(path.join(dir, 'slot-b'), real);
    assert.equal(direct.status, 0, JSON.stringify(direct.state));
    assert.equal(direct.state.activeSecondaryModel, 'sd15');
    assert.equal(direct.state.secondaryModelState, 'active');
    assert.equal(slot(path.join(dir, 'slot-c'), path.join(dir, 'missing.safetensors')).status !== 0, true);
    fs.writeFileSync(path.join(dir, 'small.safetensors'), 'tiny');
    assert.match(slot(path.join(dir, 'slot-d'), path.join(dir, 'small.safetensors')).state.lastSwitchResult.error, /too small/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function resolveWith(slotSource, sshOutput) {
  const m = SCRIPT.match(/# SLOT_RESOLVE_BEGIN\n([\s\S]*?)# SLOT_RESOLVE_END/);
  assert.ok(m, 'resolution block markers present');
  const prog = `log() { :; }\nssh_remote() { printf '%s' "$FAKE_SSH_OUT"; }\nSLOT_SOURCE='${slotSource}'\n${m[1]}\nprintf '%s' "$SLOT_SOURCE"`;
  return spawnSync('bash', ['-c', prog], { env: { ...process.env, FAKE_SSH_OUT: sshOutput }, encoding: 'utf8' }).stdout;
}

test('worker: legacy staging symlink is resolved one level; everything else is left alone', () => {
  const legacy = '$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors';
  const real = '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors';
  assert.equal(resolveWith(legacy, real + '\n'), real, 'symlink target replaces the legacy path');
  assert.equal(resolveWith('/Users/bigmac/sdcpp-staging/models/x.safetensors', real + '\r\n'), real, 'absolute legacy path too');
  assert.equal(resolveWith(legacy, ''), legacy, 'not a symlink: unchanged');
  assert.equal(resolveWith(legacy, 'relative/path.safetensors'), legacy, 'non-absolute output ignored');
  assert.equal(resolveWith(legacy, '/etc/passwd'), legacy, 'non-.safetensors output ignored');
  assert.equal(resolveWith(real, '/should/not/be/used.safetensors'), real, 'canonical external path is never rewritten');
  assert.equal(resolveWith('/Volumes/wc2tb/ImageGen/checkpoints/sdxl/x.safetensors', '/other.safetensors'), '/Volumes/wc2tb/ImageGen/checkpoints/sdxl/x.safetensors', 'other roots untouched');
});

test('worker: resolution happens before the slot is asked, and the slot call still receives the (possibly resolved) source', () => {
  const resolvePos = SCRIPT.indexOf('# SLOT_RESOLVE_BEGIN');
  const slotPos = SCRIPT.indexOf('sdcpp-secondary-slot.sh" activate');
  assert.ok(resolvePos > 0 && slotPos > resolvePos);
  assert.match(SCRIPT, /sdcpp-secondary-slot\.sh" activate "\$ARG_TARGET" "\$SLOT_SOURCE"/);
});

test('example config names the canonical external sd15 path (what the local config must match)', () => {
  const ex = fs.readFileSync(path.join(BIN, '..', 'config', 'sdcpp.env.example'), 'utf8');
  assert.match(ex, /REMOTE_MODEL='\/Volumes\/wc2tb\/ImageGen\/checkpoints\/sd15\/v1-5-pruned-emaonly\.safetensors'/);
});
