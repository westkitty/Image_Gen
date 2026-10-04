import * as THREE from './vendor/three.module.js';
import { PLYLoader } from './vendor/three-addons/loaders/PLYLoader.js';

const canvas = document.querySelector('#world-canvas');
const status = document.querySelector('#world-status');
const params = new URLSearchParams(location.search);
const projectId = params.get('project');
const state = { cameraStart: new THREE.Vector3(0, 0, 2.5), yaw: 0, pitch: 0, keys: new Set(), dragging: false, lastX: 0, lastY: 0, splat: null, project: null };

function setStatus(title, detail, error = false) {
  status.innerHTML = `<div class="title">${escapeHtml(title)}</div><div class="meta${error ? ' error' : ''}">${escapeHtml(detail || '')}</div>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070b');
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 1000);
camera.position.copy(state.cameraStart);
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
} catch (error) {
  setStatus('World Focus unavailable', `WebGL renderer unavailable: ${error.message}`, true);
}
scene.add(spark);

function resetCamera() { camera.position.copy(state.cameraStart); state.yaw = 0; state.pitch = 0; camera.rotation.set(0, 0, 0); }
function applyLook() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
}
function disposeSplat() {
  if (!state.splat) return;
  scene.remove(state.splat);
  state.splat.dispose?.();
  state.splat.geometry?.dispose?.();
  state.splat.material?.dispose?.();
  state.splat = null;
}
async function loadSplat(url) {
  disposeSplat();
  const geometry = await new PLYLoader().loadAsync(url);
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const material = new THREE.PointsMaterial({ size: Math.max(radius / 420, 0.002), sizeAttenuation: true, vertexColors: geometry.hasAttribute('color'), color: 0xdbeafe, transparent: true, opacity: 0.96 });
  state.splat = new THREE.Points(geometry, material);
  state.splat.position.set(0, 0, 0);
  scene.add(state.splat);
}
function move(dt) {
  const speed = (state.keys.has('shift') ? 4 : 1.6) * dt;
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, Math.sin(state.yaw));
  if (state.keys.has('w')) camera.position.addScaledVector(forward, speed);
  if (state.keys.has('s')) camera.position.addScaledVector(forward, -speed);
  if (state.keys.has('a')) camera.position.addScaledVector(right, -speed);
  if (state.keys.has('d')) camera.position.addScaledVector(right, speed);
}

async function loadProject() {
  if (!projectId) throw new Error('Missing project query parameter');
  const response = await fetch('/api/world/projects/' + encodeURIComponent(projectId));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `project request failed (${response.status})`);
  state.project = body;
  const artifact = body.viewerArtifact || (Array.isArray(body.artifacts?.finalPly) ? body.artifacts.finalPly[0] : body.artifacts?.finalPly);
  if (!artifact?.url) throw new Error('World project has no viewer-ready PLY artifact');
  const worker = body.workerEvidence?.['sharp-reconstruct'];
  if (renderer) {
    await loadSplat(new URL(artifact.url, location.origin).href);
    setStatus(body.mode === 'quick3d' ? 'Quick 3D World' : 'Complete 360 World · Progressive Preview', `${body.id} · ${body.status} · ${artifact.artifact_id} · PLY ${artifact.bytes || 'unknown'} bytes · ${worker?.vertices || 'coarse scaffold'} vertices`);
  } else {
    setStatus('World artifact ready', `${body.id} · ${body.status} · ${artifact.artifact_id} · PLY ${artifact.bytes || 'unknown'} bytes · WebGL is unavailable in this browser`, true);
  }
  fetch('/api/world/projects/' + encodeURIComponent(projectId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ viewerState: { opened: true, lastArtifactId: artifact.artifact_id } }) }).catch(() => {});
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer?.setSize(innerWidth, innerHeight, false); });
addEventListener('keydown', e => { const key = e.key.toLowerCase(); if (['w','a','s','d','shift'].includes(key)) state.keys.add(key); if (key === 'r') resetCamera(); if (key === 'f') document.documentElement.requestFullscreen?.(); });
addEventListener('keyup', e => state.keys.delete(e.key.toLowerCase()));
canvas.addEventListener('pointerdown', e => { state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', e => { state.dragging = false; canvas.releasePointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!state.dragging) return; state.yaw -= (e.clientX - state.lastX) * 0.004; state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - (e.clientY - state.lastY) * 0.004)); state.lastX = e.clientX; state.lastY = e.clientY; });
document.querySelector('#world-reset').addEventListener('click', resetCamera);
document.querySelector('#world-fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());

let last = performance.now();
function animate(now) { const dt = Math.min((now - last) / 1000, 0.05); last = now; move(dt); applyLook(); renderer?.render(scene, camera); requestAnimationFrame(animate); }
if (renderer) requestAnimationFrame(animate);
loadProject().catch(error => setStatus('World Focus unavailable', error.message, true));
