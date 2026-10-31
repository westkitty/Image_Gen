/* Same-origin, classic WebGL panorama viewer for native WKWebView compatibility.
 * A generated ERP image supports rotation, NOT position/6DoF navigation.
 * Do not substitute the colored fused PLY for a verified spatial 360 world. */
(function () {
  'use strict';
  const canvas = document.getElementById('panorama-canvas');
  const status = document.getElementById('world-state');
  const pointLink = document.getElementById('world-points');
  const gaussianLink = document.getElementById('world-gaussian');
  const projectId = new URLSearchParams(location.search).get('project');
  const validMediaUrl = /^\/api\/media\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  let yaw = 0, pitch = 0, fov = 72, gl = null, program = null, buffer = null, texture = null;
  let dragging = false, lastX = 0, lastY = 0, ready = false, framePending = false;
  function message(label, detail, error) {
    status.textContent = label + (detail ? '\n' + detail : '');
    status.style.color = error ? '#fda4af' : '#9db4c9';
  }
  function shader(type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'WebGL shader failed');
    return sh;
  }
  function queueRender() {
    if (!ready || framePending) return;
    framePending = true;
    requestAnimationFrame(function () { framePending = false; render(); });
  }
  function render() {
    if (!gl || !ready) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'uPanorama'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uYaw'), yaw);
    gl.uniform1f(gl.getUniformLocation(program, 'uPitch'), pitch);
    gl.uniform1f(gl.getUniformLocation(program, 'uFov'), fov * Math.PI / 180);
    gl.uniform1f(gl.getUniformLocation(program, 'uAspect'), canvas.width / canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const attr = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function initialize(image) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true })
      || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL unavailable in this browser');
    const vertex = shader(gl.VERTEX_SHADER,
      'attribute vec2 aPosition; varying vec2 vPosition; void main(){vPosition=aPosition;gl_Position=vec4(aPosition,0.0,1.0);}');
    const fragment = shader(gl.FRAGMENT_SHADER,
      'precision highp float; varying vec2 vPosition; uniform sampler2D uPanorama; uniform float uYaw; uniform float uPitch; uniform float uFov; uniform float uAspect; const float PI=3.141592653589793; void main(){' +
      'float t=tan(uFov*0.5); float cy=cos(uYaw); float sy=sin(uYaw); float cp=cos(uPitch); float sp=sin(uPitch);' +
      'vec3 forward=vec3(sy*cp,sp,cy*cp); vec3 right=vec3(cy,0.0,-sy); vec3 up=vec3(-sy*sp,cp,-cy*sp);' +
      'vec3 ray=normalize(forward + right*(vPosition.x*uAspect*t) + up*(vPosition.y*t));' +
      'float lon=atan(ray.x,ray.z); float lat=asin(clamp(ray.y,-1.0,1.0));' +
      'vec2 uv=vec2(fract(0.5+lon/(2.0*PI)),clamp(0.5-lat/PI,0.001,0.999));' +
      'gl_FragColor=texture2D(uPanorama,uv); }');
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program failed');
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // HTML image top row maps to v=0 by default. The shader uses v=0 for north.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
    queueRender();
  }
  function reset() { yaw = 0; pitch = 0; fov = 72; queueRender(); }
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.focus();
  });
  canvas.addEventListener('pointerup', function (e) {
    dragging = false; if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointercancel', function () { dragging = false; });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.0045;
    pitch = Math.max(-1.49, Math.min(1.49, pitch + (e.clientY - lastY) * 0.0045));
    lastX = e.clientX; lastY = e.clientY; queueRender();
  });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault(); fov = Math.max(35, Math.min(96, fov + e.deltaY * 0.035)); queueRender();
  }, { passive: false });
  canvas.addEventListener('keydown', function (e) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') yaw -= 0.095;
    else if (k === 'arrowright') yaw += 0.095;
    else if (k === 'arrowup') pitch = Math.min(1.49, pitch + 0.095);
    else if (k === 'arrowdown') pitch = Math.max(-1.49, pitch - 0.095);
    else if (k === 'r') reset();
    else if (k === 'f') document.documentElement.requestFullscreen?.();
    else return;
    e.preventDefault(); queueRender();
  });
  document.getElementById('panorama-reset').onclick = reset;
  document.getElementById('panorama-fullscreen').onclick = function () { document.documentElement.requestFullscreen?.(); };
  window.addEventListener('resize', queueRender);
  window.addEventListener('pagehide', function () {
    ready = false;
    if (gl) { if (texture) gl.deleteTexture(texture); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); }
  });
  async function start() {
    if (!/^wp-[a-f0-9]{8}$/.test(String(projectId || ''))) throw new Error('No valid saved World project was specified');
    const response = await fetch('/api/world/projects/' + encodeURIComponent(projectId), { cache: 'no-store' });
    if (!response.ok) throw new Error('World project unavailable (' + response.status + ')');
    const project = await response.json();
    const artifacts = project.artifacts || {};
    const panorama = Array.isArray(artifacts.panorama) ? artifacts.panorama[0] : artifacts.panorama;
    const point = project.viewerArtifact || (Array.isArray(artifacts.coarseGeometry) ? artifacts.coarseGeometry[0] : artifacts.coarseGeometry);
    if (point && validMediaUrl.test(point.url || '')) {
      pointLink.href = './world-viewer.html?project=' + encodeURIComponent(projectId) + '&view=points';
      pointLink.hidden = false;
    }
    const splats = Array.isArray(artifacts.perViewSplats) ? artifacts.perViewSplats : [];
    if (splats.some(function (s) { return s && validMediaUrl.test(s.url || ''); })) {
      gaussianLink.href = './world-gaussian-viewer.html?project=' + encodeURIComponent(projectId);
      gaussianLink.hidden = false;
    }
    if (project.mode !== 'complete360' || !panorama || !/^\/api\/media\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(panorama.url || '')) {
      throw new Error('This project does not have a valid published 360° panorama. Use Point-cloud diagnostic if available.');
    }
    message('Loading generated 360° panorama', (project.status || 'UNVERIFIED') + ' quality · single viewpoint');
    const image = new Image();
    await new Promise(function (resolve, reject) {
      image.onload = resolve;
      image.onerror = function () { reject(new Error('Published panorama image could not load')); };
      image.src = panorama.url;
    });
    if (image.width !== image.height * 2 || image.width < 8) throw new Error('Panorama must be a 2:1 equirectangular image');
    initialize(image);
    message('Generated panorama ready · ' + image.width + ' × ' + image.height,
      '360° rotation only · spatial reconstruction: ' + (project.status || 'UNVERIFIED') + ' · no positional movement');
    // Read-only visibility is the goal here; do not mutate stored project state.
  }
  start().catch(function (err) { message('Panorama preview unavailable', String(err.message || err), true); });
}());
