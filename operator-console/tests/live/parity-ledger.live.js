'use strict';
// Live evidence is a separate audit. Source preflight validates the ledger schema and gate logic;
// this audit retains the strict missing-run assertion without treating absent private runs as source failure.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const RunEvidence = require('../helpers/run-evidence');
const ROOT = path.join(__dirname, '..', '..', '..');
const ROWS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json'), 'utf8')).atomic_requirements;
const RUN_GATE = RunEvidence.evidenceGate({ state: RunEvidence.runStoreState(RunEvidence.storePath(ROOT), RunEvidence.citedRuns(ROWS).map(c => c.run)), strict: RunEvidence.strictFromEnv(process.env) });
test('cited live runs exist when the run store is present (it is git-ignored, so CI skips this)', { skip: RUN_GATE.skip }, () => {
  for (const r of ROWS) for (const e of r.evidence_runs || [])
    assert.ok(fs.existsSync(path.join(ROOT, 'sdcpp-workflow/runs', e.run)), `${r.id} cites missing run ${e.run}`);
});
