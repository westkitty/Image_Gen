"""Narrow scheduler deployment for the existing, idle DexDiffusion GUI worker."""
import datetime,hashlib,json,os,pathlib,secrets,socket,subprocess,time
root=pathlib.Path.home()/'.dexdiffusion-engine';sock=root/'engine.sock';reg=root/'registry.json'
assert str(root)=='/Users/bigmac/.dexdiffusion-engine' and os.getuid()==503
assert not root.is_symlink() and root.stat().st_uid==os.getuid()
def request(req):
 with socket.socket(socket.AF_UNIX) as s:
  s.settimeout(10);s.connect(str(sock));s.sendall(json.dumps(req).encode()+b'\n')
  return json.loads(s.makefile('rb').readline(1024*1024))
before=request({'op':'health'})
assert before.get('ok') and before['active'] is None and not before['recovery_uncertain'],before
service='gui/503/local.dexdiffusion.engine-worker'
launch=subprocess.run(['launchctl','print',service],capture_output=True,text=True,check=True).stdout
assert '/Users/bigmac/Applications/DexDiffusion Engine Worker.app/Contents/MacOS/DexDiffusionEngineHost' in launch
original=reg.read_bytes();data=json.loads(original)
assert 'kl_optimal' not in data['schedulers'],'already deployed; inspect effective worker before restarting'
assert data['schedulers']==['discrete','karras','exponential','ays','sgm_uniform','simple','smoothstep','lcm']
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=root/('registry-before-kl-optimal-'+stamp+'.json')
with backup.open('xb') as f:f.write(original)
os.chmod(backup,0o600)
assert backup.read_bytes()==original
assert reg.read_bytes()==original,'registry changed during preparation'
data['schedulers'].insert(data['schedulers'].index('smoothstep'),'kl_optimal')
staged=root/('registry-'+secrets.token_hex(8)+'.tmp')
with staged.open('x') as f:json.dump(data,f,indent=2);f.write('\n')
os.chmod(staged,0o600)
last=request({'op':'health'})
assert last.get('ok') and last['pid']==before['pid'] and last['active'] is None and not last['recovery_uncertain']
os.replace(staged,reg)
# Signal only the identified idle DexDiffusion host; its existing handler forwards
# TERM to its worker and KeepAlive restores the same signed host without a rebuild.
subprocess.run(['launchctl','kill','SIGTERM',service],check=True)
deadline=time.monotonic()+30
while time.monotonic()<deadline:
 try:
  after=request({'op':'health'})
  if after.get('ok') and after['pid']!=before['pid']:break
 except (OSError,ValueError):pass
 time.sleep(.3)
else:raise RuntimeError('worker did not recover; registry backup preserved at '+str(backup))
assert after['active'] is None and not after['recovery_uncertain']
assert all(after['models'].values()) and all(v is True for v in after['access'].values())
# A deliberately invalid prompt-policy type fails AFTER scheduler validation and
# BEFORE admission. This checks the running contract without creating a job.
results={}
for scheduler in ['karras','kl_optimal']:
 reply=request({'op':'generate','run_id':'20261022-000000-contract-probe-'+secrets.token_hex(4),'token':secrets.token_hex(32),'target':'sd15','prompt':'','negative_prompt':'','width':64,'height':64,'steps':1,'seed':1,'cfg':7,'sampler':'euler','scheduler':scheduler,'save_prompts':'invalid'})
 assert reply=={'ok':False,'error':'invalid prompt policy'},reply
 results[scheduler]=reply['error']
print('ENGINE_REGISTRY_REFRESH: '+json.dumps({'old_pid':before['pid'],'new_pid':after['pid'],'backup':str(backup),'before_sha256':hashlib.sha256(original).hexdigest(),'after_sha256':hashlib.sha256(reg.read_bytes()).hexdigest(),'effective_contract_probes':results,'active':after['active'],'models_readable':len(after['models']),'adapter_and_checkpoint_access':after['access']}))
print('ENGINE_REGISTRY_REFRESH_DONE')
