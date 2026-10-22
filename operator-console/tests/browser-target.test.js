'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'browser');
const intentional = new Set(['concept-a-refinement.browser.js', 'interaction-matrix.browser.js',
  // These verify production first-run resolution, without seeding stored version.
  'studio-beginner.browser.js', 'studio-first-screen-shapes.browser.js']);
test('every product browser suite targets V2, with only named comparative and first-run exceptions', () => {
  for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.browser.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!source.includes('/dexdiffusion/')) continue;
    if (intentional.has(file)) {
      assert.match(source, /state\??\.version\s*===\s*2|installStudioProfile|dex_version.*4/s, file);
      continue;
    }
    assert.match(source, /openStudio\(page,/, file + ' must use the explicit V2 entry');
    assert.doesNotMatch(source, /await page\.goto\(/, file + ' bypasses the V2 entry');
    assert.doesNotMatch(source, /installDeveloperShellProfile|setVersion\(|data-vbtn|\.ca-shell|\.ca-primary|\.ca-nav-item/, file + ' contains a legacy product target');
  }
});
