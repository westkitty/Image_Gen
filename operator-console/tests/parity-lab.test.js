'use strict';
// Differential parity lab (docs/parity/lab): the pinned A1111 oracle and the DexDiffusion subject must agree on every
// executable fixture; pending fixtures must name the approval packet that will make them executable.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const LAB = path.join(ROOT, 'docs/parity/lab');
const FIX = JSON.parse(fs.readFileSync(path.join(LAB, 'fixtures.json'), 'utf8'));
const LEDGER = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json'), 'utf8')).atomic_requirements.map(r => r.id));
const PACKETS = fs.readFileSync(path.join(ROOT, 'docs/parity/OPUS_TASK_PACKETS.md'), 'utf8');

test('fixtures are pinned, well-formed and tied to ledger rows; pending ones name a real packet', () => {
  assert.equal(FIX.schema, 'dexdiffusion.parity-lab.v1');
  assert.equal(FIX.a1111_commit, '82a973c04367123ae98bd9abdf80d9eda9b910e2');
  const ids = new Set();
  for (const f of FIX.fixtures) {
    assert.ok(!ids.has(f.id), 'duplicate ' + f.id); ids.add(f.id);
    assert.ok(Object.keys(FIX.kinds).includes(f.kind), f.id + ' kind');
    assert.ok(f.tolerance && f.tolerance.metric, f.id + ' states a tolerance');
    for (const r of f.ledger_rows) assert.ok(LEDGER.has(r), `${f.id}: ledger row ${r}`);
    if (f.kind === 'pending') assert.ok(new RegExp('^## ' + f.pending.packet + '\\b', 'm').test(PACKETS), `${f.id}: packet ${f.pending.packet}`);
  }
  for (const c of ['img2img-resize', 'hires-geometry', 'infotext-parse']) assert.ok(FIX.fixtures.some(f => f.category === c && f.kind === 'unit-differential'), c);
});

test('every executable fixture agrees with the pinned A1111 oracle', () => {
  const r = spawnSync('python3', [path.join(LAB, 'run_lab.py')], { cwd: ROOT, encoding: 'utf8', timeout: 170000 });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  const m = /(\{[^\n]*\}) PASS\s*$/.exec(r.stdout.trim());
  assert.ok(m, r.stdout);
  const counts = JSON.parse(m[1]);
  assert.ok(!counts.FAIL && counts.PASS >= 30, r.stdout);
});
