'use strict';

// Durable, media-neutral state for local world generation. World projects own
// lineage and stage truth; generic jobs own execution state and the media store
// owns canonical artifact bytes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'dexdiffusion.world_project.v1';
const MODES = ['quick3d', 'complete360'];
const STAGES = ['source', 'complete', 'project', 'reconstruct', 'align', 'finalize', 'viewer'];
const STAGE_STATES = ['NOT_STARTED', 'READY', 'RUNNING', 'FAILED', 'BLOCKED', 'EXPERIMENTAL', 'NOT_INSTALLED'];

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 1) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function projectId() { return `wp-${crypto.randomBytes(4).toString('hex')}`; }

function stageState() {
  return { status: 'NOT_STARTED', worker: null, model: null, progress: null, startedAt: null, completedAt: null, error: null, artifacts: [] };
}

function stageMap() {
  return Object.fromEntries(STAGES.map(stage => [stage, stageState()]));
}

function newProject({ id, mode, sourceArtifactId, sourceImage, parameters = {}, now = Date.now } = {}) {
  if (!MODES.includes(mode)) throw new Error('world mode must be quick3d or complete360');
  const created = new Date(now()).toISOString();
  const p = {
    schema: SCHEMA,
    schemaVersion: 1,
    id: id || projectId(),
    createdAt: created,
    updatedAt: created,
    mode,
    sourceArtifactId: sourceArtifactId || null,
    sourceImage: sourceImage || null,
    status: 'QUEUED',
    currentStage: 'source',
    parameters: { seed: 42, ...parameters },
    workerEvidence: {},
    modelEvidence: {},
    lineage: sourceArtifactId ? [{ type: 'source', artifactId: sourceArtifactId }] : [],
    timing: {},
    failure: null,
    artifacts: { source: sourceArtifactId || null, erpReference: null, panorama: null, cubemapFaces: [], depthMaps: [], perViewSplats: [], finalPly: null, preview: null, optionalColliderOrMesh: null },
    stages: stageMap(),
    viewerState: { opened: false, camera: null, lastArtifactId: null },
  };
  p.stages.source = { ...stageState(), status: sourceArtifactId ? 'READY' : 'NOT_STARTED', artifacts: sourceArtifactId ? [sourceArtifactId] : [] };
  return p;
}

function migrate(input, now = Date.now) {
  if (!input || typeof input !== 'object') return null;
  const p = { ...input };
  p.schema = SCHEMA;
  p.schemaVersion = 1;
  p.mode = MODES.includes(p.mode) ? p.mode : 'quick3d';
  p.parameters = p.parameters && typeof p.parameters === 'object' ? p.parameters : { seed: 42 };
  p.workerEvidence = p.workerEvidence && typeof p.workerEvidence === 'object' ? p.workerEvidence : {};
  p.modelEvidence = p.modelEvidence && typeof p.modelEvidence === 'object' ? p.modelEvidence : {};
  p.lineage = Array.isArray(p.lineage) ? p.lineage : [];
  p.timing = p.timing && typeof p.timing === 'object' ? p.timing : {};
  p.artifacts = { ...newProject({ mode: p.mode, now }).artifacts, ...(p.artifacts || {}) };
  p.stages = { ...stageMap(), ...(p.stages || {}) };
  for (const stage of STAGES) p.stages[stage] = { ...stageState(), ...(p.stages[stage] || {}) };
  p.viewerState = { opened: false, camera: null, lastArtifactId: null, ...(p.viewerState || {}) };
  p.status = String(p.status || 'QUEUED');
  p.currentStage = STAGES.includes(p.currentStage) ? p.currentStage : 'source';
  p.createdAt = p.createdAt || new Date(now()).toISOString();
  p.updatedAt = p.updatedAt || p.createdAt;
  return p;
}

function createWorldStore({ root, now = () => Date.now() } = {}) {
  const dir = path.resolve(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const projects = new Map();
  const file = id => path.join(dir, `${id}.json`);
  const persist = p => { p.updatedAt = new Date(now()).toISOString(); atomicWrite(file(p.id), p); };
  const load = () => {
    projects.clear();
    for (const name of fs.readdirSync(dir)) {
      if (!/^wp-[a-f0-9]{8}\.json$/.test(name)) continue;
      try { const p = migrate(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), now); if (p) projects.set(p.id, p); } catch (_) {}
    }
  };
  load();

  function get(id) { return projects.get(id) || null; }
  function create(input) { const p = newProject({ ...input, now }); projects.set(p.id, p); persist(p); return p; }
  function touch(p) { if (!p || !projects.has(p.id)) return null; persist(p); return p; }
  function list() { return [...projects.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(p => ({ ...p, stages: undefined })); }
  function updateStage(id, stage, patch = {}) {
    if (!STAGES.includes(stage)) throw new Error('unknown world stage');
    const p = get(id); if (!p) throw new Error('world project not found');
    const next = String(patch.status || p.stages[stage].status || 'NOT_STARTED');
    if (!STAGE_STATES.includes(next)) throw new Error('invalid world stage status');
    const before = p.stages[stage];
    const entry = { ...before, ...patch, status: next };
    if (next === 'RUNNING' && !entry.startedAt) entry.startedAt = new Date(now()).toISOString();
    if (['READY', 'FAILED', 'BLOCKED', 'EXPERIMENTAL', 'NOT_INSTALLED'].includes(next)) entry.completedAt = entry.completedAt || new Date(now()).toISOString();
    p.stages[stage] = entry;
    p.currentStage = stage;
    if (next === 'FAILED' || next === 'BLOCKED') { p.status = next; p.failure = { stage, ...(patch.failure || {}), error: patch.error || entry.error || null }; }
    else if (next === 'RUNNING') { p.status = 'RUNNING'; p.failure = null; }
    else if (next === 'READY' || next === 'EXPERIMENTAL') { p.status = next === 'EXPERIMENTAL' ? 'EXPERIMENTAL' : p.status === 'QUEUED' ? 'RUNNING' : p.status; }
    persist(p); return p;
  }
  function attachArtifact(id, slot, artifact, { stage = null } = {}) {
    const p = get(id); if (!p) throw new Error('world project not found');
    if (Array.isArray(p.artifacts[slot])) p.artifacts[slot] = [...p.artifacts[slot], artifact];
    else p.artifacts[slot] = artifact;
    if (artifact && artifact.artifact_id) p.lineage.push({ type: slot, artifactId: artifact.artifact_id, parent: artifact.parent || p.sourceArtifactId });
    if (stage) p.stages[stage].artifacts = [...new Set([...(p.stages[stage].artifacts || []), artifact && (artifact.artifact_id || artifact)])];
    persist(p); return p;
  }
  function recordEvidence(id, { worker, model, workerEvidence, modelEvidence, timing } = {}) {
    const p = get(id); if (!p) throw new Error('world project not found');
    if (worker) p.workerEvidence[worker] = { ...(p.workerEvidence[worker] || {}), ...workerEvidence };
    if (model) p.modelEvidence[model] = { ...(p.modelEvidence[model] || {}), ...modelEvidence };
    if (timing) p.timing = { ...p.timing, ...timing };
    persist(p); return p;
  }
  function setViewer(id, patch) { const p = get(id); if (!p) throw new Error('world project not found'); p.viewerState = { ...p.viewerState, ...patch }; persist(p); return p; }
  function retry(id, stage) {
    const p = get(id); if (!p || !STAGES.includes(stage)) return null;
    p.failure = null; p.status = 'QUEUED'; p.currentStage = stage; p.stages[stage] = stageState(); persist(p); return p;
  }
  return { root: dir, file, get, list, create, touch, updateStage, attachArtifact, recordEvidence, setViewer, retry, reload: load, valid: id => /^wp-[a-f0-9]{8}$/.test(String(id)) };
}

module.exports = { SCHEMA, MODES, STAGES, STAGE_STATES, newProject, migrate, createWorldStore };
