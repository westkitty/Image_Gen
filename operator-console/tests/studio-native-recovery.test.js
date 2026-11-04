'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../public/dexdiffusion/component.js'), 'utf8');
const start = source.indexOf('  async pingBackend() {');
const end = source.indexOf('\n  // Map one /api/run-index item', start);
assert.ok(start >= 0 && end > start, 'pingBackend must remain independently testable');
const method = source.slice(start, end);

function harness() {
  const deliveries = [];
  const queue = [];
  const timers = new Map();
  let tick = 100000, id = 0, fetchCalls = 0;
  const sandbox = {
    AbortController,
    Date: { now: () => tick },
    setTimeout: (fn, ms) => { const token = ++id; timers.set(token, {fn, ms}); return token; },
    clearTimeout: token => { timers.delete(token); },
    fetch: () => {
      fetchCalls++;
      const next = queue.shift();
      if (typeof next === 'function') return next();
      if (next === 'fail') return Promise.reject(new Error('connection stalled'));
      if (next === 'invalid') return Promise.resolve({ok:true,json:async()=>({name:'Wrong process'})});
      return Promise.resolve({ok:true,json:async()=>({name:'Image_Gen Operator Console'})});
    },
    window: { __dexNativeWrapper:true, webkit:{messageHandlers:{dexRecovery:{postMessage: x=>deliveries.push(x)}}} }
  };
  const Component = vm.runInNewContext('(class RecoveryProbe {\n'+method+'\n})', sandbox);
  const c = new Component();
  Object.assign(c,{
    state:{backendUrl:'http://127.0.0.1:31337',backendOnline:null,backendHealth:'unknown'},
    _backendMounted:true,
    _pingGeneration:0,
    _pingController:null,
    _pingRetryTimer:null,
    _pingFailures:0,
    _nativeRecoveryRequested:false,
    _lastNativeRecoveryAt:-Infinity,
    probes:[],
    _recordConnectionProbe(probe){this.probes.push(probe);},
    setState(value){Object.assign(this.state,value);}
  });
  return {c,deliveries,queue,timers,advance:ms=>{tick+=ms;}, fetchCalls:()=>fetchCalls};
}

test('one failed check cannot trigger native restart, second confirmed failure may',async()=>{
  const h=harness();
  h.queue.push('fail','fail','fail');
  await h.c.pingBackend();
  assert.equal(h.c._pingFailures,1);
  assert.equal(h.c.state.backendOnline,null);
  assert.deepEqual(h.deliveries,[]);
  assert.equal(h.c.probes[0].ok,false);
  assert.equal(h.c.probes[0].error,'connection stalled','the failure reason is kept for the report');
  await h.c.pingBackend();
  assert.equal(h.c.state.backendOnline,false);
  assert.equal(h.c.state.backendHealth,'degraded');
  assert.deepEqual(h.deliveries,['backend-degraded']);
  await h.c.pingBackend();
  assert.equal(h.deliveries.length,1,'native recovery must not spam after a third failure');
});

test('successful probe clears degraded state while retaining a sixty-second recovery cooldown',async()=>{
  const h=harness();
  h.queue.push('fail','fail','success','fail','fail','fail','fail');
  await h.c.pingBackend();
  await h.c.pingBackend();
  assert.equal(h.deliveries.length,1);
  await h.c.pingBackend();
  assert.equal(h.c.state.backendOnline,true);
  assert.equal(h.c.state.backendHealth,'healthy');
  assert.equal(h.c._pingFailures,0);
  h.advance(20000);
  await h.c.pingBackend();
  await h.c.pingBackend();
  assert.equal(h.deliveries.length,1,'recovery cooldown survives temporary success');
  h.advance(61000);
  await h.c.pingBackend();
  await h.c.pingBackend();
  assert.equal(h.deliveries.length,2,'genuine later outage remains recoverable');
});

test('concurrent focus and timer events reuse one in-flight probe',async()=>{
  const h=harness();
  let settle;
  h.queue.push(() => new Promise(resolve => {settle=resolve;}));
  const pending=h.c.pingBackend();
  await h.c.pingBackend();
  assert.equal(h.fetchCalls(),1,'no redundant request or mid-flight abort');
  settle({ok:true,json:async()=>({name:'Image_Gen Operator Console'})});
  await pending;
  assert.equal(h.c.state.backendOnline,true);
  assert.equal(h.c._pingController,null);
});

test('unmount or superseded base cannot declare an outage or request recovery',async()=>{
  const h=harness();
  h.queue.push('fail');
  h.c._backendMounted=false;
  await h.c.pingBackend();
  assert.equal(h.fetchCalls(),0);
  assert.deepEqual(h.deliveries,[]);
});

test('native bridge is same-origin guarded and shell recovery still owns process signalling',()=>{
  const swift=fs.readFileSync(path.resolve(__dirname,'../../native/macos/Image_Gen/ImageGenApp.swift'),'utf8');
  const shell=fs.readFileSync(path.resolve(__dirname,'../../bin/dexdiffusion'),'utf8');
  assert.match(swift,/message\.frameInfo\.isMainFrame/);
  assert.match(swift,/origin\.host == "127\.0\.0\.1", origin\.port == 31337/);
  assert.match(swift,/lastNativeRecoveryAttempt/);
  assert.match(shell,/owned_ssh_tunnel_pid/);
  assert.match(shell,/STUDIO_HEALTH_TIMEOUT/);
});
