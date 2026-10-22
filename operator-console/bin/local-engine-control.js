#!/usr/bin/env node
'use strict';
const { ownedRequest, readOwner } = require('../local-engine-client');
(async () => {
  const [mode, id] = process.argv.slice(2);
  if (!readOwner(id)) { process.exitCode = 3; return; }
  let state = await ownedRequest(id, mode === 'check' ? 'status' : 'cancel');
  if (mode !== 'check') {
    const deadline = Date.now() + 20000;
    while (!['complete','failed','cancelled'].includes(state.status) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300)); state = await ownedRequest(id, 'status');
    }
  }
  const alive = ['complete','failed','cancelled'].includes(state.status) && state.cleanup ? 0 : 1;
  console.log(mode === 'check' ? `REMOTE_CHECK: run=${id} alive=${alive}` : `REMOTE_CANCEL: found=1 killed=${1-alive} left=${alive}`);
  if (alive && mode !== 'check') process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
