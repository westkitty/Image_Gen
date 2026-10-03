'use strict';

// Engine-agnostic long-form text chunking for TTS.
//
// Splits on the most natural boundary that fits: paragraph → sentence → clause →
// whitespace → hard cut (only when unavoidable). Recognized performance /
// paralinguistic tags — [laughs], <whisper>, {beat}, (sighs) — are never split.
// Each chunk records the boundary that FOLLOWS it so the stitcher can insert a
// deliberate pause there (paragraph/sentence/clause) and otherwise crossfade.

const GAP_MS = { paragraph: 520, sentence: 260, clause: 110, word: 0, hard: 0, end: 0 };
const TAG_RE = /\[[^\]\n]{1,80}\]|<[^>\n]{1,80}>|\{[^}\n]{1,80}\}|\([^)\n]{1,60}\)/g;

function protectedSpans(text) {
  const spans = []; let m; const re = new RegExp(TAG_RE.source, 'g');
  while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
const insideSpan = (spans, i) => spans.some(([s, e]) => i > s && i < e);

const LEVELS = [
  ['paragraph', /\n[ \t]*\n+/g],
  ['sentence', /[.!?…。！？]+["'”’)\]]*\s+/g],
  ['clause', /[,;:—–]\s+|\s-\s/g],
  ['word', /\s+/g],
];

// Pieces of text[start,end) cut after every separator of `re` that is not inside a protected span.
function pieces(text, start, end, re, spans) {
  const out = []; let from = start; const rx = new RegExp(re.source, 'g'); rx.lastIndex = start; let m;
  while ((m = rx.exec(text)) !== null && m.index < end) {
    const cut = m.index + m[0].length;
    if (cut > end) break;
    if (insideSpan(spans, m.index) || insideSpan(spans, cut - 1)) continue;
    if (cut > from) { out.push([from, cut]); from = cut; }
    if (m[0].length === 0) rx.lastIndex++;
  }
  if (from < end) out.push([from, end]);
  return out;
}

function splitLongText(input, { maxChars = 600 } = {}) {
  const text = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
  if (!Number.isFinite(maxChars) || maxChars < 20) throw new Error('maxChars must be >= 20');
  const body = text.trim();
  if (!body) return [];
  const lead = text.indexOf(body), spans = protectedSpans(text);
  const out = [];
  const push = (s, e, boundary) => {
    const raw = text.slice(s, e), t = raw.trim(); if (!t) return;
    const off = s + raw.indexOf(t);
    out.push({ text: t, start: off, end: off + t.length, boundary });
  };
  // Pack consecutive pieces up to maxChars; pieces larger than maxChars descend a level.
  function pack(s, e, level, boundaryAfter) {
    if (e - s <= maxChars || text.slice(s, e).trim().length <= maxChars) { push(s, e, boundaryAfter); return; }
    if (level >= LEVELS.length) { hardSplit(s, e, boundaryAfter); return; }
    const [kind, re] = LEVELS[level];
    const ps = pieces(text, s, e, re, spans);
    if (ps.length <= 1) { pack(s, e, level + 1, boundaryAfter); return; }
    let cs = ps[0][0], ce = ps[0][0];
    const flush = (b) => { if (ce > cs) push(cs, ce, b); };
    for (let i = 0; i < ps.length; i++) {
      const [ps0, pe] = ps[i];
      if (pe - ps0 > maxChars) {                       // single piece too big: flush what we have, recurse
        if (ce > cs) { flush(kind); }
        pack(ps0, pe, level + 1, i === ps.length - 1 ? boundaryAfter : kind);
        cs = ce = pe; continue;
      }
      if (ce > cs && text.slice(cs, pe).trim().length > maxChars) { flush(kind); cs = ps0; }
      if (ce === cs) cs = ps0;
      ce = pe;
    }
    if (ce > cs) push(cs, ce, boundaryAfter);
  }
  function hardSplit(s, e, boundaryAfter) {
    let cur = s;
    while (e - cur > maxChars) {
      let cut = cur + maxChars;
      const span = spans.find(([a, b]) => cut > a && cut < b);
      if (span) cut = span[0] > cur ? span[0] : span[1];                // keep tags whole (may exceed max)
      else { const ws = text.lastIndexOf(' ', cut); if (ws > cur + maxChars * 0.5) cut = ws + 1; }
      push(cur, cut, 'hard'); cur = cut;
    }
    push(cur, e, boundaryAfter);
  }
  pack(lead, lead + body.length, 0, 'end');
  // Re-derive each chunk's boundary from the source text so paragraph/sentence breaks are exact.
  out.forEach((c, i) => {
    if (i === out.length - 1) { c.boundary = 'end'; return; }
    if (c.boundary === 'hard' || c.boundary === 'word') return;
    const between = text.slice(c.end, out[i + 1].start);
    if (/\n[ \t]*\n/.test(between)) c.boundary = 'paragraph';
    else if (/[.!?…。！？]["'”’)\]]*$/.test(c.text)) c.boundary = 'sentence';
    else if (/[,;:—–]$/.test(c.text)) c.boundary = 'clause';
    else if (c.boundary === 'paragraph' || c.boundary === 'sentence' || c.boundary === 'clause') c.boundary = 'word';
  });
  return out.map((c, i) => ({ index: i, total: out.length, text: c.text, start: c.start, end: c.end, boundary: c.boundary, gapAfterMs: GAP_MS[c.boundary] || 0 }));
}

// A tag-aware check used by tests/validation: true when no chunk boundary falls inside a protected span.
function tagsIntact(input, chunks) {
  const text = String(input).replace(/\r\n?/g, '\n'), spans = protectedSpans(text);
  return chunks.every(c => !spans.some(([a, b]) => (c.start > a && c.start < b) || (c.end > a && c.end < b)));
}

module.exports = { splitLongText, tagsIntact, protectedSpans, GAP_MS };
