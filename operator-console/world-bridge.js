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
const PANORAMA_CACHE = `${WORLD_ROOT}/mflux-cache`;
const PANORAMA_BIN = '$HOME/Library/Caches/DexDiffusion/mflux/venv/bin/mflux-generate-flux2';
const PANORAMA_WIDTH = 1024;
const PANORAMA_HEIGHT = 512;
const COMPILER = path.join(__dirname, 'world-compiler.py');

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function q(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function idSafe(value) { return /^[A-Za-z0-9._/-]+$/.test(String(value)); }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function runFile(file, args, timeout = 300000) {
  return execFileP(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
}

function createWorldBridge({ jobStore, arbiter, staging, mediaStore, worldStore, imageStore, stateDir, sshTarget = 'westcat', log = () => {} }) {
  const panoramaEvidenceFile = path.join(stateDir, 'world-panorama-evidence.json');
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
panorama=0
test -x ${PANORAMA_BIN} && test -d ${q(`${PANORAMA_CACHE}/huggingface/hub/models--AITRADER--FLUX2-klein-base-4B-mlx-4bit`)} && test -d ${q(`${PANORAMA_CACHE}/xdg/mflux/loras/models--nomadoor--flux-2-klein-4B-360-erp-outpaint-lora`)} && panorama=1
printf 'WORLD_ASSETS sharp=%s checkpoint=%s work=%s panorama=%s host=%s user=%s\\n' "$sharp" "$checkpoint" "$world" "$panorama" "$(hostname)" "$(whoami)"`;
    try {
      const r = await ssh(command, 20000);
      const m = /WORLD_ASSETS sharp=(\d+) checkpoint=(\d+) work=(\d+) panorama=(\d+) host=(\S+) user=(\S+)/.exec(`${r.stdout}\n${r.stderr}`);
      if (!m) throw new Error('world asset probe missing in-band marker');
      return { reachable: true, identity: `${m[6]}@${m[5]}`, sharp: m[1] === '1' && m[2] === '1', worldWork: m[3] === '1', panorama: m[4] === '1', checkedAt: new Date().toISOString() };
    } catch (error) {
      return { reachable: false, identity: null, sharp: false, worldWork: false, panorama: false, error: String(error.message).slice(0, 180), checkedAt: new Date().toISOString() };
    }
  }

  async function runCompiler(args, timeout = 120000) { return runFile('python3', [COMPILER, ...args], timeout); }

  function finalizeWorld(file, base, jobId, worker, model, parent, meta = {}) {
    return mediaStore.finalize(file, { kind: 'world', base, job_id: jobId, worker, model, parent, meta });
  }

  async function runDerivedPipeline(jobId, project, panoRec, sourcePath, localRoot) {
    const derived = { depth: [], views: [], coarse: null, collision: null, rig: null, quality: null };
    const depthPath = path.join(localRoot, 'depth-360.pgm');
    const depthManifestPath = path.join(localRoot, 'depth-360.json');
    const scaffoldPath = path.join(localRoot, 'coarse.ply');
    const collisionPath = path.join(localRoot, 'collision.obj');
    const scaffoldManifestPath = path.join(localRoot, 'scaffold.json');
    const rigPath = path.join(localRoot, 'camera-rig.json');
    const viewsDir = path.join(localRoot, 'views');
    const viewsManifestPath = path.join(localRoot, 'views.json');
    const qualityPath = path.join(localRoot, 'quality-report.json');
    const worker = 'world-compiler';
    const model = 'deterministic-world-v1';
    try {
      worldStore.updateStage(project.id, 'depth360', { status: 'RUNNING', worker, model });
      const panoramaPath = mediaStore.resolve(panoRec.artifact_id)?.path;
      if (!panoramaPath) throw new Error('canonical panorama could not be reopened for derived stages');
      await runCompiler(['depth', '--panorama', panoramaPath, '--output', depthPath, '--manifest', depthManifestPath]);
      const depthMetrics = JSON.parse(fs.readFileSync(depthManifestPath, 'utf8'));
      const depthRec = finalizeWorld(depthPath, `${project.id}-depth360`, jobId, worker, model, panoRec.artifact_id, { metrics: depthMetrics, confidence: 'LOW' });
      const depthManifestRec = finalizeWorld(depthManifestPath, `${project.id}-depth360-metrics`, jobId, worker, model, depthRec.artifact_id, { metrics: depthMetrics });
      worldStore.attachArtifact(project.id, 'depthMaps', depthRec, { stage: 'depth360' });
      worldStore.attachArtifact(project.id, 'depthMaps', depthManifestRec, { stage: 'depth360' });
      worldStore.updateStage(project.id, 'depth360', { status: 'READY', worker, model, artifacts: [depthRec.artifact_id, depthManifestRec.artifact_id] });
      derived.depth.push(depthRec, depthManifestRec);

      worldStore.updateStage(project.id, 'project', { status: 'RUNNING', worker, model });
      await runCompiler(['scaffold', '--panorama', panoramaPath, '--depth', depthPath, '--output', scaffoldPath, '--collision', collisionPath, '--manifest', scaffoldManifestPath]);
      const scaffoldMetrics = JSON.parse(fs.readFileSync(scaffoldManifestPath, 'utf8'));
      const coarseRec = finalizeWorld(scaffoldPath, `${project.id}-coarse-geometry`, jobId, worker, model, depthRec.artifact_id, { metrics: scaffoldMetrics, coordinateFrame: 'erp-spherical' });
      const collisionRec = finalizeWorld(collisionPath, `${project.id}-collision`, jobId, worker, model, coarseRec.artifact_id, { metrics: scaffoldMetrics, collisionOnly: true });
      const scaffoldManifestRec = finalizeWorld(scaffoldManifestPath, `${project.id}-scaffold-metrics`, jobId, worker, model, coarseRec.artifact_id, { metrics: scaffoldMetrics });
      worldStore.attachArtifact(project.id, 'coarseGeometry', coarseRec, { stage: 'project' });
      worldStore.attachArtifact(project.id, 'collisionMesh', collisionRec, { stage: 'runtime' });
      worldStore.updateStage(project.id, 'project', { status: 'READY', worker, model, artifacts: [coarseRec.artifact_id] });
      derived.coarse = coarseRec; derived.collision = collisionRec;

      worldStore.updateStage(project.id, 'rig', { status: 'RUNNING', worker, model });
      await runCompiler(['rig', '--output', rigPath]);
      const rigMetrics = JSON.parse(fs.readFileSync(rigPath, 'utf8'));
      const rigRec = finalizeWorld(rigPath, `${project.id}-camera-rig`, jobId, worker, model, panoRec.artifact_id, { metrics: rigMetrics });
      worldStore.attachArtifact(project.id, 'cameraRig', rigRec, { stage: 'rig' });
      await runCompiler(['views', '--panorama', panoramaPath, '--output-dir', viewsDir, '--manifest', viewsManifestPath]);
      const viewsMetrics = JSON.parse(fs.readFileSync(viewsManifestPath, 'utf8'));
      const viewRecs = viewsMetrics.views.map(view => finalizeWorld(view.path, `${project.id}-view-${view.id}`, jobId, worker, model, panoRec.artifact_id, { metrics: view, projected: true }));
      for (const rec of viewRecs) worldStore.attachArtifact(project.id, 'projectedViews', rec, { stage: 'rig' });
      worldStore.updateStage(project.id, 'rig', { status: 'READY', worker, model, artifacts: [rigRec.artifact_id, ...viewRecs.map(rec => rec.artifact_id)] });
      derived.rig = rigRec; derived.views.push(...viewRecs);

      const quality = {
        schema: 'dexdiffusion.world.quality-report.v1',
        status: 'PARTIAL',
        classification: 'WARN',
        generatedAt: new Date().toISOString(),
        coordinateFrame: 'erp-spherical',
        checks: {
          panorama: { status: 'PASS', score: project.workerEvidence?.['flux2-world-completion']?.scores?.[0] || null },
          depth360: { status: 'WARN', method: depthMetrics.method, confidence: depthMetrics.confidence, validPixelRatio: depthMetrics.validPixelRatio, nanCount: depthMetrics.nanCount, infCount: depthMetrics.infCount },
          coarseGeometry: { status: 'PASS', points: scaffoldMetrics.points, finite: scaffoldMetrics.finite, bounds: scaffoldMetrics.bounds },
          cameraRig: { status: 'PASS', cameras: rigMetrics.cameras.length, overlapDegrees: 15 },
          sharpPerView: { status: 'NOT_STARTED', reason: 'Per-view SHARP fitting requires a bounded remote compute pass.' },
          fusion: { status: 'NOT_STARTED', reason: 'Fusion awaits learned per-view proposals.' },
          runtime: { status: 'PASS', collision: true, progressiveArtifact: true },
          viewer: { status: 'READY', artifact: coarseRec.artifact_id },
        },
        blockers: ['learned global depth unavailable in this local runtime', 'SHARP per-view fitting and fusion not yet executed'],
      };
      writeJson(qualityPath, quality);
      const qualityRec = finalizeWorld(qualityPath, `${project.id}-quality-report`, jobId, worker, model, coarseRec.artifact_id, { classification: 'WARN' });
      worldStore.attachArtifact(project.id, 'qualityReport', qualityRec, { stage: 'quality' });
      worldStore.setQualityReport(project.id, quality);
      worldStore.updateStage(project.id, 'runtime', { status: 'READY', worker, model, artifacts: [coarseRec.artifact_id, collisionRec.artifact_id] });
      worldStore.updateStage(project.id, 'viewer', { status: 'READY', worker: 'spark-three', model: 'three@0.186.1 + @sparkjsdev/spark@2.3.1', artifacts: [coarseRec.artifact_id] });
      worldStore.updateStage(project.id, 'quality', { status: 'READY', worker, model, artifacts: [qualityRec.artifact_id] });
      project.status = 'PARTIAL'; project.currentStage = 'quality'; worldStore.touch(project);
      derived.quality = qualityRec;
      return { ok: true, derived, quality };
    } catch (error) {
      const message = String(error.message || error).slice(0, 260);
      const stage = project.currentStage || 'depth360';
      try { worldStore.updateStage(project.id, stage, { status: 'FAILED', error: message, failure: { gate: 'derived-stage', error: message } }); } catch (_) {}
      log(`world derived pipeline ${jobId} failed at ${stage}: ${message}`);
      return { ok: false, error: message, derived, stage };
    }
  }

  async function runComplete360(jobId, project, staged) {
    const remoteDir = `${WORLD_WORK}/${jobId}/complete360`;
    const remoteJobDir = `${WORLD_WORK}/${jobId}`;
    const remoteInput = `${remoteDir}/input/${staged.file}`;
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-world-360-'));
    const localAnchor = path.join(localRoot, 'erp-reference.png');
    const localMask = path.join(localRoot, 'source-mask.png');
    const cameraManifest = path.join(localRoot, 'camera.json');
    const anchorManifest = path.join(localRoot, 'erp-reference.json');
    let lease = null;
    try {
      lease = await arbiter.acquire(jobId, 'flux2-world-completion panorama');
      if (!lease.granted) throw Object.assign(new Error('heavy-compute lease was not granted'), { gate: 'resource-wait' });
      jobStore.transition(jobId, 'RUNNING', { resource_lease: arbiter.state().group });
      worldStore.updateStage(project.id, 'camera', { status: 'RUNNING', worker: 'world-compiler', model: 'deterministic-camera-v1' });
      await runCompiler(['anchor', '--source', staged.path, '--output', localAnchor, '--mask', localMask, '--manifest', anchorManifest, '--width', String(PANORAMA_WIDTH), '--height', String(PANORAMA_HEIGHT), '--fov', String(project.parameters.fov || 70)]);
      const camera = JSON.parse(fs.readFileSync(anchorManifest, 'utf8'));
      worldStore.setCamera(project.id, camera);
      worldStore.updateStage(project.id, 'camera', { status: 'READY', worker: 'world-compiler', model: 'deterministic-camera-v1' });
      const anchorRec = mediaStore.finalize(localAnchor, { kind: 'world', base: `${project.id}-erp-reference`, job_id: jobId, worker: 'world-compiler', model: 'deterministic-camera-v1', parent: project.sourceArtifactId, meta: { mode: 'complete360', sourceMask: localMask, fov: camera.fovHorizontal } });
      worldStore.attachArtifact(project.id, 'erpReference', anchorRec, { stage: 'erpReference' });
      worldStore.updateStage(project.id, 'erpReference', { status: 'READY', worker: 'world-compiler', model: 'deterministic-camera-v1', artifacts: [anchorRec.artifact_id] });
      worldStore.setManifest(project.id, { sourceCommit: process.env.DEX_WORLD_SOURCE_HEAD || null, dependencies: { erpReference: { source: project.sourceArtifactId, camera: camera.erpReferenceSha256 } } });
      worldStore.updateStage(project.id, 'complete', { status: 'RUNNING', worker: 'flux2-world-completion', model: PANORAMA_MODEL });
      const prepared = await ssh(`set -e; mkdir -p ${q(`${remoteDir}/input`)} ${q(`${remoteDir}/output`)}; printf 'WORLD_PANORAMA_PREPARED\\n'`);
      if (!/WORLD_PANORAMA_PREPARED/.test(`${prepared.stdout}\n${prepared.stderr}`)) throw new Error('remote panorama preparation missing in-band marker');
      await runFile('scp', ['-O', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', staged.path, `${sshTarget}:${remoteInput}`], 300000);
      const requestedCandidates = Number(project.parameters.candidates || 1);
      const candidateCount = Math.max(1, Math.min(3, Number.isFinite(requestedCandidates) ? requestedCandidates : 1));
      const requestedSteps = Number(project.parameters.steps || 1);
      const steps = Math.max(1, Math.min(4, Number.isFinite(requestedSteps) ? requestedSteps : 1));
      const candidates = [];
      for (let i = 0; i < candidateCount; i++) {
        const seed = Number(project.parameters.seed || 42) + i;
        const remoteOut = `${remoteDir}/output/candidate-${i + 1}.png`;
        const command = `set -uo pipefail
export HF_HOME=${q(`${PANORAMA_CACHE}/huggingface`)} XDG_CACHE_HOME=${q(`${PANORAMA_CACHE}/xdg`)} HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false
OUT=${q(remoteOut)}
MFLUX="$HOME/Library/Caches/DexDiffusion/mflux/venv/bin/mflux-generate-flux2"
PYTHON="$HOME/Library/Caches/DexDiffusion/mflux/venv/bin/python"
"$MFLUX" --model ${q(PANORAMA_MODEL)} --base-model flux2-klein-base-4b --lora-paths ${q(PANORAMA_LORA)} --lora-scales 1.0 --prompt ${q('equirectangular 360 degree panoramic world, preserve the observed scene and continue the environment around the camera, seamless horizon, consistent lighting')} --image ${q(remoteInput)} 0.85 --steps ${steps} --seed ${seed} --width ${PANORAMA_WIDTH} --height ${PANORAMA_HEIGHT} --output "$OUT" --no-metadata
RC=$?
if [ "$RC" -ne 0 ] || [ ! -s "$OUT" ]; then printf 'WORLD_PANORAMA_FAIL\\trc=%s\\tcandidate=%s\\n' "$RC" "${i + 1}"; exit 0; fi
DIMS=$("$PYTHON" -c 'from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(im.width, im.height)' "$OUT" 2>/dev/null)
WIDTH=$(printf '%s' "$DIMS" | awk '{print $1}')
HEIGHT=$(printf '%s' "$DIMS" | awk '{print $2}')
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ] || [ -z "$SHA" ]; then printf 'WORLD_PANORAMA_FAIL\\toutput-invalid\\tcandidate=%s\\n' "${i + 1}"; exit 0; fi
printf 'WORLD_PANORAMA_PASS\\tpath=%s\\twidth=%s\\theight=%s\\tsha256=%s\\tmodel=%s\\tlora=%s\\tseed=%s\\tcandidate=%s\\n' "$OUT" "$WIDTH" "$HEIGHT" "$SHA" ${q(PANORAMA_MODEL)} ${q(PANORAMA_LORA)} "${seed}" "${i + 1}"`;
        const remote = await ssh(command, 1200000);
        const combined = `${remote.stdout}\n${remote.stderr}`;
        try { fs.writeFileSync(path.join(stateDir, `world-${jobId}-candidate-${i + 1}.remote.log`), combined, { mode: 0o600 }); } catch (_) {}
        const marker = /WORLD_PANORAMA_PASS[ \t]+path=(\S+)[ \t]+width=(\d+)[ \t]+height=(\d+)[ \t]+sha256=([a-f0-9]{64})[ \t]+model=(\S+)[ \t]+lora=(\S+)[ \t]+seed=(\d+)[ \t]+candidate=(\d+)/.exec(combined);
        if (!marker || marker[1] !== remoteOut || Number(marker[2]) !== 2 * Number(marker[3])) {
          const failMarker = /WORLD_PANORAMA_FAIL[^\n]*/.exec(combined)?.[0];
          const tail = combined.replace(/\s+/g, ' ').slice(-700);
          throw new Error(failMarker || `panorama result missing 2:1 in-band marker; remote tail: ${tail}`);
        }
        const localPano = path.join(localRoot, `candidate-${i + 1}.png`);
        await scpRemote(marker[1], localPano, 300000);
        const localSha = sha256File(localPano);
        if (localSha !== marker[4]) throw new Error('transferred panorama checksum does not match Big Mac marker');
        const score = JSON.parse((await runCompiler(['score', '--source', staged.path, '--panorama', localPano])).stdout.trim());
        candidates.push({ path: localPano, remotePath: marker[1], remoteSha256: marker[4], localSha256: localSha, width: Number(marker[2]), height: Number(marker[3]), seed, score });
      }
      candidates.sort((a, b) => b.score.score - a.score.score);
      const winner = candidates[0];
      const panoRec = mediaStore.finalize(winner.path, { kind: 'world', base: `${project.id}-panorama`, job_id: jobId, worker: 'flux2-world-completion', model: PANORAMA_MODEL, seed: winner.seed, parent: project.sourceArtifactId, meta: { mode: 'complete360', lora: PANORAMA_LORA, dimensions: { width: winner.width, height: winner.height }, candidateCount: candidates.length, selectedCandidate: candidates.indexOf(winner) + 1, score: winner.score, remotePath: winner.remotePath, remoteSha256: winner.remoteSha256, localSha256: winner.localSha256 } });
      worldStore.attachArtifact(project.id, 'panorama', panoRec, { stage: 'complete' });
      worldStore.recordEvidence(project.id, { worker: 'flux2-world-completion', model: PANORAMA_MODEL, workerEvidence: { status: 'PASS', lora: PANORAMA_LORA, width: winner.width, height: winner.height, steps, remoteSha256: winner.remoteSha256, localSha256: winner.localSha256, candidateCount: candidates.length, selectedCandidate: candidates.indexOf(winner) + 1, scores: candidates.map(c => c.score) }, modelEvidence: { baseModel: PANORAMA_MODEL, lora: PANORAMA_LORA, cache: PANORAMA_CACHE }, timing: { panoramaSeconds: Math.round((Date.now() - Date.parse(project.createdAt)) / 1000) } });
      worldStore.updateStage(project.id, 'complete', { status: 'READY', worker: 'flux2-world-completion', model: PANORAMA_MODEL, artifacts: [panoRec.artifact_id] });
      worldStore.setManifest(project.id, { dependencies: { complete: { erpReference: anchorRec.artifact_id, model: PANORAMA_MODEL, lora: PANORAMA_LORA, seed: winner.seed } } });
      writeJson(panoramaEvidenceFile, { at: new Date().toISOString(), projectId: project.id, jobId, model: PANORAMA_MODEL, lora: PANORAMA_LORA, artifactId: panoRec.artifact_id, sha256: panoRec.sha256 });
      if (lease && arbiter.holds(jobId)) { arbiter.release(jobId); lease = null; }
      const derivedResult = await runDerivedPipeline(jobId, project, panoRec, staged.path, localRoot);
      const allArtifacts = [anchorRec, panoRec, ...derivedResult.derived.depth, derivedResult.derived.coarse, derivedResult.derived.collision, derivedResult.derived.rig, ...derivedResult.derived.views, derivedResult.derived.quality].filter(Boolean);
      const receipt = artifactReceipt(allArtifacts);
      const done = jobStore.transition(jobId, 'COMPLETE', { resource_lease: null, artifacts: allArtifacts.map(rec => rec.artifact_id), artifact_validation: receipt });
      if (done.error) throw new Error(done.error);
      project.status = 'PARTIAL'; project.currentStage = derivedResult.ok ? 'quality' : 'complete'; worldStore.touch(project);
      return { ok: true, project, panorama: panoRec, candidates, derived: derivedResult };
    } catch (error) {
      const message = String(error.message || error).slice(0, 300);
      const gate = error.gate || (/panorama|checksum|marker|PNG/i.test(message) ? 'output-invalid' : 'generation-failed');
      const job = jobStore.get(jobId);
      if (job && !['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) jobStore.transition(jobId, 'FAILED', { first_failed_gate: gate, error: message });
      if (worldStore.get(project.id)) worldStore.updateStage(project.id, 'complete', { status: gate === 'resource-wait' ? 'BLOCKED' : 'FAILED', error: message, failure: { gate, error: message } });
      log(`world complete360 ${jobId} ${gate}: ${message}`);
      return { ok: false, gate, error: message, project: worldStore.get(project.id) };
    } finally {
      try { await ssh(`set +e; rm -rf -- ${q(remoteJobDir)}; printf 'WORLD_CLEANUP_%s\\n' "$([ ! -e ${q(remoteJobDir)} ] && echo PASS || echo FAIL)"`, 30000); } catch (_) {}
      try { fs.rmSync(localRoot, { recursive: true, force: true }); } catch (_) {}
      if (lease && arbiter.holds(jobId)) arbiter.release(jobId);
      try { staging.remove(staged.id); } catch (_) {}
    }
  }

  async function runQuick3d(jobId, project, staged) {
    const remoteDir = `${WORLD_WORK}/${jobId}/quick3d`;
    const remoteJobDir = `${WORLD_WORK}/${jobId}`;
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
      try { await ssh(`set +e; rm -rf -- ${q(remoteJobDir)}; printf 'WORLD_CLEANUP_%s\\n' "$([ ! -e ${q(remoteJobDir)} ] && echo PASS || echo FAIL)"`, 30000); } catch (_) {}
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
      runComplete360(job.job_id, project, staged).catch(error => log(`world complete360 uncaught: ${error.message}`));
      return { job_id: job.job_id, project_id: project.id, status: job.status, project };
    }
    runQuick3d(job.job_id, project, staged).catch(error => log(`world bridge uncaught: ${error.message}`));
    return { job_id: job.job_id, project_id: project.id, status: job.status, project };
  }

  async function workers() {
    const assets = await remoteStatus();
    let evidence = null;
    try { evidence = JSON.parse(fs.readFileSync(panoramaEvidenceFile, 'utf8')); } catch (_) {}
    return {
      assets,
      workers: [
        { id: 'sharp-reconstruct', label: 'Apple SHARP', stage: 'reconstruct', installed: assets.sharp, proven: assets.sharp, status: assets.sharp ? 'PROVEN' : 'MODEL/RUNTIME MISSING', model: SHARP_MODEL, checkpoint: SHARP_CHECKPOINT, license: 'Model weights require separate research-use review.' },
        { id: 'flux2-world-completion', label: 'FLUX.2 Klein Base 4B + 360 ERP LoRA', stage: 'complete', installed: assets.panorama, proven: !!evidence, status: !assets.panorama ? 'MODEL/RUNTIME MISSING' : evidence ? 'PROVEN' : 'READY — awaiting product proof', model: PANORAMA_MODEL, lora: PANORAMA_LORA, peakMemory: '31.43 GiB at 2048×1024 proof', lastPass: evidence },
        { id: 'spark-three', label: 'Spark / Three.js viewer', stage: 'viewer', installed: true, proven: true, status: 'READY', model: 'three@0.186.1 + @sparkjsdev/spark@2.3.1' },
      ],
    };
  }

  return { start, workers, remoteStatus, runQuick3d, runComplete360, constants: { WORLD_ROOT, SHARP_ROOT, SHARP_CHECKPOINT, SHARP_MODEL, PANORAMA_MODEL, PANORAMA_LORA, PANORAMA_CACHE, WORLD_WORK } };
}

module.exports = { createWorldBridge, constants: { WORLD_ROOT, SHARP_ROOT, SHARP_CHECKPOINT, SHARP_MODEL, PANORAMA_MODEL, PANORAMA_LORA, PANORAMA_CACHE, WORLD_WORK } };
