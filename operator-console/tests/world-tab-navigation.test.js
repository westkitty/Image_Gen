'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'dexdiffusion', 'index.html'), 'utf8');
const component = fs.readFileSync(path.join(root, 'public', 'dexdiffusion', 'component.js'), 'utf8');
// The V2 chip row is rendered from the canonical 14-category registry (studio-nav.js), so destination
// assertions check that registry plus the single generated chip row instead of hand-written per-chip markup.
const Nav = require('../public/dexdiffusion/studio-nav.js');

test('World is a first-class navigation destination in all three workstation versions', () => {
  assert.ok(Nav.IDS.includes('world'), 'World is a canonical Studio destination');
  assert.equal(Nav.IDS.filter(id => id === 'world').length, 1);
  assert.equal((html.match(/data-tab="true"/g) || []).length, 1, 'the V2 chip row is rendered once from the registry');
  // V4 keeps its own rail; the two shells never share a duplicate row.
  const rails = html.match(/data-rail="true" data-active="{{ isWorldStr }}" onClick="{{ navWorld }}" title="World"/g) || [];
  assert.equal(rails.length, 1);
  assert.match(component, /isWorldStr:/);
  assert.match(component, /navWorld:/);
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
  assert.ok(Nav.IDS.includes('3d'), '3D is its own canonical Studio destination');
  assert.equal(Nav.CATEGORIES.find(c => c.id === '3d').label, '3D');
  assert.equal((html.match(/data-rail="true" data-active="{{ is3dStr }}" onClick="{{ nav3d }}" title="3D"/g) || []).length, 1);
  assert.equal((html.match(/value="{{ is3d }}"/g) || []).length, 3);
  assert.match(component, /asset3dWorkspace:\s*this\.buildAsset3dWorkspace\(\)/);
  assert.match(component, /this\.startAsset3d\('mesh'\)/);
  assert.match(component, /PBR: disabled/);
});
