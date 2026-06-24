'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('declares the shared UI hint system', () => {
  assert.match(appJs, /const UI_HINTS\s*=\s*Object\.freeze\(/);
  assert.match(appJs, /const UI_PLACEHOLDERS\s*=\s*Object\.freeze\(/);
  assert.match(appJs, /function initUiHints\s*\(/);
  assert.match(appJs, /function applyUiHints\s*\(/);
});

test('includes tooltip styling and placeholder fallback styling', () => {
  assert.match(stylesCss, /\.ui-tooltip/);
  assert.match(stylesCss, /::placeholder/);
});

test('covers the requested create form placeholders and tooltip copy', () => {
  assert.match(indexHtml, /placeholder="Describe the image you want:/);
  assert.match(appJs, /#batch_prompt/);
  assert.match(appJs, /#negative_prompt[^]*avoid unwanted traits/);
  assert.match(appJs, /#negative_prompt[^]*what to avoid/);
});

test('covers the requested hint metadata for top-level controls', () => {
  for (const id of ['#btn-refresh-all', '#btn-reset-recommended', '#btn-random-seed', '#btn-load-library', '#btn-viewer-close']) {
    assert.match(appJs, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('covers system data-action buttons in the hint registry', () => {
  for (const action of ['verify', 'server-status', 'server-start', 'server-stop', 'seed-test', 'probe-image-edit', 'probe-upscale', 'discover-assets']) {
    assert.match(appJs, new RegExp(`\\[data-action="${action}"\\]`));
  }
});

test('covers library card and comparison affordances', () => {
  assert.match(appJs, /data-tooltip="Open image viewer\. Right-click for image actions\."/);
  assert.match(appJs, /data-tooltip="Select this controlled run for comparison\."/);
  assert.match(appJs, /data-tooltip="Open run metadata, images, and reuse actions\."/);
  assert.match(appJs, /data-tooltip="Send this run’s primary image to the Enhance upscale panel\."/);
  assert.match(appJs, /data-tooltip="Open this comparison image in the viewer\."/);
});

test('covers the generated aspect preset metadata', () => {
  assert.match(appJs, /Set output size to \$\{w\} by \$\{h\} pixels\./);
  assert.match(appJs, /Set aspect preset \$\{label\}, \$\{w\} by \$\{h\} pixels/);
});
