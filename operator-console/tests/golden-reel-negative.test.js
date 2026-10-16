'use strict';
// Honest-failure scenarios against the Golden Reel script (fake Big Mac; real producer, planner, mixer, FFmpeg). Complements the
// per-module negative tests: these assert the END-TO-END outcome (no job, no master, no false success) for the specific production.
const test = require('node:test'); const assert = require('node:assert/strict');
const D = require('../drama'); const P = require('../drama-planner'); const T = require('../audio-tools'); const SD = require('../sound-director');
const { rig } = require('./helpers/drama-rig');
const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const SCRIPT = `INT. CONTROL ROOM - NIGHT

CONTROL: Station Nine, this is Control. Do you copy?

NINE: I copy. The delay is wrong.

INT. STATION NINE - NIGHT

NINE: There wasn't. Until you said that.
`;
const lines = p => D.renderableLines(p).map(x => x.line);

test('A: an engine that is unavailable blocks production with the named reason; no job, no Big Mac call', async () => {
  const r = await rig({}); const p = await r.project(SCRIPT);
  r.drama.planContext = () => ({ profiles: r.profiles, media: r.mediaStore, engineAvailable: () => ({ ok: false, reason: 'qwen3-tts-voice-design runtime is not available' }) });
  const before = r.jobStore.list ? r.jobStore.list().length : 0;
  assert.throws(() => r.producer.produce(p.id), e => e.gate === 'production-blocked' && /not available|unavailable/i.test(e.message));
  assert.equal(r.state.requests.length, 0); assert.equal(r.jobStore.list ? r.jobStore.list().length : 0, before, 'no job was created');
});

test('B: a REQUIRED sound cue with no asset blocks production (it cannot be silently skipped); an OPTIONAL one only warns', opts, async () => {
  const r = await rig({}); const p = await r.project(SCRIPT.replace('NINE: I copy.', '[SFX: comms beep, required]\nNINE: I copy.'));
  assert.equal(SD.scriptCues(p).length, 1); assert.equal(SD.scriptCues(p)[0].required, true);
  assert.throws(() => r.producer.produce(p.id), e => e.gate === 'production-blocked' && /cue/i.test(e.message));
  assert.equal(r.state.requests.length, 0); assert.equal(p.project_master, undefined);
  const opt = await r.project(SCRIPT.replace('NINE: I copy.', '[SFX: comms beep]\nNINE: I copy.'), { title: 'optional' });
  const plan = P.planProduction(opt, r.drama.planContext()); assert.equal(plan.ready, true, 'optional cue does not block'); assert.ok(plan.review_items.some(i => /cue/i.test(i.code)), 'but it is visible as a review item');
});

test('K: a mixer failure fails the production and publishes no master, scene master or export', opts, async () => {
  const r = await rig({}); const p = await r.project(SCRIPT);
  const Mixer = require('../drama-mixer'), orig = Mixer.renderScene; Mixer.renderScene = async () => { throw new Error('mixer failed: simulated'); };
  let fin; try { fin = await r.finish(r.producer.produce(p.id)); } finally { Mixer.renderScene = orig; }
  assert.equal(fin.status, 'failed'); assert.match(fin.errors.map(e => e.message).join(' '), /mixer failed/);
  assert.equal(p.project_master, undefined); assert.deepEqual(p.scene_masters || {}, {}); assert.equal(p.exports.length, 0); assert.equal(r.jobStore.get(fin.job_id).status, 'FAILED');
  assert.ok(lines(p).every(l => l.takes.some(t => t.status === 'complete')), 'the speech that was generated is kept for the next attempt');
  const retry = await r.finish(r.producer.produce(p.id)); assert.equal(retry.status, 'complete'); assert.equal(retry.lines.generated, 0, 'retry reuses all speech');
});

test('L: cancelling a production only ever cleans resources it created; unrelated remote directories are never targeted', async () => {
  const r = await rig({ delayMs: 15 }); const p = await r.project(SCRIPT);
  const res = r.producer.produce(p.id);
  for (let i = 0; i < 400 && !r.state.requests.length; i++) await new Promise(x => setTimeout(x, 5));
  r.producer.cancel(res.production.id); const fin = await r.finish(res); assert.equal(fin.status, 'cancelled');
  const cleanups = r.calls.filter(([c, a]) => c === 'ssh' && a.includes('rm -rf')).map(([, a]) => a);
  assert.ok(cleanups.length >= 1, 'its own job directory was cleaned');
  for (const a of cleanups) { assert.match(a, /dexmedia\.FB\d+/, 'targets only a directory created by this harness'); assert.doesNotMatch(a, /rm -rf "?(\/|\$HOME"?\s|~|\*)/, 'never a broad path'); }
  assert.equal(r.arbiter.state().owner, null, 'the heavy-compute lease is released'); assert.equal(r.jobStore.get(res.job_id).status, 'CANCELLED');
});

test('F: an OUTDATED take is never used in a current-source production: editing text regenerates, the old take stays as history', opts, async () => {
  const r = await rig({}); const p = await r.project(SCRIPT); await r.finish(r.producer.produce(p.id));
  const target = lines(p).find(l => /wrong/.test(l.text)); const oldTake = target.takes[0];
  await r.drama.reparse(p.id, { script: SCRIPT.replace('The delay is wrong', 'The delay is broken'), apply: true });
  const plan = P.planProduction(p, r.drama.planContext()); assert.equal(plan.counts.stale + plan.counts.new, 1, 'the edited line needs speech again'); assert.equal(plan.counts.reuse, 2, 'the other lines are reusable');
  assert.ok(!plan.reusable.some(x => x.line_id === target.id), 'the outdated take is not offered for reuse');
  const fin = await r.finish(r.producer.produce(p.id)); assert.equal(fin.status, 'complete'); assert.equal(fin.lines.generated, 1);
  const now = lines(p).find(l => l.id === target.id); const current = P.planProduction(p, r.drama.planContext()).chosen.get(now.id); assert.ok(current, 'a current take is chosen'); assert.notEqual(current.id, oldTake.id); assert.ok(now.takes.some(t => t.id === oldTake.id), 'history kept');
  const snap = r.proofs.get(fin.id).snapshot.lines.find(l => l.line_id === now.id); assert.equal(snap.take_id, current.id, 'the proof/master uses the current take'); assert.notEqual(snap.take_id, oldTake.id);
});
