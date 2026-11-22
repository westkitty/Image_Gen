'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = '/Volumes/wc2tb/DexDiffusion-OptionA-Test';
assert.equal(os.hostname(), 'bigmac');
assert.equal(process.env.DEX_OPTION_A_TEST, '1');
assert.equal(process.env.OPERATOR_CONSOLE_PORT, '31347');
assert.equal(process.env.DEX_DATA_ROOT, root);
const fixture = path.join(root, 'runs/gate-e-probe');
assert.equal(fs.realpathSync(fixture), fixture);
const sentinel = path.join(fixture, 'ui-run-card.md');
assert.ok(fs.lstatSync(sentinel).isFile());
assert.match(fs.readFileSync(sentinel, 'utf8'), /gate-e-wc2tb-read/);
const workflow = path.resolve(__dirname, '../../sdcpp-workflow/bin/sdcpp-read-run-metadata.sh');
const result = spawnSync('/bin/bash', [workflow, '--run-id', 'gate-e-probe'], {
  env: { ...process.env, DEX_RUNS_DIR: path.join(root, 'runs') }, timeout: 6000, encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr || String(result.error));
assert.match(result.stdout, /gate-e-wc2tb-read/);
console.log(JSON.stringify({ gate: 'WC2TB_EXISTING_FIXTURE_READ', node: process.pid, workflow: result.pid }));
