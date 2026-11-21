'use strict';
// WC2TB prevention contract (docs/WC2TB_PREVENTION.md). Portable: no Big Mac,
// WC2TB, TCC, credentials, models or MacBook. Every child runs in a temporary
// HOME with a hard timeout and is proven to have exited.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { sharedDiskReserveBytes } = require('../backend-quiescence');

const REPO = path.resolve(__dirname, '../..');
const GATE = path.join(REPO, 'scripts/release-gate.sh');
const DOCTOR = path.join(REPO, 'scripts/wc2tb-release-doctor.py');
const REV = '352e508ceebe950bac6b2115be6782564e7b2370';
const PY = fs.existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';
const spawned = [];

function tempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-prevention-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(cmd, args, opts = {}) {
  const out = cp.spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, ...opts });
  if (out.pid) spawned.push(out.pid);
  return out;
}
function goodFacts() {
  const script = `import importlib.util,json,sys
sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'scripts/test'))})
spec = importlib.util.spec_from_file_location('t', ${JSON.stringify(path.join(REPO, 'scripts/test/test_wc2tb_release_doctor.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(json.dumps(m.good_facts()))`;
  const out = run(PY, ['-c', script]);
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}
function gate(t, facts, extra = []) {
  const home = tempHome(t);
  const file = path.join(home, 'facts.json');
  fs.writeFileSync(file, JSON.stringify(facts));
  const out = run('/bin/bash', [GATE, '--expect-revision', REV, ...extra],
    { env: { ...process.env, HOME: home, DEX_RELEASE_GATE_FIXTURE_FACTS: file } });
  return { ...out, home };
}

test('gate: passing fixture is reported but never authorizes (exit 79, not 0)', t => {
  const out = gate(t, goodFacts());
  assert.equal(out.status, 79, out.stderr);
  assert.match(out.stdout, /GATE_FIXTURE verdict=PASS decision=AUTHORIZE /);
});

test('gate negative control: a broken fixture fails the gate (A: Node hash mismatch)', t => {
  const facts = goodFacts(); facts.node.sha256 = '0'.repeat(64);
  const out = gate(t, facts);
  assert.equal(out.status, 78, out.stderr);
  assert.match(out.stdout, /verdict=BLOCKED decision=REFUSE failing=node=BLOCKED/);
});

test('gate: BLOCKED cannot be overridden; UNVERIFIED needs a written, logged reason', t => {
  const blocked = goodFacts(); blocked.authority.legacy_loaded = true; // D: two restart owners
  assert.equal(gate(t, blocked, ['--override-unverified', 'operator verified this by hand today']).status, 78);
  const unverified = goodFacts(); delete unverified.disk;
  assert.equal(gate(t, unverified).status, 78);
  assert.equal(gate(t, unverified, ['--override-unverified', 'too short']).status, 78);
  const out = gate(t, unverified, ['--override-unverified', 'diskutil timed out; df checked by operator']);
  assert.equal(out.status, 79, out.stderr);
  assert.match(out.stdout, /decision=AUTHORIZE_OVERRIDE/);
  assert.match(fs.readFileSync(path.join(out.home, 'Library/Logs/DexDiffusion/release-gate-overrides.log'), 'utf8'),
    /fixture=true verdict=UNVERIFIED .*failing=disk_reserve=UNVERIFIED/);
});

test('gate: expected revision is mandatory and doctor output must be consistent', t => {
  const home = tempHome(t);
  const out = run('/bin/bash', [GATE], { env: { ...process.env, HOME: home } });
  assert.equal(out.status, 78);
  assert.match(out.stderr, /--expect-revision <full sha> is mandatory/);
});

test('owner restart runs the release gate before any worker contact and refuses fixtures', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts/request-worker-backend.sh'), 'utf8');
  const gateAt = src.indexOf('release-gate.sh');
  assert.ok(gateAt > 0 && gateAt < src.indexOf("request('backend-restart')"), 'gate must precede backend-restart');
  assert.match(src, /DEX_RELEASE_GATE_FIXTURE_FACTS[^\n]*\n?[^\n]*fixture facts cannot authorize a restart/);
  assert.match(src, /release gate refused restart; backend left running' >&2; exit 78/);
  assert.doesNotMatch(src, /SKIP_GATE|NO_GATE|DEX_RELEASE_GATE_BYPASS/);
});

test('E: legacy direct stop is refused under EngineHost supervision and signals nothing', t => {
  const home = tempHome(t);
  fs.mkdirSync(path.join(home, '.dexdiffusion-engine'));
  fs.writeFileSync(path.join(home, '.dexdiffusion-engine/backend-supervisor-mode'), 'production\n');
  const cli = fs.readFileSync(path.join(REPO, 'bin/dexdiffusion'), 'utf8');
  const stop = cli.slice(cli.indexOf('cmd_stop() {'), cli.indexOf('\ncmd_status() {'));
  const script = `set -euo pipefail\nhostname(){ echo bigmac; }\nkill(){ echo "SIGNAL:$*"; }\nowned_pid(){ echo 1111; }\nport_pid(){ echo 1111; }\n${stop}\nset +e; cmd_stop; echo "rc=$?"`;
  const out = run('/bin/bash', ['-c', script], { env: { ...process.env, HOME: home } });
  assert.match(out.stdout, /rc=78/);
  assert.match(out.stderr, /Backend lifecycle belongs to the EngineHost worker/);
  assert.doesNotMatch(out.stdout, /SIGNAL/);
});

test('F/G/H: doctor disk formula equals the server admission formula', () => {
  const out = run(PY, ['-c', `import importlib.util,json
s=importlib.util.spec_from_file_location('d',${JSON.stringify(DOCTOR)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps([m.disk_reserve_bytes(n) for n in range(1,17)]))`]);
  assert.equal(out.status, 0, out.stderr);
  const py = JSON.parse(out.stdout);
  for (let n = 1; n <= 16; n++) assert.equal(py[n - 1], sharedDiskReserveBytes('controlled-generate', { quantity: n }), String(n));
  assert.equal(py[0], 1536 * 1024 * 1024); // F: one-image reserve
  assert.equal(sharedDiskReserveBytes('controlled-generate', {}), 5376 * 1024 * 1024); // G: unknown keeps the full reserve
  assert.equal(sharedDiskReserveBytes('upscale', { quantity: 1 }), 5376 * 1024 * 1024);
});

test('N: unsupported installer "status" argument is rejected before any launchd action', t => {
  const out = run('/bin/bash', [path.join(REPO, 'scripts/install-backend-service.sh'), 'status'], { env: { ...process.env, HOME: tempHome(t) } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /unknown argument: status/);
  assert.equal(out.stdout, '');
  const src = fs.readFileSync(path.join(REPO, 'scripts/install-backend-service.sh'), 'utf8');
  assert.ok(src.indexOf('*) echo "ERROR: unknown argument') < src.indexOf('/bin/launchctl'), 'argument parsing must precede launchctl');
});

test('O: doctor on an unsupported platform reports UNVERIFIED, never PASS', t => {
  const out = run(PY, [DOCTOR, '--release-readiness', '--expect-revision', REV], { env: { ...process.env, HOME: tempHome(t) } });
  const report = JSON.parse(out.stdout);
  if (report.checks[0].status === 'PASS') return t.skip('running on the supported Big Mac host');
  assert.equal(out.status, 3);
  assert.equal(report.verdict, 'UNVERIFIED');
  assert.ok(report.checks.every(c => c.status === 'UNVERIFIED'));
});

test('P: every test child exited and no production path was written', () => {
  for (const pid of spawned) {
    let alive = true;
    try { process.kill(pid, 0); } catch (_) { alive = false; }
    assert.equal(alive, false, 'child ' + pid + ' still running');
  }
  const gateSrc = fs.readFileSync(GATE, 'utf8');
  assert.doesNotMatch(gateSrc, /\bkill\b|launchctl|backend-restart|rm -/, 'the gate itself never stops, restarts or deletes');
});

test('O: the handoff interface refuses fixture facts and sends only the strict owner request', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts/request-worker-backend.sh'), 'utf8');
  const block = src.slice(src.indexOf('--handoff-fallback || "$action" == --return-external'), src.indexOf("elif [[ $# -gt 1 ]]"));
  assert.match(block, /DEX_RELEASE_GATE_FIXTURE_FACTS[^\n]*fixture facts cannot authorize a handoff/);
  assert.match(block, /\{'op': 'backend-handoff', 'target': target, 'expect_revision': expect, 'reason': reason\}/);
  assert.doesNotMatch(block, /\bkill\b|launchctl|lsof .*-t.*\| *xargs/);
});
