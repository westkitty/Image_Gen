'use strict';

// Exercises the real Big Mac half of the MFLUX bridge (mflux-remote-generate.sh)
// locally with a stub generator, covering the 2026-09-25 remote-png incident:
// failure classification, in-band exit status, cleanup ordering, prompt safety.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin');
const REMOTE = path.join(BIN, 'mflux-remote-generate.sh');
const BRIDGE = fs.readFileSync(path.join(BIN, 'mflux-controlled-generate.sh'), 'utf8');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64, 7)]);

const NASTY_PROMPT = `it's a "red" cube (small); A&B $HOME \`id\` $(id) ünïcödé 🐶\nsecond line\\n 'end'`;

function run(mode, prompt = 'a red cube') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-bridge-'));
  const tmpdir = path.join(base, 'tmp');
  fs.mkdirSync(tmpdir);
  fs.writeFileSync(path.join(base, 'fixture.png'), PNG);
  const stub = path.join(base, 'fake-mflux');
  fs.writeFileSync(stub, `#!/usr/bin/env bash
out=""; prompt=""
while [ $# -gt 0 ]; do case "$1" in --output) out="$2"; shift 2;; --prompt) prompt="$2"; shift 2;; *) shift;; esac; done
printf '%s' "$prompt" > "${base}/received-prompt"
echo "fake mflux progress line"
case "${mode}" in
  ok) cp "${base}/fixture.png" "$out" ;;
  crash) echo "TypeError: key(): incompatible function arguments" >&2; exit 1 ;;
  none) exit 0 ;;
  empty) : > "$out" ;;
  junk) echo "not a png" > "$out" ;;
esac
`);
  fs.chmodSync(stub, 0o755);
  const b64 = Buffer.from(prompt, 'utf8').toString('base64');
  const r = spawnSync('bash', ['-c', fs.readFileSync(REMOTE, 'utf8'), 'dexdiffusion-mflux', b64, '4', '7', '512', '512', path.join(base, 'cache'), stub, path.join(base, 'model')], {
    env: { ...process.env, TMPDIR: tmpdir }, encoding: 'buffer',
  });
  const stderr = r.stderr.toString('utf8');
  const marker = name => (stderr.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];
  return {
    base, stdout: r.stdout, stderr, marker,
    leftovers: fs.readdirSync(tmpdir).filter(f => f.startsWith('dexdiffusion-mflux.')),
    received: fs.existsSync(path.join(base, 'received-prompt')) ? fs.readFileSync(path.join(base, 'received-prompt'), 'utf8') : null,
  };
}

test('success: stdout is exactly the PNG, checksum marker matches, exit reported in-band, temp removed after transfer', () => {
  const r = run('ok');
  assert.deepEqual(r.stdout, PNG, 'stdout carries only PNG bytes (logs went to stderr)');
  assert.equal(r.marker('MFLUX_REMOTE_PNG_SHA256'), crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.equal(r.marker('MFLUX_REMOTE_EXIT'), '0');
  assert.match(r.stderr.trim(), /MFLUX_REMOTE_EXIT: 0$/, 'exit marker is emitted last, after the PNG was streamed');
  assert.deepEqual(r.leftovers, [], 'remote temp dir removed');
});

for (const [mode, reason] of [['crash', 'generator-exit'], ['none', 'output-missing'], ['empty', 'output-empty'], ['junk', 'output-invalid']]) {
  test(`failure "${mode}" is classified as ${reason}, streams nothing and still cleans up`, () => {
    const r = run(mode);
    assert.match(r.marker('MFLUX_REMOTE_FAIL') || '', new RegExp(`^${reason} `));
    assert.notEqual(r.marker('MFLUX_REMOTE_EXIT'), '0');
    assert.equal(r.stdout.length, 0);
    assert.equal(r.marker('MFLUX_REMOTE_PNG_SHA256'), undefined);
    assert.deepEqual(r.leftovers, [], 'failed run removed its temp image dir');
  });
}

test('shell-sensitive and multiline prompts reach the generator byte-for-byte (no injection)', () => {
  const r = run('ok', NASTY_PROMPT);
  assert.equal(r.received, NASTY_PROMPT);
  assert.equal(r.marker('MFLUX_REMOTE_EXIT'), '0');
});

test('bridge: negative seed becomes a recorded random seed; specific gates replace remote-png', () => {
  assert.match(BRIDGE, /case "\$SEED_VALUE" in\n\s*-\*\) SEED_VALUE="\$\(gen_random_seed\)"; SEED_LABEL="\$SEED_VALUE\(random\)"/);
  assert.match(BRIDGE, /-le 4294967295/);
  assert.doesNotMatch(BRIDGE, /fail "remote-png"/);
  for (const gate of ['generator-exit', 'output-missing', 'output-empty', 'output-invalid', 'transfer-failed', 'sha-mismatch', 'canonicalization-failed', 'cleanup-failed']) {
    assert.ok(BRIDGE.includes(gate), `gate ${gate} present`);
  }
  // Remote status is read in-band; the ssh exit code is never trusted as the remote result.
  assert.match(BRIDGE, /MFLUX_REMOTE_EXIT/);
  assert.doesNotMatch(BRIDGE, /\[ "\$SSH_RC" -eq 0 \] \|\| fail/);
  // The prompt only travels as base64; ssh argv carries base64, integers and %q-quoted paths.
  assert.match(BRIDGE, /dexdiffusion-mflux \$PROMPT_B64 \$ARG_STEPS \$SEED_VALUE \$ARG_WIDTH \$ARG_HEIGHT \$\(printf '%q'/);
  // Hot path is on Big Mac's internal SSD.
  assert.match(BRIDGE, /REMOTE_VENV_REL="Library\/Caches\/DexDiffusion\/mflux\/venv"/);
});
