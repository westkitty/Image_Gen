'use strict';
// Activation logic for the parity ledger's live-run evidence audit (tests/parity-ledger.test.js).
// The run store (sdcpp-workflow/runs) is git-ignored. Workflow tests that source sdcpp-lib.sh create it empty in a fresh
// worktree, and browser suites can add their own run directories (e.g. a no-op *-server-stop run), so neither the
// directory nor arbitrary run folders are evidence that the real store is present. The audit runs when the store holds
// at least one run the ledger cites, or always when DEX_PARITY_REQUIRE_RUN_EVIDENCE=1 (strict: missing evidence fails).
const fs = require('node:fs');
const path = require('node:path');

const RUN_DIR_RE = /^20\d{6}-\d{6}-[A-Za-z0-9_.-]+$/;

// 'absent' | 'empty' (no run directories) | 'unrelated' (run directories, none of them cited) | 'populated'
function runStoreState(dir, cited = null) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return 'absent'; throw e; }
  const runs = entries.filter(d => d.isDirectory() && RUN_DIR_RE.test(d.name)).map(d => d.name);
  if (!runs.length) return 'empty';
  if (!cited) return 'populated';
  const want = new Set(cited);
  return runs.some(r => want.has(r)) ? 'populated' : 'unrelated';
}

// -> { skip: false } (run the audit) or { skip: '<truthful reason>' }
function evidenceGate({ state, strict = false }) {
  if (strict || state === 'populated') return { skip: false };
  const why = state === 'absent' ? 'absent' : state === 'unrelated' ? 'not the evidence store (only uncited run directories)' : 'empty (no run directories)';
  return { skip: `live run evidence unavailable: sdcpp-workflow/runs is ${why}; set DEX_PARITY_REQUIRE_RUN_EVIDENCE=1 to require it` };
}

function citedRuns(rows) {
  const out = [];
  for (const r of rows) for (const e of r.evidence_runs || []) out.push({ id: r.id, run: e.run });
  return out;
}

module.exports = { RUN_DIR_RE, runStoreState, evidenceGate, citedRuns, strictFromEnv: env => env.DEX_PARITY_REQUIRE_RUN_EVIDENCE === '1', storePath: root => path.join(root, 'sdcpp-workflow/runs') };
