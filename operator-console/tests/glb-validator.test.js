'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateGlb } = require('../glb-validator');

function glb({ textured = false, declaredLength = null, min = [-1, -1, -1], max = [1, 1, 1] } = {}) {
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(textured ? { material: 0 } : {}) }] }],
    accessors: [{ count: 3, type: 'VEC3', componentType: 5126, min, max }],
  };
  const bin = Buffer.from('mesh-data');
  if (textured) {
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    json.textures = [{ source: 0 }];
    json.images = [{ bufferView: 0, mimeType: 'image/png' }];
    json.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: bin.length }];
  }
  const jsonBytes = Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, ' '));
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(declaredLength == null ? total : declaredLength, 8);
  jsonBytes.copy(out, 20); out.writeUInt32LE(jsonBytes.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = 20 + jsonBytes.length; out.writeUInt32LE(bin.length, binHeader); out.writeUInt32LE(0x004e4942, binHeader + 4); bin.copy(out, binHeader + 8);
  return out;
}

test('GLB validator proves binary structure and finite geometry', () => {
  const result = validateGlb(glb());
  assert.equal(result.valid, true);
  assert.equal(result.meshes, 1);
  assert.equal(result.positionCount, 3);
  assert.equal(result.textured, false);
});

test('GLB validator requires material, texture, and image for textured output', () => {
  const result = validateGlb(glb({ textured: true }), { textured: true });
  assert.equal(result.textured, true);
  assert.equal(result.images, 1);
  assert.throws(() => validateGlb(glb(), { textured: true }), /textured output/);
});

test('GLB validator rejects truncation, bad length, and degenerate bounds', () => {
  assert.throws(() => validateGlb(glb().subarray(0, 40)), /declared length|truncated|chunk/);
  assert.throws(() => validateGlb(glb({ declaredLength: 99 })), /declared length/);
  assert.throws(() => validateGlb(glb({ min: [1, 1, 1], max: [1, 1, 1] })), /degenerate/);
});
