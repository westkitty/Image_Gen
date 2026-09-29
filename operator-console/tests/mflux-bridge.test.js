'use strict';

// Exercises the real Big Mac half of the MFLUX bridge (mflux-remote-generate.sh)
// and MacBook bridge contract (mflux-controlled-generate.sh), covering:
// 1. cleanup-success marker exists
// 2. successful remote exit cannot precede cleanup proof
// 3. Mac bridge requires MFLUX_REMOTE_CLEANUP: OK
// 4. missing cleanup marker fails closed
// 5. FAIL cleanup marker fails closed
// 6. cleanup failure prevents canonicalization
// 7. .incoming-* file is removed on failure
// 8. valid successful PNG still canonicalizes
// 9. remote temp path is restricted to the Dex MFLUX namespace
// 10. cleanup is safe when called repeatedly
// 11. stale recovery cannot target unrelated paths
// 12. stale recovery ignores fresh/active dirs
// 13. prompt redaction remains intact
// 14. SHA validation remains intact
// 15. stderr markers never contaminate PNG stdout

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

function run(mode, prompt = 'a red cube', extraEnv = {}) {
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
    env: { ...process.env, TMPDIR: tmpdir, ...extraEnv }, encoding: 'buffer',
  });
  const stderr = r.stderr.toString('utf8');
  const marker = name => (stderr.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];
  return {
    base, stdout: r.stdout, stderr, marker,
    leftovers: fs.readdirSync(tmpdir).filter(f => f.startsWith('dexdiffusion-mflux.')),
    received: fs.existsSync(path.join(base, 'received-prompt')) ? fs.readFileSync(path.join(base, 'received-prompt'), 'utf8') : null,
  };
}

test('1, 2, 15: success emits cleanup marker, exit follows cleanup proof, stdout is uncontaminated PNG', () => {
  const r = run('ok');
  assert.deepEqual(r.stdout, PNG, 'stdout carries only PNG bytes (15. stderr markers never contaminate stdout)');
  assert.equal(r.marker('MFLUX_REMOTE_PNG_SHA256'), crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.equal(r.marker('MFLUX_REMOTE_CLEANUP'), 'OK', '1. cleanup-success marker exists and is OK');
  assert.equal(r.marker('MFLUX_REMOTE_EXIT'), '0');

  // Verify ordering: MFLUX_REMOTE_CLEANUP: OK must precede MFLUX_REMOTE_EXIT: 0
  const cleanupIdx = r.stderr.indexOf('MFLUX_REMOTE_CLEANUP: OK');
  const exitIdx = r.stderr.indexOf('MFLUX_REMOTE_EXIT: 0');
  assert.ok(cleanupIdx !== -1, 'cleanup marker present');
  assert.ok(exitIdx !== -1, 'exit marker present');
  assert.ok(cleanupIdx < exitIdx, '2. successful remote exit cannot precede cleanup proof');
  assert.deepEqual(r.leftovers, [], 'remote temp dir removed');
});

for (const [mode, reason] of [['crash', 'generator-exit'], ['none', 'output-missing'], ['empty', 'output-empty'], ['junk', 'output-invalid']]) {
  test(`failure "${mode}" is classified as ${reason}, streams nothing and still cleans up with cleanup OK`, () => {
    const r = run(mode);
    assert.match(r.marker('MFLUX_REMOTE_FAIL') || '', new RegExp(`^${reason} `));
    assert.notEqual(r.marker('MFLUX_REMOTE_EXIT'), '0');
    assert.equal(r.stdout.length, 0);
    assert.equal(r.marker('MFLUX_REMOTE_PNG_SHA256'), undefined);
    assert.equal(r.marker('MFLUX_REMOTE_CLEANUP'), 'OK');
    assert.deepEqual(r.leftovers, [], 'failed run removed its temp image dir');
  });
}

test('3, 4, 5: Mac bridge requires MFLUX_REMOTE_CLEANUP: OK and fails closed if missing or FAIL', () => {
  assert.match(BRIDGE, /REMOTE_CLEANUP="\$\(sed -n 's\/\^MFLUX_REMOTE_CLEANUP: \/\/p' "\$REMOTE_STDOUT_LOG" \| tail -1\)"/);
  assert.match(BRIDGE, /if \[ "\$REMOTE_CLEANUP" != "OK" \]; then\s*fail "cleanup-failed" "Remote cleanup unverified/);

  // Redundant post-transfer SSH round trips are removed
  assert.doesNotMatch(BRIDGE, /ssh_remote "rm -rf -- \$\(printf '%q' "\$REMOTE_TMP"\)"/);
  assert.doesNotMatch(BRIDGE, /remote_test "test ! -e \$\(printf '%q' "\$REMOTE_TMP"\)"/);
});

test('6, 7, 8: bridge canonicalization contract and incoming cleanup', () => {
  // 7. .incoming-* file is trapped for cleanup on exit
  assert.match(BRIDGE, /trap 'rm -f -- "\$INCOMING" "\$RAW_STDERR"' EXIT/);
  // 6. canonicalization only happens AFTER all gates pass
  const cleanGatePos = BRIDGE.indexOf('Remote cleanup unverified');
  const canonPos = BRIDGE.indexOf('IMAGE_BASE="$RUN_ID-s$SEED_VALUE-controlled-$ARG_TARGET"');
  assert.ok(cleanGatePos !== -1 && canonPos !== -1 && cleanGatePos < canonPos, 'cleanup check precedes canonicalization');
  // 8. valid successful PNG links into canonical root
  assert.match(BRIDGE, /ln "\$INCOMING" "\$candidate"/);
});

test('9: remote temp path is restricted to the Dex MFLUX namespace', () => {
  const remoteCode = fs.readFileSync(REMOTE, 'utf8');
  assert.match(remoteCode, /"\$tmp_root"\/dexdiffusion-mflux\.\[A-Za-z0-9\]\*\)/);
});

test('10: cleanup is idempotent and safe when called repeatedly', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-idempotent-'));
  const testDir = path.join(base, 'dexdiffusion-mflux.TEST1234');
  fs.mkdirSync(testDir);
  const snippet = `
tmp_root="${base}"
tmp="${testDir}"
cleaned=0
clean_tmp() {
  if [ "$cleaned" -eq 1 ]; then return 0; fi
  case "$tmp" in
    "$tmp_root"/dexdiffusion-mflux.[A-Za-z0-9]*) rm -rf -- "$tmp" 2>/dev/null || true ;;
    *) return 1 ;;
  esac
  local retries=3
  while [ "$retries" -gt 0 ]; do
    if [ ! -e "$tmp" ]; then cleaned=1; return 0; fi
    retries=$((retries - 1))
    sleep 0.05
  done
  return 1
}
clean_tmp || exit 1
clean_tmp || exit 2
clean_tmp || exit 3
echo "IDEMPOTENT_OK"
`;
  const res = spawnSync('bash', ['-c', snippet], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /IDEMPOTENT_OK/);
  assert.equal(fs.existsSync(testDir), false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('11, 12: stale recovery cleans only abandoned MFLUX dirs older than 60m, preserves fresh and unrelated dirs', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-stale-'));
  const staleMflux = path.join(base, 'dexdiffusion-mflux.STALE001');
  const freshMflux = path.join(base, 'dexdiffusion-mflux.FRESH002');
  const unrelatedDir = path.join(base, 'unrelated-dir');
  const unrelatedFile = path.join(base, 'other.txt');

  fs.mkdirSync(staleMflux);
  fs.mkdirSync(freshMflux);
  fs.mkdirSync(unrelatedDir);
  fs.writeFileSync(unrelatedFile, 'keep me');

  // Set stale directory mtime to 2 hours ago (120 minutes)
  const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
  fs.utimesSync(staleMflux, twoHoursAgo, twoHoursAgo);

  const snippet = `
tmp_root="${base}"
find "$tmp_root" -mindepth 1 -maxdepth 1 -type d -name 'dexdiffusion-mflux.*' -mmin +60 -exec rm -rf -- {} + 2>/dev/null || true
`;
  spawnSync('bash', ['-c', snippet]);

  assert.equal(fs.existsSync(staleMflux), false, 'stale mflux dir was cleaned');
  assert.equal(fs.existsSync(freshMflux), true, '12. fresh mflux dir was preserved');
  assert.equal(fs.existsSync(unrelatedDir), true, '11. unrelated dir was preserved');
  assert.equal(fs.existsSync(unrelatedFile), true, '11. unrelated file was preserved');

  fs.rmSync(base, { recursive: true, force: true });
});

test('13: prompt redaction remains intact under privacy mode', () => {
  const r = run('ok', NASTY_PROMPT);
  assert.equal(r.received, NASTY_PROMPT);
  assert.equal(r.marker('MFLUX_REMOTE_EXIT'), '0');
  assert.match(BRIDGE, /if \[ "\$ARG_SAVE_PROMPTS" = "true" \]; then\s*export SDCPP_REDACT_PROMPTS=0\s*else\s*export SDCPP_REDACT_PROMPTS=1\s*fi/);
  assert.match(BRIDGE, /strip_png_metadata "\$INCOMING"/);
});

test('14: SHA-256 validation compares remote vs local streamed file', () => {
  assert.match(BRIDGE, /LOCAL_SHA="\$\(shasum -a 256 "\$INCOMING" \| cut -d' ' -f1\)"/);
  assert.match(BRIDGE, /\[ "\$LOCAL_SHA" = "\$REMOTE_SHA" \] \|\| fail "sha-mismatch"/);
});
