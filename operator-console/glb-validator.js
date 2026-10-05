'use strict';

// Small, dependency-free binary glTF validator used at the remote and
// canonicalization boundaries. It proves content shape, not production quality.

const JSON_CHUNK = 0x4e4f534a; // JSON
const BIN_CHUNK = 0x004e4942; // BIN\0

function invalid(message) {
  throw new Error('output-invalid: GLB ' + message);
}

function validateGlb(input, { textured = false } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (bytes.length < 20) invalid('is truncated');
  if (bytes.toString('latin1', 0, 4) !== 'glTF') invalid('signature is missing');
  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  if (version !== 2) invalid('version is not 2');
  if (declaredLength !== bytes.length) invalid(`declared length ${declaredLength} differs from ${bytes.length}`);

  let offset = 12;
  let json = null;
  let binBytes = 0;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) invalid('chunk exceeds declared length');
    if (type === JSON_CHUNK) {
      try { json = JSON.parse(bytes.toString('utf8', start, end).replace(/\0+$/g, '').trim()); }
      catch (_) { invalid('JSON chunk is unreadable'); }
    } else if (type === BIN_CHUNK) {
      binBytes += length;
    }
    offset = end;
  }
  if (offset !== bytes.length) invalid('has an incomplete chunk header');
  if (!json) invalid('has no JSON chunk');
  if (!binBytes) invalid('has no binary buffer');
  if (!Array.isArray(json.scenes) || !json.scenes.length) invalid('has no scene');
  if (!Array.isArray(json.nodes) || !json.nodes.length) invalid('has no node');
  if (!Array.isArray(json.meshes) || !json.meshes.length) invalid('has no mesh');

  const primitives = json.meshes.flatMap(mesh => Array.isArray(mesh.primitives) ? mesh.primitives : []);
  if (!primitives.length) invalid('has no mesh primitive');
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  for (const accessor of accessors) {
    for (const value of [...(accessor.min || []), ...(accessor.max || [])]) {
      if (!Number.isFinite(value)) invalid('contains non-finite accessor bounds');
    }
  }
  const positionIndex = primitives.find(p => p.attributes && Number.isInteger(p.attributes.POSITION))?.attributes.POSITION;
  const position = Number.isInteger(positionIndex) ? accessors[positionIndex] : null;
  if (!position || !Number.isInteger(position.count) || position.count < 3) invalid('has no usable position accessor');
  if (!Array.isArray(position.min) || !Array.isArray(position.max) || position.min.length !== 3 || position.max.length !== 3) invalid('has no usable position bounds');
  if (position.min.every((value, i) => value === position.max[i])) invalid('has degenerate position bounds');

  const materials = Array.isArray(json.materials) ? json.materials : [];
  const textures = Array.isArray(json.textures) ? json.textures : [];
  const images = Array.isArray(json.images) ? json.images : [];
  if (textured && (!materials.length || !textures.length || !images.length)) invalid('textured output lacks material/texture/image data');

  return {
    valid: true,
    version,
    bytes: bytes.length,
    scenes: json.scenes.length,
    nodes: json.nodes.length,
    meshes: json.meshes.length,
    primitives: primitives.length,
    positionCount: position.count,
    bounds: { min: position.min, max: position.max },
    materials: materials.length,
    textures: textures.length,
    images: images.length,
    binBytes,
    textured: materials.length > 0 && textures.length > 0 && images.length > 0,
  };
}

module.exports = { validateGlb };
