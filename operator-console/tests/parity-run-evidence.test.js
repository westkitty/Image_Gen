'use strict';
// The live-run evidence audit activates on a populated run store, not on a bare
// directory, and DEX_PARITY_REQUIRE_RUN_EVIDENCE=1 forces it. Scenarios use test-owned temp stores only; the real store is
// only ever read (never written or copied).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const RE = require('./helpers/run-evidence');

const ROOT = path.join(__dirname, '..', '..');
const ROWS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json'), 'utf8')).atomic_requirements;
const CITED = RE.citedRuns(ROWS);
const UNIQUE = [...new Set(CITED.map(c => c.run))];

// The same check the ledger test performs, against a given store.
const missingIn = store => CITED.filter(c => !fs.existsSync(path.join(store, c.run))).map(c => `${c.id} cites missing run ${c.run}`);

function tempRoot(kind) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-parity-runs-'));
  const store = path.join(base, 'runs');
  if (kind !== 'absent') fs.mkdirSync(store);
  if (kind === 'populated-complete' || kind === 'populated-missing') for (const run of UNIQUE) fs.mkdirSync(path.join(store, run));
  if (kind === 'populated-missing') fs.rmdirSync(path.join(store, UNIQUE[0]));
  if (kind === 'unrelated') fs.mkdirSync(path.join(store, '20261023-180240-server-stop'));
  if (kind === 'empty-with-files') { fs.writeFileSync(path.join(store, '.DS_Store'), ''); fs.writeFileSync(path.join(store, 'lora-performance-x.json'), '{}'); fs.mkdirSync(path.join(store, 'zz-fixture-0123456789')); }
  return { base, store };
}

test('the ledger still cites all 22 live runs (38 citations), each a run-directory name', () => {
  assert.equal(UNIQUE.length, 22);
  assert.equal(CITED.length, 38);
  for (const run of UNIQUE) assert.match(run, RE.RUN_DIR_RE);
});

test('scenario matrix: absent, empty, unrelated runs only, populated-complete, populated-missing, normal and strict', () => {
  const rows = [
    ['absent', 'absent', true, 22],
    ['empty', 'empty', true, 22],
    ['empty-with-files', 'empty', true, 22],
    ['unrelated', 'unrelated', true, 22],
    ['populated-complete', 'populated', false, 0],
    ['populated-missing', 'populated', false, null],
  ];
  for (const [kind, state, skipsNormally, missingUnique] of rows) {
    const { base, store } = tempRoot(kind);
    try {
      assert.equal(RE.runStoreState(store, UNIQUE), state, kind);
      const normal = RE.evidenceGate({ state, strict: false });
      assert.equal(!!normal.skip, skipsNormally, kind);
      if (normal.skip) assert.match(normal.skip, new RegExp(`runs is ${{ absent: 'absent', empty: 'empty', unrelated: 'not the evidence store' }[state]}`));
      assert.deepEqual(RE.evidenceGate({ state, strict: true }), { skip: false }, 'strict always audits: ' + kind);
      const missing = missingIn(store);
      if (missingUnique !== null) assert.equal(new Set(missing.map(m => m.split(' ').pop())).size, missingUnique, kind);
      else {
        assert.ok(missing.length >= 1, 'a populated store missing one cited run is caught');
        assert.ok(missing.every(m => m.endsWith(UNIQUE[0])));
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  }
  assert.equal(RE.strictFromEnv({ DEX_PARITY_REQUIRE_RUN_EVIDENCE: '1' }), true);
  assert.equal(RE.strictFromEnv({ DEX_PARITY_REQUIRE_RUN_EVIDENCE: 'true' }), false);
  assert.equal(RE.strictFromEnv({}), false);
});

test('the real parity test: normal mode skips truthfully here; strict mode runs the unchanged assertion', { timeout: 60000 }, () => {
  const store = RE.storePath(ROOT);
  const state = RE.runStoreState(store, UNIQUE);  // read-only
  const realMissing = state === 'absent' ? CITED.length : missingIn(store).length;
  // A fresh, independent runner with a TAP report (not the parent runner's child protocol).
  const run = strictMode => {
    const env = Object.assign({}, process.env);
    delete env.NODE_TEST_CONTEXT; delete env.DEX_PARITY_REQUIRE_RUN_EVIDENCE;
    if (strictMode) env.DEX_PARITY_REQUIRE_RUN_EVIDENCE = '1';
    return spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'live/parity-ledger.live.js')], { env, encoding: 'utf8' });
  };
  const normal = run(false), strict = run(true);
  if (state === 'populated') {
    assert.equal(normal.status, realMissing ? 1 : 0, normal.stdout.slice(-800));
  } else {
    assert.equal(normal.status, 0, normal.stdout.slice(-800));
    assert.match(normal.stdout, /# skipped 1/);
    assert.match(normal.stdout, /live run evidence unavailable: sdcpp-workflow\/runs is (absent|empty|not the evidence store)/);
  }
  if (realMissing) {
    assert.equal(strict.status, 1, 'strict mode fails when evidence is missing');
    assert.match(strict.stdout, /cites missing run 20\d{6}-\d{6}-/);
    assert.match(strict.stdout, /# skipped 0/);
  } else assert.equal(strict.status, 0);
});
