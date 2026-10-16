'use strict';

// Assembly service: turns planned, current takes into verified scene masters, a mastered project master and its delivery
// formats. It is the only place that touches the mixer/mastering pipeline, so production, manual export and previews share one
// path. Every published file is canonical (media store), checksummed and re-verified before it is reported.

const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('./drama');
const F = require('./drama-fingerprint');
const Tools = require('./audio-tools');
const { createSceneRenderer } = require('./drama-render');
const { createMasterBuilder } = require('./drama-master');

const slug = s => String(s || 'drama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drama';
const DEFAULT_DELIVERY = { formats: ['mp3', 'm4b'], stems: false };
const DEFAULT_MASTERING = { preset: 'drama' };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function createAssembly({ mediaStore, derived, tools = Tools, workRoot = os.tmpdir(), now = () => Date.now() }) {
  const renderer = createSceneRenderer({ mediaStore, derived, tools, workRoot, now });
  const builder = createMasterBuilder({ tools, workRoot });

  async function scene(project, sceneId, { takeFor, stems = false, productionId = null }) {
    const out = await renderer.renderScene(project, sceneId, { takeFor, stems, meta: productionId ? { production_id: productionId } : {} });
    const rec = out.record, frames = out.timeline.length_frames;
    return { artifact: { artifact_id: rec.artifact_id, sha256: rec.sha256, duration: rec.duration, bytes: rec.bytes, url: rec.safe_url, download_url: rec.download_url }, record: rec, fingerprint: out.assembly_fp, frames,
      dialogue: out.timeline.lines.map(l => [Math.round(l.start_s * 48000), Math.round(l.end_s * 48000)]), lines: out.timeline.lines, stems: Object.fromEntries(Object.entries(out.stems).map(([k, v]) => [k, v.artifact_id])), warnings: out.warnings, clipped_samples: out.render.clipped_samples, levelling: out.levelling };
  }

  // sceneEntries: [{ scene_id, title, master:{artifact_id, frames, dialogue, stems}, gap_after_frames }]
  async function projectMaster(project, { sceneEntries, formats = DEFAULT_DELIVERY.formats, stems = false, mastering = DEFAULT_MASTERING, projectCues = [], productionId = null, title = null }) {
    const work = fs.mkdtempSync(path.join(workRoot, 'dexmaster-'));
    try {
      const scenes = sceneEntries.map(e => {
        const a = mediaStore.resolve(e.master.artifact_id); if (!a) throw Object.assign(new Error(`scene master ${e.scene_id} is missing`), { gate: 'scene-master-missing' });
        const st = e.master.stems && Object.fromEntries(Object.entries(e.master.stems).map(([k, id]) => [k, (mediaStore.resolve(id) || {}).path]));
        return { scene_id: e.scene_id, title: e.title, file: a.path, frames: e.master.frames, dialogue: e.master.dialogue || [], gap_after_frames: e.gap_after_frames, stems: st };
      });
      const cueSpecs = [];
      for (const c of projectCues) {
        const art = mediaStore.resolve(c.artifact_id); if (!art) { if (c.required !== false) throw Object.assign(new Error(`project cue ${c.id} has no audio`), { gate: 'cue-unresolved' }); continue; }
        const d = await derived.ensure(['conform.v1', art.sha256, 'clean'], { ext: 'f32', kind: 'conform-f32', lineage: { source_artifact_id: c.artifact_id, source_sha256: art.sha256, fx_identity: 'clean' } }, async dest => ({ frames: (await tools.conformToF32(art.path, dest)).frames }));
        cueSpecs.push({ role: c.role, file: d.path, start_frame: Math.round((c.start_s || 0) * 48000), src_offset_frames: Math.round((c.trim_start_s || 0) * 48000), frames: Math.round(((c.trim_end_s != null ? c.trim_end_s : art.duration) - (c.trim_start_s || 0)) * 48000), gain: c.gain == null ? 0.3 : c.gain, fade_in_frames: Math.round((c.fade_in_s || 0) * 48000), fade_out_frames: Math.round((c.fade_out_s || 0) * 48000), duck: c.duck === undefined ? c.role !== 'sfx' : !!c.duck, loop: !!c.loop, loop_frames: Math.round((art.duration || 1) * 48000) });
      }
      const mix = require('./drama-timeline').mixSettings(project);
      const pre = path.join(work, 'pre.wav');
      const concat = await builder.concatScenes({ scenes, outPath: pre, projectCues: cueSpecs, duck: { db: mix.duck_db, attack_s: mix.duck_attack_s, release_s: mix.duck_release_s, lookahead_s: mix.duck_lookahead_s } });
      const mastered = path.join(work, 'master.wav');
      const report = await builder.master(pre, mastered, mastering);
      // integrity: decodable, finite, not silent, length equals the planned programme
      const scan = await tools.scanWav(mastered), info = await tools.probe(mastered);
      const problems = [];
      if (scan.non_finite) problems.push('non-finite samples'); if (scan.silent) problems.push('the master is silent');
      if (Math.abs(scan.frames - concat.frames) > 1) problems.push(`length ${scan.frames} does not match the planned ${concat.frames} frames`);
      if (info.sample_rate !== 48000 || info.channels !== 2) problems.push('unexpected master format');
      if (problems.length) throw Object.assign(new Error('master failed integrity checks: ' + problems.join('; ')), { gate: 'integrity' });
      const base = `${stamp()}-drama-${slug(project.title)}`;
      const masterRec = mediaStore.finalize(mastered, { kind: 'voice', base: `${base}-master`, worker: 'drama-master', model: 'drama-master', duration: scan.duration,
        meta: { operation: 'drama-master', sample_rate: 48000, channels: 2, bits: 24, drama: { project_id: project.id, production_id: productionId, source_rev: project.source_rev || 1, scenes: scenes.length, mastering: { preset: report.preset, applied: report.applied, gain_db: report.gain_db, limiter_engaged: report.limiter_engaged, target_lufs: report.target_lufs, after_lufs: report.after && report.after.integrated_lufs, true_peak_dbtp: report.after && report.after.true_peak_dbtp } } } });
      const outputs = {};
      const wantFormats = formats.filter(f => f !== 'wav');
      const enc = await builder.exportFormats(mastered, { formats: wantFormats, chapters: concat.chapters, title: title || project.title, outDir: path.join(work, 'enc'), basename: 'drama' });
      for (const [fmt, o] of Object.entries(enc)) {
        const rec = mediaStore.finalize(o.path, { kind: 'voice', base: `${base}-${fmt === 'm4b' ? 'audiobook' : 'mix'}`, worker: 'drama-master', model: 'drama-master', duration: o.duration,
          meta: { operation: 'drama-export', format: fmt, source_master: masterRec.artifact_id, source_master_sha256: masterRec.sha256, drama: { project_id: project.id, production_id: productionId }, chapters: o.chapters.length } });
        outputs[fmt] = { record: rec, chapters: o.chapters, codec: o.codec, duration: o.duration };
      }
      const stemRecs = {};
      if (stems) {
        const st = await builder.concatStems({ scenes: scenes.map(s => ({ scene_id: s.scene_id, stems: s.stems || {}, frames: s.frames, gap_after_frames: s.gap_after_frames })), outDir: path.join(work, 'stems'), basename: 'stem' });
        const gain = report.applied && report.gain_db ? report.gain_db : 0;
        for (const [role, st1] of Object.entries(st)) {
          let file = st1.path;
          if (gain) { file = st1.path + '.g.wav'; await tools.run('ffmpeg', ['-v', 'error', '-y', '-i', st1.path, '-af', `volume=${gain}dB`, '-c:a', 'pcm_s24le', '-fflags', '+bitexact', '-flags:a', '+bitexact', file]); }
          stemRecs[role] = mediaStore.finalize(file, { kind: 'voice', base: `${base}-stem-${role}`, worker: 'drama-master', model: 'drama-master', duration: scan.duration, meta: { operation: 'drama-stem', stem: role, master_gain_db: gain, source_master: masterRec.artifact_id, drama: { project_id: project.id, production_id: productionId } } });
        }
      }
      return { master: masterRec, outputs, stems: stemRecs, mastering: report, chapters: concat.chapters, frames: scan.frames, duration_s: scan.duration, integrity: { decodable: true, finite: scan.non_finite === 0, clipped_samples: scan.clipped_samples, peak_db: scan.peak_db, silent: scan.silent, length_matches_plan: true, codec: info.codec, sample_rate: info.sample_rate, channels: info.channels }, cues_mixed: concat.cues_mixed || 0 };
    } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} }
  }
  // Frames of silence between a scene and the next: the last line's trailing pause plus the scene gap (same rule as the timeline).
  function gapAfterFrames(project, sc) {
    const lines = sc.lines.filter(l => l.render !== false && l.kind !== 'direction' && String(l.text).trim());
    const last = lines[lines.length - 1]; const after = last && last.pause_after_s != null ? Number(last.pause_after_s) : Number(project.settings.line_gap_s);
    return Math.round(((Number.isFinite(after) ? after : 0.35) + Number(project.settings.scene_gap_s || 0)) * 48000);
  }

  // The shared orchestration used by one-click production AND manual export.
  //   entries: [{ scene_id, title, action: 'reuse'|'rebuild', fingerprint }]  (current builds)  — historical builds pass fingerprint=null
  async function build(project, { entries, takeFor, delivery = {}, mastering = {}, productionId = null, historical = false, persist = () => {}, cancelled = () => false, onProgress = () => {} }) {
    const dlv = Object.assign({}, DEFAULT_DELIVERY, project.delivery || {}, delivery), mst = Object.assign({}, DEFAULT_MASTERING, project.mastering || {}, mastering);
    const sceneEntries = [], sceneFps = [], built = [];
    let i = 0;
    for (const e of entries) {
      i++; if (cancelled()) return { cancelled: true };
      const sc = project.scenes.find(s => s.id === e.scene_id);
      const cur = !historical && project.scene_masters && project.scene_masters[e.scene_id];
      const needStems = dlv.stems && !(cur && cur.stems && Object.keys(cur.stems).length);
      let master;
      if (e.action === 'reuse' && cur && mediaStore.resolve(cur.artifact_id) && !needStems) master = cur;
      else {
        onProgress({ phase: 'assembling', label: `Assembling scene ${i}/${entries.length}`, done: i - 1, total: entries.length });
        const out = await scene(project, e.scene_id, { takeFor, stems: !!dlv.stems, productionId });
        master = { assembly_fp: out.fingerprint.sha, artifact_id: out.artifact.artifact_id, sha256: out.artifact.sha256, duration: out.artifact.duration, frames: out.frames, dialogue: out.dialogue, lines: out.lines, stems: out.stems, built_at: now(), production_id: productionId };
        if (!historical) { project.scene_masters[e.scene_id] = master; persist(); }
        built.push(e.scene_id);
      }
      sceneFps.push(master.assembly_fp);
      sceneEntries.push({ scene_id: e.scene_id, title: sc.title, master, action: built.includes(e.scene_id) ? 'rebuild' : 'reuse', gap_after_frames: gapAfterFrames(project, sc) });
    }
    const projectCues = (project.tracks || []).filter(t => !t.scene_id);
    const projectFp = F.hashOf({ scenes: sceneFps, gaps: sceneEntries.map(e => e.gap_after_frames), cues: projectCues.map(t => [t.id, t.role, t.artifact_id, t.start_s, t.trim_start_s, t.trim_end_s, t.gain, t.fade_in_s, t.fade_out_s, t.duck, t.loop]), mastering: mst, formats: [...(dlv.formats || [])].sort(), stems: !!dlv.stems, mix: require('./drama-timeline').mixSettings(project) });
    const cur = project.project_master;
    if (!historical && cur && cur.assembly_fp === projectFp && mediaStore.resolve(cur.artifact_id) && Object.values(cur.outputs || {}).every(id => mediaStore.resolve(id)) && Object.values(cur.stems || {}).every(id => mediaStore.resolve(id)))
      return { sceneEntries, built, projectFp, noop: built.length === 0, project: null, reused: cur };
    if (cancelled()) return { cancelled: true };
    onProgress({ phase: 'mastering', label: 'Assembling and mastering the project master', done: entries.length, total: entries.length });
    const out = await projectMaster(project, { sceneEntries, formats: dlv.formats, stems: dlv.stems, mastering: mst, projectCues, productionId });
    return { sceneEntries, built, projectFp, noop: false, project: out };
  }
    return { scene, project: projectMaster, build, gapAfterFrames, renderer, builder };
}

module.exports = { createAssembly, DEFAULT_DELIVERY, DEFAULT_MASTERING };
