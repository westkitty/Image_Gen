'use strict';
// Invariants of the A1111 parity ledger (schema v2) and its upstream inventory.
// The ledger is evidence, so its computed summary, per-row proof states, the
// upstream mapping and the execution-ledger headline must all agree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json'), 'utf8'));
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/A1111_UPSTREAM_INVENTORY.json'), 'utf8'));
const EXECUTION = fs.readFileSync(path.join(ROOT, 'docs/parity/EXECUTION_LEDGER.md'), 'utf8');
const ROWS = LEDGER.atomic_requirements;
const STATES = LEDGER.proof_states;

test('ledger is schema v2, pinned, and every row carries the structured proof fields', () => {
  assert.equal(LEDGER.schema, 'dexdiffusion.a1111.parity-ledger.v2');
  assert.equal(LEDGER.a1111_commit, '82a973c04367123ae98bd9abdf80d9eda9b910e2');
  const ids = new Set();
  for (const r of ROWS) {
    assert.ok(!ids.has(r.id), 'duplicate id ' + r.id); ids.add(r.id);
    for (const k of ['source_reference', 'required_behavior', 'ui_owner', 'api_contract', 'effective_worker_path', 'supported_models', 'next_action', 'blocker'])
      assert.ok(k in r, r.id + ' lacks ' + k);
    for (const k of ['source_status', 'ui_status', 'wiring_status', 'automated_proof', 'live_proof', 'release_status'])
      assert.ok(STATES[k].includes(r[k]), `${r.id} ${k}=${r[k]}`);
    assert.equal(r.completion_status, r.release_status, r.id + ' completion_status mirrors release_status');
  }
  for (const n of [1, 2, 3, 4, 5]) assert.ok(ids.has('PR-0' + n));
});

test('COMPLETE is never granted without exposure, wiring, an automated test and live proof (or a stated not-required)', () => {
  for (const r of ROWS.filter(x => x.release_status === 'COMPLETE')) {
    assert.equal(r.source_status, 'PRESENT', r.id);
    assert.equal(r.ui_status, 'EXPOSED', r.id);
    assert.equal(r.wiring_status, 'WIRED', r.id);
    assert.notEqual(r.automated_proof, 'NONE', r.id);
    assert.ok(['LIVE_PROVEN', 'NOT_REQUIRED'].includes(r.live_proof), r.id);
    assert.equal(r.blocker, null, r.id + ' has a blocker');
  }
  for (const r of ROWS.filter(x => x.release_status === 'BLOCKED')) assert.ok(r.blocker, r.id + ' BLOCKED without a blocker');
  for (const r of ROWS.filter(x => x.release_status === 'EXCLUDED')) assert.ok(r.exclusion_reason, r.id + ' EXCLUDED without a reason');
});

test('computed summary equals the rows', () => {
  const rel = {}, live = {};
  for (const s of STATES.release_status) rel[s] = 0;
  for (const s of STATES.live_proof) live[s] = 0;
  for (const r of ROWS) { rel[r.release_status]++; live[r.live_proof]++; }
  assert.equal(LEDGER.summary.total, ROWS.length);
  assert.deepEqual(LEDGER.summary.release_status, rel);
  assert.deepEqual(LEDGER.summary.live_proof, live);
  assert.equal(LEDGER.summary.verdict, rel.COMPLETE + rel.EXCLUDED === ROWS.length ? 'COMPLETE' : 'PARTIAL');
});

test('execution ledger headline states the computed counts (no stale counters)', () => {
  const m = /^## Verdict: (\w+) — (\d+) rows: (\d+) COMPLETE, (\d+) PARTIAL, (\d+) PENDING, (\d+) BLOCKED, (\d+) EXCLUDED/m.exec(EXECUTION);
  assert.ok(m, 'verdict headline missing or malformed');
  const s = LEDGER.summary, r = s.release_status;
  assert.deepEqual(m.slice(1).map(String), [s.verdict, s.total, r.COMPLETE, r.PARTIAL, r.PENDING, r.BLOCKED, r.EXCLUDED].map(String));
});

test('every upstream inventory item maps to a ledger row or is classified with a reason', () => {
  assert.equal(INVENTORY.commit, LEDGER.a1111_commit);
  assert.equal(INVENTORY.unmapped, 0);
  const ids = new Set(ROWS.map(r => r.id));
  for (const item of INVENTORY.items) {
    if (item.maps_to) for (const t of item.maps_to) assert.ok(ids.has(t), 'unknown row ' + t);
    else assert.match(item.classification || '', /^(EXCLUDED_TRAINING|NOT_GENERATION_AFFECTING|NOT_A_CONTROL|SUPERSEDED_BY_CANONICAL_STORE):.+/, JSON.stringify(item));
  }
  // Only training and checkpoint merging are blanket exclusions: no excluded item may be a generation control.
  for (const item of INVENTORY.items.filter(i => /^EXCLUDED_TRAINING/.test(i.classification || '')))
    assert.ok(item.kind === 'setting' ? /training|caption/i.test(item.classification) : item.file === 'modules/ui.py', JSON.stringify(item));
});

test('cited live runs exist when the run store is present (it is git-ignored, so CI skips this)', { skip: !fs.existsSync(path.join(ROOT, 'sdcpp-workflow/runs')) }, () => {
  for (const r of ROWS) for (const e of r.evidence_runs || [])
    assert.ok(fs.existsSync(path.join(ROOT, 'sdcpp-workflow/runs', e.run)), `${r.id} cites missing run ${e.run}`);
});
