import subprocess,pathlib,sys
root=pathlib.Path('/Users/andrew/Image_Gen');out=root/'output/final-recovery-20261022'
for name in ['form-stability','generate-hires','generate-sampling','prompt-language','interrupt','progressive-batch']:
 log=out/(name+'-profile-focused.log')
 with log.open('w') as f:r=subprocess.run(['node',str(root/'operator-console/tests/browser'/(name+'.browser.js'))],stdout=f,stderr=subprocess.STDOUT,timeout=610)
 s=log.read_text();fail=[x for x in s.splitlines() if '] FAIL ' in x];passed=sum('] PASS ' in x for x in s.splitlines())
 print(name,'exit',r.returncode,'pass',passed,'fail',len(fail),flush=True)
 if r.returncode or fail or not passed:print('\n'.join(s.splitlines()[-25:]),flush=True);sys.exit(1)
