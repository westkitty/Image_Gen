'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getWildcardCatalog, expandWildcards, extractWildcardTokens } = require('../wildcards');

test('wildcards: loads catalog with 15 He-Maker banks and provenance', () => {
  const catalog = getWildcardCatalog();
  assert(Array.isArray(catalog), 'catalog is an array');
  assert(catalog.length >= 15, `expected at least 15 wildcards, got ${catalog.length}`);

  const heMakerEntries = catalog.filter(c => c.source === 'he-maker');
  assert.equal(heMakerEntries.length, 15, `expected 15 He-Maker banks, got ${heMakerEntries.length}`);

  for (const entry of heMakerEntries) {
    assert(entry.count > 0, `${entry.name} has count > 0`);
    assert(entry.preview.length > 0, `${entry.name} has preview`);
    assert.equal(entry.provenance.source_repo, 'westkitty/He-Maker');
    assert.equal(entry.provenance.source_commit, '5904d101e1a4a64f0cf477328bd97edfc65d581b');
    assert(typeof entry.provenance.sha256 === 'string' && entry.provenance.sha256.length === 64);
  }
});

test('wildcards: case-insensitive matching resolves He-Maker banks', () => {
  const lowerPrompt = 'A scene of __bewaretheyokai__ in the night';
  const expandedLower = expandWildcards(lowerPrompt);
  assert.notEqual(expandedLower, lowerPrompt, 'lowercase token should expand');
  assert(!expandedLower.includes('__bewaretheyokai__'), 'token should be replaced');

  const camelPrompt = 'A scene of __BewareTheYokai__ in the night';
  const expandedCamel = expandWildcards(camelPrompt);
  assert.notEqual(expandedCamel, camelPrompt, 'camelcase token should expand');
  assert(!expandedCamel.includes('__BewareTheYokai__'), 'token should be replaced');
});

test('wildcards: unknown token is preserved literally', () => {
  const prompt = 'A test with __unknown_nonexistent_bank_12345__ in the text';
  const expanded = expandWildcards(prompt);
  assert.equal(expanded, prompt);
});

test('wildcards: extractWildcardTokens returns unique tokens', () => {
  const prompt = 'Hero with __colors__ wearing __colors__ near __BewareTheFey__';
  const tokens = extractWildcardTokens(prompt);
  assert.deepEqual(tokens, ['colors', 'BewareTheFey']);
});

test('wildcards: circular references terminate cleanly at maxDepth', () => {
  // Create a temporary directory with circular wildcards
  const tmpDir = fs.mkdtempSync(path.join(__dirname, 'wc-circ-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'loopA.txt'), '__loopB__');
    fs.writeFileSync(path.join(tmpDir, 'loopB.txt'), '__loopA__');

    const prompt = 'Test __loopA__';
    const expanded = expandWildcards(prompt, { wildcardsDir: tmpDir, maxDepth: 4 });
    // Should not crash or infinite loop, should terminate
    assert(typeof expanded === 'string');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
