'use strict';
// Exact local Chat model allowlist (Phase 0 contract D.2). Changing this list is a code change with owner approval.
// Matching is exact against the /api/tags names: no prefix match, no ':latest' normalisation, no fallback to names[0].

const CHAT_MODELS = Object.freeze([
  Object.freeze({ name: 'gemma3:4b', class: 'light', default: true }),
  Object.freeze({ name: 'qwen3.8:27b-mlx', class: 'heavy' }),
  Object.freeze({ name: 'hermes-qwen3.8-27b-64k:latest', class: 'heavy' }),
  Object.freeze({ name: 'dex-cydonia-heretic:24b-q4km', class: 'heavy', label: 'Cydonia 24B Heretic v4' }),
  Object.freeze({ name: 'dex-gemma4-heretic:12b-q4km', class: 'heavy', label: 'Gemma 4 12B Heretic' }),
  Object.freeze({ name: 'dex-rocinante:12b-v1.1-q4km', class: 'heavy', label: 'Rocinante 12B v1.1' }),
]);
const DEFAULT_CHAT_MODEL = CHAT_MODELS.find(m => m.default).name;
// Same threshold as parseOllamaPs (media.js): a tag this large is heavy whatever it is declared as.
const HEAVY_BYTES = 8 * 1024 ** 3;

function isAllowlisted(name) {
  return typeof name === 'string' && CHAT_MODELS.some(m => m.name === name);
}

function installedTags(tagsJson) {
  const models = tagsJson && Array.isArray(tagsJson.models) ? tagsJson.models : [];
  const out = new Map();
  for (const m of models) if (m && typeof m.name === 'string') out.set(m.name, m);
  return out;
}

function classFor(entry, tag) {
  return entry.class === 'heavy' || (tag && Number(tag.size) >= HEAVY_BYTES) ? 'heavy' : 'light';
}

// The allowlist as the client may see it. Tags that are installed but not listed never appear.
function describeAllowlist(tagsJson) {
  const tags = installedTags(tagsJson);
  return CHAT_MODELS.map(m => ({ name: m.name, label: m.label || m.name, class: classFor(m, tags.get(m.name)), installed: tags.has(m.name) }));
}

// -> { ok:true, model, resource_class } or { ok:false, status, code }
function resolveChatModel(requested, tagsJson) {
  const name = requested === undefined || requested === null ? DEFAULT_CHAT_MODEL : requested;
  const entry = CHAT_MODELS.find(m => m.name === name);
  if (!entry) return { ok: false, status: 422, code: 'model-not-allowed' };
  const tag = installedTags(tagsJson).get(name);
  if (!tag) return { ok: false, status: 422, code: 'model-not-installed' };
  return { ok: true, model: name, resource_class: classFor(entry, tag) };
}

// Chat refuses to start unless Ollama is reached through the loopback forward (blocks a cloud OLLAMA_HOST override).
function isLoopbackBaseUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname);
  } catch (_) { return false; }
}

module.exports = { CHAT_MODELS, DEFAULT_CHAT_MODEL, HEAVY_BYTES, isAllowlisted, describeAllowlist, resolveChatModel, isLoopbackBaseUrl };
