import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const projectId = new URLSearchParams(location.search).get('project');
const state = document.querySelector('#splat-state');
const selector = document.querySelector('#splat-view');
const canvas = document.querySelector('#splat-canvas');
const reset = document.querySelector('#splat-reset');
const fused = document.querySelector('#splat-fused');
let renderer, scene, camera, spark, current, views = [], generation = 0, disposed = false;
let target = new THREE.Vector3(), radius = 4, theta = 0, phi = Math.PI/2;
let drag = false, lastX = 0, lastY = 0;
const updateStatus = (title, detail) => { state.textContent = title + (detail ? ' · ' + detail : ''); };
function updateCamera() {
  if (!camera) return;
  const sin = Math.sin(phi);
  camera.position.set(target.x + radius * sin * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * sin * Math.cos(theta));
  camera.lookAt(target);
}
function resize() {
  if (!renderer) return;
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  renderer.setSize(w,h,false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
async function selectView(index) {
  const view = views[index];
  if (!view || !/^\/api\/media\/[A-Za-z0-9._-]+$/.test(view.url || '')) return;
  const request = ++generation;
  updateStatus('Loading original Gaussian view ' + (index + 1) + '/' + views.length, 'Preserving scale, rotation, SH color and opacity');
  // Free the previous splat GPU buffers before loading the next large view.
  if (current) { scene.remove(current); current.dispose(); current = null; }
  selector.disabled = true;
  let next;
  try {
    next = new SplatMesh({ url: view.url, onProgress: e => {
      if (request !== generation || !e.lengthComputable) return;
      updateStatus('Loading view ' + (index + 1) + '/' + views.length, Math.round(100 * e.loaded / Math.max(1,e.total)) + '% downloaded');
    }});
    await next.initialized;
    if (disposed || request !== generation) { next.dispose(); return; }
    current = next;
    scene.add(next);
    // Fit to source centers; do not synthesize cross-view registration.
    const box = next.getBoundingBox(true);
    if (box && !box.isEmpty() && Number.isFinite(box.min.x+box.min.y+box.min.z+box.max.x+box.max.y+box.max.z)) {
      box.getCenter(target);
      const size = box.getSize(new THREE.Vector3());
      radius = Math.max(1.25, Math.min(250, size.length() * 1.4));
    } else { target.set(0,0,0); radius=4; }
    theta=0; phi=Math.PI/2; updateCamera();
    const count = next.splats?.getNumSplats?.() || next.packedSplats?.numSplats || 0;
    updateStatus('Original Gaussian view ' + (index + 1) + '/' + views.length, count ? count.toLocaleString() + ' splats · real Gaussian rendering' : 'Gaussian rendering ready');
  } catch (error) {
    if (next && next !== current) try { next.dispose(); } catch (_) {}
    if (request === generation) updateStatus('Gaussian view unavailable', String(error?.message || error).slice(0,160));
  } finally {
    if (!disposed && request === generation) selector.disabled = false;
  }
}
async function main() {
  if (!projectId || !/^wp-[a-zA-Z0-9-]{4,80}$/.test(projectId)) throw new Error('A valid saved World project is required');
  fused.href = './world-viewer.html?project=' + encodeURIComponent(projectId);
  const response=await fetch('/api/world/projects/' + encodeURIComponent(projectId), {cache:'no-store'});
  if (!response.ok) throw new Error('World project unavailable');
  const project=await response.json();
  views=Array.isArray(project.artifacts?.perViewSplats) ? project.artifacts.perViewSplats.filter(v=>v && /^\/api\/media\/[A-Za-z0-9._-]+$/.test(v.url || '')) : [];
  if (!views.length) throw new Error('No preserved SHARP Gaussian splats for this project');
  views.forEach((_,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent='View '+(i+1)+' / '+views.length;selector.appendChild(option);});
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));
  scene=new THREE.Scene();scene.background=new THREE.Color(0x05070b);
  camera=new THREE.PerspectiveCamera(62,1,0.01,1000);
  spark=new SparkRenderer({renderer});scene.add(spark);
  resize(); updateCamera();
  // A full page navigation releases the previous WebGL context before loading
  // another million-splat view. Avoid transient two-view GPU memory pressure.
  selector.onchange=()=>{
    const selected=Number(selector.value);
    if (!Number.isInteger(selected) || selected<0 || selected>=views.length) return;
    updateStatus('Switching Gaussian view', 'Releasing previous GPU resources');
    selector.disabled=true;
    location.assign('./world-gaussian-viewer.html?project='+encodeURIComponent(projectId)+'&view='+(selected+1));
  };
  reset.onclick=()=>{theta=0;phi=Math.PI/2;updateCamera();canvas.focus();};
  canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointerup',e=>{drag=false;try{canvas.releasePointerCapture(e.pointerId);}catch(_){}});
  canvas.addEventListener('pointercancel',()=>{drag=false;});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;theta-=(e.clientX-lastX)*0.006;phi=Math.max(0.08,Math.min(Math.PI-0.08,phi+(e.clientY-lastY)*0.006));lastX=e.clientX;lastY=e.clientY;updateCamera();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();radius=Math.max(0.1,Math.min(1000,radius*Math.exp(e.deltaY*0.001)));updateCamera();},{passive:false});
  canvas.addEventListener('keydown',e=>{const speed=radius*0.03;if(e.key==='w')target.z-=speed;if(e.key==='s')target.z+=speed;if(e.key==='a')target.x-=speed;if(e.key==='d')target.x+=speed;if('wasd'.includes(e.key)){e.preventDefault();updateCamera();}});
  window.addEventListener('resize',resize);
  renderer.setAnimationLoop(()=>{if (!disposed) renderer.render(scene,camera);});
  const requested=Number(new URLSearchParams(location.search).get('view') || 1);
  const index=Number.isInteger(requested) && requested>=1 && requested<=views.length ? requested-1 : 0;
  selector.value=String(index);await selectView(index);
}
window.addEventListener('pagehide',()=>{disposed=true;generation++;if(renderer)renderer.setAnimationLoop(null);if(current)current.dispose();if(spark)spark.dispose?.();if(renderer)renderer.dispose();});
main().catch(err=>updateStatus('Gaussian viewer unavailable',String(err?.message||err).slice(0,180)));
