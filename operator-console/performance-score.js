'use strict';

// Shared Voice/Drama directing record. Dialogue is immutable input; score data only
// describes how a renderer should perform it.
const crypto = require('crypto');
const SCORE_VERSION = 'dex-performance.v1';
const PRESETS = Object.freeze({
  neutral: { delivery: '', emotion: null, intensity: null, rate: null },
  formal_dry: { delivery: 'Formal, rapid, dry, clipped.', emotion: 'dry', intensity: 0.45, rate: 1.12 },
  restrained_irritation: { delivery: 'Increasing restrained irritation.', emotion: 'irritated', intensity: 0.55, rate: 1 },
  contempt: { delivery: 'Emphasize the specified word, slow down, finish with contempt.', emotion: 'contempt', intensity: 0.7, rate: 0.88 },
});
const digest = text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
function createScore({ sourceText, profileId, identityVersion = null, sceneId = null, lineId, phrases = [], engineId = null, modelRevision = null, seed = null, settings = {} }) {
  const source = String(sourceText == null ? '' : sourceText);
  if (!lineId || !profileId) throw new TypeError('lineId and profileId are required');
  const normalized = phrases.map((p, index) => {
    const start = Number(p.start), end = Number(p.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) throw new RangeError(`phrase ${index + 1} has invalid source boundaries`);
    if (p.text !== undefined && source.slice(start, end) !== p.text) throw new Error(`phrase ${index + 1} text does not match immutable source dialogue`);
    return { id: String(p.id || `phrase-${index + 1}`), start, end, text: source.slice(start, end), preset: p.preset || null,
      delivery: String(p.delivery || ''), emotion: p.emotion || null,
      rate: p.rate == null ? null : Number(p.rate), emphasis: Array.isArray(p.emphasis) ? p.emphasis.map(x => {
        const span = { text: String(x.text), start: Number(x.start), end: Number(x.end) };
        if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < start || span.end <= span.start || span.end > end || source.slice(span.start, span.end) !== span.text) throw new Error(`phrase ${index + 1} emphasis does not match source dialogue`);
        return span;
      }) : [],
      intensity: p.intensity == null ? null : Number(p.intensity), transition: p.transition || null,
      pauseAfterMs: p.pauseAfterMs == null ? 0 : Number(p.pauseAfterMs), cues: Array.isArray(p.cues) ? p.cues.map(String) : [],
      controls: { delivery: 'requested', emotion: 'requested', rate: 'requested' } };
  });
  for (let i = 1; i < normalized.length; i++) if (normalized[i].start < normalized[i - 1].end) throw new RangeError(`phrase ${i + 1} overlaps or precedes phrase ${i}`);
  return { schema: SCORE_VERSION, source: { text: source, sha256: digest(source) }, speaker: { profileId: String(profileId), identityVersion }, sceneId, lineId: String(lineId),
    phrases: normalized, engine: { id: engineId, revision: modelRevision }, seed, settings: Object.assign({}, settings), reference: null,
    takes: { selected: null, alternates: [], approvals: [] }, lineage: { source_sha256: digest(source), parent_take_id: null }, createdAt: new Date().toISOString() };
}
function validateScore(score) {
  if (!score || score.schema !== SCORE_VERSION || !score.source || digest(score.source.text) !== score.source.sha256) return { ok: false, error: 'invalid or modified source dialogue' };
  let end = 0;
  for (const p of score.phrases || []) {
    if (!Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < end || p.end <= p.start || p.end > score.source.text.length) return { ok: false, error: `phrase ${p.id} has stale or overlapping boundaries` };
    if (score.source.text.slice(p.start, p.end) !== p.text) return { ok: false, error: `phrase ${p.id} no longer matches source dialogue` };
    end = p.end;
  }
  return { ok: true };
}
function resolvePhraseControls(score, engine) {
  const v = validateScore(score); if (!v.ok) throw new Error(v.error);
  return score.phrases.map(p => {
    const preset = PRESETS[p.preset] || {};
    const native = !!(engine && engine.capabilities && engine.capabilities.per_item_instructions);
    const rateSupported = !!(engine && engine.capabilities && engine.capabilities.speed_control);
    return { phraseId: p.id, text: p.text, delivery: p.delivery || preset.delivery || '', rate: p.rate == null ? (preset.rate || null) : p.rate,
      controls: { delivery: !p.delivery && !preset.delivery ? 'not-requested' : native ? 'native' : 'unsupported',
        emotion: p.emotion || preset.emotion ? (p.delivery || preset.delivery ? 'approximate' : 'unsupported') : 'not-requested',
        rate: p.rate == null && !preset.rate ? 'not-requested' : rateSupported ? 'native' : 'unsupported' } };
  });
}
function compileScoreItems(score, engine) {
  const v = validateScore(score); if (!v.ok) throw new Error(v.error);
  if (!score.phrases.length) return score.source.text ? [{ text: score.source.text, direction: '', phraseId: null, pauseAfterMs: 0 }] : [];
  const controls = new Map(resolvePhraseControls(score, engine).map(x => [x.phraseId, x]));
  const source = score.source.text, items = [];
  let cursor = 0;
  for (const p of score.phrases) {
    if (p.start > cursor) items.push({ text: source.slice(cursor, p.start), direction: '', phraseId: null, pauseAfterMs: 0, sourceStart: cursor, sourceEnd: p.start });
    const control = controls.get(p.id);
    items.push({ text: source.slice(p.start, p.end), direction: control && control.controls.delivery !== 'unsupported' ? control.delivery : '',
      phraseId: p.id, pauseAfterMs: p.pauseAfterMs, sourceStart: p.start, sourceEnd: p.end, controls: control ? control.controls : {} });
    cursor = p.end;
  }
  if (cursor < source.length) items.push({ text: source.slice(cursor), direction: '', phraseId: null, pauseAfterMs: 0, sourceStart: cursor, sourceEnd: source.length });
  // Phrase boundaries commonly leave a separator (usually a single space) between
  // two directed items. Keep that byte-for-byte source text, but attach whitespace
  // to an adjacent spoken item instead of dispatching it as an empty speech request.
  for (let i = 0; i < items.length;) {
    if (items[i].text.trim()) { i++; continue; }
    const gap = items.splice(i, 1)[0];
    if (i > 0) {
      items[i - 1].text += gap.text;
      items[i - 1].sourceEnd = gap.sourceEnd;
      items[i - 1].pauseAfterMs = gap.pauseAfterMs || items[i - 1].pauseAfterMs;
    } else if (items.length) {
      items[0].text = gap.text + items[0].text;
      items[0].sourceStart = gap.sourceStart;
    } else items.push(gap);
  }
  return items;
}
function migrateLegacyLine(line, { profileId, identityVersion = null, engineId = null } = {}) {
  if (!line || !profileId || !line.id) throw new TypeError('legacy line, profileId, and line id are required');
  const text = String(line.text == null ? '' : line.text);
  return createScore({ sourceText: text, profileId, identityVersion, lineId: String(line.id), engineId,
    phrases: text ? [{ id: 'legacy-line', start: 0, end: text.length, text, delivery: String(line.direction || '') }] : [] });
}
module.exports = { SCORE_VERSION, PRESETS, createScore, validateScore, resolvePhraseControls, compileScoreItems, migrateLegacyLine };
