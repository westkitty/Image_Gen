// Extra-network prompt tokens (P11, RS-12): strict scanner for <lora:name[:weight]> and the other A1111 network tags.
// Pure; loaded by the browser (window.DexNetworkTokens) and the server (require).
//
// Engine truth (stable-diffusion.cpp rev 7f0e728, examples/common/common.cpp extract_and_remove_lora):
//   * only the CLI handles tags, with the regex <lora:([^:>]+):([^>]+)> — a weight is REQUIRED;
//   * "<lora:name>" does not match and would be sent to the text encoder as literal text;
//   * a weight that does not parse, or a file that does not exist, is dropped silently (one log line);
//   * "<lora:name:0.5:0.3>" parses as 0.5 (std::stof prefix), silently ignoring ":0.3";
//   * <lyco:...> and <hypernet:...> are not parsed at all (literal text).
// A1111 treats "<lora:name>" as weight 1 and also accepts separate unet/text-encoder weights. This scanner makes every
// one of those cases explicit: normalise what is equivalent (missing weight -> 1), refuse what the engine cannot do.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexNetworkTokens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = ['lora', 'lyco', 'hypernet'];
  const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  const OPEN = /<\s*(lora|lyco|hypernet)\s*:/gi;

  // -> { tokens: [{kind,name,weight,explicitWeight,offset,length,raw}], issues: [{offset,message}] }
  function scanNetworkTokens(text) {
    const src = String(text == null ? '' : text);
    const tokens = [], issues = [];
    OPEN.lastIndex = 0;
    let m;
    while ((m = OPEN.exec(src))) {
      const start = m.index, kind = m[1].toLowerCase();
      const close = src.indexOf('>', OPEN.lastIndex);
      if (close === -1) { issues.push({ offset: start, message: `Unclosed "<${kind}:" tag: add the closing ">" or remove it.` }); continue; }
      const raw = src.slice(start, close + 1);
      const fields = src.slice(OPEN.lastIndex, close).split(':');
      OPEN.lastIndex = close + 1;
      const name = fields[0].trim();
      if (!name) { issues.push({ offset: start, message: `"${raw}" has no ${kind} name.` }); continue; }
      if (kind !== 'lora') { issues.push({ offset: start, message: `"${raw}": <${kind}:…> tags are not applied by the installed engine and would be sent as literal prompt text. Remove it.` }); continue; }
      if (fields.length > 2) { issues.push({ offset: start, message: `"${raw}": separate text-encoder / UNet weights are not supported; use a single weight (<lora:${name}:0.8>).` }); continue; }
      let weight = 1, explicitWeight = false;
      if (fields.length === 2) {
        const w = fields[1].trim();
        if (!NUMBER.test(w)) { issues.push({ offset: start, message: `"${raw}": "${w}" is not a number; the engine would silently drop this LoRA.` }); continue; }
        weight = Number(w); explicitWeight = true;
      }
      tokens.push({ kind, name, weight, explicitWeight, offset: start, length: raw.length, raw });
    }
    return { tokens, issues };
  }

  // "<lora:name>" -> "<lora:name:1>" so the engine applies it (A1111 default weight 1). Everything else untouched.
  function normalizeDefaultWeights(text) {
    if (typeof text !== 'string' || !/<\s*lora\s*:/i.test(text)) return text;
    const { tokens } = scanNetworkTokens(text);
    let out = '', at = 0;
    for (const t of tokens) {
      if (t.explicitWeight) continue;
      out += text.slice(at, t.offset) + `<lora:${t.name}:1>`; at = t.offset + t.length;
    }
    return out + text.slice(at);
  }

  return { KINDS, scanNetworkTokens, normalizeDefaultWeights };
});
