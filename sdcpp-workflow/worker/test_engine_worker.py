"""Isolated protocol/lifecycle tests; fake engines are never live inference proof."""
import copy
import importlib.util
import json
import os
import shutil
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys
import socket
import subprocess

spec = importlib.util.spec_from_file_location('engine_worker', Path(__file__).with_name('engine-worker.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.registry = {
            'models': {'sdxl-base': {'maxSteps': 50}}, 'samplers': {'euler': 'euler'}, 'schedulers': ['sgm_uniform'],
            'adapters': {'sdxl_lightning_4step_lora': {'targets': ['sdxl-base'], 'production': {'backend_override':'MTL0','lora_apply_mode':'at_runtime'}, 'recipe': {'steps':4,'cfg_scale':0,'sampler':'euler','scheduler':'sgm_uniform'}}}}
        self.req = dict(op='generate', run_id='20261021-150000-test', token='a'*64, target='sdxl-base',
                        prompt='test', negative_prompt='', width=512,height=512,steps=4,seed=1,cfg=0,
                        sampler='euler',scheduler='sgm_uniform',loras=[{'id':'sdxl_lightning_4step_lora','strength':1}])

    def test_proven_recipe(self):
        m.validate(self.req,self.registry)

    def test_unknown_fields_and_paths(self):
        for key in ['command','executable','model_path','output','__proto__']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate({**self.req,key:'/tmp/evil'}, self.registry)

    def test_invalid_numeric_values(self):
        for key,value in [('width',513),('height',9000),('steps',-1),('seed',float('nan')),('cfg',True),('steps',float('inf'))]:
            with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                m.validate({**self.req,key:value},self.registry)

    def test_adapter_recipe_and_paths(self):
        for change in [{'loras':[{'id':'../../evil','strength':1}]},{'steps':8},
                       {'loras':[{'id':'sdxl_lightning_4step_lora','strength':99}]},
                       {'prompt':'x <lora:../../evil:1>'},{'negative_prompt':'<lora:../../evil:1>'},{'target':'unknown'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.validate({**self.req,**change},self.registry)

    def test_both_prompts_and_multiline_fragments_are_excluded_from_evidence(self):
        req={**self.req,'prompt':'first line\nprivate at_runtime phrase','negative_prompt':'failed to load private negative'}
        lines=['  negative_prompt: "failed to load private negative"',
               'private at_runtime phrase', '  backend: "MTL0",',
               '[INFO ] lora.hpp:892 - (10 / 10) LoRA tensors have been applied']
        evidence=m.evidence_lines(lines,req,req['prompt'])
        self.assertEqual(len(evidence),2)
        self.assertNotIn('private',' '.join(evidence))

    def test_bad_identity(self):
        for change in [{'run_id':'../escape'},{'token':'x'}, {'op':'exec'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.validate({**self.req,**change},self.registry)

class InterpreterWatchdogTests(unittest.TestCase):
    SNAP={'executable':'/opt/homebrew/bin/python3','real_executable':'/opt/homebrew/Cellar/python@3.15/3.15.0/bin/python3.15','script':'/w/engine-worker.py'}

    def run_watch(self, present, active_seq, max_ticks=10, realpath=None):
        """Drive watch_interpreter with fake sleep; stop after max_ticks without real waits."""
        ticks=[];exits=[];logs=[];active=iter(active_seq)
        def sleep(interval): ticks.append(interval)
        def exit_fn(code): exits.append(code); return True
        result=m.watch_interpreter(self.SNAP,lambda:next(active,False),exit_fn,interval=15,
                                   exists=lambda p:p in present,realpath=realpath or (lambda p:self.SNAP['real_executable']),
                                   sleep=sleep,stopping=lambda:bool(exits) or len(ticks)>=max_ticks,log=logs.append)
        return result,ticks,exits,logs

    def test_present_interpreter_never_exits(self):
        result,ticks,exits,logs=self.run_watch(set(self.SNAP.values()),[])
        self.assertFalse(result);self.assertEqual(exits,[]);self.assertEqual(logs,[]);self.assertEqual(ticks,[15]*10)

    def test_missing_interpreter_waits_for_idle_then_exits_once(self):
        present={self.SNAP['executable'],self.SNAP['script']}
        result,ticks,exits,logs=self.run_watch(present,[True,True,True,False])
        self.assertTrue(result);self.assertEqual(exits,[0]);self.assertEqual(len(ticks),4)
        self.assertEqual(len(logs),1);self.assertIn(self.SNAP['real_executable']+' was removed; restarting to adopt the current interpreter',logs[0])

    def test_missing_script_path_exits(self):
        present={self.SNAP['executable'],self.SNAP['real_executable']}
        result,_,exits,logs=self.run_watch(present,[])
        self.assertEqual(exits,[0]);self.assertIn('worker script /w/engine-worker.py was removed',logs[0])

    def test_replaced_interpreter_symlink_exits(self):
        present=set(self.SNAP.values())
        _,_,exits,logs=self.run_watch(present,[],realpath=lambda p:'/opt/homebrew/Cellar/python@3.15/3.15.1/bin/python3.15')
        self.assertEqual(exits,[0]);self.assertIn('was replaced by',logs[0])

    def test_refused_exit_keeps_watching_and_logs_once(self):
        exits=[];logs=[];ticks=[]
        def exit_fn(code): exits.append(code); return len(exits)==2
        m.watch_interpreter(self.SNAP,lambda:False,exit_fn,interval=15,exists=lambda p:False,realpath=lambda p:p,
                            sleep=ticks.append,stopping=lambda:len(ticks)>=10,log=logs.append)
        self.assertEqual(exits,[0,0]);self.assertEqual(len(logs),1)

    def test_snapshot_uses_running_interpreter(self):
        snap=m.interpreter_snapshot()
        self.assertEqual(snap['executable'],sys.executable);self.assertEqual(snap['real_executable'],os.path.realpath(sys.executable))
        self.assertIsNone(m.interpreter_problem(snap))

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        ProtocolTests.setUp(self)
        # macOS AF_UNIX paths are limited to 104 bytes. The release gate nests
        # TMPDIR under its scratch directory, which exceeds that limit before
        # engine.sock is appended. Keep this owned fixture short; tearDown removes it.
        self.temp = tempfile.TemporaryDirectory(prefix='dex-engine-test-', dir='/tmp')
        self.root = Path(self.temp.name)
        (self.root/'jobs').mkdir()
        model = self.root/'model.safetensors'; model.write_bytes(b'model')
        fake = self.root/'fake-engine'
        fake.write_text('#!/usr/bin/env python3\nimport time\ntime.sleep(10)\n')
        fake.chmod(0o700)
        self.registry.update(sdcli=str(fake),image_python='/usr/bin/python3',lora_root=str(self.root))
        self.registry['models']['sdxl-base']['path']=str(model)
        self.registry['access_probe']={'checkpoint':str(model)}
        (self.root/'registry.json').write_text(json.dumps(self.registry))
        shutil.copyfile(Path(__file__).with_name('engine-child.py'), self.root/'engine-child.py')
        self.worker=m.Worker(self.root,external_probe=lambda:'')
        self.req['loras']=[]

    def tearDown(self):
        for job in self.worker.jobs.values():
            if job['status'] not in m.TERMINAL:
                self.worker.request({'op':'cancel','run_id':job['run_id'],'token':self.req['token']})
        until=time.time()+8
        while self.worker.active and time.time()<until: time.sleep(.05)
        self.temp.cleanup()

    def wait_terminal(self):
        until=time.time()+8
        while self.worker.active and time.time()<until: time.sleep(.05)
        self.assertIsNone(self.worker.active)
        return self.worker.jobs[self.req['run_id']]

    def test_external_engine_blocks_admission(self):
        self.worker.external_probe=lambda:'/tmp/sd-cli\n'
        with self.assertRaisesRegex(ValueError,'another image engine'):
            self.worker.request(self.req)

    def test_cancel_owned_job_then_recover(self):
        self.worker.request(self.req)
        other={**self.req,'run_id':'20261021-150001-test'}
        with self.assertRaisesRegex(ValueError,'busy'): self.worker.request(other)
        with self.assertRaisesRegex(ValueError,'ownership'): self.worker.request({'op':'cancel','run_id':self.req['run_id'],'token':'b'*64})
        self.worker.request({'op':'cancel','run_id':self.req['run_id'],'token':self.req['token']})
        job=self.wait_terminal()
        self.assertEqual(job['status'],'cancelled'); self.assertTrue(job['cleanup'])
        self.assertFalse((self.root/'jobs'/self.req['run_id']/'tmp').exists())
        self.worker.request(other)
        self.assertEqual(self.worker.active,other['run_id'])

    def test_disconnect_does_not_remove_owned_job(self):
        result=self.worker.request(self.req)
        self.assertEqual(result['status'],'running')
        time.sleep(.3)
        owned=self.worker.request({'op':'status','run_id':self.req['run_id'],'token':self.req['token']})
        self.assertEqual(owned['status'],'running')
        self.assertNotIn('token_hash',owned)

    def test_failed_model_read_cleanup(self):
        self.worker.registry['models']['sdxl-base']['path']=str(self.root/'missing')
        self.worker.request(self.req)
        job=self.wait_terminal()
        self.assertEqual(job['status'],'failed'); self.assertTrue(job['cleanup'])

    def test_native_batch_returns_individual_hashes_and_cleans_ack(self):
        fake=self.root/'fake-engine'
        fake.write_text('#!'+sys.executable+'\nfrom PIL import Image\nimport sys\nout=sys.argv[sys.argv.index("-o")+1];n=int(sys.argv[sys.argv.index("-b")+1])\nfor i in range(n): Image.new("RGB",(512,512),(i*50,0,0)).save(out%i)\n')
        self.worker.registry['image_python']=sys.executable
        self.worker.request({**self.req,'batch_count':2})
        job=self.wait_terminal();self.assertEqual(job['status'],'complete',job)
        self.assertEqual(len(job['images']),2)
        hashes=[]
        for index in range(2):
            result=self.worker.request({'op':'result','run_id':self.req['run_id'],'token':self.req['token'],'index':index})
            hashes.append(result['sha256'])
        self.assertNotEqual(hashes[0],hashes[1])
        self.worker.request({'op':'ack','run_id':self.req['run_id'],'token':self.req['token']})
        self.assertEqual(list((self.root/'jobs'/self.req['run_id']).glob('output*.png')),[])

    def test_uncertain_terminal_receipt_stays_quarantined_after_restarts(self):
        run=self.root/'jobs'/self.req['run_id']; run.mkdir()
        (run/'result.json').write_text(json.dumps(dict(run_id=self.req['run_id'],token_hash='x',status='failed',cleanup=False,pgid=123456,started=time.time())))
        with patch.object(m.os,'killpg',return_value=None), patch.object(m.subprocess,'run',return_value=type('Result',(),{'stdout':'123456 unrelated-process'})()):
            first=m.Worker(self.root)
            second=m.Worker(self.root)
        self.assertEqual(first.recovery_uncertain,[self.req['run_id']])
        self.assertEqual(second.recovery_uncertain,[self.req['run_id']])
        with self.assertRaisesRegex(ValueError,'busy'):
            second.request({**self.req,'run_id':'20261021-150002-test'})

    def test_image_result_ack_and_unsaved_prompt_metadata(self):
        fake=self.root/'fake-engine'
        fake.write_text('#!'+sys.executable+'\nfrom PIL import Image,PngImagePlugin\nimport sys\np=PngImagePlugin.PngInfo();p.add_text("parameters","private prompt")\nImage.new("RGB",(512,512),"red").save(sys.argv[sys.argv.index("-o")+1],pnginfo=p)\n')
        self.worker.registry['image_python']=sys.executable
        self.worker.request(self.req)
        job=self.wait_terminal()
        self.assertEqual(job['status'],'complete',job)
        result=self.worker.request({'op':'result','run_id':self.req['run_id'],'token':self.req['token']})
        import base64,io
        from PIL import Image
        self.assertNotIn('parameters',Image.open(io.BytesIO(base64.b64decode(result['png']))).info)
        self.assertTrue(job['cleanup'])
        self.worker.request({'op':'ack','run_id':self.req['run_id'],'token':self.req['token']})
        self.assertFalse((self.root/'jobs'/self.req['run_id']/'output.png').exists())

    def test_real_unix_socket_permissions_and_rejection(self):
        code = 'import importlib.util,pathlib; s=importlib.util.spec_from_file_location("w",'+repr(str(Path(__file__).with_name('engine-worker.py')))+'); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.ROOT=pathlib.Path('+repr(str(self.root))+');m.SOCKET=m.ROOT/"engine.sock";m.serve()'
        server=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        sock=self.root/'engine.sock'
        try:
            until=time.time()+5
            while not sock.exists() and time.time()<until: time.sleep(.05)
            self.assertTrue(sock.exists())
            self.assertEqual(self.root.stat().st_mode & 0o777,0o700)
            self.assertEqual(sock.stat().st_mode & 0o777,0o600)
            with socket.socket(socket.AF_UNIX) as client:
                client.connect(str(sock));client.sendall(b'{"op":"health"}\n')
                response=json.loads(client.makefile('rb').readline())
            self.assertTrue(response['ok']);self.assertEqual(response['uid'],os.getuid())
            with socket.socket(socket.AF_UNIX) as client:
                client.connect(str(sock));client.sendall(b'{"op":"exec","command":"touch /tmp/unsafe"}\n')
                response=json.loads(client.makefile('rb').readline())
            self.assertFalse(response['ok'])
        finally:
            server.terminate();server.wait(timeout=12)
            server.stderr.close()
        self.assertFalse(sock.exists())

    def test_health_reports_interpreter_state(self):
        health=self.worker.request({'op':'health'})
        self.assertTrue(health['interpreter_ok']);self.assertEqual(health['interpreter_path'],sys.executable)
        for key in ['ok','models','secondary','pid','uid','active','access','recovery_uncertain']: self.assertIn(key,health)
        self.worker.interpreter_check=lambda:'interpreter /x was removed'
        self.assertFalse(self.worker.request({'op':'health'})['interpreter_ok'])

    def test_serve_exits_zero_and_cleans_socket_when_interpreter_removed(self):
        fake_python=self.root/'fake-python'; fake_python.write_text('')
        code = ('import importlib.util,pathlib; s=importlib.util.spec_from_file_location("w",'+repr(str(Path(__file__).with_name('engine-worker.py')))+'); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'm.ROOT=pathlib.Path('+repr(str(self.root))+');m.SOCKET=m.ROOT/"engine.sock";m.INTERPRETER_CHECK_INTERVAL=0.1;'
                'm.STARTUP_INTERPRETER=m.interpreter_snapshot('+repr(str(fake_python))+','+repr(str(Path(__file__).with_name('engine-worker.py')))+');m.serve()')
        server=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        sock=self.root/'engine.sock'
        try:
            until=time.time()+5
            while not sock.exists() and time.time()<until: time.sleep(.05)
            self.assertTrue(sock.exists())
            fake_python.unlink()
            self.assertEqual(server.wait(timeout=10),0)
            self.assertIn(b'restarting to adopt the current interpreter',server.stderr.read())
        finally:
            if server.poll() is None: server.kill(); server.wait()
            server.stderr.close()
        self.assertFalse(sock.exists())

    def test_unknown_result_and_live_ack_rejected(self):
        with self.assertRaisesRegex(ValueError,'unknown'): self.worker.request({'op':'result','run_id':self.req['run_id'],'token':self.req['token']})
        self.worker.request(self.req)
        with self.assertRaisesRegex(ValueError,'active'): self.worker.request({'op':'ack','run_id':self.req['run_id'],'token':self.req['token']})

if __name__=='__main__': unittest.main()
