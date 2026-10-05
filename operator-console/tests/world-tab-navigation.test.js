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

test('3D asset generation is a separate tab with proven-mode gates', () => {
  assert.match(html, /data-active="{{ is3dStr }}" onClick="{{ nav3d }}"[^>]*>3D<\/button>/);
  assert.equal((html.match(/data-tab="true" data-active="{{ is3dStr }}" onClick="{{ nav3d }}"/g) || []).length, 1);
  assert.equal((html.match(/data-rail="true" data-active="{{ is3dStr }}" onClick="{{ nav3d }}" title="3D"/g) || []).length, 1);
  assert.equal((html.match(/value="{{ is3d }}"/g) || []).length, 3);
  assert.match(component, /asset3dWorkspace:\s*this\.buildAsset3dWorkspace\(\)/);
  assert.match(component, /this\.startAsset3d\('mesh'\)/);
  assert.match(component, /PBR: disabled/);
});
