#!/usr/bin/env python3
import os,sys,subprocess,pathlib,re,base64
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
mode=(root/'mode').read_text().strip() if (root/'mode').exists() else ''
if args and args[-1]=='bash -s':
    payload=sys.stdin.buffer.read()
    if (root/'mode').exists(): (root/'mode').unlink()
    request_match=re.search(rb"printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > \"\$D/request.json\"",payload)
    if request_match:
        import json,hashlib
        request=json.loads(base64.b64decode(request_match[1]))
        safe=[{'chars':len(it['text']),'sha256':hashlib.sha256(it['text'].encode()).hexdigest(),'quiet_tag': '[quietly]' in it['text'],'calm_tag':'[calmly]' in it['text']} for it in request.get('items',[])]
        with (root/'request-summaries').open('a') as f: f.write(json.dumps({'mode':mode or 'normal','items':safe})+'\n')
    with (root/'events').open('a') as f: f.write(mode+'\n')
    if mode=='skip-one-transport':
        (root/'mode').write_text('transport')
    if mode=='transport': sys.exit(255)
    if mode=='chunk':
        pat=rb"printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > \"\$D/driver.py\""
        m=re.search(pat,payload)
        if not m: sys.exit(91)
        source=base64.b64decode(m[1]).decode()
        anchor='        try:\n            if it.get("seed") is not None:'
        assert anchor in source
        source=source.replace(anchor,'        try:\n            if i == 1: raise RuntimeError("Rev18 controlled second-chunk fault")\n            if it.get("seed") is not None:',1)
        payload=payload[:m.start(1)]+base64.b64encode(source.encode())+payload[m.end(1):]
    sys.exit(subprocess.run(['/usr/bin/ssh']+args,input=payload).returncode)
if any('mktemp -d' in a for a in args):
    p=subprocess.run(['/usr/bin/ssh']+args,stdout=subprocess.PIPE)
    sys.stdout.buffer.write(p.stdout)
    for line in p.stdout.decode(errors='replace').splitlines():
        if line.startswith('DEXMEDIA_DIR='):
            with (root/'dirs').open('a') as f: f.write(line.split('=',1)[1]+'\n')
    sys.exit(p.returncode)
os.execv('/usr/bin/ssh',['/usr/bin/ssh']+args)
