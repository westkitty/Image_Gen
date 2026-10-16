#!/usr/bin/env node
'use strict';
// OPERATION GOLDEN REEL driver — drives the REAL Drama Studio HTTP API of the project-owned console (the same endpoints the UI uses).
// It never calls a model directly, never approves a voice on a human's behalf, and writes only to its own evidence directory.
//
//   node scripts/golden-reel.js setup            create (or reuse) the QA fixture voices + the saved QA project; verify parse contract
//   node scripts/golden-reel.js audition         one short VoiceDesign audition for the NINE fixture voice (real Big Mac inference)
//   node scripts/golden-reel.js produce <label>  PRODUCE ENTIRE DRAMA through the real producer, then snapshot the state under <label>
//   node scripts/golden-reel.js status           print the current plan/production summary
//
// Evidence lives in output/golden-reel/ (state.json = ids, <label>/ = per-state snapshots). Nothing here is committed.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const BASE = process.env.DEX_BASE || 'http://127.0.0.1:31337';
const EVIDENCE = process.env.GOLDEN_REEL_DIR || path.join(__dirname, '..', '..', 'output', 'golden-reel');
const STATE_FILE = path.join(EVIDENCE, 'state.json');

const TITLE = 'STATION NINE — THE LAST REPLY [QA FIXTURE]';
const SCRIPT = `INT. CONTROL ROOM - NIGHT

CONTROL: Station Nine, this is Control. Your emergency beacon arrived eleven minutes early. Do you copy?

NINE: I copy. The delay is wrong.

CONTROL: How wrong?

NINE: Your reply came before I asked the question.

CONTROL: Read back the last message.

INT. STATION NINE - NIGHT

NINE: It was my voice. It said, "Do not open the door."

CONTROL: There is no door at Station Nine.

NINE: There wasn't. Until you said that.

CONTROL: Then who is standing beside you?

NINE: You are. In about six seconds.
`;
const EXPECTED = { scenes: 2, dialogue: 10, speakers: ['CONTROL', 'NINE'] };
const NINE_DESIGN = { identity: { age: 'middle-aged', gender_presentation: 'male', register: 'low', timbre: 'dry, textured', texture: 'slightly rough', personality: 'restrained, deliberate and quietly uneasy, never theatrical', linguistic_style: 'slowly and carefully, with short pauses' } };
const AUDITION_TEXT = 'It was my voice. It said, "Do not open the door." There is no door at Station Nine.';

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, route, body, { raw = false } = {}) {
  const res = await fetch(BASE + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (raw) return res;
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch (_) { json = { _text: text }; }
  return { status: res.status, ok: res.ok, body: json };
}
async function until(fn, what, { ms = 600000, every = 2000 } = {}) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(every); } }
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } };
const saveState = s => { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n'); };
const must = (r, what) => { if (!r.ok) throw new Error(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

async function version() {
  const v = (await api('GET', '/api/version')).body; if (!v || !/Image_Gen\/operator-console$/.test(v.cwd || '')) throw new Error('listener is not this checkout: ' + JSON.stringify(v)); return v;
}

async function setup() {
  const st = loadState(); await version();
  // voices: reuse by recorded id, else create (QA FIXTURE labels; nothing is approved here)
  const profiles = (await api('GET', '/api/voice/profiles')).body.profiles;
  const find = id => profiles.find(p => p.id === id);
  if (!find(st.control_profile)) { const r = must(await api('POST', '/api/voice/profiles', { name: 'QA FIXTURE · CONTROL (Kokoro am_michael)', type: 'preset', preset_voice: 'am_michael', notes: 'Golden Reel QA fixture voice — not a human-approved identity.' }), 'create CONTROL voice'); st.control_profile = r.profile.id; }
  if (!find(st.nine_profile)) { const r = must(await api('POST', '/api/voice/profiles', { name: 'QA FIXTURE · NINE (VoiceDesign, UNAPPROVED)', type: 'designed', design: NINE_DESIGN, notes: 'Golden Reel QA fixture voice — NOT human-approved; approval stays pending until a person listens.' }), 'create NINE voice'); st.nine_profile = r.profile.id; }
  // project
  let pid = st.project;
  if (!pid || !(await api('GET', '/api/drama/projects/' + pid)).ok) { const r = must(await api('POST', '/api/drama/projects', { title: TITLE, script: SCRIPT }), 'create project'); pid = st.project = r.project.id; }
  let proj = must(await api('GET', '/api/drama/projects/' + pid), 'read project').project;
  const actor = k => proj.actors.find(a => a.speaker_key === k);
  for (const [k, prof] of [['CONTROL', st.control_profile], ['NINE', st.nine_profile]]) {
    const a = actor(k); if (!a) throw new Error('actor not parsed: ' + k);
    if (a.voice_profile_id !== prof) must(await api('PUT', `/api/drama/projects/${pid}/actors/${a.id}`, { voice_profile_id: prof, role: 'character' }), 'cast ' + k);
  }
  proj = must(await api('GET', '/api/drama/projects/' + pid), 'read project').project;
  must(await api('POST', `/api/drama/projects/${pid}/save`, {}), 'save project');
  proj = must(await api('GET', '/api/drama/projects/' + pid), 'read project').project;
  const dlg = proj.scenes.flatMap(s => s.lines).filter(l => l.kind === 'dialogue');
  const checks = {
    scenes: proj.scenes.length === EXPECTED.scenes, dialogue_lines: dlg.length === EXPECTED.dialogue,
    speakers: JSON.stringify([...new Set(dlg.map(l => l.speaker_key))].sort()) === JSON.stringify(EXPECTED.speakers.slice().sort()),
    no_narrator: !proj.actors.some(a => /NARRATOR/i.test(a.speaker_key)) && !dlg.some(l => /NARRATOR/i.test(l.speaker_key)),
    coverage_ok: !!(proj.source && proj.source.coverage && proj.source.coverage.ok === true), saved: proj.saved === true && fs.existsSync(path.join(__dirname, '..', '..', 'sdcpp-workflow', 'state', 'drama', pid + '.json')),
    source_exact: proj.source_script === SCRIPT || (st.script_sha256 && sha256(proj.source_script) === st.script_sha256),
    cast_resolved: actor('CONTROL').voice_profile_id === st.control_profile && actor('NINE').voice_profile_id === st.nine_profile,
  };
  const spoken = dlg.map(l => l.text);
  st.script_sha256 = st.script_sha256 || sha256(SCRIPT); st.created_at = st.created_at || new Date().toISOString(); st.setup_checks = checks; saveState(st);
  console.log(JSON.stringify({ project: pid, control_profile: st.control_profile, nine_profile: st.nine_profile, scenes: proj.scenes.map(s => ({ id: s.id, title: s.title, lines: s.lines.length })), dialogue: dlg.length, checks, spoken }, null, 2));
  if (Object.values(checks).some(v => v !== true)) process.exitCode = 1;
}

async function audition() {
  const st = loadState(); await version(); if (!st.nine_profile) throw new Error('run setup first');
  const start = must(await api('POST', `/api/voice/profiles/${st.nine_profile}/auditions`, { text: AUDITION_TEXT, count: 2 }), 'start audition');
  const rid = (start.round || start).id; console.log('audition round', rid, 'started', JSON.stringify(start).slice(0, 300));
  const round = await until(async () => { const r = (await api('GET', `/api/voice/profiles/${st.nine_profile}/auditions/${rid}`)).body.round; return r && r.status !== 'rendering' ? r : null; }, 'audition round', { ms: 900000, every: 3000 });
  const out = path.join(EVIDENCE, 'audition'); fs.mkdirSync(out, { recursive: true });
  const rec = { round_id: rid, status: round.status, engine: round.engine, runtime: round.runtime, identity_version: round.identity_version, candidates: [] };
  for (const c of round.candidates) {
    const entry = { id: c.id, seed: c.seed, status: c.status, error: c.error || null, clips: [] };
    for (const clip of c.clips || []) {
      const r = await api('GET', clip.url, undefined, { raw: true }); const buf = Buffer.from(await r.arrayBuffer());
      const f = path.join(out, `${c.id}-${clip.artifact_id}`); fs.writeFileSync(f, buf);
      entry.clips.push({ artifact_id: clip.artifact_id, url: clip.url, reported_sha256: clip.sha256, downloaded_sha256: sha256(buf), bytes: buf.length, duration_reported: clip.duration, riff: buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WAVE', file: f });
    }
    rec.candidates.push(entry);
  }
  st.audition = rec; saveState(st); console.log(JSON.stringify(rec, null, 2));
  if (!rec.candidates.some(c => c.status === 'complete')) process.exitCode = 1;
}

// ── produce / revise / verify ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const { execFileSync } = require('node:child_process');
const dialogueOf = proj => proj.scenes.flatMap(sc => sc.lines).filter(l => l.kind === 'dialogue');
async function view(pid) { return must(await api('GET', '/api/drama/projects/' + pid), 'read project').project; }
async function download(url, file) { const r = await api('GET', url, undefined, { raw: true }); if (!r.ok) throw new Error('download failed ' + url + ' HTTP ' + r.status); const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(file, b); return { file, bytes: b.length, sha256: sha256(b) }; }
const ff = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });

async function produce(label) {
  if (!label) throw new Error('usage: produce <label>  (e.g. state-a-original)');
  const st = loadState(); await version(); const pid = st.project; if (!pid) throw new Error('run setup first');
  const before = await view(pid); const planBefore = (before.plan && before.plan.counts) || null;
  const jobsBefore = (await api('GET', '/api/jobs?limit=500')).body;
  const start = must(await api('POST', `/api/drama/projects/${pid}/produce`, {}), 'start production');
  const prodId = (start.production || {}).id; console.log('production', prodId, 'job', start.job_id, 'plan', JSON.stringify(planBefore));
  const fin = await until(async () => { const r = (await api('GET', '/api/drama/productions/' + prodId)).body; const pr = r.production; return pr && ['complete', 'failed', 'cancelled'].includes(pr.status) ? pr : (process.stdout.write('.'), null); }, 'production', { ms: 3600000, every: 3000 }); console.log();
  const dir = path.join(EVIDENCE, label); fs.mkdirSync(dir, { recursive: true });
  const proj = await view(pid);
  const rec = { label, production_id: prodId, job_id: start.job_id, status: fin.status, errors: fin.errors, lines: fin.lines, chunks: fin.chunks, plan_before: planBefore, source_rev: fin.source_rev, finished_at: new Date().toISOString(),
    takes: dialogueOf(proj).map(l => ({ line_id: l.id, speaker: l.speaker_key, state: (l.state && l.state.label) || null, takes: (l.takes || []).map(t => ({ id: t.id, status: t.status, sha256: t.sha256, duration: t.duration, engine: t.engine, seed: t.seed, fingerprint: t.fingerprint && t.fingerprint.inputs_sha })) })),
    scene_masters: proj.scene_masters, project_master: proj.project_master, outputs: {} };
  if (fin.status === 'complete' && proj.project_master) {
    const pm = proj.project_master;
    for (const [fmt, id] of [['wav', pm.artifact_id], ...Object.entries(pm.outputs || {})]) { rec.outputs[fmt] = Object.assign({ artifact_id: id }, await download(`/api/media/${encodeURIComponent(id)}/download`, path.join(dir, 'drama.' + fmt))); }
  }
  const proof = (await api('GET', `/api/drama/productions/${prodId}/proof`)).body; rec.proof = proof && proof.proof ? { sha256_of_master: proof.proof.master && proof.proof.master.sha256, human_acceptance: proof.proof.human_acceptance, asr: proof.proof.asr && proof.proof.asr.state } : null;
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(rec, null, 2) + '\n'); st.states = st.states || {}; st.states[label] = path.join(label, 'receipt.json'); saveState(st);
  console.log(JSON.stringify({ label, status: rec.status, lines: rec.lines, outputs: Object.fromEntries(Object.entries(rec.outputs).map(([k, v]) => [k, v.sha256])) }, null, 1));
  if (fin.status !== 'complete') process.exitCode = 1;
}

async function reviseText() {
  const st = loadState(); await version(); const pid = st.project; const revised = SCRIPT.replace('"Do not open the door."', '"Never open the door."');
  const prev = must(await api('POST', `/api/drama/projects/${pid}/reparse`, { script: revised }), 'reparse preview'); console.log('preview applied=', prev.applied);
  const done = must(await api('POST', `/api/drama/projects/${pid}/reparse`, { script: revised, apply: true }), 'reparse apply');
  const proj = await view(pid); console.log(JSON.stringify({ applied: done.applied, plan: proj.plan && proj.plan.counts }, null, 1));
}
async function reviseFx(preset = 'intercom') {
  const st = loadState(); await version(); const pid = st.project; const proj = await view(pid); const nine = proj.actors.find(a => a.speaker_key === 'NINE');
  must(await api('PUT', `/api/drama/projects/${pid}/actors/${nine.id}`, { fx: preset }), 'set NINE fx'); const after = await view(pid); console.log(JSON.stringify({ nine_fx: after.actors.find(a => a.speaker_key === 'NINE').fx, plan: after.plan && after.plan.counts }, null, 1));
}
async function verify(label) {
  const st = loadState(); const dir = path.join(EVIDENCE, label || ''); const rec = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8')); const out = { label, files: {} };
  for (const [fmt, o] of Object.entries(rec.outputs)) {
    const probe = JSON.parse(ff('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', o.file]));
    const loud = ff('ffmpeg', ['-hide_banner', '-nostats', '-i', o.file, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).toString();
    out.files[fmt] = { codec: probe.streams[0].codec_name, duration: Number(probe.format.duration), chapters: (probe.chapters || []).map(c => (c.tags || {}).title), sha256_matches_receipt: sha256(fs.readFileSync(o.file)) === o.sha256 };
  }
  console.log(JSON.stringify(out, null, 2));
}

const COMMANDS = { setup, audition, produce, 'revise-text': reviseText, 'revise-fx': reviseFx, verify };
(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!COMMANDS[cmd]) { console.error('usage: golden-reel.js <' + Object.keys(COMMANDS).join('|') + '>'); process.exit(2); }
  await COMMANDS[cmd](...rest);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
module.exports = { api, until, sha256, loadState, saveState, must, version, SCRIPT, TITLE, EVIDENCE, BASE, NINE_DESIGN, AUDITION_TEXT, COMMANDS };
