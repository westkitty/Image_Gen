'use strict';
// PR-23: keyboard prompt editing, behaviour pinned to javascript/edit-attention.js and edit-order.js at 82a973c0.
const test = require('node:test'), assert = require('node:assert/strict');
const A = require('../public/dexdiffusion/edit-attention.js');
const at = (text, caret, plus, end = caret) => A.editAttention(text, caret, end, plus);

test('word at the caret is wrapped and stepped by 0.1; stepping back to 1.0 removes the parentheses', () => {
  assert.deepEqual(at('a cat on a mat', 4, true), { text: 'a (cat:1.1) on a mat', selectionStart: 3, selectionEnd: 6 });
  assert.deepEqual(at('a (cat:1.1) on', 5, false), { text: 'a cat on', selectionStart: 2, selectionEnd: 5 });
  assert.equal(at('a (cat:1.1) on', 5, true).text, 'a (cat:1.2) on');
  assert.equal(at('(red hair:0.9)', 3, false).text, '(red hair:0.8)', 'the enclosing block is used, not just the word');
});

test('old-style ((emphasis)) and [de-emphasis] are converted to an explicit weight, then stepped', () => {
  assert.equal(at('((cat))', 3, true).text, '(cat:1.3)', '1.1^2 rounds to 1.2, then +0.1');
  assert.equal(at('[cat]', 2, false).text, '(cat:0.8)', '1/1.1 rounds to 0.9, then -0.1');
});

test('extra networks <name:w> step by 0.05; a selection is used as is; trailing spaces are not wrapped', () => {
  assert.equal(at('<lora:fox:0.8>', 4, true).text, '<lora:fox:0.85>');
  assert.equal(at('a big red fox', 2, true, 9).text, 'a (big red:1.1) fox');
  assert.equal(at('a big  red', 2, true, 7).text, 'a (big:1.1)  red');
  assert.equal(at('   ', 1, true), null, 'nothing to weight');
});

test('Alt+Left/Right moves comma-separated elements exactly as edit-order.js (spacing included)', () => {
  assert.deepEqual(A.editOrder('a, b, c', 4, 4, true), { text: ' b,a, c', selectionStart: 0, selectionEnd: 2 });
  assert.equal(A.editOrder('a, b, c', 4, 4, false).text, 'a, c, b');
  assert.equal(A.editOrder('a, b, c', 0, 0, true), null, 'first element cannot move left');
  assert.equal(A.editOrder('a, b, c', 6, 6, false), null, 'last element cannot move right');
});
