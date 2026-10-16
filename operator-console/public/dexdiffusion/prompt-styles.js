// A1111 prompt-style semantics (P04 slice S04.2), pure and shared by the browser and the server.
//
// A style has a name, a positive template and a negative template. Applying a style to a prompt follows
// stable-diffusion-webui's apply_styles_to_prompt: a template containing {prompt} has that token replaced by the
// current text; otherwise the template is appended after ", "; an empty prompt simply becomes the template.
// Styles are applied in the order given. Nothing here stores or sends text anywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DexStyles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PLACEHOLDER = '{prompt}';
  const MAX_NAME = 60;
  const MAX_TEMPLATE = 4000;

  function applyTemplate(template, text) {
    const t = String(template == null ? '' : template);
    const p = String(text == null ? '' : text);
    if (!t) return p;
    if (t.includes(PLACEHOLDER)) return t.split(PLACEHOLDER).join(p);
    return p ? p + ', ' + t : t;
  }

  // Inverse used when saving the current prompt as a style: strip a previously applied template back out.
  function extractTemplate(template, text) {
    const t = String(template == null ? '' : template), p = String(text == null ? '' : text);
    if (!t) return p;
    if (t.includes(PLACEHOLDER)) {
      const [head, ...rest] = t.split(PLACEHOLDER), tail = rest.join(PLACEHOLDER);
      return p.startsWith(head) && p.endsWith(tail) && p.length >= head.length + tail.length ? p.slice(head.length, p.length - tail.length) : p;
    }
    if (p.endsWith(', ' + t)) return p.slice(0, p.length - t.length - 2);
    return p === t ? '' : p;
  }

  function applyStyles(styles, positive, negative) {
    let pos = String(positive == null ? '' : positive), neg = String(negative == null ? '' : negative);
    for (const s of styles || []) {
      pos = applyTemplate(s.prompt, pos);
      neg = applyTemplate(s.negative_prompt, neg);
    }
    return { prompt: pos, negative_prompt: neg };
  }

  // Returns an error string or null.
  function validateStyle(style) {
    if (!style || typeof style !== 'object') return 'Style must be an object';
    const name = typeof style.name === 'string' ? style.name.trim() : '';
    if (!name) return 'Style name is required';
    if (name.length > MAX_NAME) return `Style name must be at most ${MAX_NAME} characters`;
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'Style name contains control characters';
    for (const key of ['prompt', 'negative_prompt']) {
      const v = style[key];
      if (v !== undefined && v !== null && typeof v !== 'string') return `${key} must be text`;
      if (typeof v === 'string' && v.length > MAX_TEMPLATE) return `${key} must be at most ${MAX_TEMPLATE} characters`;
    }
    if (!String(style.prompt || '').trim() && !String(style.negative_prompt || '').trim()) return 'A style needs a prompt or a negative prompt template';
    return null;
  }

  return { PLACEHOLDER, MAX_NAME, MAX_TEMPLATE, applyTemplate, extractTemplate, applyStyles, validateStyle };
});
