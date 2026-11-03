'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const source=fs.readFileSync(path.resolve(__dirname,'../../bin/dexdiffusion'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0 && b>a,start+'..'+end);return source.slice(a,b)}
const funcs=[between('owned_ssh_tunnel_pid() {','\n# Prints the pid'),between('owned_pid() {','\nhealthy() {'),between('cmd_start_unlocked() {','\n# All callers (CLI, Dock app, and Retry)')].join('\n');
function simulate({owner='ssh',backend=true,initial='stale',sshMarker='DEX_SSH_REACHABLE',registeredUnhealthy=false,readyAfter=1}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-tunnel-recover-'));
 const script=`set -euo pipefail
PORT=31337; SSH_TARGET=westcat; PROBE_TIMEOUT=2; CONSOLE_DIR=/Users/andrew/Image_Gen/operator-console; PIDFILE='${dir}/pid'; LOG='${dir}/log'; BASE=http://127.0.0.1:31337; LOCAL_URL=http://127.0.0.1:31337/dexdiffusion/; DETACH_HELPER=/dev/null;
STATE=${initial}; OWNER=${owner}; BACKEND=${backend?'yes':'no'}; SSH_MARKER=${sshMarker}; REGISTERED_UNHEALTHY=${registeredUnhealthy?'yes':'no'}; READY_AFTER=${readyAfter}; READY_FILE='${dir}/ready-probes'; echo 0 > "$READY_FILE";
port_pid(){ if [ "$STATE" != none ]; then if [ "$STATE" = new ]; then echo 2222; else echo 1111; fi; fi; }
ps(){ if [[ "$*" == *"comm="* ]]; then echo ssh; elif [ "$OWNER" = ssh ]; then printf 'ssh -f -N -o ExitOnForwardFailure=yes -L 31337:127.0.0.1:31337 westcat\\n'; else printf 'node /an/unrelated/server.js\\n'; fi; }
hostname(){ echo MacBook-Air; }
version_json(){ local probes; probes="$(cat "$READY_FILE")"; if [ "$STATE" = stale ] && [ "$probes" -lt "$READY_AFTER" ]; then return 1; fi; echo '{"name":"Image_Gen Operator Console","cwd":"/Users/bigmac/Image_Gen/operator-console","pid":5432}'; }
json_field(){ python3 -c 'import json,sys;print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
healthy(){ local probes; probes="$(cat "$READY_FILE")"; [ "$STATE" = new ] || [ "$STATE" = healthy ] || { [ "$STATE" = stale ] && [ "$BACKEND" = yes ] && [ "$probes" -ge "$READY_AFTER" ]; }; }
recovery_remaining(){ echo 8; }
bounded_recovery(){ local t="$1"; shift; bounded "$t" "$@"; }
bounded(){ case "$*" in *DEX_SSH_REACHABLE*) [ -n "$SSH_MARKER" ] && echo "$SSH_MARKER"; return 0 ;; *install-backend-service.sh*) if [ "$REGISTERED_UNHEALTHY" = yes ]; then echo 'ERROR: service is registered but not API-ready; leaving the existing service untouched.'; return 8; fi; [ "$BACKEND" = yes ] && { echo SERVICE_READY; return 0; } ;; *DEX_BACKEND_READY*) local probes; probes="$(cat "$READY_FILE")"; probes=$((probes+1)); echo "$probes" > "$READY_FILE"; if [ "$BACKEND" = yes ] && [ "$probes" -ge "$READY_AFTER" ]; then echo DEX_BACKEND_READY; return 0; fi; return 1 ;; *) [ "$BACKEND" = yes ] ;; esac; }
kill(){ echo "SIGNAL:$1:$2"; [ "$OWNER" = ssh ] && [ "$2" = 1111 ] && [ "$1" = -TERM ]; STATE=none; }
ssh(){ echo "NEW_TUNNEL"; STATE=new; }
sleep(){ :; }
tailnet_url(){ return 1; }
${funcs}
cmd_start_unlocked
`;
 try{const r=cp.spawnSync('/bin/bash',['-c',script],{encoding:'utf8',timeout:4500});return {code:r.status,output:r.stdout||'',error:r.stderr||''}}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Stale upstream recovers the remote backend while preserving the healthy owned tunnel',()=>{
 const x=simulate();assert.equal(x.code,0,x.error);assert.match(x.output,/Big Mac backend recovered; existing SSH tunnel pid 1111 is healthy and preserved/);assert.match(x.output,/connected to Big Mac backend/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('Unrelated listener is never signalled or replaced',()=>{
 const x=simulate({owner:'other'});assert.notEqual(x.code,0);assert.match(x.error,/not this checkout/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('SSH exit zero without the exact reachability marker is not trusted',()=>{
 const x=simulate({sshMarker:''});assert.notEqual(x.code,0);assert.match(x.error,/SSH to Big Mac is unavailable or unverified/);assert.doesNotMatch(x.output,/NEW_TUNNEL|SIGNAL/);
});
test('Backend unreachable preserves even the correctly owned tunnel',()=>{
 const x=simulate({backend:false});assert.notEqual(x.code,0);assert.match(x.error,/service recovery was not confirmed.*preserving tunnel/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('DD-02 registered but unhealthy backend preserves the existing service and tunnel',()=>{
 const x=simulate({backend:false,registeredUnhealthy:true});assert.notEqual(x.code,0);
 assert.match(x.error,/preserving tunnel/);assert.match(x.error,/service is registered but not API-ready/);
 assert.doesNotMatch(x.output+x.error,/SIGNAL|NEW_TUNNEL|launchctl bootout|bootstrap/);
});
test('DD-03 slow legitimate backend startup progresses within the bounded readiness probes',()=>{
 const x=simulate({backend:true,readyAfter:4});assert.equal(x.code,0,x.error);
 assert.match(x.output,/Big Mac backend recovered/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});
test('Healthy tunnel is reused without termination or reconnection',()=>{
 const x=simulate({initial:'healthy'});assert.equal(x.code,0,x.error);assert.match(x.output,/already connected to Big Mac/);assert.doesNotMatch(x.output,/SIGNAL|NEW_TUNNEL/);
});

test('DD-04 PID reuse with a changed owner immediately before stop prevents signalling',()=>{
 const stop=between('cmd_stop() {','\ncase "${1:-status}" in');
 const script=`set -euo pipefail
calls=0
 owned_pid(){ if [ "$#" -eq 0 ]; then echo 1111; else return 1; fi; }
port_pid(){ echo 1111; }
owned_ssh_tunnel_pid(){ return 1; }
kill(){ echo "SIGNAL:$*"; }
${stop}
cmd_stop`;
 const out=cp.spawnSync('/bin/bash',['-c',script],{encoding:'utf8',timeout:3000});
 assert.equal(out.status,1,out.stderr);assert.match(out.stderr,/owner changed|ownership is no longer verifiable/);assert.doesNotMatch(out.stdout,/SIGNAL/);
});

test('DD-10 competing recovery callers serialize through the kernel lock and recheck after the first repair',async t=>{
 if(!fs.existsSync('/usr/bin/lockf')) return t.skip('macOS lockf is unavailable in this environment');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-lockf-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const helper=between('cmd_start() {','\ncmd_stop() {');
 const script=path.join(dir,'fixture.sh'), calls=path.join(dir,'calls');
 fs.writeFileSync(script,`#!/bin/bash\nset -euo pipefail\ncmd_start_unlocked(){ if [ -f "$HOME/Library/Caches/DexDiffusion/ready" ]; then echo REUSE >> '${calls}'; else echo START >> '${calls}'; sleep 0.4; touch "$HOME/Library/Caches/DexDiffusion/ready"; fi; }\n${helper}\nif [ "\${1:-}" = __locked-start ]; then cmd_start_unlocked; else cmd_start; fi\n`,{mode:0o700});
 const run=()=>new Promise(resolve=>{const child=cp.spawn('/bin/bash',[script,'run'],{env:{...process.env,HOME:dir,DEX_RECOVERY_DEADLINE:String(Math.floor(Date.now()/1000)+10)}});let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('close',code=>resolve({code,stderr}));});
 const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(x=>x.code),[0,0],results.map(x=>x.stderr).join('\n'));
 const rows=fs.readFileSync(calls,'utf8').trim().split(/\n/);assert.equal(rows.filter(x=>x==='START').length,1);assert.equal(rows.filter(x=>x==='REUSE').length,1);
});

test('launcher health uses Studio + identity, never optional capabilities endpoint',()=>{
  const fragment=source.slice(source.indexOf('healthy() {'),source.indexOf('\ntailnet_url() {'));
  assert.match(fragment,/version_json/);
  assert.match(fragment,/Image_Gen Operator Console/);
  assert.match(fragment,/\$LOCAL_URL/);
  assert.doesNotMatch(fragment,/api\/capabilities/);
  for(const {identity, studio,expectHealthy} of [
    {identity:'Image_Gen Operator Console',studio:true,expectHealthy:true},
    {identity:'Other application',studio:true,expectHealthy:false},
    {identity:'Image_Gen Operator Console',studio:false,expectHealthy:false},
  ]) {
    const cmd=`set -euo pipefail
       BASE=http://127.0.0.1:31337; LOCAL_URL="$BASE/dexdiffusion/"; CONSOLE_DIR=/Users/bigmac/Image_Gen/operator-console; STUDIO_HEALTH_TIMEOUT=12
       version_json(){ printf '{"name":"${identity}","cwd":"/Users/bigmac/Image_Gen/operator-console","pid":123}'; }
       json_field(){ python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
       curl(){ if [ "${studio?'yes':'no'}" = 'yes' ] && [[ "$*" == *'/dexdiffusion/'* ]]; then return 0; fi; return 1; }
       ${fragment}
       if healthy; then echo HEALTHY; else echo UNHEALTHY; fi`;
    const out=cp.spawnSync('/bin/bash',['-c',cmd],{encoding:'utf8',timeout:4000});
    assert.equal(out.status,0,out.stderr);
    assert.equal(out.stdout.trim(),expectHealthy?'HEALTHY':'UNHEALTHY');
  }
});
test('compressed tunnel is launched and recognised by the launcher and the recovery controller',()=>{
 const owned=between('owned_ssh_tunnel_pid() {','\n# Prints the pid');
 const run=cmd=>cp.spawnSync('/bin/bash',['-c',`set -euo pipefail\nPORT=31337; SSH_TARGET=westcat\nps(){ if [[ "$*" == *"comm="* ]]; then echo ssh; else printf '%s\\n' '${cmd}'; fi; }\n${owned}\nowned_ssh_tunnel_pid 1111`],{encoding:'utf8'}).status;
 assert.equal(run('ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o Compression=yes -L 31337:127.0.0.1:31337 westcat'),0);
 assert.equal(run('ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 31337:127.0.0.1:31337 westcat'),0);
 assert.notEqual(run('ssh -f -N -o Compression=yes -L 31337:127.0.0.1:31337 westcat'),0);
 assert.match(source,/ServerAliveCountMax=3 \\\n\s+-o Compression=yes -L "\$PORT:127\.0\.0\.1:31337" "\$SSH_TARGET"/);
 const controller=fs.readFileSync(path.resolve(__dirname,'../../scripts/dexdiffusion-recovery-controller.py'),'utf8');
 assert.match(controller,/"ServerAliveCountMax=3", "-o", "Compression=yes", "-L", "31337:127\.0\.0\.1:31337", REMOTE\]/);
 assert.match(controller,/argv\[1:\] in \(compressed, exact, legacy\)/);
});
