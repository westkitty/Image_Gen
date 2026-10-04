'use strict';

// Local WorldGen bridge. It deliberately keeps Quick 3D as a real SHARP
// worker and keeps Complete 360 truthful until every stage has a validated
// artifact. SSH success alone is never treated as worker success.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { artifactReceipt } = require('./job-contract');

const execFileP = promisify(execFile);
const WORLD_ROOT = '/Volumes/wc2tb/generative-models/world';
const SHARP_ROOT = `${WORLD_ROOT}/sharp`;
const SHARP_CHECKPOINT = `${SHARP_ROOT}/sharp_2572gikvuh.pt`;
const SHARP_VENV = `${SHARP_ROOT}/venv`;
const WORLD_WORK = '/Volumes/wc2tb/dex-world-work';
const SHARP_MODEL = 'apple-aiml-research/ml-sharp';
const PANORAMA_MODEL = 'AITRADER/FLUX2-klein-base-4B-mlx-4bit';
const PANORAMA_LORA = 'nomadoor/flux-2-klein-4B-360-erp-outpaint-lora';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function q(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function idSafe(value) { return /^[A-Za-z0-9._/-]+$/.test(String(value)); }

async function runFile(file, args, timeout = 300000) {
  return execFileP(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
}

function createWorldBridge({ jobStore, arbiter, staging, mediaStore, worldStore, imageStore, stateDir, sshTarget = 'westcat', log = () => {} }) {
  async function ssh(command, timeout = 300000) {
    return runFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshTarget, command], timeout);
  }
  async function scpRemote(remote, local, timeout = 300000) {
    // Big Mac's OpenSSH endpoint is compatible with legacy SCP mode; the
    // default SFTP-backed client can finish the copy but leave the subprocess
    // open, which would strand the durable job in RUNNING.
    return runFile('scp', ['-O', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `${sshTarget}:${remote}`, local], timeout);
  }
  async function remoteStatus() {
    const command = `set +e
sharp=0; checkpoint=0; world=0
test -x ${q(`${SHARP_VENV}/bin/sharp`)} && sharp=1
test -s ${q(SHARP_CHECKPOINT)} && checkpoint=1
test -d ${q(WORLD_WORK)} && world=1
printf 'WORLD_ASSETS sharp=%s checkpoint=%s work=%s host=%s user=%s\\n' "$sharp" "$checkpoint" "$world" "$(hostname)" "$(whoami)"`;
    try {
      const r = await ssh(command, 20000);
      const m = /WORLD_ASSETS sharp=(\d+) checkpoint=(\d+) work=(\d+) host=(\S+) user=(\S+)/.exec(`${r.stdout}\n${r.stderr}`);
      if (!m) throw new Error('world asset probe missing in-band marker');
      return { reachable: true, identity: `${m[5]}@${m[4]}`, sharp: m[1] === '1' && m[2] === '1', worldWork: m[3] === '1', panorama: false, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { reachable: false, identity: null, sharp: false, worldWork: false, panorama: false, error: String(error.message).slice(0, 180), checkedAt: new Date().toISOString() };
    }
  }

  async function runQuick3d(jobId, project, staged) {
    const remoteDir = `${WORLD_WORK}/${jobId}/quick3d`;
    const remoteInput = `${remoteDir}/input/${staged.file}`;
    const remoteOutput = `${remoteDir}/output`;
    const localTransferRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-'));
    const localPly = path.join(localTransferRoot, `${project.id}.ply`);
    let lease = null;
    try {
      lease = await arbiter.acquire(jobId, 'sharp-reconstruct quick3d');
      if (!lease.granted) throw Object.assign(new Error('heavy-compute lease was not granted'), { gate: 'resource-wait' });
      jobStore.transition(jobId, 'RUNNING', { resource_lease: arbiter.state().group });
      worldStore.updateStage(project.id, 'reconstruct', { status: 'RUNNING', worker: 'sharp-reconstruct', model: SHARP_MODEL });
      const prepared = await ssh(`set -e; mkdir -p ${q(`${remoteDir}/input`)} ${q(remoteOutput)}; printf 'WORLD_PREPARED\\n'`);
      if (!/WORLD_PREPARED/.test(`${prepared.stdout}\n${prepared.stderr}`)) throw new Error('remote preparation missing in-band marker');
      await runFile('scp', ['-O', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', staged.path, `${sshTarget}:${remoteInput}`], 300000);
      const command = `set -uo pipefail
ROOT=${q(SHARP_ROOT)}; D=${q(remoteDir)}
"$ROOT/venv/bin/sharp" predict --input-path "$D/input" --output-path "$D/output" --checkpoint-path ${q(SHARP_CHECKPOINT)} --device mps --no-render
RC=$?
if [ "$RC" -ne 0 ]; then printf 'WORLD_SHARP_FAIL rc=%s\\n' "$RC"; exit 0; fi
PLY=$(find "$D/output" -type f -name '*.ply' | head -1)
if [ -z "$PLY" ] || [ ! -s "$PLY" ]; then printf 'WORLD_SHARP_FAIL output-missing\\n'; exit 0; fi
BYTES=$(stat -f %z "$PLY")
VERTICES=$("$ROOT/venv/bin/python" -c "from plyfile import PlyData; import sys; p=PlyData.read(sys.argv[1]); print(len(p['vertex'].data))" "$PLY" 2>/dev/null)
SHA=$(shasum -a 256 "$PLY" | awk '{print $1}')
if [ -z "$VERTICES" ] || [ "$VERTICES" -le 0 ] || [ -z "$SHA" ]; then printf 'WORLD_SHARP_FAIL output-invalid\\n'; exit 0; fi
printf 'WORLD_SHARP_PASS\\tply=%s\\tbytes=%s\\tvertices=%s\\tsha256=%s\\tdevice=mps\\n' "$PLY" "$BYTES" "$VERTICES" "$SHA"`;
      const remote = await ssh(command, 900000);
      const combined = `${remote.stdout}\n${remote.stderr}`;
      const marker = /WORLD_SHARP_PASS\s+ply=(\S+)\s+bytes=(\d+)\s+vertices=(\d+)\s+sha256=([a-f0-9]{64})\s+device=(\S+)/.exec(combined);
      if (!marker || !marker[1].startsWith(`${remoteDir}/`)) throw new Error(/WORLD_SHARP_FAIL[^\n]*/.exec(combined)?.[0] || 'SHARP result missing in-band validation marker');
      await scpRemote(marker[1], localPly, 300000);
      const localSha = sha256File(localPly);
      if (localSha !== marker[4]) throw new Error('transferred PLY checksum does not match Big Mac marker');
      const rec = mediaStore.finalize(localPly, { kind: 'world', base: `${project.id}-quick3d`, job_id: jobId, worker: 'sharp-reconstruct', model: SHARP_MODEL, parent: project.sourceArtifactId, meta: { mode: 'quick3d', vertices: Number(marker[3]), device: marker[5], remote_path: marker[1], source_artifact_id: project.sourceArtifactId } });
      jobStore.transition(jobId, 'TRANSFERRING');
      const receipt = artifactReceipt([rec]);
      worldStore.attachArtifact(project.id, 'finalPly', rec, { stage: 'finalize' });
      worldStore.recordEvidence(project.id, { worker: 'sharp-reconstruct', model: SHARP_MODEL, workerEvidence: { status: 'PASS', device: marker[5], vertices: Number(marker[3]), remoteSha256: marker[4], localSha256: localSha, remotePath: marker[1] }, modelEvidence: { installed: true, checkpoint: SHARP_CHECKPOINT }, timing: { quick3dSeconds: Math.round((Date.now() - Date.parse(project.createdAt)) / 1000) } });
      worldStore.updateStage(project.id, 'reconstruct', { status: 'READY', worker: 'sharp-reconstruct', model: SHARP_MODEL, artifacts: [rec.artifact_id] });
      worldStore.updateStage(project.id, 'finalize', { status: 'READY', worker: 'artifact-store', model: SHARP_MODEL, artifacts: [rec.artifact_id] });
      worldStore.updateStage(project.id, 'viewer', { status: 'READY', worker: 'spark-three', model: 'three@0.186.1 + @sparkjsdev/spark@2.3.1', artifacts: [rec.artifact_id] });
      const done = jobStore.transition(jobId, 'COMPLETE', { artifacts: [rec.artifact_id], artifact_validation: receipt });
      if (done.error) throw new Error(done.error);
      project.status = 'COMPLETE'; project.currentStage = 'viewer'; worldStore.touch(project);
      return { ok: true, project, artifact: rec, remoteMarker: marker[0] };
    } catch (error) {
      const message = String(error.message || error).slice(0, 260);
      const gate = error.gate || (/SHARP|PLY|result|checksum/i.test(message) ? 'output-invalid' : 'generation-failed');
      const job = jobStore.get(jobId);
      if (job && !['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) jobStore.transition(jobId, 'FAILED', { first_failed_gate: gate, error: message });
      if (worldStore.get(project.id)) worldStore.updateStage(project.id, 'reconstruct', { status: gate === 'resource-wait' ? 'BLOCKED' : 'FAILED', error: message, failure: { gate, error: message } });
      log(`world quick3d ${jobId} ${gate}: ${message}`);
      return { ok: false, gate, error: message, project: worldStore.get(project.id) };
    } finally {
      try { await ssh(`set +e; rm -rf -- ${q(remoteDir)}; printf 'WORLD_CLEANUP_%s\\n' "$([ ! -e ${q(remoteDir)} ] && echo PASS || echo FAIL)"`, 30000); } catch (_) {}
      try { fs.rmSync(localTransferRoot, { recursive: true, force: true }); } catch (_) {}
      if (lease && arbiter.holds(jobId)) arbiter.release(jobId);
      try { staging.remove(staged.id); } catch (_) {}
    }
  }

  function start(mode, { sourceArtifactId, parameters = {}, saveText = false } = {}) {
    if (!['quick3d', 'complete360'].includes(mode)) return { error: 'unsupported world mode', gate: 'validation', status: 400 };
    const source = imageStore.resolveImage(String(sourceArtifactId || ''));
    if (!source) return { error: 'source image is not a canonical DexDiffusion image', gate: 'reference-invalid', status: 400 };
    let staged;
    try {
      const stagedRecord = staging.stage(fs.readFileSync(source.path), { accept: ['image'] });
      if (!stagedRecord || stagedRecord.error) return { error: stagedRecord && stagedRecord.error || 'source image could not be staged', gate: 'reference-invalid', status: 400 };
      staged = staging.get(stagedRecord.id);
    } catch (error) { return { error: error.message, gate: 'reference-invalid', status: 400 }; }
    if (!staged) return { error: 'source image staging record could not be reopened', gate: 'reference-invalid', status: 400 };
    const project = worldStore.create({ mode, sourceArtifactId: source.id, sourceImage: { artifactId: source.id, dimensions: { width: staged.width, height: staged.height }, mime: staged.mime }, parameters });
    const job = jobStore.create({ media_kind: 'world', operation: mode === 'quick3d' ? 'quick3d' : 'complete360', worker_id: mode === 'quick3d' ? 'sharp-reconstruct' : 'flux2-world-completion', model_id: mode === 'quick3d' ? SHARP_MODEL : PANORAMA_MODEL, resource_class: 'heavy', params: { mode, source_artifact_id: source.id, seed: parameters.seed ?? 42 }, persist_text: !!saveText });
    project.jobId = job.job_id; worldStore.touch(project);
    if (mode === 'complete360') {
      worldStore.updateStage(project.id, 'complete', { status: 'BLOCKED', worker: 'flux2-world-completion', model: PANORAMA_MODEL, error: 'Complete 360 product bridge is not yet wired; the exact Base+LoRA compatibility proof is recorded separately.' });
      jobStore.transition(job.job_id, 'FAILED', { first_failed_gate: 'worker-unavailable', error: 'Complete 360 worker is not yet integrated into the product bridge' });
      try { staging.remove(staged.id); } catch (_) {}
      return { job_id: job.job_id, project_id: project.id, status: job.status, project: worldStore.get(project.id) };
    }
    runQuick3d(job.job_id, project, staged).catch(error => log(`world bridge uncaught: ${error.message}`));
    return { job_id: job.job_id, project_id: project.id, status: job.status, project };
  }

  async function workers() {
    const assets = await remoteStatus();
    return {
      assets,
      workers: [
        { id: 'sharp-reconstruct', label: 'Apple SHARP', stage: 'reconstruct', installed: assets.sharp, proven: assets.sharp, status: assets.sharp ? 'PROVEN' : 'MODEL/RUNTIME MISSING', model: SHARP_MODEL, checkpoint: SHARP_CHECKPOINT, license: 'Model weights require separate research-use review.' },
        { id: 'flux2-world-completion', label: 'FLUX.2 Klein Base 4B + 360 ERP LoRA', stage: 'complete', installed: false, proven: false, status: 'EXPERIMENTAL PROOF ONLY', model: PANORAMA_MODEL, lora: PANORAMA_LORA, peakMemory: '31.43 GiB at 2048×1024 proof' },
        { id: 'spark-three', label: 'Spark / Three.js viewer', stage: 'viewer', installed: true, proven: true, status: 'READY', model: 'three@0.186.1 + @sparkjsdev/spark@2.3.1' },
      ],
    };
  }

  return { start, workers, remoteStatus, runQuick3d, constants: { WORLD_ROOT, SHARP_ROOT, SHARP_CHECKPOINT, SHARP_MODEL, PANORAMA_MODEL, PANORAMA_LORA, WORLD_WORK } };
}

module.exports = { createWorldBridge, constants: { WORLD_ROOT, SHARP_ROOT, SHARP_CHECKPOINT, SHARP_MODEL, PANORAMA_MODEL, PANORAMA_LORA, WORLD_WORK } };
