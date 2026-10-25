#!/usr/bin/env python3
"""GUI-session inference owner. Only fixed registry IDs cross this private socket."""
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path.home() / '.dexdiffusion-engine'
SOCKET = ROOT / 'engine.sock'
RUN_ID = re.compile(r'^20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80}$')
TERMINAL = {'complete', 'failed', 'cancelled'}
INTERPRETER_CHECK_INTERVAL = 20


def interpreter_snapshot(executable=None, script=None, realpath=os.path.realpath):
    """Capture the interpreter and script this process was launched from."""
    executable = sys.executable if executable is None else executable
    script = os.path.abspath(__file__) if script is None else script
    return {'executable': executable, 'real_executable': realpath(executable) if executable else '', 'script': script}


STARTUP_INTERPRETER = interpreter_snapshot()


def interpreter_problem(snapshot, exists=os.path.exists, realpath=os.path.realpath):
    """Return None while the launch interpreter/script remain on disk, else a reason.

    A Homebrew cleanup can delete the Cellar directory a running process executes
    from; macOS TCC then cannot attribute it and removable-volume reads fail.
    """
    executable, real = snapshot['executable'], snapshot['real_executable']
    if not executable or not exists(executable):
        return 'interpreter %s was removed' % (executable or '<unknown>')
    if not exists(real):
        return 'interpreter %s was removed' % real
    try:
        current = realpath(executable)
    except OSError:
        current = real
    if current != real:
        return 'interpreter %s was replaced by %s' % (real, current)
    if not exists(snapshot['script']):
        return 'worker script %s was removed' % snapshot['script']
    return None


def watch_interpreter(snapshot, active, exit_fn, interval=INTERPRETER_CHECK_INTERVAL,
                      exists=os.path.exists, realpath=os.path.realpath, sleep=time.sleep,
                      stopping=lambda: False, log=None):
    """Exit (status 0) once the launch interpreter is gone, never during a job.

    active() reports a running job; exit_fn(0) performs the clean shutdown and
    returns falsy if a job was admitted meanwhile, in which case watching resumes.
    Uses only already-imported modules: the deleted stdlib cannot be imported.
    """
    log = log or (lambda line: (sys.stderr.write(line + '\n'), sys.stderr.flush()))
    announced = False
    while not stopping():
        sleep(interval)
        if stopping():
            return False
        problem = interpreter_problem(snapshot, exists, realpath)
        if problem is None or active():
            continue
        if not announced:
            log('engine-worker: %s; restarting to adopt the current interpreter' % problem)
            announced = True
        if exit_fn(0):
            return True
    return False


def number(value, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('invalid numeric setting')
    if not lo <= value <= hi or (integer and int(value) != value):
        raise ValueError('numeric setting outside registry bounds')
    return value


def validate(req, registry):
    allowed = {'op', 'run_id', 'token', 'target', 'prompt', 'negative_prompt', 'width', 'height',
               'steps', 'seed', 'cfg', 'sampler', 'scheduler', 'loras', 'save_prompts', 'settings', 'batch_count', 'index'}
    if set(req) - allowed:
        raise ValueError('unknown fields; paths and commands are forbidden')
    if req.get('op') not in {'generate', 'status', 'cancel', 'result', 'ack', 'health', 'activate'}:
        raise ValueError('unknown operation')
    if req['op'] == 'health':
        return
    if not RUN_ID.fullmatch(req.get('run_id', '')) or not re.fullmatch(r'[a-f0-9]{64}', req.get('token', '')):
        raise ValueError('invalid job ownership')
    if req['op'] == 'activate':
        if req.get('target') not in registry['models'] or registry['models'][req['target']].get('backend') == 'mflux':
            raise ValueError('invalid secondary target')
        return
    if req['op'] != 'generate':
        if req['op'] == 'result':
            number(req.get('index',0),0,15,True)
        return
    spec = registry['models'].get(req.get('target'))
    if not spec:
        raise ValueError('unknown model ID')
    count=number(req.get('batch_count',1),1,16,True)
    if spec.get('backend') == 'mflux' and count != 1:
        raise ValueError('MFLUX batches remain sequential')
    for key in ('prompt', 'negative_prompt'):
        if not isinstance(req.get(key, ''), str) or len(req.get(key, '')) > 20000 or '\x00' in req.get(key, ''):
            raise ValueError('invalid prompt')
    if any(re.search(r'<(?:lora|lyco|embedding):', req.get(key,''), re.I) for key in ('prompt','negative_prompt')):
        raise ValueError('use structured registry adapter IDs')
    for key in ('width', 'height'):
        v = number(req.get(key), 64, spec.get('max' + key.title(), 2048), True)
        if v % 8:
            raise ValueError('dimensions must be multiples of eight')
    number(req.get('steps'), spec.get('minSteps', 1), spec.get('maxSteps', 150), True)
    number(req.get('seed'), 0, 4294967295-int(count)+1, True)
    number(req.get('cfg'), 0, 30)
    fixed_cfg=1 if spec.get('backend')=='mflux' else spec.get('fixedCfgScale')
    if fixed_cfg is not None and req['cfg'] != fixed_cfg:
        raise ValueError('model requires its fixed CFG')
    if (spec.get('backend')=='mflux' or spec.get('noNegativePrompt')) and req.get('negative_prompt','').strip():
        raise ValueError('model has no negative prompt')
    if req.get('sampler') not in registry['samplers'] or req.get('scheduler') not in registry['schedulers']:
        raise ValueError('unknown sampling recipe')
    if not isinstance(req.get('save_prompts', False), bool):
        raise ValueError('invalid prompt policy')
    settings = req.get('settings', {})
    if not isinstance(settings, dict) or set(settings) - {'clip_skip', 'tiling', 'eta', 'rng', 'vae_id',
        'backend', 'lora_apply_mode', 'hires_scale', 'hires_width', 'hires_height', 'hires_steps', 'hires_denoise', 'hires_upscaler'}:
        raise ValueError('unknown engine settings')
    for key, lo, hi, integer in [('clip_skip',1,12,True),('eta',0,2,False),('hires_scale',1.1,2,False),
        ('hires_width',64,2048,True),('hires_height',64,2048,True),('hires_steps',0,150,True),('hires_denoise',.05,.95,False)]:
        if key in settings:
            number(settings[key],lo,hi,integer)
    if 'tiling' in settings and not isinstance(settings['tiling'],bool):
        raise ValueError('invalid tiling')
    if 'eta' in settings and req['sampler'] not in ['euler_a','dpmpp2s_a','ddim_trailing','tcd','res_multistep','res_2s','er_sde']:
        raise ValueError('eta is unsupported by this sampler')
    if 'rng' in settings and settings['rng'] not in ['cuda','cpu','std_default']:
        raise ValueError('invalid RNG')
    if 'vae_id' in settings and settings['vae_id'] not in registry.get('vaes', {}):
        raise ValueError('unknown VAE ID')
    if settings.get('backend', 'MTL0') not in ['MTL0','cpu'] or settings.get('lora_apply_mode','at_runtime') not in ['at_runtime','immediately']:
        raise ValueError('invalid backend or application mode')
    if spec.get('backend') == 'mflux' and settings:
        raise ValueError('SDCPP settings cannot be applied to MFLUX')
    if any(k.startswith('hires_') for k in settings):
        scale = settings.get('hires_scale')
        w,h = settings.get('hires_width'),settings.get('hires_height')
        if scale is not None:
            if w is not None or h is not None or req['width']*scale > 2048 or req['height']*scale > 2048:
                raise ValueError('invalid hires dimensions')
        elif w is None or h is None or w%8 or h%8 or w<req['width'] or h<req['height']:
            raise ValueError('invalid hires dimensions')
        if settings.get('hires_upscaler','Latent') not in registry.get('hires_upscalers', []):
            raise ValueError('invalid hires upscaler')
    loras = req.get('loras', [])
    if not isinstance(loras, list) or len(loras) > 1:
        raise ValueError('one verified adapter per job')
    for adapter in loras:
        if not isinstance(adapter, dict) or set(adapter) != {'id', 'strength'}:
            raise ValueError('invalid adapter shape')
        policy = registry['adapters'].get(adapter['id'])
        if not policy or req['target'] not in policy['targets']:
            raise ValueError('incompatible adapter ID')
        if policy.get('backend') != 'mflux':
            candidates = [policy['production']] + policy.get('fallbacks', [])
            if not any(c['backend_override'] == settings.get('backend','MTL0') and c['lora_apply_mode'] == settings.get('lora_apply_mode','at_runtime') for c in candidates):
                raise ValueError('unverified adapter backend combination')
        bounds = policy.get('strength', {'min': -2, 'max': 2})
        number(adapter['strength'], bounds['min'], bounds['max'])
        for key, value in policy.get('recipe', {}).items():
            if req.get('cfg' if key == 'cfg_scale' else key) != value:
                raise ValueError('adapter requires its verified recipe')


def evidence_lines(lines, req, engine_prompt):
    # Engine dumps can include quoted or multiline text. Never retain either prompt,
    # including escaped fragments, even when it contains a diagnostic keyword.
    sensitive=[]
    for text in (engine_prompt,req.get('prompt',''),req.get('negative_prompt','')):
        for part in text.splitlines():
            if part:
                sensitive.extend([part,json.dumps(part,ensure_ascii=False)[1:-1]])
    return [line[:500] for line in lines if re.search(
        r'(using MTL0|backend.*MTL0|LoRA.*(appl|tensor)|lora.*(appl|tensor)|generate_image completed|Operation not permitted|failed to load|at_runtime)',line,re.I)
        and not re.search(r'(^|\s)(negative_)?prompt\s*:',line,re.I)
        and not any(part in line for part in sensitive)][-120:]


class Worker:
    def __init__(self, root=ROOT, external_probe=None, interpreter=None, interpreter_check=None):
        self.root = Path(root)
        self.interpreter = interpreter or STARTUP_INTERPRETER
        self.interpreter_check = interpreter_check or (lambda: interpreter_problem(self.interpreter))
        self.external_probe = external_probe or (lambda: subprocess.run(['/bin/ps','-axo','comm='],capture_output=True,text=True).stdout)
        self.registry = json.loads((self.root / 'registry.json').read_text())
        self.lock = threading.RLock()
        self.jobs = {}
        self.active = None
        self.stopping = False
        self.recovery_uncertain = []
        # A restart cannot inherit an untracked child: stop only recorded process groups.
        for receipt in (self.root / 'jobs').glob('*/result.json'):
            job = json.loads(receipt.read_text())
            if job['status'] not in TERMINAL or job.get('cleanup') is False:
                # Every child starts a new session, whose group ID equals its PID.
                # Command contains the unique private run directory; reject PID reuse.
                pgid = job.get('pgid')
                clean = True
                if pgid:
                    try:
                        os.killpg(pgid, 0)
                    except ProcessLookupError:
                        pass
                    else:
                        commands = subprocess.run(['/bin/ps', '-axo', 'pgid=,command='], capture_output=True, text=True).stdout
                        owned = any(line.split(None, 1)[0] == str(pgid) and str(receipt.parent / 'tmp') in line
                                    for line in commands.splitlines() if line.strip())
                        if owned:
                            os.killpg(pgid, signal.SIGKILL)
                            for _ in range(30):
                                try:
                                    os.killpg(pgid, 0)
                                except ProcessLookupError:
                                    break
                                time.sleep(.1)
                            else:
                                clean = False
                        else:
                            clean = False
                if clean:
                    shutil.rmtree(receipt.parent / 'tmp', ignore_errors=True)
                else:
                    self.recovery_uncertain.append(job['run_id'])
                job.update(status='failed', error='worker restarted during job', cleanup=clean)
                receipt.write_text(json.dumps(job))
            self.jobs[job['run_id']] = job

    def expire_results(self):
        while not self.stopping:
            with self.lock:
                for job in self.jobs.values():
                    if job['status'] in TERMINAL and time.time() - job.get('finished', job['started']) > 3600:
                        for output in (self.root / 'jobs' / job['run_id']).glob('output*.png'):
                            output.unlink(missing_ok=True)
                        if not job.get('expired'):
                            job['expired'] = True
                            self.save(job)
            time.sleep(10)

    def save(self, job):
        p = self.root / 'jobs' / job['run_id'] / 'result.json'
        tmp = p.with_suffix('.tmp')
        tmp.write_text(json.dumps(job, indent=2))
        os.replace(tmp, p)

    def public(self, job):
        return {k: v for k, v in job.items() if k not in {'token_hash'}}

    def request(self, req):
        validate(req, self.registry)
        with self.lock:
            if req['op'] == 'health':
                access = {}
                for key, name in self.registry['access_probe'].items():
                    try:
                        with open(os.path.expandvars(name), 'rb') as f:
                            f.read(1)
                        access[key] = True
                    except OSError as e:
                        access[key] = str(e)
                model_access = {}
                for key,spec in self.registry['models'].items():
                    try:
                        with open(os.path.expandvars(spec['path']),'rb') as f:
                            f.read(1)
                        model_access[key] = True
                    except OSError:
                        model_access[key] = False
                try:
                    secondary = json.loads((Path.home() / 'Library/Caches/DexDiffusion/secondary-model/current/state.json').read_text())
                except (OSError,ValueError):
                    secondary = {}
                return {'ok': True, 'models': model_access, 'secondary': secondary, 'pid': os.getpid(), 'uid': os.getuid(), 'active': self.active, 'access': access, 'recovery_uncertain': self.recovery_uncertain,
                        'interpreter_ok': self.interpreter_check() is None, 'interpreter_path': self.interpreter['executable']}
            run_id = req['run_id']
            digest = hashlib.sha256(req['token'].encode()).hexdigest()
            if req['op'] == 'activate':
                if self.active or self.recovery_uncertain:
                    raise ValueError('worker busy')
                source = str(Path(os.path.expandvars(self.registry['models'][req['target']]['path'])).resolve())
                with open(source,'rb') as f:
                    f.read(1)
                result = subprocess.run(['/bin/bash', str(self.root / 'sdcpp-secondary-slot.sh'),'activate',req['target'],source],
                    env={**os.environ,'DEX_SECONDARY_SLOT_REMOTE':'1'},check=True,capture_output=True,text=True,timeout=20)
                return {'ok': True, 'secondary': json.loads(result.stdout)}
            job = self.jobs.get(run_id)
            if job and job['token_hash'] != digest:
                raise ValueError('job ownership mismatch')
            if req['op'] == 'generate' and not job:
                if self.stopping or self.active or self.recovery_uncertain:
                    raise ValueError('worker busy; one heavy job is allowed')
                # Also refuse unrelated heavy image workers; console owns the wider resource lease.
                commands = self.external_probe()
                if any(Path(c.strip()).name in {'sd-cli', 'sd-server', 'mflux-generate-flux2'} for c in commands.splitlines()):
                    raise ValueError('another image engine is active')
                directory = self.root / 'jobs' / run_id
                directory.mkdir(mode=0o700)
                job = {'run_id': run_id, 'token_hash': digest, 'status': 'running', 'target': req['target'],
                       'started': time.time(), 'batch_count': req.get('batch_count',1), 'cleanup': False, 'deadline': time.time() + 1800}
                self.jobs[run_id] = job
                self.active = run_id
                self.save(job)
                threading.Thread(target=self.run, args=(job, dict(req)), daemon=True).start()
            if not job:
                raise ValueError('unknown owned job')
            if req['op'] == 'cancel' and job['status'] not in TERMINAL:
                job['cancel_requested'] = True
                self.save(job)
                if job.get('pgid'):
                    try:
                        os.killpg(job['pgid'], signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            if req['op'] == 'result':
                if job['status'] != 'complete' or job.get('acknowledged'):
                    raise ValueError('no pending result')
                index=int(req.get('index',0))
                if index >= job.get('batch_count',1):
                    raise ValueError('result index out of range')
                name='output.png' if job.get('batch_count',1)==1 else 'output-'+str(index)+'.png'
                data = (self.root / 'jobs' / run_id / name).read_bytes()
                details=job.get('images',[job])[index]
                return {'ok': True, **self.public(job), **details, 'png': base64.b64encode(data).decode()}
            if req['op'] == 'ack':
                if job['status'] not in TERMINAL:
                    raise ValueError('job is still active')
                for output in (self.root / 'jobs' / run_id).glob('output*.png'):
                    output.unlink(missing_ok=True)
                job['acknowledged'] = True
                self.save(job)
            return {'ok': True, **self.public(job)}

    def execute(self, args, tmp, job, env, log_name):
        gate = tmp / 'registered'
        gate.unlink(missing_ok=True)
        proc = None
        try:
            with (tmp / log_name).open('wb') as stream:
                with self.lock:
                    if job.get('cancel_requested'):
                        raise RuntimeError('cancelled before engine start')
                    proc = subprocess.Popen([sys.executable, str(self.root / 'engine-child.py'), str(tmp)],
                        stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT, env=env, start_new_session=True)
                    job['pgid'] = proc.pid
                    self.save(job)
                    proc.stdin.write((json.dumps(args) + '\n').encode())
                    proc.stdin.close()
                    gate.write_text('registered')
                while proc.poll() is None:
                    if job.get('cancel_requested') or time.time() > job['deadline']:
                        try:
                            os.killpg(proc.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            os.killpg(proc.pid, signal.SIGKILL)
                            proc.wait()
                    time.sleep(.2)
                return proc.returncode
        finally:
            if proc is not None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()

    def run(self, job, req):
        directory = self.root / 'jobs' / job['run_id']
        tmp = directory / 'tmp'
        tmp.mkdir(mode=0o700)
        try:
            spec = self.registry['models'][req['target']]
            model = os.path.expandvars(spec['path'])
            with open(model, 'rb') as f:
                f.read(1)
            job['model_read'] = True
            loras = req.get('loras', [])
            settings = req.get('settings', {})
            prompt = req['prompt']
            env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'}
            count=int(req.get('batch_count',1))
            output = tmp / ('output.png' if count==1 else 'output-b%02d.png')
            if spec.get('backend') == 'mflux':
                # Keep existing rsLoRA conversion/cache semantics, never duplicate original weights.
                mroot = Path.home() / 'Library/Caches/DexDiffusion/mflux'
                env.update(HF_HOME=str(mroot / 'cache/huggingface'), XDG_CACHE_HOME=str(mroot / 'cache/xdg'))
                args = [str(mroot / 'venv/bin/mflux-generate-flux2'), '--model', str(mroot / 'flux2-klein-4b-4bit'),
                        '--base-model', 'flux2-klein-4b']
                if loras:
                    derived = mroot / 'loras/pixelart_lora-rslora-r128-a64.safetensors'
                    convert_args = [str(mroot / 'venv/bin/python'), str(self.root / 'mflux-rslora-convert.py'),
                                    self.registry['adapters'][loras[0]['id']]['path'], str(derived)]
                    if self.execute(convert_args, tmp, job, env, 'convert.log') != 0:
                        raise RuntimeError('rsLoRA conversion verification failed')
                    args += ['--lora', str(derived), str(loras[0]['strength'])]
                args += ['--prompt', prompt, '--steps', str(req['steps']), '--seed', str(req['seed']),
                         '--width', str(req['width']), '--height', str(req['height']), '--output', str(output)]
            else:
                for adapter in loras:
                    p = self.registry['adapters'][adapter['id']]['path']
                    with open(p, 'rb') as f:
                        f.read(1)
                    prompt += '<lora:' + Path(p).stem + ':' + str(adapter['strength']) + '>'
                args = [self.registry['sdcli'], '-m', model, '-p', prompt, '-n', req.get('negative_prompt', ''),
                        '-W', str(req['width']), '-H', str(req['height']), '--steps', str(req['steps']),
                        '--cfg-scale', str(req['cfg']), '--sampling-method', self.registry['samplers'][req['sampler']],
                        '--scheduler', req['scheduler'], '--seed', str(req['seed']), '--backend', settings.get('backend','MTL0'),
                        '--diffusion-fa', '-o', str(output), '-v']
                if loras:
                    args += ['--lora-model-dir', self.registry['lora_root'], '--lora-apply-mode', settings.get('lora_apply_mode','at_runtime')]
                if count>1:
                    args += ['-b',str(count)]
                args += spec.get('engine_args', [])
                if spec.get('default_clip_skip') and 'clip_skip' not in settings:
                    args += ['--clip-skip',str(spec['default_clip_skip'])]
                args += ['--embd-dir','/Volumes/wc2tb/ImageGen/embeddings']
                mapping = {'clip_skip':'--clip-skip','eta':'--eta','rng':'--rng'}
                for key, flag in mapping.items():
                    if key in settings:
                        args += [flag,str(settings[key])]
                if settings.get('tiling'):
                    args += ['--vae-tiling']
                vae = self.registry.get('vaes', {}).get(settings.get('vae_id'))
                if vae:
                    args += ['--vae',os.path.expandvars(vae)]
                if any(k.startswith('hires_') for k in settings):
                    args += ['--hires']
                    for key, flag in {'hires_scale':'--hires-scale','hires_width':'--hires-width','hires_height':'--hires-height',
                        'hires_steps':'--hires-steps','hires_denoise':'--hires-denoising-strength','hires_upscaler':'--hires-upscaler'}.items():
                        if key in settings:
                            args += [flag,str(settings[key])]
            job['engine_started'] = time.time()
            rc = self.execute(args, tmp, job, env, 'engine.log')
            job['engine_finished'] = time.time()
            job['generation_seconds'] = round(job['engine_finished'] - job['engine_started'],3)
            log = tmp / 'engine.log'
            # Keep only non-prompt evidence; raw verbose logs are always ephemeral.
            lines = log.read_text(errors='replace').splitlines()
            job['evidence'] = evidence_lines(lines,req,prompt)
            job['engine_exit'] = rc
            if job.get('cancel_requested'):
                final_status = 'cancelled'
            elif rc != 0:
                raise RuntimeError('engine failed; see structured evidence')
            else:
                expected = [int(req['width'] * settings.get('hires_scale',1)), int(req['height'] * settings.get('hires_scale',1))]
                if 'hires_width' in settings:
                    expected = [settings['hires_width'],settings['hires_height']]
                images=[]
                for index in range(count):
                    source = output if count==1 else tmp / ('output-b%02d.png' % index)
                    check = subprocess.run([self.registry['image_python'], '-c',
                        'from PIL import Image,PngImagePlugin; import sys; i=Image.open(sys.argv[1]); i.load(); assert i.format=="PNG"; print(i.width,i.height); i.copy().save(sys.argv[1],pnginfo=PngImagePlugin.PngInfo()) if sys.argv[2]=="strip" else None', str(source), 'keep' if req.get('save_prompts') else 'strip'],
                        check=True,capture_output=True,text=True,timeout=30)
                    dimensions=[int(x) for x in check.stdout.split()]
                    if dimensions != expected:
                        raise RuntimeError('image dimension mismatch')
                    data=source.read_bytes()
                    images.append(dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),dimensions=dimensions))
                    destination=directory / ('output.png' if count==1 else 'output-'+str(index)+'.png')
                    os.replace(source,destination)
                job.update(images=images,**images[0])
                final_status='complete'
        except Exception as e:
            final_status = 'cancelled' if job.get('cancel_requested') else 'failed'
            job['error'] = str(e)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            with self.lock:
                if job.get('cancel_requested') and final_status == 'complete':
                    final_status = 'cancelled'
                if final_status != 'complete':
                    for output in directory.glob('output*.png'):
                        output.unlink(missing_ok=True)
                job.update(status=final_status, cleanup=not tmp.exists(), finished=time.time())
                self.save(job)
                self.active = None


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        # Same-user peer check in addition to filesystem permissions (macOS getpeereid).
        if hasattr(self.connection, 'getpeereid') and self.connection.getpeereid()[0] != os.getuid():
            return
        try:
            raw = self.rfile.readline(131073)
            if len(raw) > 131072:
                raise ValueError('request too large')
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError('request must be an object')
            response = self.server.worker.request(req)
        except Exception as e:
            response = {'ok': False, 'error': str(e)}
        try:
            self.wfile.write(json.dumps(response).encode() + b'\n')
        except (BrokenPipeError, ConnectionResetError):
            pass  # The persisted owned job is independent of the transport.


def client():
    req = sys.stdin.buffer.readline(131073)
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(20)
        s.connect(str(SOCKET))
        s.sendall(req)
        with s.makefile('rb') as f:
            response = f.readline(64 * 1024 * 1024)
        sys.stdout.buffer.write(response)


def serve():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if ROOT.is_symlink() or ROOT.stat().st_uid != os.getuid():
        raise RuntimeError('unsafe worker directory')
    os.chmod(ROOT, 0o700)
    lockfile = (ROOT / 'worker.lock').open('a')
    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    (ROOT / 'jobs').mkdir(mode=0o700, exist_ok=True)
    SOCKET.unlink(missing_ok=True)
    worker = Worker(ROOT)
    threading.Thread(target=worker.expire_results, daemon=True).start()
    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True
    with Server(str(SOCKET), Handler) as server:
        server.worker = worker
        os.chmod(SOCKET, 0o600)
        def stop(signum, frame):
            worker.stopping = True
            for job in worker.jobs.values():
                if job['status'] not in TERMINAL:
                    job['cancel_requested'] = True
            threading.Thread(target=server.shutdown, daemon=True).start()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        restart = []
        def restart_when_idle(code):
            # Claim idleness under the admission lock; `stopping` rejects new jobs.
            with worker.lock:
                if worker.active:
                    return False
                worker.stopping = True
                restart.append(code)
            threading.Thread(target=server.shutdown, daemon=True).start()
            return True
        threading.Thread(target=watch_interpreter, args=(worker.interpreter, lambda: worker.active is not None, restart_when_idle),
                         kwargs={'interval': INTERPRETER_CHECK_INTERVAL, 'stopping': lambda: worker.stopping}, daemon=True).start()
        server.serve_forever(poll_interval=0.2)
        deadline = time.time() + 10
        while worker.active and time.time() < deadline:
            time.sleep(0.1)
    SOCKET.unlink(missing_ok=True)
    if restart:
        lockfile.close()
        # launchd KeepAlive relaunches the host, which starts the current interpreter.
        sys.exit(restart[0])


if __name__ == '__main__':
    if sys.argv[1:] == ['client']:
        try:
            client()
        except Exception as e:
            print(json.dumps({'ok': False, 'error': 'Local engine unavailable: ' + str(e) + '. Restart the Big Mac worker in its authorized graphical session.'}))
            sys.exit(1)
    elif sys.argv[1:] == ['serve']:
        serve()
    else:
        sys.exit('usage: engine-worker.py serve|client')
