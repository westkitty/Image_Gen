'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const D = require('../drama');

const v1 = {
  schema: 'dexdiffusion.drama_project.v1', id: 'dp-0a1b2c3d', title: 'Old drama', source_script: 'TIGER: Hi.\nCODEC: Hello.', saved: true,
  scenes: [{ id: 'sc-01', title: 'Scene 1', lines: [
    { id: 'ln-001', speaker: 'TIGER', speaker_key: 'TIGER', kind: 'dialogue', text: 'Hi.', direction: '', render: true, active_take_id: 'tk-1', takes: [
      { id: 'tk-1', status: 'complete', artifact_id: 'a.wav', duration: 1, profile_id: 'vp-1' }, { id: 'tk-2', status: 'rendering' }] },
    { id: 'ln-002', speaker: 'CODEC', speaker_key: 'CODEC', kind: 'dialogue', text: 'Hello.', takes: [] }] }],
  actors: [{ id: 'ac-1', speaker: 'TIGER', speaker_key: 'TIGER', voice_profile_id: 'vp-1', default_direction: 'calm' }], tracks: [{ id: 'tr-1', role: 'music', artifact_id: 'm.wav' }],
  exports: [], settings: { line_gap_s: 0.5 }, created_at: 1, updated_at: 2,
};

test('a v1 project file migrates without losing anything and keeps a one-time backup before rewrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mig-')); const f = path.join(dir, 'dp-0a1b2c3d.json');
  const original = JSON.stringify(v1, null, 1) + '\n'; fs.writeFileSync(f, original);
  const store = D.createDramaStore({ root: dir });
  const p = store.get('dp-0a1b2c3d');
  assert.equal(p.schema, D.SCHEMA); assert.equal(p.source_script, v1.source_script);
  assert.equal(p.settings.line_gap_s, 0.5); assert.equal(p.settings.scene_gap_s, 1);
  assert.deepEqual(p.tracks, v1.tracks); assert.equal(p.actors[0].default_direction, 'calm'); assert.deepEqual(p.actors[0].pronunciation, []);
  const l = p.scenes[0].lines[0];
  assert.equal(l.takes[0].legacy, true, 'a pre-fingerprint recording is kept but flagged');
  assert.equal(l.takes[1].status, 'failed'); assert.equal(l.takes[1].interrupted, true);
  assert.equal(l.active_take_id, 'tk-1');
  assert.equal(fs.readFileSync(f, 'utf8'), original, 'loading alone never rewrites the file');
  store.touch(p);
  assert.equal(fs.readFileSync(path.join(dir, 'dp-0a1b2c3d.pre-v2.bak.json'), 'utf8'), original, 'byte-identical pre-upgrade backup');
  const disk = JSON.parse(fs.readFileSync(f, 'utf8')); assert.equal(disk.schema, D.SCHEMA); assert.equal('_migrated_from' in disk, false);
  fs.writeFileSync(path.join(dir, 'dp-0a1b2c3d.pre-v2.bak.json'), 'KEEP');
  store.touch(p);
  assert.equal(fs.readFileSync(path.join(dir, 'dp-0a1b2c3d.pre-v2.bak.json'), 'utf8'), 'KEEP', 'backup is written once');
  const again = D.createDramaStore({ root: dir }).get('dp-0a1b2c3d');
  assert.equal(again.scenes[0].lines[0].takes.length, 2); assert.equal(again.scenes[0].lines[0].takes[0].legacy, true);
});

test('an unversioned legacy file also migrates, and a foreign schema is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mig2-'));
  const legacy = { id: 'dp-11111111', title: 'x', source_script: 'A: b', scenes: [] };
  fs.writeFileSync(path.join(dir, 'dp-11111111.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(dir, 'dp-22222222.json'), JSON.stringify({ schema: 'someone.else.v9', id: 'dp-22222222', scenes: [] }));
  const store = D.createDramaStore({ root: dir });
  assert.ok(store.get('dp-11111111')); assert.equal(store.get('dp-22222222'), null);
});
