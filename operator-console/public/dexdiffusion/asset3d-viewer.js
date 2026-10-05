import * as THREE from './vendor/three.module.js';

const canvas = document.querySelector('#asset-canvas');
const status = document.querySelector('#asset-status');
const artifactId = new URLSearchParams(location.search).get('artifact');
const state = { yaw: 0.55, pitch: 0.28, distance: 3, dragging: false, lastX: 0, lastY: 0, object: null, radius: 1 };

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setStatus(title, detail, error = false) { status.innerHTML = `<div class="title">${escapeHtml(title)}</div><div class="meta${error ? ' error' : ''}">${escapeHtml(detail || '')}</div>`; }

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070b');
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.001, 1000);
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight, false); } catch (error) { setStatus('3D preview unavailable', `WebGL renderer unavailable: ${error.message}`, true); }
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x202030, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 4, 5); scene.add(key);
const fill = new THREE.DirectionalLight(0x82aaff, 1.1); fill.position.set(-4, 1, -2); scene.add(fill);

function componentInfo(type) { return { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[type] || 1; }
function typeInfo(componentType) { return { 5121: [1, DataView.prototype.getUint8], 5123: [2, DataView.prototype.getUint16], 5125: [4, DataView.prototype.getUint32], 5126: [4, DataView.prototype.getFloat32] }[componentType]; }
function readAccessor(json, bin, index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView], info = typeInfo(a.componentType);
  if (!a || !view || !info) throw new Error(`unsupported accessor ${index}`);
  const count = a.count * componentInfo(a.type), stride = view.byteStride || info[0] * componentInfo(a.type), base = (view.byteOffset || 0) + (a.byteOffset || 0), data = new (a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : a.componentType === 5123 ? Uint16Array : Uint8Array)(a.count * componentInfo(a.type));
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < componentInfo(a.type); c++) data[i * componentInfo(a.type) + c] = info[1].call(dv, base + i * stride + c * info[0], true);
  return { data, count, components: componentInfo(a.type) };
}
function chunkData(json, bin, image) {
  const view = json.bufferViews[image.bufferView];
  return new Uint8Array(bin.buffer, bin.byteOffset + (view.byteOffset || 0), view.byteLength);
}
function parseGlb(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer);
  if (bytes.length < 20 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'glTF' || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== bytes.length) throw new Error('invalid GLB header or length');
  let offset = 12, json = null, bin = null;
  while (offset + 8 <= bytes.length) { const length = dv.getUint32(offset, true), type = dv.getUint32(offset + 4, true), start = offset + 8; if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.slice(start, start + length)).replace(/\0+$/g, '').trim()); if (type === 0x004e4942) bin = bytes.slice(start, start + length); offset = start + length; }
  if (!json || !bin) throw new Error('GLB has no readable JSON and BIN chunks');
  return { json, bin };
}
async function loadAsset() {
  if (!artifactId) throw new Error('Missing artifact query parameter');
  const response = await fetch('/api/media/' + encodeURIComponent(artifactId));
  if (!response.ok) throw new Error(`artifact request failed (${response.status})`);
  const { json, bin } = parseGlb(await response.arrayBuffer());
  const primitive = json.meshes?.[0]?.primitives?.[0];
  if (!primitive) throw new Error('GLB has no mesh primitive');
  const geometry = new THREE.BufferGeometry();
  for (const [name, attr] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0']]) if (Number.isInteger(primitive.attributes?.[attr])) { const a = readAccessor(json, bin, primitive.attributes[attr]); geometry.setAttribute(name === 'uv' ? 'uv' : name, new THREE.BufferAttribute(a.data, a.components)); }
  if (Number.isInteger(primitive.indices)) { const a = readAccessor(json, bin, primitive.indices); geometry.setIndex(new THREE.BufferAttribute(a.data, 1)); }
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3()); state.radius = Math.max(geometry.boundingSphere?.radius || 1, 0.1); geometry.translate(-center.x, -center.y, -center.z);
  let map = null;
  const textureIndex = json.materials?.[primitive.material || 0]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const image = Number.isInteger(textureIndex) ? json.images?.[json.textures?.[textureIndex]?.source] : null;
  if (image?.bufferView != null) { const blob = new Blob([chunkData(json, bin, image)], { type: image.mimeType || 'image/png' }); map = await new THREE.TextureLoader().loadAsync(URL.createObjectURL(blob)); map.colorSpace = THREE.SRGBColorSpace; }
  const material = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0xa78bfa, roughness: .72, metalness: .08, side: THREE.DoubleSide });
  state.object = new THREE.Mesh(geometry, material); scene.add(state.object); state.distance = state.radius * 3.2;
  setStatus('3D Asset', `${artifactId} · ${geometry.attributes.position.count.toLocaleString()} vertices · ${map ? 'textured GLB' : 'GLB mesh'}`);
}
function resetCamera() { state.yaw = .55; state.pitch = .28; state.distance = state.radius * 3.2; }
function updateCamera() { camera.position.set(Math.sin(state.yaw) * Math.cos(state.pitch) * state.distance, Math.sin(state.pitch) * state.distance, Math.cos(state.yaw) * Math.cos(state.pitch) * state.distance); camera.lookAt(0, 0, 0); }
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer?.setSize(innerWidth, innerHeight, false); });
canvas.addEventListener('pointerdown', e => { state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', e => { state.dragging = false; canvas.releasePointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!state.dragging) return; state.yaw -= (e.clientX - state.lastX) * .006; state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - (e.clientY - state.lastY) * .006)); state.lastX = e.clientX; state.lastY = e.clientY; });
canvas.addEventListener('wheel', e => { state.distance = Math.max(state.radius * 1.15, Math.min(state.radius * 12, state.distance * (e.deltaY > 0 ? 1.08 : .92))); e.preventDefault(); }, { passive: false });
addEventListener('keydown', e => { if (e.key.toLowerCase() === 'r') resetCamera(); if (e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.(); });
document.querySelector('#asset-reset').addEventListener('click', resetCamera);
document.querySelector('#asset-fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
let last = performance.now(); function animate(now) { last = now; updateCamera(); renderer?.render(scene, camera); requestAnimationFrame(animate); }
loadAsset().catch(error => setStatus('3D preview unavailable', error.message, true));
if (renderer) requestAnimationFrame(animate);
