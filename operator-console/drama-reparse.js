'use strict';

// Safe re-parse of a drama project's screenplay.
//
// A re-parse must never attach a recording to the wrong dialogue. Lines are matched by CONTENT (speaker,
// kind, whitespace-normalised text), not by position or id, so reordering cannot move a take onto other
// text. The only fuzzy step (an edited line) requires a unique, mutual best match with a clear margin;
// anything else is reported as a conflict and needs explicit confirmation. Lines that disappear are
// archived with their takes, never deleted. Preview and apply share one plan, so what you review is
// what is applied.

const D = require('./drama');

const norm = D.normalizeSpoken;
const keyOf = l => `${l.speaker_key}\u0001${l.kind}\u0001${norm(l.text)}`;
const words = s => new Set(norm(s).toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean));
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  return (2 * inter) / (a.size + b.size);
}
const FUZZY_MIN = 0.5, FUZZY_MARGIN = 0.15;
const KEEP = ['takes', 'active_take_id', 'profile_override', 'engine_override', 'pause_after_s', 'fx_override', 'notes'];
const preview80 = s => { const t = norm(s); return t.length > 80 ? t.slice(0, 77) + '…' : t; };

function planReparse(project, parsed) {
  const oldLines = [], newLines = [];
  project.scenes.forEach((sc, si) => sc.lines.forEach((l, li) => oldLines.push({ line: l, scene: sc, si, li, pos: oldLines.length })));
  parsed.scenes.forEach((sc, si) => sc.lines.forEach((l, li) => newLines.push({ line: l, scene: sc, si, li, pos: newLines.length })));
  const pairs = new Map();               // new pos -> old pos
  const usedOld = new Set(), conflicts = [], warnings = [];
  const group = (arr) => { const m = new Map(); for (const x of arr) { const k = keyOf(x.line); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const og = group(oldLines), ng = group(newLines);
  for (const [k, news] of ng) {
    const olds = og.get(k); if (!olds) continue;
    if (olds.length === news.length) news.forEach((n, i) => { pairs.set(n.pos, olds[i].pos); usedOld.add(olds[i].pos); });
    else conflicts.push({ type: 'ambiguous-duplicates', speaker: news[0].line.speaker, text_preview: preview80(news[0].line.text), old_count: olds.length, new_count: news.length,
      detail: 'identical lines were added or removed, so which recording belongs to which cannot be determined; their recordings are archived and not reattached' });
  }
  // fuzzy: an edited line keeps its identity only on a unique, mutual best match
  const freeOld = oldLines.filter(o => !usedOld.has(o.pos) && !(ng.has(keyOf(o.line))) && o.line.kind !== 'direction');
  const freeNew = newLines.filter(n => ![...pairs.keys()].includes(n.pos) && !(og.has(keyOf(n.line))) && n.line.kind !== 'direction');
  const sim = (o, n) => (o.line.speaker_key === n.line.speaker_key && o.line.kind === n.line.kind ? dice(words(o.line.text), words(n.line.text)) : 0);
  const rank = (x, others, f) => others.map(y => ({ y, s: f(x, y) })).filter(c => c.s >= FUZZY_MIN).sort((a, b) => b.s - a.s);
  const bestNew = new Map(), bestOld = new Map();
  for (const n of freeNew) bestNew.set(n.pos, rank(n, freeOld, (a, b) => sim(b, a)));
  for (const o of freeOld) bestOld.set(o.pos, rank(o, freeNew, (a, b) => sim(a, b)));
  const clear = list => list.length === 1 || (list.length > 1 && list[0].s - list[1].s >= FUZZY_MARGIN);
  const ambiguousNew = new Set();
  for (const n of freeNew) {
    const cn = bestNew.get(n.pos); if (!cn.length) continue;
    const o = cn[0].y, co = bestOld.get(o.pos);
    if (clear(cn) && co.length && co[0].y.pos === n.pos && clear(co)) { pairs.set(n.pos, o.pos); usedOld.add(o.pos); }
    else { ambiguousNew.add(n.pos); conflicts.push({ type: 'ambiguous-match', speaker: n.line.speaker, text_preview: preview80(n.line.text), candidates: cn.length, detail: 'an edited line has more than one plausible earlier version; no recording is carried over' }); }
  }
  // statuses
  const items = [];
  const matchedOldOrder = [...pairs.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
  const oldRank = new Map(matchedOldOrder.map((npos, i) => [npos, i]));
  const matchedNewOrder = [...pairs.keys()].sort((a, b) => a - b);
  const newRank = new Map(matchedNewOrder.map((npos, i) => [npos, i]));
  const summary = { unchanged: 0, changed: 0, moved: 0, added: 0, removed: 0, ambiguous: ambiguousNew.size, takes_preserved: 0, takes_archived: 0, lines_total: newLines.length };
  for (const n of newLines) {
    const op = pairs.get(n.pos);
    if (op == null) { items.push({ status: 'added', speaker: n.line.speaker, kind: n.line.kind, text_preview: preview80(n.line.text), scene: n.scene.title }); summary.added++; continue; }
    const o = oldLines[op], same = keyOf(o.line) === keyOf(n.line), takes = (o.line.takes || []).length;
    const status = !same ? 'changed' : oldRank.get(n.pos) !== newRank.get(n.pos) ? 'moved' : 'unchanged';
    summary[status]++; summary.takes_preserved += takes;
    items.push({ status, old_line_id: o.line.id, speaker: n.line.speaker, kind: n.line.kind, text_preview: preview80(n.line.text), takes, scene: n.scene.title });
    if (o.line.edited && !same) warnings.push({ type: 'manual-edit-overwritten', line_id: o.line.id, detail: 'a manual edit to this line is replaced by the script text' });
    if (o.line.edited && same) { /* manual edit already equals the script */ }
  }
  const pairedOld = new Set(pairs.values());
  for (const o of oldLines) if (!pairedOld.has(o.pos)) {
    const takes = (o.line.takes || []).length;
    items.push({ status: 'removed', old_line_id: o.line.id, speaker: o.line.speaker, kind: o.line.kind, text_preview: preview80(o.line.text), takes, scene: o.scene.title });
    summary.removed++; summary.takes_archived += takes;
    if (o.line.edited && !(norm(o.line.text) === '')) warnings.push({ type: 'manual-edit-overwritten', line_id: o.line.id, detail: 'a manually edited line is not in the new script and is archived' });
  }
  // scenes: preserve ids by title; flag tracks whose scene vanishes
  const used = new Set(), sceneMap = new Map();
  parsed.scenes.forEach((sc, i) => {
    const old = project.scenes.find(o => !used.has(o.id) && norm(o.title).toLowerCase() === norm(sc.title).toLowerCase());
    if (old) { used.add(old.id); sceneMap.set(i, old.id); }
  });
  const keptScenes = new Set(sceneMap.values());
  for (const t of project.tracks || []) if (t.scene_id && !keptScenes.has(t.scene_id)) warnings.push({ type: 'track-scene-missing', track_id: t.id, scene_id: t.scene_id, detail: 'this track was attached to a scene that no longer exists; it becomes project-wide' });
  return { summary, items, conflicts, warnings, requires_confirmation: conflicts.length > 0, source_rev_from: project.source_rev || 1,
    _pairs: pairs, _oldLines: oldLines, _newLines: newLines, _sceneMap: sceneMap };
}

const nextIdNumber = (ids, prefix) => Math.max(0, ...ids.map(id => Number(String(id).replace(prefix, '').replace(/\D/g, '')) || 0));

function applyPlan(project, plan, parsed, script, now = Date.now()) {
  const { _pairs: pairs, _oldLines: oldLines, _newLines: newLines, _sceneMap: sceneMap } = plan;
  const rev = (project.source_rev || 1) + 1;
  const allLineIds = [...oldLines.map(o => o.line.id), ...(project.archived_lines || []).map(a => a.line.id)];
  let lineCounter = nextIdNumber(allLineIds, 'ln-');
  const sceneIds = project.scenes.map(s => s.id);
  let sceneCounter = nextIdNumber(sceneIds, 'sc-');
  const archive = project.archived_lines = project.archived_lines || [];
  const paired = new Set(pairs.values());
  for (const o of oldLines) if (!paired.has(o.pos)) archive.push({ line: o.line, scene_id: o.scene.id, scene_title: o.scene.title, reason: 'removed-by-reparse', source_rev: rev, archived_at: now });
  const scenes = parsed.scenes.map((sc, si) => {
    const id = sceneMap.has(si) ? sceneMap.get(si) : 'sc-' + String(++sceneCounter).padStart(2, '0');
    const lines = sc.lines.map(nl => {
      const pos = newLines.find(x => x.line === nl).pos, op = pairs.get(pos);
      if (op == null) { nl.id = 'ln-' + String(++lineCounter).padStart(3, '0'); nl.rev = 1; return nl; }
      const old = oldLines[op].line, out = Object.assign({}, nl, { id: old.id });
      for (const k of KEEP) if (old[k] !== undefined) out[k] = old[k];
      if (nl.pause_before_s == null && old.pause_before_s != null) out.pause_before_s = old.pause_before_s;
      if (old.render !== undefined && old.kind === nl.kind) out.render = old.render;
      out.rev = norm(old.text) === norm(nl.text) ? (old.rev || 1) : (old.rev || 1) + 1;
      out.edited = false;
      return out;
    });
    return { id, title: sc.title, lines };
  });
  const keptIds = new Set(scenes.map(s => s.id));
  for (const t of project.tracks || []) if (t.scene_id && !keptIds.has(t.scene_id)) t.scene_id = null;
  project.scenes = scenes;
  project.source_script = String(script);
  project.source_rev = rev;
  project.parse_warnings = parsed.warnings || [];
  D.stampSource(project, parsed);
  D.ensureActors(project);
  return project;
}

// apply:false (default) → preview only. apply:true with conflicts requires confirm:true.
function reparse(project, script, parsed, { apply = false, confirm = false, now } = {}) {
  const plan = planReparse(project, parsed);
  const preview = { summary: plan.summary, items: plan.items, conflicts: plan.conflicts, warnings: plan.warnings, requires_confirmation: plan.requires_confirmation, source_rev_from: plan.source_rev_from };
  if (!apply) return { applied: false, preview };
  if (plan.requires_confirmation && !confirm) throw Object.assign(new Error('the new script has ambiguous matches; review the preview and confirm to apply'), { status: 409, gate: 'reparse-conflict', preview });
  applyPlan(project, plan, parsed, script, now);
  return { applied: true, preview };
}

module.exports = { planReparse, reparse, FUZZY_MIN, FUZZY_MARGIN };
