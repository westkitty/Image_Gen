'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { promisify } = require('node:util');
const isolation = require('../../test-isolation');

const env = process.env;
assert.ok(isolation.enabled());
assert.match(path.basename(env.DEX_CREATE_FIXTURE_ROOT), /^dex-create-fixture-/);
for (const [key, subdir] of Object.entries({
  HOME: 'home', DEX_STATE_DIR: 'state', DEX_IMAGES_ROOT_OVERRIDE: 'images',
  DEX_MEDIA_ROOT_OVERRIDE: 'media', DEX_RUNS_DIR: 'runs', DEX_LOGS_DIR: 'logs',
  DEX_SCRATCH_ROOT: 'scratch', TMPDIR: 'tmp',
})) assert.equal(env[key], path.join(env.DEX_CREATE_FIXTURE_ROOT, subdir));
assert.equal(env.OLLAMA_BASE_URL, 'http://127.0.0.1:9');

isolation.install();
const { makePng } = require('../browser/helpers');
const guardedExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, ...rest) {
  if ((file === 'ssh' || file === '/bin/sh') && args?.at(-1)?.startsWith('ollama ps 2>/dev/null;')) {
    process.nextTick(rest.at(-1), null, 'NAME ID SIZE PROCESSOR UNTIL\nPROBE_DONE:0\n', '');
    return;
  }
  return guardedExecFile.call(this, file, args, ...rest);
};
childProcess.execFile[promisify.custom] = guardedExecFile[promisify.custom];

const guardedSpawn = childProcess.spawn;
let runs = 0;
childProcess.spawn = function (file, args, opts) {
  if (!['bin/sdcpp-controlled-generate.sh', 'bin/mflux-controlled-generate.sh'].includes(file)) {
    return guardedSpawn.apply(this, arguments);
  }
  assert.match(opts.env.DEXDIFFUSION_JOB_ID, /^[0-9a-f-]{36}$/);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  setImmediate(() => {
    const runId = '20261124-120000-create-fixture-' + ++runs;
    const runDir = path.join(env.DEX_RUNS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({
      schema: 'dexdiffusion.run_owner.v1', job_id: opts.env.DEXDIFFUSION_JOB_ID, run_id: runId,
    }));
    const image = path.join(runDir, 'fixture.png');
    const value = flag => args[args.indexOf(flag) + 1];
    const invalid = String(value('--seed')) === '43';
    fs.writeFileSync(image, invalid ? 'not a PNG' : makePng(Number(value('--width')), Number(value('--height'))));
    child.stdout.end(`SDCPP_RUN_ID: ${runId}\nCONTROLLED_TARGET: ${value('--target')}\nCONTROLLED_OUTPUT_IMAGE: ${image}\n==== PASS ====\n`);
    child.stderr.end();
    child.emit('close', 0);
  });
  return child;
};

const simulatedAssetProbe = isolation.simulatedAssetProbe;
isolation.simulatedAssetProbe = options => {
  const assets = simulatedAssetProbe(options);
  for (const key of Object.keys(assets.dormant)) {
    if (key.startsWith('kokoro:')) assets.dormant[key] = false;
  }
  return assets;
};

const server = require('../../server').app.listen(0, '127.0.0.1', () => process.send(server.address().port));
process.on('disconnect', () => server.close(() => process.exit(0)));
