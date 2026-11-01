'use strict';
// HTTP integration, isolated server: reproduce Big Mac's EPERM read without
// accessing or mutating the live external drive. Neither image jobs nor SSH run.
const assert=require('node:assert/strict');
const path=require('node:path');
const { startServer, runCleanups }=require('./helpers');
(async()=>{
 const savedOptions=process.env.NODE_OPTIONS;
 const savedFlag=process.env.DEX_TEST_SIMULATE_PORTS_EPERM;
 const preload=path.resolve(__dirname,'../fixtures/mock-current-ports-eperm.cjs');
 process.env.NODE_OPTIONS=(savedOptions||'')+' --require='+preload;
 process.env.DEX_TEST_SIMULATE_PORTS_EPERM='1';
 try{
   const server=await startServer();
   const response=await fetch(server.base+'/api/capabilities');
   assert.equal(response.status,200, 'optional state file denial must never fail the capabilities API');
   const body=await response.json();
   assert.equal(body.configuration?.degraded,true);
   assert.deepEqual(body.configuration.warnings,[{file:'current-ports.env',state:'UNAVAILABLE',code:'EPERM'}]);
   assert.ok(Array.isArray(body.modelTargets) && body.modelTargets.length>1,'existing model catalogue is preserved');
   assert.equal(typeof body.featureGates?.txt2img?.supported,'boolean');
   assert.ok(!JSON.stringify(body.configuration).includes('/Volumes/'),'no private storage path exposed');
   const v=await (await fetch(server.base+'/api/version')).json();
   assert.equal(v.testIsolation,true);
   console.log('PASS isolated capabilities HTTP EPERM: 200 + degraded warning + model catalogue, no external file touch');
   await server.stop();
 } finally {
   if(savedOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=savedOptions;
   if(savedFlag===undefined)delete process.env.DEX_TEST_SIMULATE_PORTS_EPERM;else process.env.DEX_TEST_SIMULATE_PORTS_EPERM=savedFlag;
   await runCleanups();
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
