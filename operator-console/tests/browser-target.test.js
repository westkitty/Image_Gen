'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'browser');
const intentional = new Set(['concept-a-refinement.browser.js', 'interaction-matrix.browser.js',
  // Verifies production first-run resolution without seeding stored version.
  'studio-first-screen-shapes.browser.js']);
const viewerOnly = new Set(['omni-viewer-inspector.browser.js']);
test('every product browser suite targets V2, with only named comparative and first-run exceptions', () => {
  for (const file of fs.readdirSync(dir).filter(n => n.endsWith('.browser.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!source.includes('/dexdiffusion/')) continue;
    if (viewerOnly.has(file)) {
      // Standalone viewer regression runs against the actual direct media viewer,
      // not a Studio shell; require that the only direct navigation targets the
      // known bundled viewer path and keep all other shell routes protected.
      assert.match(source, /asset3d-viewer\.html/, file);
      assert.doesNotMatch(source, /studio-v[134]|installDeveloperShellProfile|setVersion\(/, file);
      continue;
    }
    if (intentional.has(file)) {
      assert.match(source, /state\??\.version\s*===\s*2|installStudioProfile|dex_version.*4/s, file);
      continue;
    }
    let checked = source;
    if (file === 'wildcard-placement.browser.js') {
      // One named comparative Concept A seed subtest exercises concept-a.js seed controls;
      // the rest of the suite must remain strictly V2.
      checked = source.replace(/,\s*installDeveloperShellProfile\b/, '')
        .replace(/await test\('Concept A seed:[\s\S]*?\n    \}\);/, '');
      assert.notEqual(checked, source, file + ' expected named Concept A seed subtest');
    }
    assert.match(checked, /openStudio\(page,/, file + ' must use the explicit V2 entry');
    // Standalone viewer pages (asset3d-viewer.html, world-viewer.html) are not the Studio shell; opening them directly is how they are
    // tested. Every other direct navigation is still a bypass of the explicit V2 entry.
    const withoutViewerPages = checked.replace(/await page\.goto\([^()]*-viewer\.html[^()]*\);/g, '');
    assert.doesNotMatch(withoutViewerPages, /await page\.goto\(/, file + ' bypasses the V2 entry');
    assert.doesNotMatch(checked, /installDeveloperShellProfile|setVersion\(|data-vbtn|\.ca-shell|\.ca-primary|\.ca-nav-item/, file + ' contains a legacy product target');
  }
});
