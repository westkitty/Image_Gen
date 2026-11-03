'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const cp=require('node:child_process');
const {promisify}=require('node:util');
const execFile=promisify(cp.execFile);
const source=fs.readFileSync(path.resolve(__dirname,'../../bin/dexdiffusion'),'utf8');
const start=source.indexOf('healthy() {'),end=source.indexOf('\ntailnet_url() {',start);
assert.ok(start>=0 && end>start);
const fragment=source.slice(start,end);

async function exercise(mode) {
  const server=http.createServer((req,res)=>{
    if(req.url!=='/dexdiffusion/'){res.writeHead(404);res.end();return;}
    const size=184781;
    res.setHeader('Content-Type','text/html');
    res.setHeader('Content-Length',size);
    if(mode==='truncated'){res.end('partial');return;}
    if(mode==='slow'){
      res.write(Buffer.alloc(32,'x'));
      setTimeout(()=>res.end(Buffer.alloc(size-32,'x')),2500);
      return;
    }
    res.end(Buffer.alloc(size,'x'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const shell=[
    'set -euo pipefail',
    'BASE=http://127.0.0.1:'+port,
    'LOCAL_URL="$BASE/dexdiffusion/"',
    'CONSOLE_DIR=/Users/bigmac/Image_Gen/operator-console',
    'STUDIO_HEALTH_TIMEOUT=6',
    'version_json(){ printf \x27%s\x27 \x27{"name":"Image_Gen Operator Console","cwd":"/Users/bigmac/Image_Gen/operator-console","pid":7748}\x27; }',
    'json_field(){ python3 -c \x27import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))\x27 "$1"; }',
    'hostname(){ echo bigmac; }',
    fragment,
    'healthy'
  ].join('\n');
  try {
    await execFile('/bin/bash',['-c',shell],{timeout:11000});
    return true;
  } catch(err) {
    if(err.killed) throw err;
    return false;
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
}

test('complete Studio response is considered healthy',async()=>{
  assert.equal(await exercise('normal'),true);
});
test('valid Studio transfer taking more than two seconds is still healthy',async()=>{
  assert.equal(await exercise('slow'),true);
});
test('HTTP 200 with incomplete Content-Length is not considered a healthy Studio',async()=>{
  assert.equal(await exercise('truncated'),false);
});
