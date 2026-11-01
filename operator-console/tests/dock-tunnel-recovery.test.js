'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const source=fs.readFileSync(path.resolve(__dirname,'../../bin/dexdiffusion'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0 && b>a,start+'..'+end);return source.slice(a,b)}
const funcs=[between('owned_ssh_tunnel_pid() {','\n# Prints the pid'),between('owned_pid() {','\nhealthy() {'),between('cmd_start() {','\ncmd_stop() {')].join('\n');
function simulate({owner='ssh',backend=true,initial='stale'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-tunnel-recover-'));
 const script=`set -euo pipefail
PORT=31337; SSH_TARGET=westcat; PROBE_TIMEOUT=2; CONSOLE_DIR=/Users/andrew/Image_Gen/operator-console; PIDFILE='${dir}/pid'; LOG='${dir}/log'; BASE=http://127.0.0.1:31337; LOCAL_URL=http://127.0.0.1:31337/dexdiffusion/; DETACH_HELPER=/dev/null;
STATE=${initial}; OWNER=${owner}; BACKEND=${backend?'yes':'no'};
port_pid(){ if [ "$STATE" != none ]; then if [ "$STATE" = new ]; then echo 2222; else echo 1111; fi; fi; }
ps(){ if [ "$OWNER" = ssh ]; then printf 'ssh -f -N -o ExitOnForwardFailure=yes -L 31337:127.0.0.1:31337 westcat\\n'; else printf 'node /an/unrelated/server.js\\n'; fi; }
hostname(){ echo MacBook-Air; }
version_json(){ if [ "$STATE" = stale ]; then return 1; fi; echo '{"name":"Image_Gen Operator Console","cwd":"/Users/bigmac/Image_Gen/operator-console","pid":5432}'; }
json_field(){ python3 -c 'import json,sys;print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
healthy(){ [ "$STATE" = new ] || [ "$STATE" = healthy ]; }
bounded(){ [ "$BACKEND" = yes ]; }
kill(){ echo "SIGNAL:$1:$2"; [ "$OWNER" = ssh ] && [ "$2" = 1111 ] && [ "$1" = -TERM ]; STATE=none; }
ssh(){ echo "NEW_TUNNEL"; STATE=new; }
sleep(){ :; }
tailnet_url(){ return 1; }
${funcs}
cmd_start
`;
 try{const r=cp.spawnSync('/bin/bash',['-c',script],{encoding:'utf8',timeout:4500});return {code:r.status,output:r.stdout||'',error:r.stderr||''}}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Stale, exactly-owned SSH forwarding tunnel is recovered only with healthy remote',()=>{
 const x=simulate();assert.equal(x.code,0,x.error);assert.match(x.output,/SIGNAL:-TERM:1111/);assert.match(x.output,/NEW_TUNNEL/);assert.match(x.output,/connected to Big Mac backend/);
});
test('Unrelated listener is never signalled or replaced',()=>{
 const x=simulate({owner:'other'});assert.notEqual(x.code,0);assert.match(x.error,/not this checkout/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('Backend unreachable preserves even the correctly owned tunnel',()=>{
 const x=simulate({backend:false});assert.notEqual(x.code,0);assert.match(x.error,/backend unavailable; preserving/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('Healthy tunnel is reused without termination or reconnection',()=>{
 const x=simulate({initial:'healthy'});assert.equal(x.code,0,x.error);assert.match(x.output,/already connected to Big Mac/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
