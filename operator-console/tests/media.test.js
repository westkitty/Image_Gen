'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const M = require('../media');

const CANARY = 'DEXPRIVACY-CANARY-927';
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-media-' + p));

function wav(seconds = 0.5, rate = 8000) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 2);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length, 40);
  return Buffer.concat([b, data]);
}
function pilImage(fmt, w = 32, h = 24) {
  const out = path.join(tmp('img'), 'x.' + fmt);
  execFileSync('python3', ['-c', `from PIL import Image; Image.new("RGB", (${w}, ${h}), (200, 10, 10)).save("${out}")`]);
  return fs.readFileSync(out);
}
const pngHeaderOnly = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

// ---- Generic jobs ---------------------------------------------------------------
test('generic jobs: lifecycle, invalid transitions, privacy, restart reconciliation', () => {
  const dir = tmp('jobs'); const file = path.join(dir, 'jobs.json');
  const s = M.createJobStore(file);
  const img = s.create({ job_id: 'img1', media_kind: 'image', operation: 'controlled-generate', worker_id: 'mflux', resource_class: 'heavy', params: { prompt: CANARY, negative_prompt: CANARY, width: 512, seed: 7 } });
  assert.equal(img.status, 'QUEUED');
  assert.equal(img.params.prompt, '[REDACTED]');
  assert.equal(img.params.width, 512);
  assert.match(s.transition('img1', 'TRANSFERRING').error, /illegal transition QUEUED -> TRANSFERRING/);
  s.transition('img1', 'RUNNING'); s.transition('img1', 'TRANSFERRING'); s.transition('img1', 'COMPLETE', { artifacts: ['a.png'], artifact_validation: { canonical: true, validated: true, artifacts: [{ artifact_id: 'a.png', sha256: 'a'.repeat(64) }] } });
  assert.match(s.transition('img1', 'RUNNING').error, /illegal/);
  s.create({ job_id: 'fail1', media_kind: 'image', operation: 'img2img', worker_id: 'sdcpp' }); s.transition('fail1', 'RUNNING'); s.transition('fail1', 'FAILED', { first_failed_gate: 'output-missing', error: 'x' });
  s.create({ job_id: 'run1', media_kind: 'image', operation: 'inpaint', worker_id: 'sdcpp', params: { prompt: CANARY } }); s.transition('run1', 'RUNNING', { resource_lease: 'bigmac-heavy-inference' });
  s.create({ job_id: 'q1', media_kind: 'voice', operation: 'speech', worker_id: 'qwen3-tts', params: { text: CANARY } });
  s.create({ job_id: 'c1', media_kind: 'music', operation: 'song', worker_id: 'ace-step', params: { lyrics: CANARY } }); s.transition('c1', 'CANCELLED');
  assert.throws(() => s.create({ media_kind: 'hologram' }));
  s.flush();
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(CANARY), 'private text never durable when persistence is off');
  // restart
  const r = M.createJobStore(file);
  assert.equal(r.get('img1').status, 'COMPLETE'); assert.deepEqual(r.get('img1').artifacts, ['a.png']);
  assert.equal(r.get('fail1').status, 'FAILED'); assert.equal(r.get('fail1').first_failed_gate, 'output-missing');
  assert.equal(r.get('run1').status, 'INTERRUPTED'); assert.equal(r.get('run1').first_failed_gate, 'server-restart');
  assert.equal(r.get('run1').resource_lease, null, 'restart never strands a lease');
  assert.equal(r.get('run1').retry_requires_input, true);
  assert.equal(r.get('q1').status, 'INTERRUPTED', 'queued work is not silently re-run');
  assert.equal(r.get('c1').status, 'CANCELLED');
  const keep = M.createJobStore(path.join(dir, 'j2.json'));
  keep.create({ job_id: 'p', media_kind: 'image', operation: 'x', worker_id: 'sdcpp', params: { prompt: 'kept' }, persist_text: true });
  keep.flush();
  assert.ok(fs.readFileSync(path.join(dir, 'j2.json'), 'utf8').includes('kept'));
});

// ---- Resource arbiter ---------------------------------------------------------------
test('arbiter: capacity 1, FIFO waiting, release on success/failure, external load blocks without killing', async () => {
  const a = M.createResourceArbiter();
  const order = [];
  const p1 = a.acquire('j1', 'flux').then(r => order.push(['j1', r.granted]));
  const p2 = a.acquire('j2', 'sd15').then(r => order.push(['j2', r.granted]));
  await p1;
  assert.equal(a.state().owner.job_id, 'j1');
  assert.deepEqual(a.state().waiting.map(w => [w.job_id, w.position]), [['j2', 1]]);
  assert.match(a.state().blocked_reason, /flux currently owns heavy compute/);
  assert.equal(a.holds('j2'), false, 'second heavy job does not run concurrently');
  a.release('j1'); await p2;
  assert.equal(a.state().owner.job_id, 'j2');
  a.release('j2'); // failure path releases the same way
  assert.equal(a.state().owner, null);
  a.setExternal({ occupied: true, detail: 'ollama:big (20 GB)' });
  let granted = false;
  const p3 = a.acquire('j3').then(() => { granted = true; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(granted, false, 'external heavy load keeps the lease unavailable');
  a.setExternal({ occupied: false });
  await p3;
  assert.equal(granted, true);
  a.release('j3');
  const cancelled = a.acquire('x'); a.acquire('y'); a.release('y');
  await cancelled; a.release('x');
  assert.equal(a.state().waiting.length, 0);
});

test('external-load detection parses ollama ps conservatively', () => {
  const txt = 'NAME ID SIZE PROCESSOR CONTEXT UNTIL\nllama3.1:70b abc 42 GB 100% GPU 8192 4 minutes\nqwen2:0.5b def 700 MB 100% GPU 2048 now\n';
  const r = M.parseOllamaPs(txt);
  assert.equal(r.occupied, true);
  assert.match(r.detail, /llama3\.1:70b/);
  assert.ok(!/qwen2/.test(r.detail), 'small models are not heavy');
  assert.equal(M.parseOllamaPs('NAME    ID    SIZE    PROCESSOR    CONTEXT    UNTIL \n').occupied, false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /'ollama ps 2>\/dev\/null;/);
  assert.doesNotMatch(src, /ollama (stop|rm)|pkill|killall/);
});

// ---- Worker registry -----------------------------------------------------------------
const allKeys = id => Object.fromEntries(M.WORKER_PROBE_PATHS.filter(([k]) => k.startsWith(id + ':')).map(([k]) => [k, true]));

test('workers: bridged voice/music workers promote only on live probe + real DexDiffusion evidence; LTX stays dormant', () => {
  let ev = {};
  const reg = M.createWorkerRegistry({ getEvidence: () => ev });
  const d = Object.fromEntries(reg.describe({}).map(w => [w.id, w]));
  const bridged = ['kokoro', 'qwen3-tts-base', 'qwen3-tts-voice-design', 'ace-step', 'magenta-rt'];
  for (const id of ['mflux', 'sdcpp', ...bridged, 'ltx-video']) assert.ok(d[id], id);
  for (const id of [...bridged, 'ltx-video']) {
    const w = reg.get(id);
    for (const fn of ['probe', 'capabilities', 'prepare', 'execute', 'status', 'cancel', 'cleanup']) assert.equal(typeof w[fn], 'function', id + '.' + fn);
    assert.deepEqual([d[id].runtime_available, d[id].model_available, d[id].enabled, d[id].proven], [false, false, false, false], id);
    assert.equal(d[id].state, 'RUNTIME MISSING');
    assert.equal(w.capabilities().cancel_supported, false);
  }
  assert.deepEqual(bridged.map(id => d[id].media_kind), ['voice', 'voice', 'voice', 'music', 'music']);
  // installed (live probe) -> enabled but NOT proven until real DexDiffusion evidence exists
  for (const id of bridged) {
    const p = reg.get(id).probe(allKeys(id));
    assert.deepEqual([p.runtime_available, p.model_available, p.enabled, p.proven], [true, true, true, false], id);
    assert.match(p.state, /ENABLED — awaiting first DexDiffusion proof/);
  }
  ev = { kokoro: { lastPass: { at: '2026-09-26T00:00:00Z', job_id: 'j', artifact_id: 'a.wav' } } };
  assert.equal(reg.get('kokoro').probe(allKeys('kokoro')).proven, true);
  assert.equal(reg.get('kokoro').probe(allKeys('kokoro')).state, 'PROVEN');
  assert.equal(reg.get('kokoro').probe({}).proven, false, 'evidence never overrides a failed live probe');
  assert.equal(reg.get('qwen3-tts-base').probe(allKeys('qwen3-tts-base')).proven, false, 'evidence is per worker');
  // one missing checkpoint -> MODEL MISSING with per-variant truth
  const partial = { ...allKeys('ace-step'), 'ace-step:model:lm-0.6b': false };
  assert.equal(reg.get('ace-step').probe(partial).state, 'MODEL MISSING');
  assert.equal(reg.get('ace-step').probe(partial).model_variants['lm-0.6b'], false);
  // LTX: dormant, even with fake assets it is never enabled
  assert.equal(reg.get('ltx-video').probe(allKeys('ltx-video')).enabled, false);
  assert.equal(reg.get('ltx-video').execute({}).gate, 'runtime-missing');
});

test('worker paths: single authoritative table matches the model-stack install layout', () => {
  const P = M.WORKER_PATHS;
  const voice = '$HOME/Library/Caches/DexDiffusion/voice/venv/bin/python';
  for (const id of ['kokoro', 'qwen3-tts-base', 'qwen3-tts-voice-design']) assert.equal(P[id].runtime.python, voice, id);
  assert.equal(P.kokoro.models.voices, '/Volumes/wc2tb/generative-models/voice/kokoro/Kokoro-82M-bf16/voices');
  assert.match(P['qwen3-tts-base'].models.base, /^\/Volumes\/wc2tb\/generative-models\/voice\/qwen3-tts-base\/Qwen3-TTS-12Hz-1\.7B-Base-bf16\//);
  assert.match(P['qwen3-tts-voice-design'].models['voice-design'], /qwen3-tts-voice-design\/Qwen3-TTS-12Hz-1\.7B-VoiceDesign-8bit\//);
  assert.equal(P['ace-step'].runtime.python, '$HOME/Library/Caches/DexDiffusion/music/ACE-Step-1.5/.venv/bin/python');
  for (const k of ['turbo', 'vae', 'embedding', 'lm-0.6b']) assert.match(P['ace-step'].models[k], /^\/Volumes\/wc2tb\/generative-models\/music\/ace-step\/checkpoints\//);
  assert.equal(P['magenta-rt'].runtime.python, '$HOME/Library/Caches/DexDiffusion/music/magenta-rt-venv/bin/python');
  assert.match(P['magenta-rt'].models['mrt2-small'], /magenta-rt-v2\/models\/mrt2_small$/);
  // no stale placeholder paths anywhere
  for (const f of ['media.js', 'capabilities.js', 'server.js', 'media-bridge.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /DexDiffusion\/qwen3-tts\/|DexDiffusion\/ace-step\/|ImageGen\/ace-step|ImageGen\/ltx/, f);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'capabilities.js'), 'utf8'), /require\('\.\/media'\)\.WORKER_PROBE_PATHS/);
  // the persisted installer keeps its hard-won fixes
  const inst = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'install-bigmac-media-model-stack.sh'), 'utf8');
  assert.match(inst, /MISSING_ESTIMATE=\$\(\(EXPECTED_BYTES - CURRENT_MODEL_BYTES\)\)/);
  assert.match(inst, /REQUIRED_NOW=\$\(\(MISSING_ESTIMATE \+ RESERVE_BYTES \+ GLOBAL_MARGIN_BYTES\)\)/);
  assert.match(inst, /\[\[ -d \/Users\/bigmac\/\.ollama\/models \]\]/);
  assert.match(inst, /echo "REMOTE MODEL STACK INSTALLATION: PASS"/);
  assert.match(inst, /grep -qx 'REMOTE MODEL STACK INSTALLATION: PASS'/);
  assert.match(inst, /'misaki\[en\]'/);
  assert.match(inst, /en-core-web-sm @/);
  assert.match(inst, /'mlx==0\.31\.1'/);
  assert.match(inst, /':!checkpoints'/);
  assert.match(inst, /--verify/);
  assert.doesNotMatch(inst, /git (add|commit|push)/);
  assert.doesNotMatch(inst, /ltx|LTX-Video/i);
});

// ---- Media store -------------------------------------------------------------------------
test('media store: roots, atomic finalize, sha256/bytes/mime, no overwrite, safe resolve', () => {
  const base = tmp('store');
  const roots = { image: path.join(base, 'images_made'), voice: path.join(base, 'audio_made/voice'), music: path.join(base, 'audio_made/music'), video: path.join(base, 'video_made') };
  const store = M.createMediaStore({ roots, registryFile: path.join(base, 'media.json') });
  store.ensureRoots();
  assert.equal(M.CANONICAL_ROOTS.image, '/Users/andrew/images_made');
  assert.equal(M.CANONICAL_ROOTS.voice, '/Users/andrew/audio_made/voice');
  assert.equal(M.CANONICAL_ROOTS.music, '/Users/andrew/audio_made/music');
  assert.equal(M.CANONICAL_ROOTS.video, '/Users/andrew/video_made');
  const src = path.join(base, 'out.wav'); fs.writeFileSync(src, wav());
  const a = store.finalize(src, { kind: 'voice', base: 'speech', job_id: 'j', worker: 'qwen3-tts', duration: 0.5 });
  const b = store.finalize(src, { kind: 'voice', base: 'speech' });
  assert.equal(a.artifact_id, 'speech.wav'); assert.equal(b.artifact_id, 'speech-2.wav');
  assert.equal(a.safe_url, '/api/media/speech.wav');
  assert.equal(a.download_url, '/api/media/speech.wav/download');
  assert.equal(a.mime, 'audio/wav'); assert.equal(a.bytes, fs.statSync(src).size);
  assert.equal(a.sha256, require('crypto').createHash('sha256').update(fs.readFileSync(src)).digest('hex'));
  assert.ok(fs.readdirSync(roots.voice).every(f => !f.startsWith('.incoming-')));
  assert.deepEqual(fs.readdirSync(roots.music), [], 'voice and music are separate');
  assert.equal(store.list('voice').length, 2); assert.equal(store.list('music').length, 0);
  assert.throws(() => store.finalize(src, { kind: 'image' }), /image-store/);
  const bad = path.join(base, 'bad.wav'); fs.writeFileSync(bad, Buffer.alloc(64, 7));
  assert.throws(() => store.finalize(bad, { kind: 'music' }), /output-invalid/);
  assert.ok(store.resolve('speech.wav'));
  for (const id of ['../speech.wav', '..%2Fspeech.wav', '/etc/passwd', 'speech.wav\0', '.incoming-x.wav', 'unknown.wav']) assert.equal(store.resolve(id), null, id);
  fs.unlinkSync(path.join(roots.voice, 'speech-2.wav'));
  fs.symlinkSync('/etc/hosts', path.join(roots.voice, 'speech-2.wav'));
  assert.equal(store.resolve('speech-2.wav'), null, 'symlink escape rejected');
});

// ---- Staging ------------------------------------------------------------------------------
test('staging: valid PNG/JPEG/WebP/WAV (+M4A via ffprobe) stage; bad input rejected; expiry sweep', () => {
  let t = 1000;
  const st = M.createStaging({ root: path.join(tmp('stg'), 'staging'), now: () => t });
  for (const fmt of ['png', 'jpeg', 'webp']) {
    const r = st.stage(pilImage(fmt));
    assert.equal(r.kind, 'image', fmt); assert.equal(r.width, 32); assert.equal(r.height, 24);
    assert.match(r.id, /^stg-[a-f0-9]{24}$/);
    assert.ok(st.get(r.id).path.startsWith(st.root));
  }
  const w = st.stage(wav(1.5));
  assert.equal(w.kind, 'audio'); assert.equal(w.duration, 1.5);
  let m4a = null;
  try {
    const d = tmp('m4a'); fs.writeFileSync(path.join(d, 'a.wav'), wav(1));
    execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(d, 'a.wav'), '-c:a', 'aac', path.join(d, 'a.m4a')]);
    m4a = st.stage(fs.readFileSync(path.join(d, 'a.m4a')));
  } catch (_) { /* ffmpeg absent: m4a inspection not available */ }
  if (m4a) { assert.equal(m4a.mime, 'audio/mp4'); assert.ok(m4a.duration > 0.8); }
  assert.match(st.stage(Buffer.from('GIF89a' + 'x'.repeat(40))).error, /unsupported/);
  assert.match(st.stage(Buffer.from('not an image at all, just text')).error, /unsupported/);
  assert.match(st.stage(pngHeaderOnly(9000, 9000)).error, /exceeds/);
  assert.match(st.stage(pilImage('png'), { accept: ['audio'] }).error, /not accepted/);
  const trunc = wav(1).slice(0, 30); assert.ok(st.stage(trunc).error);
  const small = M.createStaging({ root: path.join(tmp('stg2'), 's'), limits: { ...M.STAGING_LIMITS, imageBytes: 100 } });
  assert.match(small.stage(pilImage('png', 64, 64)).error, /too large/);
  for (const id of ['../x', 'stg-..', '%2e%2e', 'stg-' + 'a'.repeat(24) + '/../../etc', 'stg-zz']) assert.equal(st.get(id), null, id);
  // symlink escape: replace a staged file with a link
  const r = st.stage(pilImage('png'));
  const f = st.get(r.id).path; fs.unlinkSync(f); fs.symlinkSync('/etc/hosts', f);
  assert.equal(st.get(r.id), null);
  t += M.STAGING_LIMITS.ttlMs + 1;
  assert.equal(st.get(w.id), null, 'expired references are not served');
  assert.ok(st.sweep() >= 4);
  assert.equal(st.stats().files, 0);
});

// ---- Server wiring (static) ----------------------------------------------------------------
test('server wiring: leases for heavy jobs, generic job adapter, safe routes, dormant gating before lease', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /function runAction\(jobId, scriptPath, args, savePrompts = false\) \{\n  withLease\(/);
  assert.match(src, /function runControlledSequential\(jobId, spec, params, quantity, opts = \{\}\) \{\n  withLease\(/);
  assert.match(src, /jobStore\.create\(\{\n      job_id: id, media_kind: 'image'/);
  assert.match(src, /app\.get\('\/api\/media\/:id'/);
  assert.match(src, /app\.get\('\/api\/media\/:id\/download'/);
  assert.match(src, /Content-Disposition[^\n]*attachment/);
  assert.match(src, /X-Content-Type-Options[^\n]*nosniff/);
  assert.match(src, /app\.get\('\/api\/library'/);
  assert.match(src, /express\.raw\(\{ type: \(\) => true, limit: '41mb' \}\)/);
  // dormant generation fails before any lease is requested
  const gen = src.slice(src.indexOf("app.post('/api/media/generate'"), src.indexOf('// ---- Active jobs'));
  assert.ok(!gen.includes('arbiter.acquire') && !gen.includes('withLease'));
  assert.match(gen, /Runtime\/model not installed/);
  assert.match(gen, /Installed but execution bridge not enabled\/proven/);
  // imports never land in images_made
  assert.match(src, /import-\$\{Date\.now\(\)\}-\$\{crypto\.randomBytes\(4\)\.toString\('hex'\)\}\.png`\);/);
  assert.match(src, /const out = path\.join\(MASK_UPLOADS_DIR, `import-/);
});

test('audio download controls use the durable same-origin attachment route', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'dexdiffusion', 'media-ui.js'), 'utf8');
  assert.match(ui, /href: base \+ art\.download_url/);
  assert.match(ui, /href: base \+ i\.download_url/);
  assert.doesNotMatch(ui, /href: base \+ art\.url, download:/);
  assert.doesNotMatch(ui, /href: base \+ i\.url, download:/);
});

test('native WebKit wrapper turns same-origin media attachment links into real downloads', () => {
  const swift = fs.readFileSync(path.join(__dirname, '..', '..', 'native', 'macos', 'Image_Gen', 'ImageGenApp.swift'), 'utf8');
  assert.match(swift, /WKDownloadDelegate/);
  assert.match(swift, /isDexMediaDownload/);
  assert.match(swift, /decisionHandler\(\.download\)/);
  assert.match(swift, /decideDestinationUsing response: URLResponse/);
  assert.match(swift, /\.downloadsDirectory/);
});
