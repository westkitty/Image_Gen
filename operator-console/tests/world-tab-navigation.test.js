'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'dexdiffusion', 'index.html'), 'utf8');
const component = fs.readFileSync(path.join(root, 'public', 'dexdiffusion', 'component.js'), 'utf8');

test('World is a first-class navigation destination in all three workstation versions', () => {
  assert.match(html, /data-active="{{ isWorldStr }}"[^>]*onClick="{{ navWorld }}"[^>]*>World<\/button>/);
  const topTabs = html.match(/data-tab="true" data-active="{{ isWorldStr }}" onClick="{{ navWorld }}"/g) || [];
  assert.equal(topTabs.length, 1);
  const rails = html.match(/data-rail="true" data-active="{{ isWorldStr }}" onClick="{{ navWorld }}" title="World"/g) || [];
  assert.equal(rails.length, 1);
  assert.doesNotMatch(html, />WorldGen<\/button>/);
});

test('World workspace exists in every workstation version', () => {
  const panes = html.match(/value="{{ isWorld }}"/g) || [];
  assert.equal(panes.length, 3);
  assert.match(component, /worldWorkspace:\s*this\.buildWorldWorkspace\(\)/);
});

test('World creation is owned by the World workspace rather than Library cards', () => {
  assert.doesNotMatch(component, /make3d:\s*\(\)\s*=>/);
  assert.doesNotMatch(component, /makeWorld:\s*\(\)\s*=>/);
  assert.match(component, /this\.startWorld\('quick3d'\)/);
  assert.match(component, /this\.startWorld\('complete360'\)/);
});
