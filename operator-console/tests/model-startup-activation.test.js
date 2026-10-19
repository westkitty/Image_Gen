'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.join(__dirname, '..');
const component = fs.readFileSync(path.join(ROOT, 'public/dexdiffusion/component.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('startup preference restoration is explicitly UI-only while manual selection keeps activation', () => {
  assert.match(component, /onSelectTarget\(initial, \{ quiet: true, restoreOnly: true \}\)/);
  assert.match(component, /if \(!options\.restoreOnly && \(target\.backend \|\| 'sdcpp'\) !== 'mflux'\)/);
  assert.match(component, /localStorage\.setItem\('dex_target', id\)/);
  assert.match(component, /await this\.onSelectTarget\(id, \{ preserveSettings: true \}\)/, 'validated user selection still invokes the normal activation path');
});

test('secondary activation rejects quarantine before acquiring or queuing a switch', () => {
  const route = server.slice(server.indexOf("app.post('/api/models/secondary/activate'"), server.indexOf("app.post('/api/actions/server-status'"));
  assert.match(route, /if \(lease\.quarantine\) return res\.status\(409\)/);
  assert.ok(route.indexOf('if (lease.quarantine)') < route.indexOf('arbiter.acquire('));
});
