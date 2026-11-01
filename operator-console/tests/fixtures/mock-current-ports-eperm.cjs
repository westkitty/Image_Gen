'use strict';
// Test-only Node preloader; never imported by production. It faults one optional
// state-file read in an isolated child server without changing permissions.
const fs=require('node:fs');
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){
  if(process.env.DEX_TEST_ISOLATION==='1' && process.env.DEX_TEST_SIMULATE_PORTS_EPERM==='1'
    && typeof file==='string' && /(?:^|\/)current-ports\.env$/.test(file)) {
    const error=new Error('simulated optional configuration denial'); error.code='EPERM'; throw error;
  }
  return read.call(this,file,...args);
};
