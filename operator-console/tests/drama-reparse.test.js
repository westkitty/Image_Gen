'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../drama');
const R = require('../drama-reparse');

const SCRIPT = `INT. WAREHOUSE - NIGHT

The rain hammers the roof.

TIGER: I warned you about the lamp.
CODEC: I know that already.
TIGER: Then why did you come back here tonight?
CODEC: Because I had no choice at all.

EXT. ROOFTOP - DAWN

NARRATOR: And so it ended.`;

const mkProject = (script = SCRIPT) => {
  const p = D.newProject({ title: 't', source_script: script, parsed: D.parseScript(script) });
  let n = 0;
  for (const { line } of D.allLines(p)) if (line.kind !== 'direction') {
    const t = D.addTake(p, line.id, { status: 'complete', artifact_id: `a-${++n}.wav`, profile_id: 'vp-1' });
    line.active_take_id = t.id;
  }
  return p;
};
const flat = p => D.allLines(p).map(x => x.line);
const reparse = (p, script, opts = {}) => R.reparse(p, script, D.parseScript(script), opts);
const by = (p, speaker, re) => flat(p).find(l => l.speaker === speaker && re.test(l.text));

test('re-parsing an unchanged script keeps every line id and every take', () => {
  const p = mkProject(); const before = flat(p).map(l => [l.id, l.takes.length, l.active_take_id]);
  const r = reparse(p, SCRIPT, { apply: true });
  assert.equal(r.applied, true); assert.equal(r.preview.requires_confirmation, false);
  assert.deepEqual(flat(p).map(l => [l.id, l.takes.length, l.active_take_id]), before);
  assert.equal(r.preview.summary.unchanged, before.length); assert.equal(p.source_rev, 2);
});

test('preview does not mutate the project', () => {
  const p = mkProject(); const snap = JSON.stringify(p);
  const r = reparse(p, SCRIPT.replace('lamp', 'light'));
  assert.equal(r.applied, false); assert.equal(JSON.stringify(p), snap);
  assert.equal(r.preview.summary.changed, 1);
});

test('editing one word keeps line identity and take history (the takes become outdated by fingerprint, never deleted)', () => {
  const p = mkProject(); const line = by(p, 'TIGER', /lamp/); const id = line.id, take = line.takes[0].id;
  const r = reparse(p, SCRIPT.replace('about the lamp', 'about the light'), { apply: true });
  const after = by(p, 'TIGER', /light/);
  assert.equal(after.id, id); assert.equal(after.takes[0].id, take); assert.equal(after.active_take_id, take);
  assert.equal(r.preview.items.find(i => i.status === 'changed').old_line_id, id);
  assert.equal(after.source_sha === line.source_sha, false, 'source hash follows the new text');
});

test('reordered dialogue: takes follow their text, never their position', () => {
  const p = mkProject(); const tiger = by(p, 'TIGER', /lamp/), codec = by(p, 'CODEC', /already/);
  const keep = { tiger: [tiger.id, tiger.takes[0].artifact_id], codec: [codec.id, codec.takes[0].artifact_id] };
  const swapped = SCRIPT.replace('TIGER: I warned you about the lamp.\nCODEC: I know that already.', 'CODEC: I know that already.\nTIGER: I warned you about the lamp.');
  const r = reparse(p, swapped, { apply: true });
  const t2 = by(p, 'TIGER', /lamp/), c2 = by(p, 'CODEC', /already/);
  assert.deepEqual([t2.id, t2.takes[0].artifact_id], keep.tiger); assert.deepEqual([c2.id, c2.takes[0].artifact_id], keep.codec);
  assert.ok(r.preview.items.some(i => i.status === 'moved'));
  const order = flat(p).filter(l => l.kind === 'dialogue').map(l => l.speaker);
  assert.deepEqual(order.slice(0, 2), ['CODEC', 'TIGER']);
});

test('removed lines are archived with their takes, not deleted', () => {
  const p = mkProject(); const gone = by(p, 'CODEC', /choice/); const art = gone.takes[0].artifact_id;
  const r = reparse(p, SCRIPT.replace('CODEC: Because I had no choice at all.\n', ''), { apply: true });
  assert.equal(by(p, 'CODEC', /choice/), undefined);
  assert.equal(r.preview.summary.removed, 1);
  const arch = p.archived_lines.find(a => a.line.id === gone.id);
  assert.ok(arch); assert.equal(arch.line.takes[0].artifact_id, art); assert.equal(arch.reason, 'removed-by-reparse'); assert.equal(arch.source_rev, 2);
});

test('added lines get brand-new ids that never collide with live or archived ids', () => {
  const p = mkProject(); const gone = by(p, 'CODEC', /choice/);
  reparse(p, SCRIPT.replace('CODEC: Because I had no choice at all.\n', ''), { apply: true });
  reparse(p, SCRIPT.replace('CODEC: Because I had no choice at all.\n', 'CODEC: Something brand new entirely.\n'), { apply: true });
  const ids = flat(p).map(l => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(by(p, 'CODEC', /brand new/).id, gone.id, 'a removed line id is never reused for new dialogue');
  assert.equal(by(p, 'CODEC', /brand new/).takes.length, 0);
});

test('ambiguous duplicates: no take inheritance without confirmation, and the preview names the conflict', () => {
  const dup = SCRIPT.replace('CODEC: I know that already.', 'CODEC: No.\nCODEC: No.');
  const p = mkProject(dup);
  const more = dup.replace('CODEC: No.\nCODEC: No.', 'CODEC: No.\nCODEC: No.\nCODEC: No.');
  const prev = reparse(p, more);
  assert.equal(prev.preview.requires_confirmation, true);
  assert.ok(prev.preview.conflicts.some(c => c.type === 'ambiguous-duplicates'));
  assert.throws(() => reparse(p, more, { apply: true }), e => e.gate === 'reparse-conflict' && !!e.preview);
  const r = reparse(p, more, { apply: true, confirm: true });
  assert.equal(r.applied, true);
  const nos = flat(p).filter(l => l.text === 'No.');
  assert.equal(nos.length, 3); assert.ok(nos.every(l => l.takes.length === 0), 'ambiguous group inherits nothing');
  assert.equal(p.archived_lines.filter(a => a.line.text === 'No.').length, 2, 'their old takes are archived instead');
});

test('equal-count duplicates pair in order and keep their takes', () => {
  const dup = SCRIPT.replace('CODEC: I know that already.', 'CODEC: No.\nCODEC: No.');
  const p = mkProject(dup); const ids = flat(p).filter(l => l.text === 'No.').map(l => l.id);
  const r = reparse(p, dup + '\nTIGER: One more line.', { apply: true });
  assert.equal(r.preview.requires_confirmation, false);
  assert.deepEqual(flat(p).filter(l => l.text === 'No.').map(l => l.id), ids);
});

test('speaker change on identical text is a different line (remove + add), never a silent reassignment', () => {
  const p = mkProject(); const orig = by(p, 'CODEC', /already/);
  const r = reparse(p, SCRIPT.replace('CODEC: I know that already.', 'TIGER: I know that already.'), { apply: true });
  const nl = by(p, 'TIGER', /know that already/);
  assert.notEqual(nl.id, orig.id); assert.equal(nl.takes.length, 0);
  assert.ok(p.archived_lines.some(a => a.line.id === orig.id));
  assert.ok(r.preview.summary.added >= 1 && r.preview.summary.removed >= 1);
});

test('two similar candidates for one edited line are ambiguous, not guessed', () => {
  const s0 = 'A: the quick brown fox jumps over the lazy dog today\nA: the quick brown fox jumps over the lazy dog tonight\nB: ok';
  const p = mkProject(s0);
  const prev = reparse(p, 'A: the quick brown fox jumps over the lazy dog sometime\nB: ok');
  assert.ok(prev.preview.conflicts.some(c => c.type === 'ambiguous-match'), JSON.stringify(prev.preview.summary));
  assert.equal(prev.preview.requires_confirmation, true);
});

test('manual line edits that the new parse overwrites are flagged', () => {
  const p = mkProject(); const l = by(p, 'TIGER', /lamp/);
  D.setLine(p, l.id, { text: 'I warned you about the lamp, twice.' });
  const prev = reparse(p, SCRIPT);
  assert.ok(prev.preview.warnings.some(w => w.type === 'manual-edit-overwritten' && w.line_id === l.id));
});

test('scene ids are preserved by title and tracks follow; vanished scenes orphan their tracks visibly', () => {
  const p = mkProject(); p.tracks.push({ id: 'tr-1', role: 'music', artifact_id: 'm.wav', scene_id: p.scenes[1].id });
  const rooftop = p.scenes[1].id;
  const r = reparse(p, SCRIPT, { apply: true });
  assert.equal(p.scenes[1].id, rooftop); assert.equal(p.tracks[0].scene_id, rooftop);
  const r2 = reparse(p, SCRIPT.replace('EXT. ROOFTOP - DAWN', 'EXT. BASEMENT - DUSK'), { apply: true });
  assert.ok(r2.preview.warnings.some(w => w.type === 'track-scene-missing'));
  assert.equal(p.tracks[0].scene_id, null);
});

test('user settings on a matched line survive (overrides, render flag), script-derived fields refresh', () => {
  const p = mkProject(); const l = by(p, 'CODEC', /already/);
  l.profile_override = 'vp-9'; l.render = false; l.pause_after_s = 2;
  reparse(p, SCRIPT.replace('CODEC: I know that already.', 'CODEC: [softly] I know that already.'), { apply: true });
  const a = by(p, 'CODEC', /already/);
  assert.equal(a.id, l.id); assert.equal(a.profile_override, 'vp-9'); assert.equal(a.render, false); assert.equal(a.pause_after_s, 2); assert.equal(a.direction, 'softly');
});

test('source revision and hash advance only on apply; coverage is re-proved', () => {
  const p = mkProject(); const sha = p.source_sha256;
  reparse(p, SCRIPT + '\nTIGER: Extra.');
  assert.equal(p.source_rev, 1); assert.equal(p.source_sha256, sha);
  reparse(p, SCRIPT + '\nTIGER: Extra.', { apply: true });
  assert.equal(p.source_rev, 2); assert.notEqual(p.source_sha256, sha); assert.equal(p.source_coverage.ok, true);
  assert.equal(p.source_script, SCRIPT + '\nTIGER: Extra.');
});
