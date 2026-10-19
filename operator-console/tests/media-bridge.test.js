'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const M = require('../media');
const B = require('../media-bridge');

const CANARY = 'DEXBRIDGE-CANARY-4411';
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-bridge-' + p));
function wav(seconds = 0.5, rate = 24000) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 2, 1);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length, 40);
  return Buffer.concat([b, data]);
}

// ---- validation / secure references --------------------------------------------
test('validateRequest: per-worker required fields, limits, private vs safe split', () => {
  assert.match(B.validateRequest('kokoro', {}).error, /Text to speak is required/);
  assert.match(B.validateRequest('kokoro', { text: 'hi', voice: '../../etc/passwd' }).error, /unknown Kokoro voice/);
  const k = B.validateRequest('kokoro', { text: CANARY, voice: 'bf_emma', speed: 1.2 });
  assert.equal(k.req.lang_code, 'b'); assert.ok(!JSON.stringify(k.safe).includes(CANARY));
  assert.equal(B.validateRequest('qwen3-tts-base', { text: 'x' }).gate, 'reference-invalid');
  const q = B.validateRequest('qwen3-tts-base', { text: CANARY, ref_text: CANARY, staged_ref: 'stg-abc', seed: 5 });
  assert.equal(q.refId, 'stg-abc'); assert.ok(!JSON.stringify(q.safe).includes(CANARY));
  assert.match(B.validateRequest('qwen3-tts-voice-design', { text: 'x' }).error, /voice description/);
  assert.match(B.validateRequest('ace-step', { lyrics: 'x' }).error, /Describe the song/);
  assert.match(B.validateRequest('ace-step', { prompt: 'x', duration: 900 }).error, /10-240/);
  const a = B.validateRequest('ace-step', { prompt: CANARY, genre: 'pop', lyrics: CANARY, duration: 30 });
  assert.match(a.req.caption, /genre: pop/); assert.ok(Number.isInteger(a.safe.seed)); assert.ok(!JSON.stringify(a.safe).includes(CANARY));
  assert.match(B.validateRequest('magenta-rt', { prompt: 'x', duration: 120 }).error, /2-60/);
  assert.match(B.validateRequest('kokoro', { text: 'x', seed: -3 }).error, /seed/);
  assert.equal(B.validateRequest('ltx-video', { prompt: 'x' }).gate, 'worker-unavailable');
  assert.match(B.validateRequest('kokoro', { text: 'x'.repeat(2001) }).error, /limited/);
});

test('buildPayload: private text only inside base64 stdin payload, job dir confined, magenta home private', () => {
  const req = { worker: 'magenta-rt', prompt: CANARY, duration: 8, out_dir: '/x/out' };
  const p = B.buildPayload({ dir: '$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.AbC123', request: req, driverSource: 'print(1)', python: '$HOME/Library/Caches/DexDiffusion/music/magenta-rt-venv/bin/python', magentaData: '/Volumes/wc2tb/generative-models/music/magenta-realtime/magenta-rt-v2' });
  assert.ok(!p.includes(CANARY), 'canary never appears in plain text');
  assert.ok(p.includes(Buffer.from(JSON.stringify(req)).toString('base64')));
  assert.match(p, /case "\$D" in "\$HOME\/Library\/Caches\/DexDiffusion\/tmp\/dexmedia\."\*\)/);
  assert.match(p, /chmod 600 "\$D\/request\.json"/);
  assert.match(p, /MAGENTA_HOME="\$D\/mhome"/);
  assert.match(p, /rm -f "\$D\/request\.json"/);
  assert.doesNotMatch(p, /pkill|killall|rclone|ImageGen|\.ollama/);
});

test('parseMarkers reads digits (SHA256) and flags', () => {
  const m = B.parseMarkers('noise\nDEXMEDIA_SHA256=' + 'a'.repeat(64) + '\nDEXMEDIA_PASS\n  DEXMEDIA_DURATION=1.5\r\n');
  assert.equal(m.SHA256, 'a'.repeat(64)); assert.equal(m.PASS, true); assert.equal(m.DURATION, '1.5');
});

test('remote driver: redacts private text in errors, validates WAV, never touches protected stores', () => {
  const src = fs.readFileSync(B.DRIVER_PATH, 'utf8');
  assert.match(src, /os\.unlink\(req_path\)/);
  assert.match(src, /def scrub\(msg, req\)/);
  assert.match(src, /wave\.open\(path, "rb"\)/);
  assert.match(src, /marker\("SHA256"/);
  assert.match(src, /"mrt2_small"/);
  assert.match(src, /acestep-5Hz-lm-0\.6B/);
  assert.doesNotMatch(src, /ImageGen|\.ollama|rclone|flux2-klein/);
});

// ---- full run() with fake ssh/scp ------------------------------------------------------
function harness({ remoteOut, scpBytes, cleaned = true, refOk = true, cleanupThrows = false, toWav: customToWav = null, remoteHashes = null } = {}) {
  const base = tmp('run');
  const roots = { image: base + '/img', voice: base + '/voice', music: base + '/music', video: base + '/video' };
  const mediaStore = M.createMediaStore({ roots, registryFile: base + '/media.json' }); mediaStore.ensureRoots();
  const jobStore = M.createJobStore(base + '/jobs.json');
  const arbiter = M.createResourceArbiter();
  const staging = M.createStaging({ root: base + '/stg' });
  const calls = [];
  const dir = '$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.TEST01';
  const exec = async (cmd, args) => {
    calls.push([cmd, args.join(' ')]);
    const a = args.join(' ');
    if (cmd === 'ssh' && a.includes('mktemp -d')) return { ok: true, stdout: `DEXMEDIA_DIR=${dir}\n` };
    if (cmd === 'ssh' && a.includes('ref.wav')) return { ok: true, stdout: refOk ? 'DEXMEDIA_REF_OK\n' : '' };
    if (cmd === 'ssh' && a.includes('shasum -a 256')) return { ok: true, stdout: (remoteHashes || []).map((h, i) => `${h} ${dir}/${i ? 'target' : 'source'}.wav`).join('\n') + '\n' };
    if (cmd === 'ssh' && a.includes('rm -rf') && cleanupThrows) throw new Error('owned cleanup transport fixture');
    if (cmd === 'ssh' && a.includes('rm -rf')) return { ok: true, stdout: cleaned ? 'DEXMEDIA_CLEANED=' + /DEXMEDIA_CLEANED=([a-f0-9]{64})/.exec(a)[1] + '\n' : 'DEXMEDIA_STILL_THERE\n' };
    if (cmd === 'scp' && a.includes(`${dir}/out`)) { if (scpBytes) fs.writeFileSync(args[args.length - 1], scpBytes); return { ok: !!scpBytes, stdout: '' }; }
    return { ok: true, stdout: '' };
  };
  let payloadSeen = '';
  const sshRunFn = async (_t, payload) => { payloadSeen = payload; return typeof remoteOut === 'function' ? remoteOut(dir) : remoteOut; };
  const toWav = customToWav || (async () => { const f = path.join(tmp('ref'), 'ref.wav'); fs.writeFileSync(f, wav()); return f; });
  const bridge = B.createMediaBridge({ jobStore, arbiter, mediaStore, staging, evidenceFile: base + '/ev.json', exec, sshRunFn, toWav });
  return { base, roots, mediaStore, jobStore, arbiter, staging, bridge, calls, dir, payload: () => payloadSeen };
}
const probe = { runtime_available: true, model_available: true };
async function settle(jobStore, id) {
  for (let i = 0; i < 400; i++) { const g = jobStore.get(id); if (['COMPLETE', 'FAILED', 'INTERRUPTED'].includes(g.status)) return g; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('job did not settle');
}
const okOut = (bytes) => dir => `log line\nDEXMEDIA_OUTPUT=${dir}/out/out_000.wav\nDEXMEDIA_SHA256=${crypto.createHash('sha256').update(bytes).digest('hex')}\nDEXMEDIA_DURATION=0.5\nDEXMEDIA_SAMPLE_RATE=24000\nDEXMEDIA_CHANNELS=1\nDEXMEDIA_PASS\nDEXMEDIA_DONE\n`;

test('run: success -> transfer, checksum, canonical voice artifact, evidence, cleanup, lease released, no private text', async () => {
  const bytes = wav();
  const h = harness({ remoteOut: okOut(bytes), scpBytes: bytes });
  const r = h.bridge.start('kokoro', { text: CANARY, voice: 'af_heart' }, { probe, saveText: false });
  const g = await settle(h.jobStore, r.job_id);
  assert.equal(g.status, 'COMPLETE');
  assert.equal(g.artifacts.length, 1);
  const rec = h.mediaStore.resolve(g.artifacts[0]);
  assert.equal(rec.kind, 'voice'); assert.ok(rec.path.startsWith(h.roots.voice));
  assert.equal(rec.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(fs.readdirSync(h.roots.music), []);
  assert.equal(h.bridge.evidence.read().kokoro.lastPass.artifact_id, g.artifacts[0]);
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf') && a.includes('dexmedia.TEST01')));
  assert.equal(h.arbiter.state().owner, null);
  h.jobStore.flush();
  for (const f of ['jobs.json', 'media.json', 'ev.json']) assert.ok(!fs.readFileSync(path.join(h.base, f), 'utf8').includes(CANARY), f);
  assert.ok(!h.payload().includes(CANARY), 'private text travels base64-encoded only');
});

test('run: failure gates are specific and never produce a canonical artifact', async () => {
  const cases = [
    ['generation', { remoteOut: 'DEXMEDIA_FAIL=generation\nDEXMEDIA_ERROR=boom\nDEXMEDIA_DONE\n' }],
    ['generation', { remoteOut: 'partial output, connection lost' }],
    ['output-missing', { remoteOut: 'DEXMEDIA_DONE\n' }],
    ['transfer', { remoteOut: okOut(wav()), scpBytes: null }],
    ['checksum', { remoteOut: okOut(wav(0.5)), scpBytes: wav(0.7) }],
  ];
  for (const [gate, opts] of cases) {
    const h = harness(opts);
    const r = h.bridge.start('magenta-rt', { prompt: 'x', duration: 4 }, { probe, saveText: false });
    const g = await settle(h.jobStore, r.job_id);
    assert.equal(g.status, 'FAILED', gate); assert.equal(g.first_failed_gate, gate);
    assert.deepEqual(fs.readdirSync(h.roots.music), [], 'no canonical output on ' + gate);
    assert.equal(h.arbiter.state().owner, null, 'lease released on ' + gate);
    assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf')), 'remote cleanup attempted on ' + gate);
  }
});

test('run: cleanup failure after canonicalization keeps the verified output and records the problem', async () => {
  const bytes = wav();
  const h = harness({ remoteOut: okOut(bytes), scpBytes: bytes, cleaned: false });
  const r = h.bridge.start('kokoro', { text: 'x' }, { probe, saveText: false });
  const g = await settle(h.jobStore, r.job_id);
  await new Promise(res => setTimeout(res, 20));
  assert.equal(g.status, 'COMPLETE');
  assert.match(h.jobStore.get(r.job_id).cleanup_error, /could not be verified removed/);
  assert.equal(fs.readdirSync(h.roots.voice).filter(f => f.endsWith('.wav')).length, 1);
});

test('start: gating and reference validation happen before any lease; clone uploads only a server-resolved staged file', async () => {
  const h = harness({ remoteOut: okOut(wav()), scpBytes: wav() });
  assert.equal(h.bridge.start('kokoro', { text: 'x' }, { probe: { runtime_available: false, model_available: true } }).gate, 'runtime-missing');
  assert.equal(h.bridge.start('kokoro', { text: 'x' }, { probe: { runtime_available: true, model_available: false } }).gate, 'model-missing');
  assert.equal(h.bridge.start('qwen3-tts-base', { text: 'x', staged_ref: 'stg-000000000000000000000000' }, { probe }).gate, 'reference-invalid');
  assert.equal(h.bridge.start('qwen3-tts-base', { text: 'x', staged_ref: '../../etc/passwd' }, { probe }).gate, 'reference-invalid');
  assert.equal(h.arbiter.state().owner, null); assert.equal(h.jobStore.list().length, 0, 'rejected requests create no job');
  const st = h.staging.stage(wav(1));
  const bytes = wav();
  const h2 = harness({ remoteOut: okOut(bytes), scpBytes: bytes });
  const st2 = h2.staging.stage(wav(1));
  const r = h2.bridge.start('qwen3-tts-base', { text: CANARY, staged_ref: st2.id, ref_text: CANARY }, { probe, saveText: false });
  const g = await settle(h2.jobStore, r.job_id);
  assert.equal(g.status, 'COMPLETE');
  const up = h2.calls.find(([c, a]) => c === 'scp' && a.includes('ref.wav'));
  assert.ok(up && up[1].includes(`${h2.dir}/ref.wav`) && !up[1].includes('..'));
  assert.ok(h2.mediaStore.resolve(g.artifacts[0]).meta.reference_used);
  assert.ok(st.id);
});

test('run: second heavy job waits for the lease held by the first (capacity 1)', async () => {
  const bytes = wav();
  let release;
  const gate = new Promise(r => { release = r; });
  const h = harness({ remoteOut: async dir => { await gate; return okOut(bytes)(dir); }, scpBytes: bytes });
  const a = h.bridge.start('kokoro', { text: 'a' }, { probe });
  const b = h.bridge.start('magenta-rt', { prompt: 'b', duration: 4 }, { probe });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(h.arbiter.state().owner.job_id, a.job_id);
  assert.deepEqual(h.arbiter.state().waiting.map(w => w.job_id), [b.job_id]);
  assert.equal(h.jobStore.get(b.job_id).status, 'QUEUED');
  release();
  assert.equal((await settle(h.jobStore, a.job_id)).status, 'COMPLETE');
  assert.equal((await settle(h.jobStore, b.job_id)).status, 'COMPLETE');
  assert.equal(h.arbiter.state().owner, null);
});

test('restart: an in-flight media job reconciles to INTERRUPTED with no stranded lease; private text not stored', () => {
  const base = tmp('restart');
  const s = M.createJobStore(base + '/jobs.json');
  const j = s.create({ media_kind: 'music', operation: 'song', worker_id: 'ace-step', resource_class: 'heavy', params: { ...B.privateOnly({ caption: CANARY, lyrics: CANARY }), duration: 30 } });
  s.transition(j.job_id, 'RUNNING', { resource_lease: 'bigmac-heavy-inference' });
  s.flush();
  assert.ok(!fs.readFileSync(base + '/jobs.json', 'utf8').includes(CANARY));
  const r = M.createJobStore(base + '/jobs.json').get(j.job_id);
  assert.equal(r.status, 'INTERRUPTED'); assert.equal(r.resource_lease, null); assert.equal(r.retry_requires_input, true);
});

test('server wiring: bridged generate path, lease sweep respects durable media jobs, orphan sweep scoped to DexDiffusion tmp', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(w\.bridged\) \{\n    \/\/ Real execution: validation \+ install gating happen before any lease\./);
  assert.match(src, /const mediaActive = !img && gen && \['QUEUED', 'RUNNING', 'TRANSFERRING'\]\.includes\(gen\.status\);/);
  assert.match(src, /mediaBridge\.sweepRemoteOrphans\(60\)/);
  const br = fs.readFileSync(path.join(__dirname, '..', 'media-bridge.js'), 'utf8');
  assert.match(br, /tracked-terminal-resources/);
});

test('OpenVoice V2 conversion validates capability and distinct identities before creating a heavy job', () => {
  const h = harness();
  const a = path.join(h.base, 'source.wav'), b = path.join(h.base, 'target.wav');
  fs.writeFileSync(a, wav()); fs.writeFileSync(b, wav(0.6));
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const common = { sourcePath: a, targetPath: b, sourceSha256: sha(a), targetSampleSha256: sha(b), targetProfileId: 'vp-abcd1234', targetSampleId: 'sm-1234abcd' };
  assert.equal(h.bridge.startConversion({ ...common, probe: { runtime_available: false, model_available: true } }).gate, 'runtime-missing');
  assert.equal(h.bridge.startConversion({ ...common, probe: { runtime_available: true, model_available: false } }).gate, 'model-missing');
  assert.equal(h.bridge.startConversion({ ...common, targetSampleSha256: sha(a), probe }).gate, 'identity-separation');
  assert.equal(h.bridge.startConversion({ ...common, targetProfileId: '../../etc/passwd', probe }).gate, 'reference-invalid');
  assert.equal(h.jobStore.list().length, 0);
  assert.equal(h.arbiter.state().owner, null);
});

test('OpenVoice V2 conversion dispatches with verified lineage, transfers distinct WAVs, and cleans private copies', async () => {
  const bytes = wav(0.55), source = wav(0.6), target = wav(0.7);
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
  const targetHash = crypto.createHash('sha256').update(target).digest('hex');
  const outputHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const converted = [];
  const toWav = async input => {
    const f = path.join(tmp('openvoice-wav'), 'audio.wav'); fs.writeFileSync(f, input.path.endsWith('source.wav') ? source : target); converted.push(f); return f;
  };
  const modelSha = '9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e';
  const watermarkSha = '7a3d873d115c2c644685fb4cf109bdb299718296b88c871d3cf1c8e4cbc13144';
  const h = harness({ scpBytes: bytes, toWav, remoteHashes: [sourceHash, targetHash], remoteOut: dir => [
    `DEXMEDIA_OUTPUT=${dir}/out/converted.wav`, `DEXMEDIA_SHA256=${outputHash}`, 'DEXMEDIA_DURATION=0.55', 'DEXMEDIA_SAMPLE_RATE=24000', 'DEXMEDIA_CHANNELS=1',
    'DEXMEDIA_WATERMARK=enabled-default', `DEXMEDIA_MODEL_SHA256=${modelSha}`, `DEXMEDIA_WATERMARK_SHA256=${watermarkSha}`, 'DEXMEDIA_PASS', 'DEXMEDIA_DONE', ''
  ].join('\n') });
  const sourcePath = path.join(h.base, 'source.wav'), targetPath = path.join(h.base, 'target.wav');
  fs.writeFileSync(sourcePath, wav(0.6)); fs.writeFileSync(targetPath, wav(0.7));
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const result = h.bridge.startConversion({ sourcePath, targetPath, sourceStagingId: 'stg-source-test', sourceSha256: sha(sourcePath),
    targetProfileId: 'vp-abcd1234', targetSampleId: 'sm-1234abcd', targetSampleSha256: sha(targetPath), probe });
  const job = await settle(h.jobStore, result.job_id);
  assert.equal(job.status, 'COMPLETE'); assert.equal(job.worker_id, 'openvoice-v2'); assert.equal(job.operation, 'voice-conversion');
  const rec = h.mediaStore.resolve(job.artifacts[0]);
  assert.equal(rec.sha256, outputHash); assert.equal(rec.parent, 'stg-source-test');
  assert.equal(rec.meta.conversion.source_staging_id, 'stg-source-test');
  assert.equal(rec.meta.conversion.target_profile_id, 'vp-abcd1234'); assert.equal(rec.meta.conversion.target_sample_id, 'sm-1234abcd');
  assert.equal(rec.meta.conversion.converter_checkpoint_sha256, modelSha); assert.equal(rec.meta.conversion.watermark_model_sha256, watermarkSha);
  assert.equal(rec.meta.conversion.source_wav_sha256, sourceHash); assert.equal(rec.meta.conversion.target_wav_sha256, targetHash);
  assert.deepEqual(rec.meta.conversion.parameters, { device: 'cpu', tau: 0.3, watermark: 'enabled-default' });
  const payload = h.payload(), encoded = [...payload.matchAll(/printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > "\$D\/[^\"]+"/g)].map(m => Buffer.from(m[1], 'base64').toString());
  assert.ok(encoded.some(s => s.includes('ToneColorConverter')), 'OpenVoice V2 adapter is dispatched');
  const request = encoded.map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).find(o => o && o.source_wav_sha256);
  assert.equal(request.source_wav_sha256, sourceHash); assert.equal(request.target_wav_sha256, targetHash);
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('shasum -a 256')));
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf') && a.includes('dexmedia.TEST01')));
  assert.equal(h.arbiter.state().owner, null, 'shared heavy-compute lease released');
  assert.ok(converted.every(f => !fs.existsSync(f)), 'MacBook worker WAV scratch copies removed');
});

test('OpenVoice V2 failure without verified default watermark creates no artifact and still cleans up', async () => {
  const output = wav(), outputHash = crypto.createHash('sha256').update(output).digest('hex');
  const input = wav(0.7), sourcePath = path.join(tmp('openvoice-fail'), 'source.wav'), targetPath = path.join(tmp('openvoice-fail'), 'target.wav');
  fs.writeFileSync(sourcePath, input); fs.writeFileSync(targetPath, wav(0.8));
  const converted = [];
  const toWav = async p => { const f = path.join(tmp('openvoice-fail-wav'), 'x.wav'); fs.writeFileSync(f, p.path === sourcePath ? input : wav(0.8)); converted.push(f); return f; };
  const ssha = crypto.createHash('sha256').update(input).digest('hex'), tsha = crypto.createHash('sha256').update(wav(0.8)).digest('hex');
  const h = harness({ scpBytes: output, toWav, remoteHashes: [ssha, tsha], remoteOut: dir => `DEXMEDIA_OUTPUT=${dir}/out/converted.wav\nDEXMEDIA_SHA256=${outputHash}\nDEXMEDIA_PASS\nDEXMEDIA_DONE\n` });
  const hashFile = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const r = h.bridge.startConversion({ sourcePath, targetPath, sourceSha256: hashFile(sourcePath), targetProfileId: 'vp-abcd1234', targetSampleId: 'sm-1234abcd', targetSampleSha256: hashFile(targetPath), probe });
  const job = await settle(h.jobStore, r.job_id);
  assert.equal(job.status, 'FAILED'); assert.equal(job.first_failed_gate, 'output-invalid');
  assert.deepEqual(fs.readdirSync(h.roots.voice), []); assert.equal(h.arbiter.state().owner, null);
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf') && a.includes('dexmedia.TEST01')));
  assert.ok(converted.every(f => !fs.existsSync(f)));
});

// D-034: cleanup transport must not bypass release in finally.
test('cleanup transport throws: completed output survives, exact cleanup failure persists, lease released', async () => {
  const bytes = wav(), h = harness({ remoteOut: okOut(bytes), scpBytes: bytes, cleanupThrows: true });
  const r = h.bridge.start('kokoro', { text: 'fixture' }, { probe });
  const g = await settle(h.jobStore, r.job_id);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(g.status, 'COMPLETE'); assert.equal(h.arbiter.state().owner, null);
  assert.equal(g.owned_resources[0].state, 'failed');
  assert.equal(g.owned_resources[0].receipt.reason, 'cleanup transport failed');
  assert.ok(h.mediaStore.resolve(g.artifacts[0]));
});
