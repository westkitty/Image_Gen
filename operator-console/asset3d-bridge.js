'use strict';

// Individual-object 3D bridge. WorldGen owns environments; this bridge owns
// only canonical image -> mesh/texture asset jobs and reuses the generic job,
// staging, media, cleanup, SSH, and heavy-compute lease contracts.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { artifactReceipt } = require('./job-contract');
const { validateGlb } = require('./glb-validator');

const execFileP = promisify(execFile);
const ROOT = '/Volumes/wc2tb/generative-models/3d/hunyuan3d-swift';
const BIN = `${ROOT}/.build/out/Products/Release/hy3d`;
const SHAPE_SMALL = `${ROOT}/weights/shape-small`;
const SHAPE_LARGE = `${ROOT}/weights/shape-large`;
const PAINT_RGB = `${ROOT}/weights/paint-small`;
const UPSTREAM_REPOSITORY = 'https://github.com/ZimengXiong/Hunyuan3D-Swift';
const UPSTREAM_COMMIT = '292331f4d26ddb80b9dcea6bcb5629ff82f12b82';
const SHAPE_MODEL = 'zimengxiong/hunyuan3d-mlx-shape-small@b7536809d38ad13fe6a9b7769a41fd5d42e520df';
const PAINT_MODEL = 'zimengxiong/hunyuan3d-mlx-paint-small@29bab9dbf2a4a4f9c6988a41b0e891156a517a23';
const REMOTE_ROOT = '/Volumes/wc2tb/dex-world-work';
const MODES = new Set(['mesh', 'textured']);

function q(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function createAsset3dBridge({ jobStore, arbiter, staging, mediaStore, imageStore, stateDir = path.join(__dirname, '..', 'sdcpp-workflow', 'state'), sshTarget = 'westcat', log = () => {} }) {
  const evidenceFile = path.join(stateDir, '3d-capability-evidence.json');

  function readEvidence() {
    try { return JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); } catch (_) { return {}; }
  }
  function recordEvidence(mode, record) {
    const previous = readEvidence();
    const next = {
      schema: 'dexdiffusion.3d-capability.v1',
      ...previous,
      engine: { ...(previous.engine || {}), repository: UPSTREAM_REPOSITORY, commit: UPSTREAM_COMMIT, binary: BIN, shape_model: SHAPE_MODEL, paint_model: PAINT_MODEL },
    };
    next[mode] = { status: 'PROVEN', lastPass: record };
    atomicWrite(evidenceFile, next);
  }

  async function runFile(file, args, options = {}) {
    return execFileP(file, args, { timeout: options.timeout || 300000, maxBuffer: options.maxBuffer || 4 * 1024 * 1024, encoding: options.encoding || 'utf8' });
  }
  async function ssh(command, timeout = 300000) {
    return runFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshTarget, command], { timeout, maxBuffer: 8 * 1024 * 1024 });
  }
  async function streamRemote(file, local, timeout = 300000) {
    await new Promise((resolve, reject) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshTarget, `/bin/cat -- ${q(file)}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      const output = fs.createWriteStream(local, { mode: 0o600 });
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        output.destroy();
        if (error) { try { fs.unlinkSync(local); } catch (_) {} reject(error); }
        else resolve();
      };
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-800); });
      child.stdout.on('error', finish);
      output.on('error', finish);
      child.on('error', finish);
      child.stdout.pipe(output);
      child.on('close', (code, signal) => {
        const complete = () => {
          if (timedOut) finish(new Error('remote GLB stream timed out'));
          else if (code === 0) finish();
          else finish(new Error(`remote GLB stream failed (${code || signal}): ${stderr.trim()}`));
        };
        if (output.writableFinished) complete();
        else output.once('finish', complete);
      });
    });
  }

  async function remoteStatus() {
    const command = `set +e
runtime=0; small=0; large=0; paint=0
test -x ${q(BIN)} && runtime=1
test -s ${q(`${SHAPE_SMALL}/model.fp16.safetensors`)} && test -s ${q(`${SHAPE_SMALL}/config.yaml`)} && small=1
test -s ${q(`${SHAPE_LARGE}/model.fp16.safetensors`)} && test -s ${q(`${SHAPE_LARGE}/config.yaml`)} && large=1
test -s ${q(`${PAINT_RGB}/hunyuan3d-paint-v2-0/vae/diffusion_pytorch_model.safetensors`)} && test -s ${q(`${PAINT_RGB}/hunyuan3d-paint-v2-0/unet/diffusion_pytorch_model.safetensors`)} && paint=1
commit=$(git -C ${q(ROOT)} rev-parse HEAD 2>/dev/null || printf unknown)
printf 'DEX_3D_ASSETS runtime=%s shape_small=%s shape_large=%s paint_rgb=%s host=%s user=%s commit=%s\\n' "$runtime" "$small" "$large" "$paint" "$(hostname)" "$(whoami)" "$commit"`;
    try {
      const result = await ssh(command, 30000);
      const marker = /DEX_3D_ASSETS runtime=(\d+) shape_small=(\d+) shape_large=(\d+) paint_rgb=(\d+) host=(\S+) user=(\S+) commit=(\S+)/.exec(`${result.stdout}\n${result.stderr}`);
      if (!marker) throw new Error('3D asset probe missing in-band marker');
      return { reachable: true, identity: `${marker[6]}@${marker[5]}`, runtime: marker[1] === '1', shapeSmall: marker[2] === '1', shapeLarge: marker[3] === '1', paintRgb: marker[4] === '1', commit: marker[7], checkedAt: new Date().toISOString() };
    } catch (error) {
      return { reachable: false, identity: null, runtime: false, shapeSmall: false, shapeLarge: false, paintRgb: false, commit: null, error: String(error.message).slice(0, 180), checkedAt: new Date().toISOString() };
    }
  }

  function modeStatus(mode, remote, evidence) {
    const installed = mode === 'mesh' ? remote.runtime && remote.shapeSmall : remote.runtime && remote.shapeSmall && remote.paintRgb;
    const pass = evidence[mode] && evidence[mode].status === 'PROVEN' && evidence[mode].lastPass;
    if (!installed) return { status: remote.reachable ? 'DISABLED' : 'UNAVAILABLE', installed: false, proven: false };
    return { status: pass ? 'PROVEN' : 'AVAILABLE_UNPROVEN', installed: true, proven: !!pass, lastPass: pass ? evidence[mode].lastPass : null };
  }

  async function workers() {
    const remote = await remoteStatus();
    const evidence = readEvidence();
    const blender = ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/local/bin/blender', '/opt/homebrew/bin/blender'].find(p => fs.existsSync(p)) || null;
    return {
      engine: { id: 'hunyuan3d-swift', label: 'Hunyuan3D Swift / MLX', repository: UPSTREAM_REPOSITORY, commit: UPSTREAM_COMMIT, runtime: BIN, blender: blender ? { available: true, path: blender } : { available: false } },
      remote,
      modes: {
        quickGeometry: { status: 'PROVEN', engine: 'apple-aiml-research/ml-sharp', output: 'PLY' },
        mesh: { ...modeStatus('mesh', remote, evidence), engine: 'hunyuan3d-swift shape-small', output: 'GLB' },
        textured: { ...modeStatus('textured', remote, evidence), engine: 'hunyuan3d-swift shape-small + RGB paint-small', output: 'GLB' },
        pbr: { status: 'DISABLED', engine: 'hunyuan3d-swift PBR', output: 'GLB', reason: 'Not proven safe on this 32 GiB machine' },
      },
    };
  }

  async function runJob(jobId, mode, source, staged) {
    const remoteJobDir = `${REMOTE_ROOT}/${jobId}/asset3d`;
    const remoteInput = `${remoteJobDir}/input/${staged.file}`;
    const remoteOutput = `${remoteJobDir}/output/${jobId}.glb`;
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-3d-'));
    const localOutput = path.join(localRoot, `${jobId}.glb`);
    let lease = null;
    const started = Date.now();
    try {
      lease = await arbiter.acquire(jobId, `hunyuan3d ${mode}`);
      if (!lease.granted) throw Object.assign(new Error('heavy-compute lease was not granted'), { gate: 'resource-wait' });
      jobStore.transition(jobId, 'RUNNING', { resource_lease: arbiter.state().group });
      const prepared = await ssh(`set -e; mkdir -p ${q(`${remoteJobDir}/input`)} ${q(`${remoteJobDir}/output`)}; printf 'DEX_3D_PREPARED\\n'`);
      if (!/DEX_3D_PREPARED/.test(`${prepared.stdout}\n${prepared.stderr}`)) throw new Error('remote preparation missing in-band marker');
      await runFile('scp', ['-O', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', staged.path, `${sshTarget}:${remoteInput}`], { timeout: 300000 });
      const shapeWeights = q(SHAPE_SMALL);
      const command = `set -uo pipefail
ROOT=${q(ROOT)}; D=${q(remoteJobDir)}; OUT=${q(remoteOutput)}
if [ ${q(mode)} = textured ]; then
  "$ROOT/.build/out/Products/Release/hy3d" generate "$D/input/${staged.file}" -o "$OUT" --shape-weights ${shapeWeights} --paint-weights ${q(PAINT_RGB)} --no-superres
else
  "$ROOT/.build/out/Products/Release/hy3d" shape "$D/input/${staged.file}" -o "$OUT" --weights ${shapeWeights}
fi
RC=$?
if [ "$RC" -ne 0 ]; then printf 'DEX_3D_FAIL rc=%s\\n' "$RC"; exit 0; fi
if [ ! -s "$OUT" ]; then printf 'DEX_3D_FAIL output-missing\\n'; exit 0; fi
BYTES=$(stat -f %z "$OUT")
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
MAGIC=$(xxd -p -l 4 "$OUT")
if [ "$MAGIC" != 676c5446 ] || [ -z "$SHA" ]; then printf 'DEX_3D_FAIL output-invalid\\n'; exit 0; fi
printf 'DEX_3D_PASS mode=%s output=%s bytes=%s sha256=%s magic=%s engine=hunyuan3d-swift@${UPSTREAM_COMMIT}\\n' ${q(mode)} "$OUT" "$BYTES" "$SHA" "$MAGIC"`;
      const remote = await ssh(command, mode === 'textured' ? 900000 : 600000);
      const combined = `${remote.stdout}\n${remote.stderr}`;
      const marker = /DEX_3D_PASS mode=(\w+) output=(\S+) bytes=(\d+) sha256=([a-f0-9]{64}) magic=(\w+) engine=(\S+)/.exec(combined);
      if (!marker || marker[1] !== mode || !marker[2].startsWith(`${remoteJobDir}/`) || marker[5] !== '676c5446') {
        const failed = /DEX_3D_FAIL[^\n]*/.exec(combined)?.[0] || '3D result missing in-band validation marker';
        throw Object.assign(new Error(failed), { gate: 'remote-output' });
      }
      await streamRemote(marker[2], localOutput, 300000);
      const localBytes = fs.statSync(localOutput).size;
      const localSha = sha256File(localOutput);
      if (localBytes !== Number(marker[3])) throw Object.assign(new Error('transferred GLB byte count does not match Big Mac marker'), { gate: 'checksum' });
      if (localSha !== marker[4]) throw Object.assign(new Error('transferred GLB checksum does not match Big Mac marker'), { gate: 'checksum' });
      const validation = validateGlb(fs.readFileSync(localOutput), { textured: mode === 'textured' });
      const rec = mediaStore.finalize(localOutput, { kind: 'world', base: `asset3d-${mode}`, job_id: jobId, worker: 'hunyuan3d-swift', model: mode === 'textured' ? `${SHAPE_MODEL}+${PAINT_MODEL}` : SHAPE_MODEL, parent: source.id, meta: { operation: 'asset3d', mode, source_artifact_id: source.id, upstream_repository: UPSTREAM_REPOSITORY, upstream_commit: UPSTREAM_COMMIT, validation, textured: mode === 'textured' } });
      jobStore.transition(jobId, 'TRANSFERRING');
      const receipt = artifactReceipt([rec]);
      const done = jobStore.transition(jobId, 'COMPLETE', { artifacts: [rec.artifact_id], artifact_validation: receipt });
      if (done.error) throw new Error(done.error);
      recordEvidence(mode, { at: new Date().toISOString(), job_id: jobId, artifact_id: rec.artifact_id, sha256: rec.sha256, bytes: rec.bytes, validation, seconds: Math.round((Date.now() - started) / 1000) });
      return { ok: true, job: jobStore.get(jobId), artifact: rec, validation, remoteMarker: marker[0] };
    } catch (error) {
      const message = String(error.message || error).slice(0, 280);
      const job = jobStore.get(jobId);
      if (job && !['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) jobStore.transition(jobId, 'FAILED', { first_failed_gate: error.gate || 'generation-failed', error: message });
      log(`asset3d ${jobId} ${error.gate || 'generation-failed'}: ${message}`);
      return { ok: false, gate: error.gate || 'generation-failed', error: message, job: jobStore.get(jobId) };
    } finally {
      try { await ssh(`set +e; rm -rf -- ${q(`${REMOTE_ROOT}/${jobId}`)}; printf 'DEX_3D_CLEANUP_%s\\n' "$([ ! -e ${q(`${REMOTE_ROOT}/${jobId}`)} ] && echo PASS || echo FAIL)"`, 30000); } catch (_) {}
      try { fs.rmSync(localRoot, { recursive: true, force: true }); } catch (_) {}
      if (lease && arbiter.holds(jobId)) arbiter.release(jobId);
      try { staging.remove(staged.id); } catch (_) {}
    }
  }

  function start(mode, { sourceArtifactId } = {}) {
    if (!MODES.has(mode)) return { error: 'unsupported 3D mode', gate: 'validation', status: 400 };
    const source = imageStore.resolveImage(String(sourceArtifactId || ''));
    if (!source) return { error: 'source image is not a canonical DexDiffusion image', gate: 'reference-invalid', status: 400 };
    let staged;
    try {
      const result = staging.stage(fs.readFileSync(source.path), { accept: ['image'] });
      if (!result || result.error) return { error: result && result.error || 'source image could not be staged', gate: 'reference-invalid', status: 400 };
      staged = staging.get(result.id);
    } catch (error) { return { error: error.message, gate: 'reference-invalid', status: 400 }; }
    if (!staged) return { error: 'source image staging record could not be reopened', gate: 'reference-invalid', status: 400 };
    const evidence = readEvidence();
    if (!evidence[mode] || evidence[mode].status !== 'PROVEN') {
      staging.remove(staged.id);
      return { error: `${mode === 'mesh' ? 'Mesh' : 'Textured Asset'} backend is installed but not proven by a completed DexDiffusion job`, gate: 'worker-unproven', status: 409 };
    }
    const job = jobStore.create({ media_kind: 'world', operation: `asset3d-${mode}`, worker_id: 'hunyuan3d-swift', model_id: mode === 'textured' ? 'hunyuan3d-shape-small+paint-small' : 'hunyuan3d-shape-small', resource_class: 'heavy', params: { mode, source_artifact_id: source.id } });
    runJob(job.job_id, mode, source, staged).catch(error => log(`asset3d uncaught: ${error.message}`));
    return { job_id: job.job_id, status: job.status, mode, source_artifact_id: source.id };
  }

  function openInBlender(artifactId, options = {}) {
    const rec = mediaStore.resolve(String(artifactId || ''));
    if (!rec || rec.kind !== 'world' || path.extname(rec.path).toLowerCase() !== '.glb') {
      return { error: 'GLB artifact not found', status: 404 };
    }
    const candidates = options.blenderBin ? [options.blenderBin] : ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/local/bin/blender', '/opt/homebrew/bin/blender'];
    const blender = candidates.find(p => fs.existsSync(p));
    if (!blender) {
      return { error: 'Blender is not installed', status: 409 };
    }
    const helperScript = options.helperScript || path.join(__dirname, 'blender-import-glb.py');
    const receiptPath = options.receiptPath || path.join(os.tmpdir(), 'dexdiffusion-blender-receipts', `${rec.artifact_id}-${Date.now()}.json`);
    const args = ['--python', helperScript, '--', rec.path, receiptPath];
    const spawnFn = options.spawn || spawn;
    const child = spawnFn(blender, args, { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
    return {
      ok: true,
      blender,
      artifact_id: rec.artifact_id,
      artifact: rec.path,
      path: rec.path,
      action: 'import-glb',
      receipt_path: receiptPath
    };
  }

  return { workers, start, openInBlender, constants: { ROOT, BIN, SHAPE_SMALL, SHAPE_LARGE, PAINT_RGB, UPSTREAM_REPOSITORY, UPSTREAM_COMMIT, evidenceFile } };
}

module.exports = { createAsset3dBridge, MODES, UPSTREAM_REPOSITORY, UPSTREAM_COMMIT, ROOT, BIN, SHAPE_SMALL, SHAPE_LARGE, PAINT_RGB };
