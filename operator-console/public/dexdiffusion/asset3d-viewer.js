import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { DRACOLoader } from './vendor/DRACOLoader.js';

const canvas = document.querySelector('#asset-canvas');
const status = document.querySelector('#asset-status');
const animationButton = document.querySelector('#asset-animation');
const structure = document.querySelector('#asset-structure');
const selectedLabel = document.querySelector('#asset-selected');
const clipSelect = document.querySelector('#asset-clip');
const largeLoadButton = document.querySelector('#asset-load-large');
const metrics = { renders: 0, parse_ms: null, transfer_ms: null, vertices: 0, triangles: 0,
  drawn_pixel_ratio: 1, idle_animation: false };
window.__dexAssetMetrics = metrics;
let selectionOutline = null;
let activeClip = null;
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xa8d7ed, wireframe: true });
const materialOwners = new Map();
let visualization = 'shaded';
const artifactId = new URLSearchParams(location.search).get('artifact');
const state = {
  yaw: 0.55, pitch: 0.28, distance: 3, radius: 1,
  pointerId: null, lastX: 0, lastY: 0, pivot: null, loaded: null,
  mixer: null, playing: false, previousFrame: 0, frame: 0, disposed: false, width: 0, height: 0
};
const controller = new AbortController();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070b');
const camera = new THREE.PerspectiveCamera(52, 1, 0.001, 100000);
let renderer = null;
const dracoLoader = new DRACOLoader().setDecoderPath('./vendor/draco/');

function setStatus(title, detail, error = false) {
  status.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'title';
  heading.textContent = title;
  const description = document.createElement('div');
  description.className = 'meta' + (error ? ' error' : '');
  description.textContent = detail || '';
  status.append(heading, description);
}

try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.5 : 2));
  metrics.drawn_pixel_ratio = renderer.getPixelRatio();
} catch (error) {
  setStatus('3D preview unavailable', 'WebGL could not initialize: ' + error.message, true);
}
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x303040, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(3, 4, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x82aaff, 1);
fill.position.set(-4, 1, -2);
scene.add(fill);

function clampCamera() {
  state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
  state.distance = Math.max(state.radius * 1.15, Math.min(state.radius * 12, state.distance));
}
function updateCamera() {
  clampCamera();
  camera.position.set(
    Math.sin(state.yaw) * Math.cos(state.pitch) * state.distance,
    Math.sin(state.pitch) * state.distance,
    Math.cos(state.yaw) * Math.cos(state.pitch) * state.distance
  );
  camera.lookAt(0, 0, 0);
}
function renderFrame(now) {
  state.frame = 0;
  if (!renderer || state.disposed || document.hidden) return;
  if (state.playing && state.mixer) {
    state.mixer.update(state.previousFrame ? Math.min((now - state.previousFrame) / 1000, 0.05) : 0);
    state.previousFrame = now;
  }
  updateCamera();
  renderer.render(scene, camera);
  metrics.renders += 1;
  if (state.playing) requestRender();
}
function requestRender() {
  if (!renderer || state.disposed || state.frame || document.hidden) return;
  state.frame = requestAnimationFrame(renderFrame);
}
function resize() {
  if (!renderer || state.disposed) return;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  if (width === state.width && height === state.height) return;
  state.width = width; state.height = height;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  requestRender();
}
function resetCamera() {
  state.yaw = 0.55;
  state.pitch = 0.28;
  state.distance = state.radius * 3.2;
  requestRender();
}

// GLB-only and same-origin: an asset must never cause the inspector to request
// arbitrary external textures, buffers or models from a private workstation.
function verifySelfContainedGlb(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 20) throw new Error('Invalid GLB: missing header');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2 ||
      dv.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB header or length');
  const jsonLength = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || jsonLength + 20 > bytes.byteLength) {
    throw new Error('Invalid GLB JSON chunk');
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
  } catch (_) { throw new Error('Invalid GLB JSON content'); }
  for (const item of [...(data.buffers || []), ...(data.images || [])]) {
    if (typeof item.uri === 'string' && !item.uri.startsWith('data:')) {
      throw new Error('External GLB resources are not permitted in the private viewer');
    }
  }
  return data;
}
function disposeScene(root) {
  if (!root) return;
  const textures = new Set();
  const geometries = new Set();
  const materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value && value.isTexture) textures.add(value);
    }
  });
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) {
    const data = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close();
  }
}
function inspectNode(object, fallbackName) {
  if (selectionOutline) {
    scene.remove(selectionOutline);
    selectionOutline.geometry.dispose();
    selectionOutline.material.dispose();
    selectionOutline = null;
  }
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  selectedLabel.textContent = (object.name || fallbackName || object.type) +
    ' · ' + object.type +
    (bounds.isEmpty() ? '' : ' · bounds ' + size.x.toFixed(3) + ' × ' + size.y.toFixed(3) + ' × ' + size.z.toFixed(3)) +
    (material ? ' · ' + (material.name || material.type) +
      (Number.isFinite(material.roughness) ? ' · roughness ' + material.roughness.toFixed(2) : '') +
      (Number.isFinite(material.metalness) ? ' · metalness ' + material.metalness.toFixed(2) : '') : '');
  if (!bounds.isEmpty()) {
    selectionOutline = new THREE.BoxHelper(object, 0xf8bb65);
    scene.add(selectionOutline);
  }
  requestRender();
}
function showSceneStructure(model) {
  structure.replaceChildren();
  let count = 0;
  const list = document.createElement('ul');
  model.traverse(object => {
    if (count >= 120) return;
    if (object === model || object.type === 'Bone') return;
    count++;
    const item = document.createElement('li');
    const depth = (() => { let level = 0, p = object.parent;
      while (p && p !== model) { level++; p = p.parent; }
      return level;
    })();
    item.style.marginLeft = Math.min(depth, 8) * 8 + 'px';
    const button = document.createElement('button');
    button.type = 'button';
    button.style.textAlign = 'left';
    button.style.maxWidth = '100%';
    button.style.overflowWrap = 'anywhere';
    button.textContent = (object.isMesh ? 'Mesh ' : object.type + ' ') +
      (object.name || '#' + count) + (object.isMesh ? ' [material: ' +
      (Array.isArray(object.material) ? 'multiple' : object.material?.name || object.material?.type || 'none') + ']' : '');
    button.addEventListener('click', () => inspectNode(object, '#' + count));
    item.append(button);
    list.appendChild(item);
  });
  structure.appendChild(list);
  if (count >= 120) structure.append('Showing first 120 nodes.');
}
function setVisualMode(mode) {
  visualization = mode;
  if (state.loaded) state.loaded.traverse(object => {
    if (!object.isMesh) return;
    if (!materialOwners.has(object)) materialOwners.set(object, object.material);
    object.material = mode === 'normals' ? normalMaterial :
      mode === 'wireframe' ? wireframeMaterial : materialOwners.get(object);
  });
  for (const option of ['shaded', 'wireframe', 'normals'])
    document.querySelector('#asset-' + option).setAttribute('aria-pressed', String(option === mode));
  requestRender();
}
function frameScene(model) {
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) throw new Error('GLB contains no displayable geometry');
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  state.radius = Math.max(size.length() * 0.5, 0.1);
  state.pivot = new THREE.Group();
  state.pivot.position.copy(center).multiplyScalar(-1);
  state.pivot.add(model);
  scene.add(state.pivot);
  camera.near = Math.max(state.radius / 1000, 0.00001);
  camera.far = Math.max(state.radius * 1000, 100);
  camera.updateProjectionMatrix();
  resetCamera();
}
async function waitForVisible() {
  if (!document.hidden) return;
  await new Promise((resolve, reject) => {
    const changed = () => {
      if (!document.hidden) { clean(); resolve(); }
    };
    const aborted = () => { clean(); reject(new DOMException('Viewer closed', 'AbortError')); };
    const clean = () => {
      document.removeEventListener('visibilitychange', changed);
      controller.signal.removeEventListener('abort', aborted);
    };
    document.addEventListener('visibilitychange', changed);
    controller.signal.addEventListener('abort', aborted, { once: true });
  });
}
async function loadAsset() {
  if (!renderer) return;
  if (!artifactId) throw new Error('Missing artifact query parameter');
  await waitForVisible();
  const started = performance.now();
  const response = await fetch('/api/media/' + encodeURIComponent(artifactId), { signal: controller.signal });
  if (!response.ok) throw new Error('Artifact request failed (' + response.status + ')');
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > 96 * 1024 * 1024) {
    setStatus('Large 3D model · confirmation required',
      'This GLB is ' + (declaredSize / 1024 / 1024).toFixed(1) +
      ' MiB. Rendering it may use substantial RAM/GPU memory. The original download is unaffected.');
    largeLoadButton.hidden = false;
    await new Promise((resolve, reject) => {
      const go = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new DOMException('Viewer closed', 'AbortError')); };
      const cleanup = () => {
        largeLoadButton.removeEventListener('click', go);
        controller.signal.removeEventListener('abort', abort);
        largeLoadButton.hidden = true;
      };
      largeLoadButton.addEventListener('click', go, { once: true });
      controller.signal.addEventListener('abort', abort, { once: true });
    });
  }
  const buffer = await response.arrayBuffer();
  metrics.transfer_ms = Math.round(performance.now() - started);
  const gltfJson = verifySelfContainedGlb(buffer);
  const extensions = Array.isArray(gltfJson.extensionsRequired) ? gltfJson.extensionsRequired : [];
  const unsupported = extensions.filter(name => ![
    'KHR_materials_unlit', 'KHR_materials_pbrSpecularGlossiness', 'KHR_materials_clearcoat',
    'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior',
    'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_iridescence',
    'KHR_materials_anisotropy', 'KHR_materials_emissive_strength',
    'KHR_texture_transform', 'KHR_lights_punctual', 'KHR_mesh_quantization',
    'EXT_meshopt_compression', 'KHR_draco_mesh_compression'
  ].includes(name));
  if (unsupported.length) throw new Error('GLB requires unavailable decoder/extensions: ' + unsupported.join(', '));
  const parsedAt = performance.now();
  // GLTFLoader preserves scene hierarchy, node transforms, all primitives,
  // authored normals, morph targets, skins and glTF PBR materials.
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(dracoLoader);
  const gltf = await loader.parseAsync(buffer, location.origin + '/');
  metrics.parse_ms = Math.round(performance.now() - parsedAt);
  if (state.disposed) {
    disposeScene(gltf.scene);
    return;
  }
  state.loaded = gltf.scene;
  frameScene(gltf.scene);
  showSceneStructure(gltf.scene);
  let meshes = 0, vertices = 0, triangles = 0;
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    meshes += 1;
    const geometry = object.geometry;
    vertices += geometry?.getAttribute('position')?.count || 0;
    triangles += geometry?.index ? Math.floor(geometry.index.count / 3) :
      Math.floor((geometry?.getAttribute('position')?.count || 0) / 3);
  });
  metrics.vertices = vertices;
  metrics.triangles = triangles;
  if (vertices > 750000 && renderer.getPixelRatio() > 1) {
    renderer.setPixelRatio(1);
    metrics.drawn_pixel_ratio = 1;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }
  if (gltf.animations.length) {
    state.mixer = new THREE.AnimationMixer(gltf.scene);
    activeClip = gltf.animations[0];
    state.mixer.clipAction(activeClip).play();
    state.playing = !reducedMotion;
    animationButton.hidden = false;
    animationButton.textContent = state.playing ? 'Pause animation' : 'Play animation';
    const label = document.querySelector('#asset-clip-label');
    label.hidden = false;
    clipSelect.replaceChildren();
    gltf.animations.forEach((clip, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = clip.name || 'Clip ' + (index + 1);
      clipSelect.append(option);
    });
    clipSelect.addEventListener('change', () => {
      state.mixer.stopAllAction();
      activeClip = gltf.animations[Number(clipSelect.value)];
      if (activeClip) state.mixer.clipAction(activeClip).play();
      state.previousFrame = 0;
      requestRender();
    });
  }
  setStatus('3D Asset · Complete scene',
    artifactId + ' · ' + meshes + ' meshes · ' + vertices.toLocaleString() +
    ' vertices · ' + triangles.toLocaleString() + ' triangles · ' +
    gltf.animations.length + ' animation clips');
  requestRender();
}
function releasePointer(event) {
  if (state.pointerId === null) return;
  if (event && event.pointerId !== state.pointerId) return;
  const id = state.pointerId;
  state.pointerId = null;
  if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
}
function dispose() {
  if (state.disposed) return;
  state.disposed = true;
  state.playing = false;
  controller.abort();
  if (state.frame) cancelAnimationFrame(state.frame);
  releasePointer();
  state.mixer?.stopAllAction();
  if (state.pivot) scene.remove(state.pivot);
  if (selectionOutline) {
    scene.remove(selectionOutline);
    selectionOutline.geometry.dispose();
    selectionOutline.material.dispose();
    selectionOutline = null;
  }
  // Restore the authored materials before disposing the model resource graph.
  if (state.loaded) state.loaded.traverse(object => {
    if (materialOwners.has(object)) object.material = materialOwners.get(object);
  });
  disposeScene(state.loaded);
  materialOwners.clear();
  dracoLoader.dispose();
  normalMaterial.dispose();
  wireframeMaterial.dispose();
  renderer?.dispose();
}
window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose, { once: true });
window.addEventListener('beforeunload', dispose, { once: true });
document.addEventListener('visibilitychange', () => {
  state.previousFrame = 0;
  if (!document.hidden) requestRender();
});
window.addEventListener('blur', () => releasePointer());
canvas.addEventListener('pointerdown', event => {
  if (state.pointerId !== null) return;
  state.pointerId = event.pointerId;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (state.pointerId !== event.pointerId) return;
  state.yaw -= (event.clientX - state.lastX) * 0.006;
  state.pitch -= (event.clientY - state.lastY) * 0.006;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  requestRender();
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(eventName, releasePointer);
}
canvas.addEventListener('wheel', event => {
  state.distance *= event.deltaY > 0 ? 1.08 : 0.92;
  event.preventDefault();
  requestRender();
}, { passive: false });
canvas.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (key === 'arrowleft') state.yaw -= 0.12;
  else if (key === 'arrowright') state.yaw += 0.12;
  else if (key === 'arrowup') state.pitch += 0.12;
  else if (key === 'arrowdown') state.pitch -= 0.12;
  else if (key === '+' || key === '=') state.distance *= 0.9;
  else if (key === '-' || key === '_') state.distance *= 1.1;
  else if (key === 'r') resetCamera();
  else if (key === 'f') document.documentElement.requestFullscreen?.();
  else return;
  event.preventDefault();
  requestRender();
});
for (const option of ['shaded', 'wireframe', 'normals'])
  document.querySelector('#asset-' + option).addEventListener('click', () => setVisualMode(option));
document.querySelector('#asset-reset').addEventListener('click', resetCamera);
document.querySelector('#asset-fullscreen').addEventListener('click',
  () => document.documentElement.requestFullscreen?.());
animationButton.addEventListener('click', () => {
  state.playing = !state.playing;
  state.previousFrame = 0;
  animationButton.textContent = state.playing ? 'Pause animation' : 'Play animation';
  requestRender();
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  state.playing = false;
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = 0;
  setStatus('3D preview paused', 'WebGL context lost. Reload the preview to restore it.', true);
});
resize();
loadAsset().catch(error => {
  if (!state.disposed && error.name !== 'AbortError') setStatus('3D preview unavailable', error.message, true);
});
