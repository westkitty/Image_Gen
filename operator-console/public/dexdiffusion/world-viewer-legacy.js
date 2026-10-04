/* Classic-script fallback for browsers that reject ES-module entry points. */
(function () {
  'use strict';
  var canvas = document.getElementById('world-canvas');
  var status = document.getElementById('world-status');
  var projectId = new URLSearchParams(location.search).get('project');
  var state = { points: null, count: 0, yaw: 0, pitch: 0, position: [0, 0, 2.8], keys: {}, drag: false, x: 0, y: 0 };

  function esc(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function setStatus(title, detail, error) { status.innerHTML = '<div class="title">' + esc(title) + '</div><div class="meta' + (error ? ' error' : '') + '">' + esc(detail || '') + '</div>'; }
  function typeSize(type) { return /^(double|float)$/.test(type) ? 4 : /^(char|uchar|int8|uint8)$/.test(type) ? 1 : /^(short|ushort|int16|uint16)$/.test(type) ? 2 : 4; }
  function readNumber(view, offset, type) {
    if (/^(double|float)$/.test(type)) return view.getFloat32(offset, true);
    if (/^(char|int8)$/.test(type)) return view.getInt8(offset);
    if (/^(uchar|uint8)$/.test(type)) return view.getUint8(offset);
    if (/^(short|int16)$/.test(type)) return view.getInt16(offset, true);
    if (/^(ushort|uint16)$/.test(type)) return view.getUint16(offset, true);
    return view.getInt32(offset, true);
  }
  function parsePly(bytes) {
    var headBytes = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 131072));
    var header = new TextDecoder().decode(headBytes);
    var end = header.indexOf('end_header');
    if (end < 0) throw new Error('PLY header has no end_header marker');
    var dataStart = end + 'end_header'.length;
    while (dataStart < header.length && (header[dataStart] === '\n' || header[dataStart] === '\r')) dataStart++;
    var vertexMatch = /element vertex\s+(\d+)/.exec(header);
    if (!vertexMatch) throw new Error('PLY header has no vertex count');
    var count = Number(vertexMatch[1]);
    var lines = header.slice(0, end).split(/\r?\n/);
    var properties = [], inVertex = false, format = '';
    lines.forEach(function (line) {
      var f = line.trim().split(/\s+/);
      if (f[0] === 'format') format = f[1];
      if (f[0] === 'element') inVertex = f[1] === 'vertex';
      else if (inVertex && f[0] === 'property' && f[1] !== 'list') properties.push({ type: f[1], name: f[2] });
      else if (f[0] === 'element' && f[1] !== 'vertex') inVertex = false;
    });
    if (format !== 'binary_little_endian') throw new Error('unsupported PLY format: ' + format);
    var stride = properties.reduce(function (n, p) { return n + typeSize(p.type); }, 0);
    var fields = {}; properties.forEach(function (p, i) { fields[p.name] = { offset: properties.slice(0, i).reduce(function (n, q) { return n + typeSize(q.type); }, 0), type: p.type }; });
    if (!fields.x || !fields.y || !fields.z || !stride) throw new Error('PLY vertex position properties are incomplete');
    var view = new DataView(bytes, dataStart), max = 250000, step = Math.max(1, Math.ceil(count / max));
    var selected = Math.ceil(count / step), positions = new Float32Array(selected * 3), colors = new Float32Array(selected * 3), min = [Infinity, Infinity, Infinity], maxv = [-Infinity, -Infinity, -Infinity];
    var hasColor = fields.red && fields.green && fields.blue, cursor = 0, written = 0;
    for (var i = 0; i < count && dataStart + (i + 1) * stride <= bytes.byteLength; i += step) {
      var base = i * stride, x = readNumber(view, base + fields.x.offset, fields.x.type), y = readNumber(view, base + fields.y.offset, fields.y.type), z = readNumber(view, base + fields.z.offset, fields.z.type);
      if (!isFinite(x + y + z)) continue;
      positions[cursor] = x; positions[cursor + 1] = y; positions[cursor + 2] = z;
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z); maxv[0] = Math.max(maxv[0], x); maxv[1] = Math.max(maxv[1], y); maxv[2] = Math.max(maxv[2], z);
      if (hasColor) { colors[cursor] = readNumber(view, base + fields.red.offset, fields.red.type) / 255; colors[cursor + 1] = readNumber(view, base + fields.green.offset, fields.green.type) / 255; colors[cursor + 2] = readNumber(view, base + fields.blue.offset, fields.blue.type) / 255; }
      else { colors[cursor] = 0.48; colors[cursor + 1] = 0.72; colors[cursor + 2] = 0.92; }
      cursor += 3; written++;
    }
    var cx = (min[0] + maxv[0]) / 2, cy = (min[1] + maxv[1]) / 2, cz = (min[2] + maxv[2]) / 2, scale = Math.max(maxv[0] - min[0], maxv[1] - min[1], maxv[2] - min[2]) || 1;
    for (var p = 0; p < written * 3; p += 3) { positions[p] = (positions[p] - cx) * 2 / scale; positions[p + 1] = (positions[p + 1] - cy) * 2 / scale; positions[p + 2] = (positions[p + 2] - cz) * 2 / scale; }
    return { positions: positions.slice(0, written * 3), colors: colors.slice(0, written * 3), count: written, sourceCount: count };
  }
  function perspective(fov, aspect, near, far) { var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); }
  function viewMatrix() { var cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch); return new Float32Array([cy, sy * sp, -sy * cp, 0, 0, cp, sp, 0, sy, -cy * sp, cy * cp, 0, -(cy * state.position[0] + sy * state.position[2]), -(sp * sy * state.position[0] + cp * state.position[1] - sp * cy * state.position[2]), sy * cp * state.position[0] - cy * cp * state.position[2], 1]); }
  function shader(gl, type, source) { var s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function startRenderer(data) {
    var gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');
    if (!gl) { setStatus('World artifact ready', 'PLY ' + data.sourceCount + ' vertices · WebGL is unavailable in this browser', true); return; }
    var program = gl.createProgram(); gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, 'attribute vec3 p; attribute vec3 c; uniform mat4 projection; uniform mat4 view; varying vec3 color; void main(){ gl_Position=projection*view*vec4(p,1.0); gl_PointSize=2.4; color=c; }')); gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying vec3 color; void main(){ vec2 q=gl_PointCoord-0.5; if(dot(q,q)>0.25) discard; gl_FragColor=vec4(color,1.0); }')); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW); var cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW); var pa = gl.getAttribLocation(program, 'p'), ca = gl.getAttribLocation(program, 'c'), projection = gl.getUniformLocation(program, 'projection'), view = gl.getUniformLocation(program, 'view');
    function frame() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.02, 0.03, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.enableVertexAttribArray(pa); gl.vertexAttribPointer(pa, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.enableVertexAttribArray(ca); gl.vertexAttribPointer(ca, 3, gl.FLOAT, false, 0, 0); gl.uniformMatrix4fv(projection, false, perspective(Math.PI / 3.2, innerWidth / innerHeight, 0.01, 100)); gl.uniformMatrix4fv(view, false, viewMatrix()); gl.drawArrays(gl.POINTS, 0, data.count); requestAnimationFrame(frame); }
    setStatus('Quick 3D World', 'PLY ' + data.sourceCount + ' vertices · displaying ' + data.count + ' points'); requestAnimationFrame(frame);
  }
  function reset() { state.position = [0, 0, 2.8]; state.yaw = 0; state.pitch = 0; }
  function move() { var speed = state.keys.shift ? 0.06 : 0.025, cy = Math.cos(state.yaw), sy = Math.sin(state.yaw); if (state.keys.w) { state.position[0] += sy * speed; state.position[2] -= cy * speed; } if (state.keys.s) { state.position[0] -= sy * speed; state.position[2] += cy * speed; } if (state.keys.a) { state.position[0] -= cy * speed; state.position[2] -= sy * speed; } if (state.keys.d) { state.position[0] += cy * speed; state.position[2] += sy * speed; } }
  window.addEventListener('keydown', function (e) { state.keys[e.key.toLowerCase()] = true; if (e.key.toLowerCase() === 'r') reset(); if (e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.(); }); window.addEventListener('keyup', function (e) { delete state.keys[e.key.toLowerCase()]; });
  canvas.addEventListener('pointerdown', function (e) { state.drag = true; state.x = e.clientX; state.y = e.clientY; canvas.setPointerCapture(e.pointerId); }); canvas.addEventListener('pointerup', function (e) { state.drag = false; canvas.releasePointerCapture?.(e.pointerId); }); canvas.addEventListener('pointermove', function (e) { if (!state.drag) return; state.yaw -= (e.clientX - state.x) * 0.004; state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch - (e.clientY - state.y) * 0.004)); state.x = e.clientX; state.y = e.clientY; }); document.getElementById('world-reset').onclick = reset; document.getElementById('world-fullscreen').onclick = function () { document.documentElement.requestFullscreen?.(); };
  async function load() { try { if (!projectId) throw new Error('Missing project query parameter'); var response = await fetch('/api/world/projects/' + encodeURIComponent(projectId)); var body = await response.json(); if (!response.ok) throw new Error(body.error || 'project request failed'); var artifact = Array.isArray(body.artifacts?.finalPly) ? body.artifacts.finalPly[0] : body.artifacts?.finalPly; if (!artifact?.url) throw new Error('World project has no final PLY artifact'); setStatus('Loading Quick 3D World', 'Downloading canonical PLY ' + (artifact.bytes || 'unknown') + ' bytes'); var parsed = parsePly(await (await fetch(artifact.url)).arrayBuffer()); startRenderer(parsed); fetch('/api/world/projects/' + encodeURIComponent(projectId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ viewerState: { opened: true, lastArtifactId: artifact.artifact_id } }) }).catch(function () {}); } catch (error) { setStatus('World Focus unavailable', error.message, true); } }
  load();
}());
