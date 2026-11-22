'use strict';
// Diagnostic contract probes: synthetic files only, no production services or model execution.
// A failed probe is an observed contract violation, not an assertion that a live user was affected.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCollectionStore } = require('../../collections-store');
const { createRecipeStore } = require('../../recipes-store');
const { createMacroStore } = require('../../macro-store');
const { createStylesStore } = require('../../styles-store');
const { createJobStore } = require('../../media');
const { createWorldStore } = require('../../world-project');

const CANARY = 'DEX-AUDIT-PRIVATE-' + crypto.randomBytes(6).toString('hex');
const scenarios = [
  {
    id: 'PERSIST-001', family: 'false-durable-success', bugs: ['BUG-93'],
    name: 'Collections must reject a failed durable save',
    check(dir) {
      const blocked = path.join(dir, 'not-a-directory');
      fs.writeFileSync(blocked, 'occupied');
      const store = createCollectionStore(path.join(blocked, 'collections.json'));
      assert.throws(() => store.create({ name: 'Synthetic collection' }), 'create() must not acknowledge a failed save');
    },
  },
  {
    id: 'PERSIST-002', family: 'false-durable-success', bugs: ['BUG-93'],
    name: 'Recipes must reject a failed durable save',
    check(dir) {
      const blocked = path.join(dir, 'not-a-directory');
      fs.writeFileSync(blocked, 'occupied');
      const store = createRecipeStore(path.join(blocked, 'recipes.json'));
      assert.throws(() => store.create({ name: 'Synthetic recipe', parameters: { steps: 7 } }), 'create() must not acknowledge a failed save');
    },
  },
  {
    id: 'PERSIST-003', family: 'false-durable-success', bugs: ['BUG-119'],
    name: 'Macros must reject a failed durable save',
    check(dir) {
      const blocked = path.join(dir, 'not-a-directory');
      fs.writeFileSync(blocked, 'occupied');
      const store = createMacroStore(path.join(blocked, 'macros.json'));
      assert.throws(() => store.create({ name: 'Synthetic macro', steps: [{ type: 'wait_input' }] }), 'create() must not acknowledge a failed save');
    },
  },
  {
    id: 'RECOVER-001', family: 'corrupt-ledger-overwrite', bugs: ['BUG-95'],
    name: 'Corrupt Collections bytes must survive a new create',
    check(dir) {
      const file = path.join(dir, 'collections.json'), original = '{BAD_COLLECTIONS_BYTES';
      fs.writeFileSync(file, original);
      const store = createCollectionStore(file);
      try { store.create({ name: 'New collection' }); } catch (_) {}
      assert.equal(fs.readFileSync(file, 'utf8'), original, 'existing damaged bytes were overwritten');
    },
  },
  {
    id: 'RECOVER-002', family: 'corrupt-ledger-overwrite', bugs: ['BUG-95'],
    name: 'Corrupt Recipes bytes must survive a new create',
    check(dir) {
      const file = path.join(dir, 'recipes.json'), original = '{BAD_RECIPES_BYTES';
      fs.writeFileSync(file, original);
      const store = createRecipeStore(file);
      try { store.create({ name: 'New recipe' }); } catch (_) {}
      assert.equal(fs.readFileSync(file, 'utf8'), original, 'existing damaged bytes were overwritten');
    },
  },
  {
    id: 'RECOVER-003', family: 'corrupt-ledger-overwrite', bugs: ['BUG-119'],
    name: 'Corrupt Macros bytes must survive a new create',
    check(dir) {
      const file = path.join(dir, 'macros.json'), original = '{BAD_MACROS_BYTES';
      fs.writeFileSync(file, original);
      const store = createMacroStore(file);
      try { store.create({ name: 'New macro', steps: [{ type: 'wait_input' }] }); } catch (_) {}
      assert.equal(fs.readFileSync(file, 'utf8'), original, 'existing damaged bytes were overwritten');
    },
  },
  {
    id: 'RECOVER-004', family: 'corrupt-ledger-overwrite', bugs: ['BUG-95'],
    name: 'Corrupt Styles bytes must survive a new create',
    check(dir) {
      const file = path.join(dir, 'styles.json'), original = '{BAD_STYLES_BYTES';
      fs.writeFileSync(file, original);
      const store = createStylesStore(file);
      try { store.create({ name: 'Synthetic style', prompt: 'an object', negative_prompt: '' }); } catch (_) {}
      assert.equal(fs.readFileSync(file, 'utf8'), original, 'existing damaged bytes were overwritten');
    },
  },
  {
    id: 'RECOVER-005', family: 'corrupt-ledger-overwrite', bugs: ['BUG-63'],
    name: 'Corrupt Jobs ledger must not be replaced by a new job',
    check(dir) {
      const file = path.join(dir, 'jobs.json'), original = '{BAD_JOBS_BYTES';
      fs.writeFileSync(file, original);
      const store = createJobStore(file);
      try { store.create({ media_kind: 'image', operation: 'synthetic', worker_id: 'fixture' }); store.flush(); } catch (_) {}
      assert.equal(fs.readFileSync(file, 'utf8'), original, 'existing damaged bytes were overwritten');
    },
  },
  {
    id: 'ADMIT-001', family: 'ack-before-durable-write', bugs: ['BUG-65'],
    name: 'Accepted job IDs must already exist in the durable ledger',
    check(dir) {
      const file = path.join(dir, 'jobs.json');
      const store = createJobStore(file);
      const job = store.create({ media_kind: 'image', operation: 'synthetic', worker_id: 'fixture' });
      try {
        assert.ok(fs.existsSync(file), 'create() acknowledged before the ledger file existed');
        const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(disk.jobs.some(j => j.job_id === job.job_id), 'accepted job ID absent from ledger');
      } finally { store.flush(); }
    },
  },
  {
    id: 'PRIVACY-001', family: 'nested-prompt-retention', bugs: ['BUG-96'],
    name: 'Recipes must not persist nested prompts without opt-in',
    check(dir) {
      const file = path.join(dir, 'recipes.json');
      const store = createRecipeStore(file);
      store.create({ name: 'Synthetic recipe', includePrompt: false, parameters: { scene: { prompt: CANARY }, steps: 7 } });
      assert.ok(!fs.readFileSync(file, 'utf8').includes(CANARY), 'private nested prompt saved with opt-in disabled');
    },
  },
  {
    id: 'PRIVACY-002', family: 'nested-prompt-retention', bugs: ['BUG-114'],
    name: 'Macros must not persist step prompts without opt-in',
    check(dir) {
      const file = path.join(dir, 'macros.json');
      const store = createMacroStore(file);
      store.create({ name: 'Synthetic macro', steps: [{ type: 'generate', settings: { prompt: CANARY } }] });
      assert.ok(!fs.readFileSync(file, 'utf8').includes(CANARY), 'private step prompt saved with opt-in disabled');
    },
  },
  {
    id: 'RECOVER-006', family: 'restart-state-divergence', bugs: ['BUG-82'],
    name: 'World projects must not claim RUNNING after a fresh server load',
    check(dir) {
      const root = path.join(dir, 'worlds');
      const store = createWorldStore({ root });
      const p = store.create({ mode: 'quick3d', sourceArtifactId: 'synthetic.png' });
      store.updateStage(p.id, 'reconstruct', { status: 'RUNNING' });
      const restored = createWorldStore({ root });
      assert.notEqual(restored.get(p.id).status, 'RUNNING', 'stale RUNNING status survived cold load');
    },
  },
];

function emitReport(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function main() {
  const results = [];
  for (const sc of scenarios) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-audit-fixture-'));
    const oldError = console.error;
    let status = 'PASS', detail = null;
    try {
      // Expected fixture disk errors are captured in results rather than spammed into CI logs.
      console.error = () => {};
      await sc.check(dir);
    } catch (err) {
      status = 'CONTRACT_FAIL';
      detail = String(err && err.message || err).slice(0, 350).replaceAll(CANARY, '[PRIVATE CANARY]');
    } finally {
      console.error = oldError;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    results.push({ id: sc.id, family: sc.family, bugs: sc.bugs, name: sc.name, status, detail });
    process.stdout.write(`${status.padEnd(13)} ${sc.id} ${sc.name}\n`);
  }
  const fail = results.filter(r => r.status === 'CONTRACT_FAIL').length;
  const report = {
    schema: 'dexdiffusion.audit.fault-matrix.v1',
    at: new Date().toISOString(),
    git_ref: process.env.GITHUB_SHA || null,
    mode: 'isolated-synthetic-read-write-fixtures; no production mutation',
    scope: 'Selected contract probes, not a complete bug audit',
    total: results.length, passed: results.length - fail, contract_failures: fail, results,
  };
  const out = process.env.DEX_AUDIT_REPORT || path.join(os.tmpdir(), `dex-audit-${process.pid}.json`);
  emitReport(out, report);
  process.stdout.write(`FAULT MATRIX ${fail ? 'CONTRACT VIOLATIONS' : 'PASS'}: ${report.passed}/${report.total} passed; report ${out}\n`);
  process.exitCode = fail ? 1 : 0;
}
main().catch(err => { console.error('FAULT MATRIX HARNESS ERROR:', err); process.exitCode = 2; });
