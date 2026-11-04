'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/dexdiffusion/prompt-chips.js');

test('segments split text from tokens, and joined text is the original', () => {
  const text = 'a fox, __colors__ and__moods__, (x:1.2)';
  const segs = C.parseSegments(text);
  assert.deepEqual(segs.filter(s => s.type === 'token').map(s => s.name), ['colors', 'moods']);
  assert.equal(segs.map(s => s.text || s.token).join(''), text);
  assert.deepEqual(C.parseSegments(''), []);
});

test('removing a token closes the gap it leaves and touches nothing else', () => {
  assert.equal(C.removeTokenAt('a, __x__, b', 0), 'a, b');
  assert.equal(C.removeTokenAt('__x__, b', 0), 'b');
  assert.equal(C.removeTokenAt('a, __x__', 0), 'a');
  assert.equal(C.removeTokenAt('a __x__ b', 0), 'a b');
  assert.equal(C.removeTokenAt('__x__', 0), '');
  assert.equal(C.removeTokenAt('__x__, __x__', 1), '__x__', 'the chosen occurrence, not the first');
  assert.equal(C.removeTokenAt('a', 3), 'a');
});

test('duplicating puts the copy right after the original', () => {
  assert.equal(C.duplicateTokenAt('a, __x__, b', 0), 'a, __x__, __x__, b');
  assert.equal(C.duplicateTokenAt('__x__', 0), '__x__, __x__');
});

test('moving a token keeps every other character and is a no-op on itself', () => {
  assert.equal(C.moveTokenTo('alpha, __x__', 0, 0), '__x__, alpha');
  assert.equal(C.moveTokenTo('__x__, alpha', 0, 12), 'alpha, __x__');
  assert.equal(C.moveTokenTo('a, __x__, b, __y__', 0, 18), 'a, b, __y__, __x__');
  assert.equal(C.moveTokenTo('a, __x__, b, __y__', 1, 0), '__y__, a, __x__, b');
  assert.equal(C.moveTokenTo('a, __x__', 0, 3), 'a, __x__');
  assert.equal(C.moveTokenTo('a, __x__', 0, 8), 'a, __x__');
});

test('swapping moves only the tokens; insert adds the separators a prompt needs', () => {
  assert.equal(C.swapTokens('one __a__ two __b__ three', 0, 1), 'one __b__ two __a__ three');
  assert.equal(C.swapTokens('__a__', 0, 1), '__a__');
  assert.equal(C.insertPiece('blurry', '__a__').text, 'blurry, __a__');
  assert.equal(C.insertPiece('', '__a__').text, '__a__');
  assert.equal(C.insertPiece('a b', '__x__', 2).text, 'a __x__, b');
});
