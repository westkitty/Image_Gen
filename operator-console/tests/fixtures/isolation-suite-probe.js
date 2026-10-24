'use strict';
// Harness probe for tests/test-isolation.test.js (not a product suite): starts a suite server exactly as a browser suite
// does, then either sends the Phase 4C incident request with no fixture ("omit") or only reads ("read"). The harness must
// turn the omitted fixture into a failing exit code even though this script itself "passes".
const { startServer, runCleanups, isolationViolations } = require('../browser/helpers');
(async () => {
  const { base } = await startServer();
  if (process.argv[2] === 'omit') {
    const r = await fetch(base + '/api/models/secondary/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'sdxl-base' }) });
    console.log('PROBE_STATUS ' + r.status + ' ' + JSON.stringify(await r.json()));
  } else {
    const r = await fetch(base + '/api/capabilities');
    console.log('PROBE_STATUS ' + r.status);
  }
  console.log('PROBE_FATAL ' + isolationViolations().filter(v => v.fatal).length);
  process.exitCode = 0;   // the suite believes it passed
})().catch(e => { console.error(e.stack); process.exitCode = 2; }).finally(runCleanups);
