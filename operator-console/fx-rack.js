'use strict';

// Actor FX rack: a versioned, non-destructive DSP chain compiled to a local FFmpeg -af string.
//
// Chains are data (never shell text). Every parameter is clamped and coerced to a number before it reaches a filter
// string, filter names come from a fixed table, and the compiled string is only ever passed as a single argv element.
// Effects never touch the clean take: the mixer bakes them into a derived, lineage-tracked cache entry keyed by
// (source checksum + chain identity), so changing an effect re-runs FFmpeg for that clip but never TTS.
// "Reverb" is an echo-tap room simulation (FFmpeg has no convolution IR here) and is labelled as such.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('./drama-fingerprint');

const CHAIN_VERSION = 1, MAX_NODES = 12, WORK_RATE = 48000;
const lin = db => Math.pow(10, db / 20);
const r3 = n => Math.round(n * 1000) / 1000;

// type → { label, params: { name: [min, max, default] }, build(p) → { f: filterString, tail?: seconds, needs48k?: bool } }
const ROOMS = { small: [[20, 35, 50], [0.35, 0.25, 0.15]], medium: [[40, 70, 110, 160], [0.35, 0.28, 0.2, 0.12]], large: [[60, 120, 200, 300, 420], [0.38, 0.32, 0.25, 0.18, 0.1]], hall: [[80, 170, 300, 450, 650], [0.4, 0.34, 0.28, 0.2, 0.12]] };
const NODE_TYPES = {
  gain: { label: 'Gain', params: { db: [-24, 24, 0] }, build: p => ({ f: `volume=${r3(p.db)}dB` }) },
  highpass: { label: 'High-pass', params: { freq: [20, 2000, 200] }, build: p => ({ f: `highpass=f=${Math.round(p.freq)}` }) },
  lowpass: { label: 'Low-pass', params: { freq: [1000, 20000, 8000] }, build: p => ({ f: `lowpass=f=${Math.round(p.freq)}` }) },
  eq: { label: 'EQ band', params: { freq: [20, 20000, 1000], width: [10, 10000, 200], gain_db: [-18, 18, 0] }, build: p => ({ f: `equalizer=f=${Math.round(p.freq)}:width_type=h:width=${Math.round(p.width)}:g=${r3(p.gain_db)}` }) },
  compressor: { label: 'Compressor', params: { threshold_db: [-60, 0, -18], ratio: [1, 20, 3], attack_ms: [1, 200, 20], release_ms: [10, 2000, 200], makeup_db: [0, 24, 0] },
    build: p => ({ f: `acompressor=threshold=${r3(lin(p.threshold_db))}:ratio=${r3(p.ratio)}:attack=${r3(p.attack_ms)}:release=${r3(p.release_ms)}:makeup=${r3(Math.max(1, lin(p.makeup_db)))}` }) },
  reverb: { label: 'Reverb (echo-tap room)', params: { room: [0, 3, 1], wet: [0, 1, 0.3] },
    build: p => { const [d, dec] = ROOMS[Object.keys(ROOMS)[Math.round(p.room)]]; return { f: `aecho=0.85:0.9:${d.join('|')}:${dec.map(x => r3(x * p.wet * 2)).join('|')}`, tail: d[d.length - 1] / 1000 * 2 }; } },
  delay: { label: 'Delay', params: { delay_ms: [20, 1500, 250], feedback: [0, 0.9, 0.35], mix: [0, 1, 0.4] },
    build: p => { const d = Math.round(p.delay_ms); return { f: `aecho=0.9:0.9:${d}|${d * 2}|${d * 3}:${r3(p.mix * p.feedback)}|${r3(p.mix * p.feedback ** 2)}|${r3(p.mix * p.feedback ** 3)}`, tail: d * 3.5 / 1000 }; } },
  chorus: { label: 'Chorus', params: { delay_ms: [10, 80, 40], depth: [0.1, 5, 1.5], speed: [0.1, 5, 0.5] }, build: p => ({ f: `chorus=0.7:0.9:${r3(p.delay_ms)}:0.4:${r3(p.speed)}:${r3(p.depth)}` }) },
  flanger: { label: 'Flanger', params: { delay_ms: [0, 10, 3], depth: [0, 10, 2], speed: [0.1, 10, 0.5] }, build: p => ({ f: `flanger=delay=${r3(p.delay_ms)}:depth=${r3(p.depth)}:speed=${r3(p.speed)}` }) },
  pitch: { label: 'Pitch shift', params: { semitones: [-12, 12, 0] }, build: p => { const k = Math.pow(2, p.semitones / 12); return { f: `asetrate=${Math.round(WORK_RATE * k)},aresample=${WORK_RATE},atempo=${r3(1 / k)}`, needs48k: true }; } },
  robot: { label: 'Bit-crush (robotic)', params: { bits: [4, 16, 10], mix: [0, 1, 0.6] }, build: p => ({ f: `acrusher=bits=${Math.round(p.bits)}:mode=lin:mix=${r3(p.mix)}` }) },
  tremolo: { label: 'Tremolo', params: { freq: [0.1, 50, 8], depth: [0, 1, 0.5] }, build: p => ({ f: `tremolo=f=${r3(p.freq)}:d=${r3(p.depth)}` }) },
};
const node = (type, params = {}, extra = {}) => Object.assign({ type, enabled: true, params }, extra);
const PRESETS = {
  none: { label: 'None / Clean', description: 'No processing; the take is used as recorded.', nodes: [] },
  radio: { label: 'Radio / Comms', description: 'Band-limited, compressed walkie-talkie voice.', nodes: [node('highpass', { freq: 300 }), node('lowpass', { freq: 3400 }), node('eq', { freq: 1800, width: 800, gain_db: 3 }), node('compressor', { threshold_db: -20, ratio: 4, makeup_db: 6 }), node('gain', { db: -2 })] },
  intercom: { label: 'Intercom', description: 'Narrow, boxy, slightly crushed speaker-grille voice.', nodes: [node('highpass', { freq: 450 }), node('lowpass', { freq: 2800 }), node('eq', { freq: 1200, width: 600, gain_db: 5 }), node('compressor', { threshold_db: -24, ratio: 6, makeup_db: 8 }), node('robot', { bits: 11, mix: 0.25 })] },
  broadcast: { label: 'Broadcast', description: 'Present, controlled announcer sound.', nodes: [node('highpass', { freq: 80 }), node('eq', { freq: 120, width: 100, gain_db: 2 }), node('eq', { freq: 5000, width: 2000, gain_db: 3 }), node('compressor', { threshold_db: -18, ratio: 3, makeup_db: 3 }), node('lowpass', { freq: 16000 })] },
  synthetic: { label: 'Synthetic / Robotic', description: 'Bit-crushed, modulated machine voice.', nodes: [node('highpass', { freq: 120 }), node('robot', { bits: 8, mix: 0.7 }), node('chorus', { delay_ms: 20, depth: 0.8, speed: 2.5 }), node('tremolo', { freq: 30, depth: 0.25 })] },
  echo_chamber: { label: 'Echo Chamber', description: 'Large hard room with a distinct repeat.', nodes: [node('reverb', { room: 3, wet: 0.5 }), node('delay', { delay_ms: 180, feedback: 0.3, mix: 0.35 })] },
  resonant: { label: 'Resonant / Supernatural', description: 'Low, hollow, slightly detuned voice in a large space.', nodes: [node('eq', { freq: 200, width: 150, gain_db: 4 }), node('pitch', { semitones: -1.5 }), node('chorus', { delay_ms: 30, depth: 1.2, speed: 0.3 }), node('reverb', { room: 2, wet: 0.45 })] },
  custom: { label: 'Custom', description: 'Build your own chain.', nodes: [] },
};

const listPresets = () => Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, description: p.description }));
const idOf = (i) => 'n' + (i + 1);
function presetChain(id) {
  const p = PRESETS[id]; if (!p) throw new Error('unknown FX preset ' + id);
  return { version: CHAIN_VERSION, preset: id, bypass: false, nodes: p.nodes.map((n, i) => ({ id: idOf(i), type: n.type, enabled: true, params: Object.assign({}, n.params) })) };
}
const reset = presetChain;

// Returns { ok, errors, warnings, chain } where chain is clamped, numeric and structurally safe.
function validate(chain) {
  const errors = [], warnings = [];
  const src = chain && typeof chain === 'object' ? chain : { nodes: [] };
  const nodes = Array.isArray(src.nodes) ? src.nodes : [];
  if (nodes.length > MAX_NODES) errors.push(`a chain holds at most ${MAX_NODES} effects`);
  const out = [];
  nodes.slice(0, MAX_NODES).forEach((n, i) => {
    const spec = n && NODE_TYPES[n.type];
    if (!spec) { errors.push(`effect ${i + 1}: unknown type ${JSON.stringify(String(n && n.type).slice(0, 30))}`); return; }
    const params = {};
    for (const [k, [lo, hi, def]] of Object.entries(spec.params)) {
      let v = n.params && n.params[k] !== undefined ? Number.parseFloat(n.params[k]) : def;
      if (!Number.isFinite(v)) v = def;
      const c = Math.min(hi, Math.max(lo, v)); if (c !== v) warnings.push(`${spec.label}: ${k} ${v} was clamped to ${c}`);
      params[k] = c;
    }
    out.push({ id: typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(n.id) ? n.id : idOf(i), type: n.type, enabled: n.enabled !== false, params, label: typeof n.label === 'string' ? n.label.slice(0, 40) : undefined });
  });
  const preset = PRESETS[src.preset] ? src.preset : 'custom';
  return { ok: !errors.length, errors, warnings, chain: { version: CHAIN_VERSION, preset, bypass: !!src.bypass, nodes: out } };
}

function compile(chain) {
  const v = validate(chain);
  const nodes = v.chain.nodes.filter(n => n.enabled);
  if (v.chain.bypass || !nodes.length || !v.ok) return { filter: '', tail_s: 0, empty: true, nodes: [] };
  const built = nodes.map(n => NODE_TYPES[n.type].build(n.params));
  const tail = Math.min(5, built.reduce((m, b) => Math.max(m, b.tail || 0), 0));
  const parts = [];
  if (built.some(b => b.needs48k)) parts.push(`aresample=${WORK_RATE}`);
  if (tail > 0) parts.push(`apad=pad_dur=${r3(tail)}`);      // pad BEFORE the echoes so the tail is generated, not truncated
  parts.push(...built.map(b => b.f));
  return { filter: parts.join(','), tail_s: r3(tail), empty: false, nodes: nodes.map(n => n.type) };
}
function identity(chain) {
  const v = validate(chain), nodes = v.chain.nodes.filter(n => n.enabled);
  if (v.chain.bypass || !nodes.length || !v.ok) return 'clean';
  return F.hashOf({ v: CHAIN_VERSION, nodes: nodes.map(n => [n.type, n.params]) });
}

const clone = c => JSON.parse(JSON.stringify(c));
function reorder(chain, from, to) {
  const c = clone(chain), n = c.nodes.length;
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < n && to < n)) throw new Error('reorder index out of range');
  const [m] = c.nodes.splice(from, 1); c.nodes.splice(to, 0, m); c.preset = 'custom'; return c;
}
function addNode(chain, type, params = {}) {
  if (!NODE_TYPES[type]) throw new Error('unknown effect ' + type);
  const c = clone(chain); if (c.nodes.length >= MAX_NODES) throw new Error(`a chain holds at most ${MAX_NODES} effects`);
  const defaults = Object.fromEntries(Object.entries(NODE_TYPES[type].params).map(([k, [, , d]]) => [k, d]));
  c.nodes.push({ id: 'n' + (Math.max(0, ...c.nodes.map(n => Number(String(n.id).replace(/\D/g, '')) || 0)) + 1), type, enabled: true, params: Object.assign(defaults, params) }); c.preset = 'custom'; return c;
}
function removeNode(chain, id) { const c = clone(chain); c.nodes = c.nodes.filter(n => n.id !== id); c.preset = 'custom'; return c; }

// Saved custom presets (user-owned, versioned, atomic).
function createPresetStore({ file, now = () => Date.now() }) {
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d.presets) ? d.presets : []; } catch (_) { return []; } };
  const write = presets => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 'dexdiffusion.fx_presets.v1', presets }, null, 1) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file);
  };
  const builtIn = id => Object.prototype.hasOwnProperty.call(PRESETS, id);
  const name = n => String(n == null ? '' : n).trim().slice(0, 60);
  return {
    list: () => read(), get: id => read().find(p => p.id === id) || null,
    save({ name: n, chain }) {
      const v = validate(chain); if (!v.ok) throw Object.assign(new Error('invalid FX chain: ' + v.errors.join('; ')), { status: 400 });
      if (!name(n)) throw Object.assign(new Error('a preset needs a name'), { status: 400 });
      const p = { id: 'cp-' + crypto.randomBytes(4).toString('hex'), name: name(n), chain: v.chain, created_at: now(), updated_at: now() };
      write([...read(), p]); return p;
    },
    update(id, patch) {
      if (builtIn(id)) throw Object.assign(new Error('built-in presets cannot be changed'), { status: 400 });
      const all = read(), p = all.find(x => x.id === id); if (!p) return null;
      if (patch.name !== undefined) p.name = name(patch.name) || p.name;
      if (patch.chain !== undefined) { const v = validate(patch.chain); if (!v.ok) throw Object.assign(new Error('invalid FX chain: ' + v.errors.join('; ')), { status: 400 }); p.chain = v.chain; }
      p.updated_at = now(); write(all); return p;
    },
    remove(id) { if (builtIn(id)) throw Object.assign(new Error('built-in presets cannot be removed'), { status: 400 }); const all = read(); const n = all.filter(x => x.id !== id); write(n); return n.length < all.length; },
  };
}

module.exports = { CHAIN_VERSION, NODE_TYPES, PRESETS, listPresets, presetChain, reset, validate, compile, identity, reorder, addNode, removeNode, createPresetStore };
