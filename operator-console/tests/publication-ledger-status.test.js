const test = require('node:test');
const assert = require('node:assert/strict');
const {createSystemInfo} = require('../system-info');
for (const [rows, expected] of [[null,'unknown'],[[],'unknown'],[[{state:'CANONICAL_VERIFIED'}],'verified'],[[{state:'PUBLICATION_PENDING'}],'pending'],[[{state:'PUBLICATION_BLOCKED'}],'blocked'],[[{state:'PUBLICATION_FAILED_RETRYABLE'}],'retryable']]) {
 test('publication ledger: '+expected+' '+JSON.stringify(rows), async () => {
 const info = createSystemInfo({getPublication:()=>rows, probes:{tailscale:async()=>({}),launcher:async()=>({installed:null,dockEntries:null})}});
 assert.equal((await info()).storage.publication, expected);
 });
}
