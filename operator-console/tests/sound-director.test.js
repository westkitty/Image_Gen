'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const M = require('../media'); const A = require('../voice-audio'); const T = require('../audio-tools'); const D = require('../drama'); const SD = require('../sound-director'); const TL = require('../drama-timeline'); const P = require('../drama-planner');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-sd-'));
const store = () => { const b = tmp(); const s = M.createMediaStore({ roots: { image: b + '/i', voice: b + '/v', music: b + '/m', video: b + '/vid', world: b + '/w' }, registryFile: b + '/media.json' }); s.ensureRoots(); return s; };
const tone = (sec, hz = 300) => ({ sampleRate: 24000, channels: [new Float32Array(Math.round(sec * 24000)).map((_, i) => 0.3 * Math.sin(2 * Math.PI * hz * i / 24000))] });
const wavArt = (ms, a, kind = 'music', base = 'a') => { const f = path.join(tmp(), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return ms.finalize(f, { kind, base, duration: a.channels[0].length / a.sampleRate }); };
const SCRIPT = `INT. WAREHOUSE - NIGHT
[AMBIENCE: rain on a tin roof, loop, fade in 2s]
TIGER: I warned you.
[SFX: a heavy door slams, for 1.5s]
CODEC: I heard it.
[MUSIC: tense strings, fade out 3s, optional]
[A door slams somewhere below.]
CODEC: Goodbye.`;

test('the parser recognises sound cues as cues, not dialogue, narration or spoken text', () => {
  const parsed = D.parseScript(SCRIPT); const all = parsed.scenes.flatMap(s => s.lines);
  const cues = all.filter(l => l.cue);
  assert.deepEqual(cues.map(c => [c.cue.role, c.cue.description]), [['ambience', 'rain on a tin roof'], ['sfx', 'a heavy door slams'], ['music', 'tense strings']]);
  assert.equal(cues[0].cue.params.loop, true); assert.equal(cues[0].cue.params.fade_in_s, 2); assert.equal(cues[1].cue.params.duration_s, 1.5); assert.equal(cues[2].cue.params.optional, true); assert.equal(cues[2].cue.params.fade_out_s, 3);
  assert.ok(cues.every(c => c.kind === 'direction' && c.render === false), 'never rendered as speech');
  assert.equal(all.filter(l => l.kind === 'dialogue').length, 3);
  assert.equal(all.find(l => /door slams somewhere/.test(l.text)).cue, undefined, 'an ordinary stage direction is not a cue');
  const cov = D.verifySourceCoverage(SCRIPT, parsed); assert.equal(cov.ok, true, 'cues are still fully classified source');
});

test('script cues start unresolved; optional ones are warnings, required ones block certification', () => {
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });
  const cues = SD.scriptCues(p); assert.equal(cues.length, 3); assert.ok(cues.every(c => c.status === 'unresolved'));
  assert.deepEqual(cues.map(c => c.required), [false, false, false], 'script cues default to optional so existing scripts keep producing');
  SD.setRequired(p, cues[1].line_id, true); assert.equal(SD.scriptCues(p)[1].required, true);
  const issues = SD.cueIssues(p); assert.deepEqual(issues.blocking.map(i => i.code), ['cue-unresolved']); assert.equal(issues.warnings.length, 2);
});

test('binding a cue to a local library asset creates an anchored track; unbinding removes it; unknown assets are refused', () => {
  const ms = store(); const rain = wavArt(ms, tone(2, 90), 'music', 'rain');
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) }); const cue = SD.scriptCues(p)[0];
  assert.throws(() => SD.bind(p, cue.line_id, { artifact_id: 'nope.wav' }, ms), /not in the library/); assert.throws(() => SD.bind(p, 'ln-999', { artifact_id: rain.artifact_id }, ms), /cue not found/);
  const tr = SD.bind(p, cue.line_id, { artifact_id: rain.artifact_id, gain: 0.4 }, ms);
  assert.equal(tr.role, 'ambience'); assert.equal(tr.loop, true); assert.equal(tr.fade_in_s, 2); assert.equal(tr.cue_line_id, cue.line_id); assert.equal(tr.scene_id, p.scenes[0].id); assert.equal(tr.duck, true);
  assert.equal(SD.scriptCues(p)[0].status, 'resolved'); assert.equal(p.tracks.length, 1);
  SD.bind(p, cue.line_id, { artifact_id: rain.artifact_id, gain: 0.2 }, ms); assert.equal(p.tracks.length, 1, 'rebinding updates the same track');
  SD.unbind(p, cue.line_id); assert.equal(p.tracks.length, 0); assert.equal(SD.scriptCues(p)[0].status, 'unresolved');
});

test('an anchored cue is placed at its position in the script and follows the dialogue; manual placement detaches it', () => {
  const ms = store(); const door = wavArt(ms, tone(1, 700), 'music', 'door'), dlg = wavArt(ms, tone(1, 400), 'voice', 'd');
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) }); p.settings.line_gap_s = 0.5;
  const lines = D.renderableLines(p).map(x => x.line); lines.forEach(l => { const t = D.addTake(p, l.id, { status: 'complete', artifact_id: dlg.artifact_id, sha256: dlg.sha256, duration: 1 }); l.active_take_id = t.id; });
  const cue = SD.scriptCues(p)[1]; SD.bind(p, cue.line_id, { artifact_id: door.artifact_id }, ms);
  const takeFor = l => l.takes[0]; const tl = TL.buildSceneTimeline(p, p.scenes[0], { takeFor, media: ms });
  const c = tl.cues[0]; assert.equal(c.start_frame, 48000 * 1, 'right after the first spoken line ends (1.0 s)');
  p.tracks[0].start_s = 0.25; assert.equal(TL.buildSceneTimeline(p, p.scenes[0], { takeFor, media: ms }).cues[0].start_frame, 48000 * 1.25, 'offset relative to the anchor');
  const extra = D.setLine(p, lines[0].id, { pause_before_s: 2 }); void extra;
  assert.equal(TL.buildSceneTimeline(p, p.scenes[0], { takeFor, media: ms }).cues[0].start_frame, 48000 * 3.25, 'moves with the dialogue it follows');
  SD.detach(p, p.tracks[0].id, { takeFor, media: ms }); assert.equal(p.tracks[0].cue_line_id, undefined); assert.equal(TL.buildSceneTimeline(p, p.scenes[0], { takeFor, media: ms }).cues[0].start_frame, 48000 * 3.25, 'detaching freezes the absolute time');
});

test('the planner blocks on a required unresolved cue and reports optional ones as review items', () => {
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });
  const profiles = { get: id => ({ id, name: id, type: 'preset', preset_voice: 'af_heart', language: 'en', validation: { state: 'valid' }, preferred_engine: 'kokoro', samples: [] }) };
  for (const a of p.actors) D.bindActor(p, a.id, 'vp-1111111111');
  const ms = store(); const ctx = { profiles, media: ms };
  let plan = P.planProduction(p, ctx); assert.ok(plan.ready); assert.ok(plan.review_items.filter(r => r.code === 'optional-cue-unresolved').length === 3);
  SD.setRequired(p, SD.scriptCues(p)[0].line_id, true);
  plan = P.planProduction(p, ctx); assert.equal(plan.ready, false); assert.ok(plan.blocking_errors.some(b => b.code === 'cue-unresolved' && b.scope === p.scenes[0].id));
});

test('reparse keeps bound cues attached to the same cue lines', () => {
  const R = require('../drama-reparse'); const ms = store(); const rain = wavArt(ms, tone(2, 90), 'music', 'rain');
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) }); const cue = SD.scriptCues(p)[0]; SD.bind(p, cue.line_id, { artifact_id: rain.artifact_id }, ms);
  const edited = SCRIPT.replace('I warned you.', 'I warned you twice.');
  R.reparse(p, edited, D.parseScript(edited), { apply: true });
  assert.equal(SD.scriptCues(p)[0].status, 'resolved'); assert.equal(SD.scriptCues(p)[0].line_id, cue.line_id);
});

test('suggestions rank local library assets by words in the cue; nothing is fetched or invented', () => {
  const ms = store(); wavArt(ms, tone(1), 'music', 'rain-loop-heavy'); wavArt(ms, tone(1), 'music', 'door-slam'); wavArt(ms, tone(1), 'voice', 'take-unrelated');
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });
  const s = SD.suggest(p, SD.scriptCues(p)[0].line_id, ms); assert.match(s.matches[0].artifact_id, /rain-loop/); assert.ok(s.matches.every(m => m.kind === 'music' || m.kind === 'voice'));
  assert.ok(s.procedural.some(x => x.recipe === 'rain')); assert.match(s.note, /local library/i);
});

test('procedural effects are generated locally with FFmpeg and registered as canonical, labelled artifacts', { skip: T.available().ffmpeg ? false : 'ffmpeg missing' }, async () => {
  const ms = store();
  for (const recipe of ['room_tone', 'rain', 'static', 'hum', 'beep', 'tone', 'silence']) {
    const rec = await SD.generateProcedural({ recipe, seconds: 1.5, frequency: 523 }, { mediaStore: ms, tools: T });
    assert.equal(rec.meta.operation, 'procedural-sfx'); assert.equal(rec.meta.recipe, recipe); assert.ok(Math.abs(rec.duration - (recipe === 'beep' ? 0.3 : 1.5)) < 0.1, recipe + ' ' + rec.duration);
    const scan = await T.scanWav(ms.resolve(rec.artifact_id).path); assert.equal(scan.non_finite, 0); assert.equal(scan.silent, recipe === 'silence', recipe);
  }
  await assert.rejects(SD.generateProcedural({ recipe: 'thunder-from-the-cloud' }, { mediaStore: ms, tools: T }), /unknown recipe/);
  const a = await SD.generateProcedural({ recipe: 'rain', seconds: 1, seed: 7 }, { mediaStore: ms, tools: T }), b = await SD.generateProcedural({ recipe: 'rain', seconds: 1, seed: 7 }, { mediaStore: ms, tools: T });
  assert.equal(a.sha256, b.sha256, 'seeded recipes are reproducible');
});
