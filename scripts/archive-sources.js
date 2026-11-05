#!/usr/bin/env node
'use strict';
/**
 * Archives the upstream source information for every model card and staged LoRA
 * as plain text/JSON under operator-console/source-archive/, so usage notes,
 * trigger words and descriptions survive if the upstream page disappears.
 * Re-runnable; read-only toward the network. CIVITAI_TOKEN is read from the
 * environment and is never written to disk.
 *   node scripts/archive-sources.js [--models] [--loras]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', 'operator-console', 'source-archive');
const TOKEN = process.env.CIVITAI_TOKEN || '';
const UA = { 'User-Agent': 'DexDiffusion-source-archive/1' };

const text = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

async function getJson(url, auth) {
  const headers = { ...UA, ...(auth && TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) };
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function civitaiModel(id, versionId) {
  const m = await getJson(`https://civitai.com/api/v1/models/${id}`, true);
  const versions = m.modelVersions.map(v => ({
    id: v.id, name: v.name, base_model: v.baseModel, published_at: v.publishedAt,
    trained_words: v.trainedWords || [], description: text(v.description),
    files: (v.files || []).map(f => ({ name: f.name, size_kb: f.sizeKB, sha256: (f.hashes || {}).SHA256 || null })),
    pinned: v.id === versionId
  }));
  let prompts = [];
  if (versionId) {
    try {
      const im = await getJson(`https://civitai.com/api/v1/images?modelVersionId=${versionId}&limit=30&nsfw=X&sort=Most%20Reactions`, true);
      prompts = (im.items || []).filter(i => i.meta && i.meta.prompt).map(i => ({
        prompt: i.meta.prompt, negative_prompt: i.meta.negativePrompt || null, steps: i.meta.steps || null,
        cfg_scale: i.meta.cfgScale || null, sampler: i.meta.sampler || null, seed: i.meta.seed || null,
        size: i.meta.Size || null, resources: i.meta.civitaiResources || null
      })).slice(0, 12);
    } catch (e) { prompts = []; }
  }
  return {
    source: { url: `https://civitai.com/models/${id}${versionId ? '?modelVersionId=' + versionId : ''}`, kind: 'civitai', fetched_at: new Date().toISOString() },
    name: m.name, type: m.type, tags: m.tags, creator: (m.creator || {}).username || null,
    license: { commercial: m.allowCommercialUse, derivatives: m.allowDerivatives, credit: m.allowNoCredit === false },
    description: text(m.description), description_html: m.description || '',
    versions, example_prompts: prompts
  };
}
async function hfModel(url) {
  const id = url.replace(/^https:\/\/huggingface\.co\//, '').replace(/\/.*$/, '') ? url.replace(/^https:\/\/huggingface\.co\//, '').split('/').slice(0, 2).join('/') : '';
  let card = null, readme = '';
  try { card = await getJson(`https://huggingface.co/api/models/${id}`); } catch (_) {}
  try { readme = await getText(`https://huggingface.co/${id}/raw/main/README.md`); } catch (_) {}
  return { source: { url: `https://huggingface.co/${id}`, kind: 'huggingface', fetched_at: new Date().toISOString() },
    repo: id, tags: card && card.tags || [], license: card && card.cardData && card.cardData.license || null, readme };
}
function write(rel, obj) {
  const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n'); return p;
}
async function loras() {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'lora-catalog.json'), 'utf8'));
  for (const c of cat) {
    const entry = { kind: 'lora', slug: c.slug, local: c, archived_with: 'scripts/archive-sources.js' };
    try { entry.civitai = await civitaiModel(c.civitai_id, c.version_id); } catch (e) { entry.civitai_error = e.message; }
    if (c.hf_url) { try { entry.huggingface = await hfModel(c.hf_url); } catch (e) { entry.huggingface_error = e.message; } }
    write(`loras/${c.slug}.json`, entry); console.log('lora', c.slug, entry.civitai_error || 'ok');
  }
}
async function models() {
  const { MODEL_CARDS } = require('../operator-console/model-registry');
  for (const card of MODEL_CARDS) {
    const entry = { kind: 'model', id: card.id, card, archived_with: 'scripts/archive-sources.js', sources: [] };
    const urls = [card.source_url, card.distribution_url, ...(JSON.stringify(card).match(/https:\/\/(?:civitai\.com\/models\/\d+[^"\s)]*|huggingface\.co\/[^"\s)]+)/g) || [])];
    for (const u of [...new Set(urls.filter(Boolean))]) {
      try {
        const cm = u.match(/civitai\.com\/models\/(\d+)(?:\?modelVersionId=(\d+))?/);
        entry.sources.push(cm ? await civitaiModel(cm[1], cm[2] ? Number(cm[2]) : null) : u.includes('huggingface.co') ? await hfModel(u) : { source: { url: u } });
      } catch (e) { entry.sources.push({ source: { url: u }, error: e.message }); }
    }
    write(`models/${card.id.replace(/[^a-z0-9._-]/gi, '_')}.json`, entry); console.log('model', card.id, entry.sources.length);
  }
}
function index() {
  const rows = []; const sums = [];
  for (const dir of ['models', 'loras']) {
    const d = path.join(ROOT, dir); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort()) {
      const buf = fs.readFileSync(path.join(d, f));
      sums.push(`${crypto.createHash('sha256').update(buf).digest('hex')}  ${dir}/${f}`);
      const j = JSON.parse(buf);
      const url = dir === 'loras' ? (j.civitai && j.civitai.source.url) || '' : ((j.sources || [])[0] || {}).source ? j.sources[0].source.url : '';
      rows.push(`| ${dir.slice(0, -1)} | ${f.replace(/\.json$/, '')} | ${url || '(no upstream URL recorded)'} |`);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'INDEX.md'), '# Source archive\n\nUpstream descriptions, trigger words, license and example prompts, snapshotted as text so they remain available if the sources change or vanish. CivitAI withholds image generation metadata through its API, so `example_prompts` is empty; usage guidance lives in each description, trigger words and version notes. Regenerate with `node scripts/archive-sources.js`.\n\n| kind | id | source |\n|---|---|---|\n' + rows.join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'SHA256SUMS'), sums.join('\n') + '\n');
}
(async () => {
  const a = process.argv.slice(2); const all = !a.length;
  if (all || a.includes('--loras')) await loras();
  if (all || a.includes('--models')) await models();
  index();
})().catch(e => { console.error(e); process.exit(1); });
