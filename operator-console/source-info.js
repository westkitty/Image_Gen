'use strict';
/**
 * Read-only access to the archived upstream source information
 * (operator-console/source-archive). Produces the compact hover-card payload for
 * models and LoRAs, and the staged-LoRA asset records the LoRA selector lists.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'source-archive');
const STAGED_ROOT = '/Volumes/wc2tb/DexDiffusion/models/loras/';
const cache = new Map();

function readJson(rel) {
  if (cache.has(rel)) return cache.get(rel);
  let v = null;
  try { v = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (_) {}
  cache.set(rel, v);
  return v;
}
const safe = id => String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
const baseId = name => String(name || '').replace(/\.(safetensors|ckpt|pt|bin)$/i, '').toLowerCase();
const clip = (t, n) => { t = String(t || '').replace(/\s+\n/g, '\n').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };

function catalog() { return readJson('lora-catalog.json') || []; }
function catalogEntry(id) {
  const k = baseId(id);
  return catalog().find(c => c.slug === k || baseId(c.filename) === k) || null;
}
function weightBounds(c) { return c.bucket === 'klein_4b' ? { min: 0.1, max: 3 } : { min: 0, max: 2 }; }

// Asset-shaped records for staged, gate-passed LoRAs (consumed by buildLoraCards).
function stagedLoraAssets() {
  return catalog().filter(c => c.staged_status === 'OK' && (c.bucket === 'klein_4b' || c.bucket === 'sdxl')).map(c => {
    const arch = readJson(`loras/${c.slug}.json`) || {};
    const desc = clip(arch.civitai && arch.civitai.description, 400);
    return {
      id: baseId(c.filename), filename: c.filename, name: c.filename, size_bytes: c.size_bytes || 0, kind: 'lora', status: 'available',
      full_path: STAGED_ROOT + c.bucket + '/' + c.filename,
      curated: {
        source_url: arch.civitai ? arch.civitai.source.url : `https://civitai.com/models/${c.civitai_id}`,
        source_model_id: String(c.civitai_id), classification: 'style', family: c.bucket === 'klein_4b' ? 'flux2' : 'sdxl',
        trigger_words: c.trigger_words || [], description: `STAGED · UNTESTED. ${desc}`,
      },
      default_weight: c.recommended_weight ?? (c.bucket === 'klein_4b' ? 0.6 : 0.7),
      min_weight: weightBounds(c).min, max_weight: weightBounds(c).max,
      plain_mflux: c.bucket === 'klein_4b', untested: true, staged: true,
      proof_status: 'FILE_INSTALLED_UNTESTED',
    };
  });
}

function usageLines(desc) {
  // Lines of the archived description that talk about use: settings, weights, triggers, prompts.
  return String(desc || '').split(/\n+/).map(s => s.trim()).filter(s => s.length > 8 && s.length < 400 &&
    /(weight|strength|trigger|prompt|use |recommend|suggest|steps|cfg|sampler|scale|keyword|tag|negative)/i.test(s)).slice(0, 8);
}
function randomizeFor(entry, triggers) {
  const phrases = [];
  for (const p of (entry.example_prompts || [])) phrases.push(p.prompt);
  return { triggers: (triggers || []).filter(Boolean), phrases: phrases.slice(0, 12) };
}

function loraInfo(id) {
  const c = catalogEntry(id);
  if (!c) return null;
  const e = readJson(`loras/${c.slug}.json`) || {};
  const cv = e.civitai || {};
  const pinned = (cv.versions || []).find(v => v.pinned) || {};
  const triggers = (c.trigger_words && c.trigger_words.length ? c.trigger_words : pinned.trained_words) || [];
  const sources = [];
  if (cv.source) sources.push({ label: 'CivitAI', url: cv.source.url });
  if (e.huggingface && e.huggingface.source) sources.push({ label: 'Hugging Face', url: e.huggingface.source.url });
  const desc = [pinned.description, cv.description].filter(Boolean).join('\n\n');
  return {
    kind: 'lora', id: baseId(c.filename), slug: c.slug, title: cv.name || c.slug, bucket: c.bucket,
    status: c.staged_status === 'OK' ? 'staged · untested' : String(c.staged_status || '').toLowerCase().replace(/_/g, ' '),
    source_url: sources[0] && sources[0].url || null, sources,
    trigger_words: triggers, recommended_weight: c.recommended_weight,
    base_model: (cv.versions || []).find(v => v.pinned) ? pinned.base_model : null,
    summary: clip(cv.description, 700), usage: usageLines(desc),
    license: cv.license || null, tags: cv.tags || [], archived_at: cv.source && cv.source.fetched_at || null,
    randomize: randomizeFor(e.civitai || {}, triggers),
    note: c.staged_status === 'AMBIGUOUS' ? 'Not downloaded: more than one version matches; pin a version.' : null,
  };
}
function modelInfo(id) {
  const e = readJson(`models/${safe(id)}.json`);
  if (!e) return null;
  const card = e.card || {};
  const sources = (e.sources || []).filter(s => s.source && s.source.url).map(s => ({ label: s.source.kind === 'civitai' ? 'CivitAI' : s.source.kind === 'huggingface' ? 'Hugging Face' : 'Source', url: s.source.url }));
  if (card.source_url && !sources.some(s => s.url === card.source_url)) sources.unshift({ label: 'Source', url: card.source_url });
  const first = (e.sources || []).find(s => s.description || s.readme) || {};
  const desc = first.description || String(first.readme || '').replace(/^---[\s\S]*?---/, '');
  const pinned = ((first.versions || []).find(v => v.pinned) || {});
  return {
    kind: 'model', id: card.id, title: card.display_name || card.id, status: card.status || null,
    source_url: sources[0] && sources[0].url || null, sources,
    trigger_words: pinned.trained_words || [], recommended_weight: null,
    summary: clip(card.description || desc, 500), usage: [card.why_use, ...(card.best_for || []).map(b => 'Best for: ' + b), ...(card.avoid_for || []).map(b => 'Avoid: ' + b), card.caveat].filter(Boolean),
    settings: { steps: card.default_steps, cfg: card.default_cfg, resolution: card.native_resolution },
    license: first.license || null, tags: card.specialties || [], archived_at: first.source && first.source.fetched_at || null,
    randomize: { triggers: [], phrases: [] , styles: card.specialties || [] },
  };
}
function getInfo(kind, id) { return kind === 'lora' ? loraInfo(id) : kind === 'model' ? modelInfo(id) : null; }
module.exports = { stagedLoraAssets, getInfo, loraInfo, modelInfo, catalogEntry };
