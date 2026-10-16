'use strict';
// A complete production rig: fake Big Mac + real stores/services + producer.
const fs = require('node:fs'); const path = require('node:path');
const { harness } = require('./fake-bigmac');
const D = require('../../drama'); const { createDramaStore } = require('../../drama'); const { createDramaService } = require('../../drama-service');
const { createChunkStore } = require('../../chunk-store'); const { createProducer } = require('../../drama-producer');
const { createQa } = require('../../drama-qa'); const { createProofStore } = require('../../proof-store'); const { createAssembly } = require('../../drama-assembly'); const { createDerivedStore } = require('../../derived-store');

const VOICES = ['af_heart', 'am_adam', 'bf_emma', 'bm_george', 'am_echo'];
function rig(opts = {}) {
  const h = harness(opts);
  const dstore = createDramaStore({ root: h.base + '/drama' });
  const derived = createDerivedStore({ root: h.base + '/derived' });
  const assembly = createAssembly({ mediaStore: h.mediaStore, derived, workRoot: h.base });
  const drama = createDramaService({ store: dstore, voice: h.voice, profiles: h.profiles, mediaStore: h.mediaStore, engineAvailable: () => ({ ok: true }), assembly });
  const chunkStore = createChunkStore({ root: h.base + '/drama-chunks', persist: id => !!(dstore.get(id) || {}).saved });
  const events = [];
  const qa = createQa({ mediaStore: h.mediaStore, detectAsr: opts.detectAsr || (() => ({ available: false, reason: 'the test rig has no local recogniser' })), asr: opts.asr });
  const proofs = createProofStore({ root: h.base + '/proofs' });
  const producer = createProducer({ drama, store: dstore, voice: h.voice, profiles: h.profiles, mediaStore: h.mediaStore, jobStore: h.jobStore, chunkStore, assembly, qa, proofs, pollMs: 2, now: opts.now, onEvent: e => events.push(e), ...(opts.producer || {}) });
  drama.attachProducer(producer);
  const speakerProfile = new Map();
  async function project(script, { bind = true, title = 'Test drama' } = {}) {
    const c = await drama.createProject({ title, script }); const p = drama.need(c.project.id);
    if (bind) for (const a of p.actors) {
      if (!speakerProfile.has(a.speaker_key)) speakerProfile.set(a.speaker_key, h.profiles.create({ name: a.speaker, type: 'preset', preset_voice: VOICES[speakerProfile.size % VOICES.length] }).id);
      D.bindActor(p, a.id, speakerProfile.get(a.speaker_key));
    }
    return p;
  }
  const finish = async (res, ms = 20000) => producer.waitFor(res.production.id, ms);
  return Object.assign(h, { dstore, drama, chunkStore, producer, assembly, derived, qa, proofs, events, project, finish, speakerProfile });
}
module.exports = { rig };
