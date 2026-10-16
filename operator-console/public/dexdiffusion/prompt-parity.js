// A1111 prompt-language scanner and per-backend support truth (P04, slice S04.1).
//
// Pure and deterministic; loaded by the browser (window.DexPrompt) and by the server (require).
// It does NOT rewrite prompts. It finds A1111 constructs, says exactly how each installed backend
// treats them, and produces precise rejections for constructs that no installed backend executes —
// literal substitution would not be A1111 prompt scheduling, so those are refused, never faked.
//
// Evidence for the support table (stable-diffusion.cpp rev 7f0e728 on Big Mac):
//   src/core/util.cpp  parse_prompt_attention(): ports A1111's parser — ( ), (x:1.3), [ ], \( \) \[ \] \\ and BREAK.
//   src/conditioning/conditioner.hpp: CLIP tokenizer applies the weights and pads at BREAK (75-token chunks).
//   No handling anywhere for [a:b:0.5] scheduling, [a|b] alternation or AND composition.
//   MFLUX / FLUX.2 Klein (Qwen3 text encoder): no prompt-weight parsing; every character is literal text.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexPrompt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = ['attention', 'attention-weight', 'bracket-decay', 'escape', 'break', 'schedule', 'alternation', 'and'];

  // Find the index of the ']' that closes the '[' at `open` (honouring escapes and nesting), or -1.
  function matchSquare(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) return i;
    }
    return -1;
  }

  // Top-level (depth 0 inside the brackets) positions of `ch` within text[from, to).
  function topLevel(text, from, to, ch) {
    const out = [];
    let sq = 0, rd = 0;
    for (let i = from; i < to; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') sq++; else if (c === ']') sq--;
      else if (c === '(') rd++; else if (c === ')') rd--;
      else if (c === ch && sq === 0 && rd === 0) out.push(i);
    }
    return out;
  }

  const NUMBER = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/;

  function analyzePrompt(text) {
    const src = String(text == null ? '' : text);
    const constructs = [], issues = [];
    const add = (kind, offset, length, extra) => constructs.push(Object.assign({ kind, offset, length, text: src.slice(offset, offset + length) }, extra || {}));

    const roundStack = [];
    const squareHandled = new Set();
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') {
        if (/[()\[\]\\]/.test(src[i + 1] || '')) { add('escape', i, 2); i++; }
        continue;
      }
      if (c === '(') { roundStack.push(i); continue; }
      if (c === ')') {
        if (!roundStack.length) { issues.push({ offset: i, severity: 'note', message: 'Unmatched ")" is sent as plain text.', hint: 'Use \\) for a literal parenthesis or add the missing "(".' }); continue; }
        const open = roundStack.pop();
        const inner = src.slice(open + 1, i);
        const w = /:\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*$/.exec(inner);
        add(w ? 'attention-weight' : 'attention', open, i - open + 1, w ? { weight: parseFloat(w[1]) } : {});
        continue;
      }
      if (c === '[' && !squareHandled.has(i)) {
        const close = matchSquare(src, i);
        if (close === -1) { issues.push({ offset: i, severity: 'note', message: 'Unclosed "[" lowers the weight of the rest of the prompt.', hint: 'Close it with "]" or escape it as \\[.' }); continue; }
        const pipes = topLevel(src, i + 1, close, '|');
        const colons = topLevel(src, i + 1, close, ':');
        const lastColon = colons.length ? colons[colons.length - 1] : -1;
        if (pipes.length) add('alternation', i, close - i + 1, { options: pipes.length + 1 });
        else if (lastColon !== -1 && NUMBER.test(src.slice(lastColon + 1, close))) add('schedule', i, close - i + 1, { when: parseFloat(src.slice(lastColon + 1, close)), parts: colons.length });
        else add('bracket-decay', i, close - i + 1);
        // Nested brackets inside a schedule/alternation belong to it; plain decay may nest other constructs.
        if (constructs[constructs.length - 1].kind !== 'bracket-decay') for (let j = i + 1; j < close; j++) if (src[j] === '[') squareHandled.add(j);
        continue;
      }
    }
    for (const open of roundStack) issues.push({ offset: open, severity: 'note', message: 'Unclosed "(" raises the weight of the rest of the prompt.', hint: 'Close it with ")" or escape it as \\(.' });

    const re = (kind, regex, extra) => { let m; while ((m = regex.exec(src))) add(kind, m.index + (m[0].length - m[0].trimStart().length), m[0].trim().length, extra); };
    re('break', /\s*\bBREAK\b\s*/g);
    re('and', /\s+\bAND\b(?::[\d.]+)?\s+|^\bAND\b\s+/g);

    constructs.sort((a, b) => a.offset - b.offset);
    return { constructs, issues, kinds: [...new Set(constructs.map(c => c.kind))] };
  }

  // How a target treats each construct: 'native' | 'literal' (sent as ordinary text) | 'unsupported' (refused) | 'unverified'.
  function supportFor(spec) {
    const mflux = spec && spec.backend === 'mflux';
    const t5 = spec && spec.id === 'flux-fp8';
    if (mflux) {
      return { engine: 'MFLUX (Qwen3 encoder)', attention: 'literal', 'attention-weight': 'literal', 'bracket-decay': 'literal', escape: 'literal', break: 'unsupported', schedule: 'unsupported', alternation: 'unsupported', and: 'unsupported' };
    }
    return {
      engine: t5 ? 'stable-diffusion.cpp (T5)' : 'stable-diffusion.cpp (CLIP)',
      attention: 'native', 'attention-weight': 'native', 'bracket-decay': 'native', escape: 'native',
      break: t5 ? 'unverified' : 'native',
      schedule: 'unsupported', alternation: 'unsupported', and: 'unsupported',
    };
  }

  const WHY = {
    schedule: 'prompt scheduling ([from:to:when]) needs per-step conditioning, which no installed backend provides; swapping the text would not be A1111 scheduling',
    alternation: 'alternating prompts ([a|b]) need per-step conditioning, which no installed backend provides',
    and: 'AND composable conditioning needs multiple conditioning streams, which no installed backend provides',
    break: 'BREAK chunk padding is not applied by this backend',
  };
  const HINT = {
    schedule: 'Remove the schedule, or write the words without "[a:b:0.5]" form to use plain text.',
    alternation: 'Pick one option, or use two separate generations.',
    and: 'Write lowercase "and" to keep it as ordinary text.',
    break: 'Remove BREAK for this target.',
  };

  // First construct that this target would mis-handle, as a precise error string; otherwise null.
  function validateForTarget(spec, positive, negative) {
    const support = supportFor(spec);
    for (const [field, text] of [['prompt', positive], ['negative prompt', negative]]) {
      if (!text) continue;
      const a = analyzePrompt(text);
      for (const c of a.constructs) {
        if (support[c.kind] === 'unsupported') {
          return `Unsupported ${field} syntax at offset ${c.offset}: "${c.text.length > 40 ? c.text.slice(0, 37) + '…' : c.text}" — ${WHY[c.kind]}. ${HINT[c.kind]}`;
        }
      }
    }
    return null;
  }

  // Short, truthful notes for the prompt editor. Never claims support that was not proven.
  function notesForTarget(spec, positive, negative) {
    const support = supportFor(spec), notes = [];
    const kinds = new Set([...analyzePrompt(positive).kinds, ...analyzePrompt(negative).kinds]);
    if (support['attention-weight'] === 'literal' && (kinds.has('attention') || kinds.has('attention-weight') || kinds.has('bracket-decay'))) {
      notes.push(`${support.engine} does not apply emphasis weights; "(word:1.3)", "(word)" and "[word]" are sent as literal text.`);
    }
    if (support.break === 'unverified' && kinds.has('break')) notes.push('BREAK behaviour is unverified for this target.');
    return notes;
  }

  function syntaxHelp(spec) {
    const s = supportFor(spec);
    if (s.engine.startsWith('MFLUX')) return 'FLUX.2 reads the prompt as plain language. Emphasis weights, BREAK, scheduling, alternation and AND are not used.';
    return 'Supported: (word), (word:1.3), [word], \\( \\) escapes' + (s.break === 'native' ? ', BREAK' : '') + '. Not supported yet: [a:b:0.5] scheduling, [a|b] alternation, AND.';
  }

  return { KINDS, analyzePrompt, supportFor, validateForTarget, notesForTarget, syntaxHelp };
});
