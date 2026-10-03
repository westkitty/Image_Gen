'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const D = require('../drama');
const A = require('../voice-audio');

const SCRIPT = `INT. WAREHOUSE - NIGHT

The rain hammers the roof. A single lamp swings overhead.

TIGER: I warned you.
CODEC: [quietly] I know.
TIGER (angry): Then why did you come
back here?

[pause 2s]
CODEC: Because (sighs) I had no choice.

EXT. ROOFTOP - DAWN

Dawn breaks over the city.
NARRATOR: And so it ended.`;

const lines = p => p.scenes.flatMap(s => s.lines);

test('parser: scenes, speakers, narration, directions, wrapped lines, pauses', () => {
  const r = D.parseScript(SCRIPT);
  assert.deepEqual(r.scenes.map(s => s.title), ['INT. WAREHOUSE - NIGHT', 'EXT. ROOFTOP - DAWN']);
  const L = lines(r);
  assert.deepEqual(L.map(l => [l.speaker, l.kind]), [['NARRATOR', 'narration'], ['TIGER', 'dialogue'], ['CODEC', 'dialogue'], ['TIGER', 'dialogue'], ['CODEC', 'dialogue'], ['NARRATOR', 'narration'], ['NARRATOR', 'dialogue']]);
  assert.equal(L[1].text, 'I warned you.'); assert.equal(L[1].direction, '');
  assert.equal(L[2].text, 'I know.'); assert.equal(L[2].direction, 'quietly');
  assert.equal(L[3].direction, 'angry'); assert.equal(L[3].text, 'Then why did you come back here?', 'wrapped dialogue joins');
  assert.equal(L[4].pause_before_s, 2, '[pause 2s] applies to the next spoken line');
  assert.match(L[4].text, /\(sighs\)/, 'inline paralinguistic tags stay in the text');
  assert.equal(L[5].text, 'Dawn breaks over the city.');
  assert.deepEqual(r.speakers.map(s => [s.key, s.lines]), [['NARRATOR', 3], ['TIGER', 2], ['CODEC', 2]]);
});

test('parser: source offsets point into the ORIGINAL script (original text stays authoritative)', () => {
  const r = D.parseScript(SCRIPT);
  for (const l of lines(r).filter(x => x.src)) {
    const piece = SCRIPT.slice(l.src.start, l.src.end);
    assert.ok(piece.includes(l.text.split(' ')[0]), `${l.id}: ${piece}`);
  }
});

test('parser: Fountain-style cues and mixed-case names', () => {
  const f = D.parseScript('TIGER\n(whispering)\nStay quiet.\nWe are not alone.\n\nCODEC\nUnderstood.');
  assert.deepEqual(lines(f).map(l => [l.speaker, l.direction, l.text]), [['TIGER', 'whispering', 'Stay quiet. We are not alone.'], ['CODEC', '', 'Understood.']]);
  const m = D.parseScript('Anna: hello there\nBen: hi\nAnna: how are you');
  assert.deepEqual(lines(m).map(l => l.speaker), ['Anna', 'Ben', 'Anna']);
  const prose = D.parseScript('Note: this is a plain sentence.\nIt continues here.');
  assert.ok(lines(prose).every(l => l.kind === 'narration'), 'stop-words are not speakers');
});

test('parser: stage directions are kept but not rendered; empty/no-dialogue scripts warn', () => {
  const r = D.parseScript('[A door slams]\nTIGER: Hey.');
  assert.deepEqual(lines(r).map(l => [l.kind, l.render]), [['direction', false], ['dialogue', true]]);
  assert.ok(D.parseScript('').warnings[0].match(/No lines/));
  assert.ok(D.parseScript('Just narration here.').warnings.some(w => /No dialogue/.test(w)));
});

test('LLM parse: verbatim lines accepted; rewritten or invented lines are rejected, never silently fixed', () => {
  const src = 'TIGER: I warned you. CODEC: I know. It was raining.';
  const ok = D.validateLlmParse(src, { scenes: [{ title: 'S', lines: [{ speaker: 'TIGER', kind: 'dialogue', text: 'I warned you.', direction: '' }, { speaker: 'CODEC', kind: 'dialogue', text: 'I know.', direction: 'quietly' }, { speaker: 'x', kind: 'narration', text: 'It was raining.' }] }] });
  assert.equal(ok.ok, true); assert.equal(ok.parsed.scenes[0].lines[2].speaker, 'NARRATOR');
  const bad = D.validateLlmParse(src, { scenes: [{ lines: [{ speaker: 'TIGER', kind: 'dialogue', text: 'I told you so.' }] }] });
  assert.equal(bad.ok, false); assert.equal(bad.rejected.length, 1); assert.match(bad.errors[0], /not verbatim/);
  assert.equal(D.validateLlmParse(src, { nope: 1 }).ok, false);
  assert.equal(D.validateLlmParse(src, { scenes: [{ lines: [{ speaker: 'A', kind: 'shout', text: 'I know.' }] }] }).ok, false);
});

test('LLM parse: model failure and non-JSON are reported, not thrown', async () => {
  assert.match((await D.parseWithLlm('x: y', { chat: async () => { throw new Error('offline'); } })).errors[0], /unavailable/);
  assert.match((await D.parseWithLlm('x: y', { chat: async () => 'sorry, no json' })).errors[0], /valid JSON/);
  const good = await D.parseWithLlm('A: hi there', { chat: async () => '```json\n{"scenes":[{"lines":[{"speaker":"A","kind":"dialogue","text":"hi there"}]}]}\n```' });
  assert.equal(good.ok, true);
});

const mkProject = () => D.newProject({ title: 'T', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });

test('cast: actors discovered; render blocked only for unresolved speakers with renderable lines', () => {
  const p = mkProject();
  assert.deepEqual(p.actors.map(a => a.speaker_key).sort(), ['CODEC', 'NARRATOR', 'TIGER']);
  assert.deepEqual(D.unresolvedSpeakers(p).map(u => u.key).sort(), ['CODEC', 'NARRATOR', 'TIGER']);
  p.actors.forEach(a => D.bindActor(p, a.id, 'vp-' + a.speaker_key.toLowerCase()));
  assert.deepEqual(D.unresolvedSpeakers(p), []);
  const q = mkProject();
  D.bindActor(q, q.actors.find(a => a.speaker_key === 'TIGER').id, 'vp-t'); D.bindActor(q, q.actors.find(a => a.speaker_key === 'CODEC').id, 'vp-c');
  const narr = lines(q).filter(l => l.speaker_key === 'NARRATOR'); narr.forEach(l => D.setLine(q, l.id, { render: false }));
  assert.deepEqual(D.unresolvedSpeakers(q), [], 'a speaker with no renderable lines does not block');
});

test('line edits: reassign speaker, kind, direction, pauses; edited text is flagged', () => {
  const p = mkProject(); const l = lines(p)[1];
  D.setLine(p, l.id, { speaker: 'Rex', direction: 'furious but controlled', pause_before_s: '1.5', pause_after_s: 0.2 });
  assert.deepEqual([l.speaker_key, l.direction, l.pause_before_s, l.pause_after_s], ['REX', 'furious but controlled', 1.5, 0.2]);
  assert.ok(p.actors.some(a => a.speaker_key === 'REX'));
  D.setLine(p, l.id, { text: 'changed' }); assert.equal(l.edited, true);
  D.setLine(p, l.id, { kind: 'direction' }); assert.equal(l.render, false);
});

test('takes: re-render creates another take; nothing is overwritten; active take is user-selected', () => {
  const p = mkProject(); const l = lines(p)[1];
  const t1 = D.addTake(p, l.id, { profile_id: 'vp-a', engine: 'e', seed: 1 }); assert.equal(D.lineStatus(l), 'rendering');
  D.completeTake(p, l.id, t1.id, { status: 'complete', artifact_id: 'a1.wav', duration: 1.5 });
  assert.equal(l.active_take_id, t1.id); assert.equal(D.lineStatus(l), 'generated');
  const t2 = D.addTake(p, l.id, { profile_id: 'vp-a', engine: 'e', seed: 2 });
  D.completeTake(p, l.id, t2.id, { status: 'complete', artifact_id: 'a2.wav', duration: 2 });
  assert.equal(l.takes.length, 2); assert.equal(l.takes[0].artifact_id, 'a1.wav'); assert.equal(l.active_take_id, t1.id, 'a new take does not steal the active slot');
  assert.equal(D.selectTake(p, l.id, t2.id).id, t2.id); assert.equal(l.active_take_id, t2.id);
  const t3 = D.addTake(p, l.id, {}); assert.equal(D.selectTake(p, l.id, t3.id), null, 'cannot select an unfinished take');
  D.completeTake(p, l.id, t3.id, { status: 'failed', error: 'boom' }); assert.equal(l.takes.length, 3);
});

function withTakes(p, dur = 1) {
  for (const { line } of D.renderableLines(p)) { const t = D.addTake(p, line.id, {}); D.completeTake(p, line.id, t.id, { status: 'complete', artifact_id: line.id + '.wav', duration: dur }); }
  return p;
}
test('timeline: scene ordering and pause handling', () => {
  const p = withTakes(mkProject()); p.settings.line_gap_s = 0.5; p.settings.scene_gap_s = 2;
  const L = lines(p).filter(l => l.render !== false); D.setLine(p, L[1].id, { pause_before_s: 1 }); D.setLine(p, L[2].id, { pause_after_s: 0 });
  const plan = D.planTimeline(p, { takeDuration: () => 1 });
  assert.equal(plan.items.length, 7); assert.deepEqual(plan.items.map(i => i.scene_id), ['sc-01', 'sc-01', 'sc-01', 'sc-01', 'sc-01', 'sc-02', 'sc-02']);
  // l0 at 0..1 ; gap .5 + pause_before 1 -> l1 at 2.5 ; l2 after gap .5 -> 4.0 ; l2 pause_after 0 -> l3 at 5.0
  assert.deepEqual(plan.items.slice(0, 4).map(i => i.start_s), [0, 2.5, 4, 5]);
  const s2 = plan.scenes[1]; const last1 = plan.items[4]; assert.ok(s2.start_s >= last1.start_s + 1 + 2, 'scene gap applied');
  assert.equal(plan.missing.length, 0);
});

test('assemble: refuses missing takes; exports a joined playable WAV with a manifest', () => {
  const p = mkProject();
  assert.throws(() => D.assemble(p, { takeDuration: () => 1, loadAudio: () => null }), e => e.gate === 'missing-takes' && e.missing.length === 7);
  withTakes(p, 0.5);
  const tone = hz => { const n = 12000, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / 24000); return { sampleRate: 24000, channels: [a] }; };
  const r = D.assemble(p, { takeDuration: () => 0.5, loadAudio: id => tone(200 + id.length * 10), loadTrackAudio: () => null });
  assert.equal(r.manifest.items.length, 7); assert.equal(r.manifest.scope, 'project'); assert.equal(r.manifest.sample_rate, 24000);
  const wav = A.parseWav(A.encodeWav(r.audio)); const d = A.analyze(wav);
  assert.ok(d.duration > 7 * 0.5 && d.rmsDb > -30 && d.peakDb <= -0.5, JSON.stringify(d));
  const sc = D.assemble(p, { sceneId: 'sc-02', takeDuration: () => 0.5, loadAudio: () => tone(300) });
  assert.equal(sc.manifest.items.length, 2); assert.equal(sc.manifest.scope, 'scene');
});

test('assemble: music/ambience/sfx tracks mix with start, trim, gain and fades (stereo 48 kHz)', () => {
  const p = withTakes(mkProject(), 0.5);
  const tone = (hz, n = 12000) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / 24000); return { sampleRate: 24000, channels: [a] }; };
  p.tracks.push({ id: 'tr-1', role: 'music', artifact_id: 'bed.wav', start_s: 0, gain: 0.2, fade_in_s: 0.1, fade_out_s: 0.1, trim_start_s: 0.1 });
  const r = D.assemble(p, { takeDuration: () => 0.5, loadAudio: () => tone(220), loadTrackAudio: () => tone(110, 48000) });
  assert.equal(r.manifest.sample_rate, 48000); assert.equal(r.manifest.channels, 2); assert.equal(r.manifest.tracks.length, 1);
});

test('persistence: unsaved projects never touch disk; saved ones survive restart; rendering takes become failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-'));
  const s1 = D.createDramaStore({ root: dir });
  const p = s1.create({ title: 'Secret', source_script: SCRIPT, parsed: D.parseScript(SCRIPT) });
  assert.deepEqual(fs.readdirSync(dir), [], 'unsaved: nothing persisted');
  const l = lines(p)[1]; const t = D.addTake(p, l.id, {}); s1.touch(p); assert.deepEqual(fs.readdirSync(dir), []);
  s1.save(p.id); assert.deepEqual(fs.readdirSync(dir), [p.id + '.json']);
  assert.ok(fs.readFileSync(path.join(dir, p.id + '.json'), 'utf8').includes('I warned you'), 'explicit save persists the script');
  const s2 = D.createDramaStore({ root: dir });             // "restart"
  const q = s2.get(p.id); assert.ok(q && q.saved);
  const tk = lines(q)[1].takes[0]; assert.equal(tk.status, 'failed'); assert.match(tk.error, /interrupted/); assert.equal(D.lineStatus(lines(q)[1]), 'failed');
  s2.unsave(p.id); assert.deepEqual(fs.readdirSync(dir), []);
});

test('schema migration: a v0 project gains actors/tracks/exports/settings', () => {
  const p = D.migrate({ id: 'dp-00000001', title: 'old', source_script: 'A: hi', scenes: [{ id: 'sc-01', title: 's', lines: [{ id: 'ln-001', speaker: 'A', kind: 'dialogue', text: 'hi' }] }] });
  assert.equal(p.schema, D.SCHEMA); assert.deepEqual([p.tracks, p.exports], [[], []]); assert.equal(p.settings.line_gap_s, 0.35);
  assert.equal(p.actors[0].speaker_key, 'A'); assert.deepEqual(p.scenes[0].lines[0].takes, []);
});
