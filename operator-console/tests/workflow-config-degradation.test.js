'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseKeyValue, readOptionalKeyValue, getWorkflowConfig } = require('../workflow-config');
const exception = code => Object.assign(new Error('permission or I/O denied'), { code });
test('KV parser retains established comments, quoted-value and override semantics', () => {
  assert.deepEqual(parseKeyValue('# comment\nMODEL="sd15.safetensors"\nPORT=31337\nBROKEN\n\n'), { MODEL:'sd15.safetensors',PORT:'31337' });
});
test('EPERM on the optional external-volume state file returns degraded but truthful config', () => {
  const readFile = p => {
    if (path.basename(p) === 'current-ports.env') throw exception('EPERM');
    if (path.basename(p) === 'sdcpp.env') return 'MODEL=sd15.safetensors\nLOCAL_TUNNEL_PORT=17870\n';
    throw exception('ENOENT');
  };
  const { values, warnings } = getWorkflowConfig('/fixture/config','/fixture/state',{readFile});
  assert.deepEqual(values,{MODEL:'sd15.safetensors', LOCAL_TUNNEL_PORT:'17870'});
  assert.deepEqual(warnings,[{file:'current-ports.env',state:'UNAVAILABLE',code:'EPERM'}]);
  assert.ok(!JSON.stringify(warnings).includes('/fixture/'),'do not disclose absolute filesystem paths');
});
test('EACCES on primary config is explicit and cannot falsely mark a fallback target as configured',()=>{
  const { values, warnings } = getWorkflowConfig('/fixture/config','/fixture/state',{readFile:p=>{
    if (path.basename(p)==='sdcpp.env') throw exception('EACCES');
    return 'LOCAL_TUNNEL_PORT=31337\n';
  }});
  assert.deepEqual(values,{LOCAL_TUNNEL_PORT:'31337'});
  assert.deepEqual(warnings,[{file:'sdcpp.env',state:'UNAVAILABLE',code:'EACCES'}]);
});
test('Absent optional file preserves normal no-warning default; arbitrary I/O failures do not silently disappear', () => {
  const warnings=[];
  assert.deepEqual(readOptionalKeyValue('/fixture/missing.env',warnings,()=>{throw exception('ENOENT');}),{});
  assert.deepEqual(warnings,[]);
  assert.throws(()=>readOptionalKeyValue('/fixture/failing.env',warnings,()=>{throw exception('EIO');}),{code:'EIO'});
});
