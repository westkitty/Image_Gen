'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const N = require('../public/dexdiffusion/network-tokens.js');

test('scan: weights, default weight, offsets', () => {
  const r = N.scanNetworkTokens('a cat <lora:fluffy:0.8> and <lora:sharp> <LORA:Big_One:-0.5>');
  assert.equal(r.issues.length, 0);
  assert.deepEqual(r.tokens.map(t => [t.name, t.weight, t.explicitWeight]), [['fluffy', 0.8, true], ['sharp', 1, false], ['Big_One', -0.5, true]]);
  assert.equal(r.tokens[0].raw, '<lora:fluffy:0.8>');
});

test('scan: every case the engine would silently mishandle is an explicit issue', () => {
  const bad = {
    '<lora:x:abc>': /not a number/,
    '<lora:x:0.5:0.3>': /separate text-encoder/,
    '<lora::1>': /no lora name/,
    '<lyco:x:1>': /literal prompt text/,
    '<hypernet:x:1>': /literal prompt text/,
    'a <lora:x:1': /Unclosed/,
  };
  for (const [text, re] of Object.entries(bad)) { const r = N.scanNetworkTokens(text); assert.match(r.issues[0] && r.issues[0].message, re, text); assert.equal(r.tokens.length, 0, text); }
});

test('normalizeDefaultWeights only rewrites weightless lora tags', () => {
  assert.equal(N.normalizeDefaultWeights('<lora:a> x <lora:b:0.4> <lora:c>'), '<lora:a:1> x <lora:b:0.4> <lora:c:1>');
  assert.equal(N.normalizeDefaultWeights('plain (word:1.2) <b>'), 'plain (word:1.2) <b>');
  assert.equal(N.normalizeDefaultWeights('<lora:a:abc>'), '<lora:a:abc>', 'invalid tags are left for validation to refuse');
});

test('sd-cli regex contract: weightless tags are NOT matched by the engine, normalised ones are', () => {
  const engine = /<lora:([^:>]+):([^>]+)>/g; // copied from sd.cpp extract_and_remove_lora (rev 7f0e728)
  assert.equal([...'<lora:a>'.matchAll(engine)].length, 0);
  assert.equal([...N.normalizeDefaultWeights('<lora:a>').matchAll(engine)].length, 1);
});
