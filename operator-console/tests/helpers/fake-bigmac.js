'use strict';
const { trackScratch } = require('./owned-scratch');
// Shared fake Big Mac: real job store, lease arbiter, media store and media bridge; ssh/scp/ffmpeg are faked.
// Every synthesised item is a deterministic tone whose frequency is derived from the item index + seed, so
// tests can assert which audio landed where without any model.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../../media'); const B = require('../../media-bridge');
const A = require('../../voice-audio');
const { createProfileStore } = require('../../voice-profiles'); const { createVoiceService } = require('../../voice-service');

const tmp = p => trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-fb-' + p)));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tone = (sec = 1, hz = 220, amp = 0.4, rate = 24000) => { const n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };

function harness(opts = {}) {
  const state = { failItem: opts.failItem == null ? null : opts.failItem, lose: !!opts.lose, cleaned: opts.cleaned !== false, requests: [], remoteItems: new Map(), delayMs: opts.delayMs || 0 };
  const base = opts.base || tmp('run');
  const roots = { image: base + '/img', voice: base + '/voice', music: base + '/music', video: base + '/video', world: base + '/world' };
  const mediaStore = M.createMediaStore({ roots, registryFile: base + '/media.json' }); mediaStore.ensureRoots();
  const jobStore = M.createJobStore(base + '/jobs.json', { onChange: opts.onChange || null });
  const arbiter = M.createResourceArbiter();
  const staging = M.createStaging({ root: base + '/stg' });
  let dirN = 0; const dirs = [];
  const calls = [];
  const exec = async (cmd, args) => {
    const a = args.join(' '); calls.push([cmd, a]);
    if (cmd === 'ssh' && a.includes('mktemp -d')) { const d = `$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.FB${String(++dirN).padStart(4, '0')}`; dirs.push(d); return { ok: true, stdout: `DEXMEDIA_DIR=${d}\n` }; }
    if (cmd === 'ssh' && a.includes('ref.wav')) return { ok: true, stdout: 'DEXMEDIA_REF_OK\n' };
    if (cmd === 'ssh' && a.includes('rm -rf')) { const m = /echo DEXMEDIA_CLEANED=([a-f0-9]{64})/.exec(a); return { ok: true, stdout: state.cleaned && m ? 'DEXMEDIA_CLEANED=' + m[1] + '\n' : 'DEXMEDIA_STILL_THERE\n' }; }
    if (cmd === 'scp' && a.includes('/out/item-')) { const m = /(dexmedia\.FB\d+)\/out\/item-(\d+)\.wav/.exec(a); fs.writeFileSync(args[args.length - 1], state.remoteItems.get(m[1] + ':' + Number(m[2]))); return { ok: true, stdout: '' }; }
    return { ok: true, stdout: '' };
  };
  const sshRunFn = async (_t, payload, _to, onData) => {
    const rq = JSON.parse(Buffer.from(/printf %s '([A-Za-z0-9+/=]{20,})' \| base64 -d > "\$D\/request\.json"/.exec(payload)[1], 'base64').toString());
    const dirName = /(dexmedia\.FB\d+)/.exec(payload)[1]; const dir = `$HOME/Library/Caches/DexDiffusion/tmp/${dirName}`;
    state.requests.push(rq);
    const n = rq.items.length; let out = `DEXMEDIA_STARTED=${rq.worker}\nDEXMEDIA_MODEL_LOADING\nDEXMEDIA_MODEL_READY\nDEXMEDIA_ITEMS_TOTAL=${n}\n`;
    const emit = piece => { out += piece; if (onData) onData(piece); };
    for (let i = 0; i < n; i++) {
      if (state.delayMs) await new Promise(r => setTimeout(r, state.delayMs));
      emit(`DEXMEDIA_ITEM_START=${i}\n`);
      if (state.failItem === i) { emit(`DEXMEDIA_FAIL_ITEM=${i}\nDEXMEDIA_FAIL=generation\nDEXMEDIA_ERROR=engine exploded on [REDACTED]\n`); return out; }
      const seed = rq.items[i].seed == null ? 0 : Number(rq.items[i].seed);
      const sec = Math.min(20, 0.4 + String(rq.items[i].text || '').length * 0.06), a = tone(sec, 200 + i * 20 + (seed % 50)), buf = A.encodeWav(a); state.remoteItems.set(dirName + ':' + i, buf);
      emit(`DEXMEDIA_ITEM=${i}|${dir}/out/item-${String(i).padStart(3, '0')}.wav|${sha(buf)}|${buf.length}|${A.duration(a)}|24000|1\n`);
      if (state.lose && i === state.lose - 1) return out;     // connection lost: no DONE marker
    }
    return out + `DEXMEDIA_OUTPUT=${dir}/out/item-000.wav\nDEXMEDIA_PASS\nDEXMEDIA_DONE\n`;
  };
  const toWav = async () => { const f = path.join(tmp('ref'), 'ref.wav'); fs.writeFileSync(f, A.encodeWav(tone(5))); return f; };
  const bridge = B.createMediaBridge({ jobStore, arbiter, mediaStore, staging, evidenceFile: base + '/ev.json', exec, sshRunFn, toWav });
  const profiles = createProfileStore({ root: base + '/profiles', ingest: async p => fs.readFileSync(p) });
  const probeFor = () => ({ runtime_available: true, model_available: true });
  const voice = createVoiceService({ bridge, jobStore, mediaStore, profiles, probeFor });
  return { base, roots, mediaStore, jobStore, arbiter, staging, bridge, profiles, voice, svc: voice, calls, state, probeFor };
}
async function settle(voice, id) { return voice.waitJob(id, { pollMs: 5, timeoutMs: 20000 }); }
const writeWav = a => { const f = path.join(tmp('src'), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return f; };

module.exports = { harness, settle, tone, sha, tmp, writeWav };
