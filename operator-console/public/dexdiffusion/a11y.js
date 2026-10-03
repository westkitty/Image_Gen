// Accessible names for form controls whose visible label is a sibling element rather than a <label>.
// The console draws labels as small caps text above the control; screen readers and speech-control software need a real name.
// Conservative: never overrides an existing name, only uses short plain text from the control's nearest preceding sibling
// (or its parent's), and re-runs when the template runtime rebuilds the DOM.
(function () {
  'use strict';
  const NAMELESS = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=file]), select, textarea';
  const hasName = el => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.hasAttribute('title') || el.placeholder
    || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
  function labelText(node) {
    let prev = node.previousElementSibling;
    while (prev) {
      if (!prev.matches('input,select,textarea,button,img,canvas,svg') && !prev.querySelector('input,select,textarea,button')) {
        const t = (prev.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 48) return t;
      }
      prev = prev.previousElementSibling;
      if (prev && prev.matches('input,select,textarea')) return '';        // another control sits between: ambiguous
    }
    return '';
  }
  function label(el) {
    if (hasName(el)) return;
    const t = labelText(el) || (el.parentElement && el.parentElement.children.length <= 2 ? labelText(el.parentElement) : '');
    if (t) el.setAttribute('aria-label', t.replace(/\s*[:：]$/, ''));
  }
  let queued = false;
  function sweep() { queued = false; document.querySelectorAll(NAMELESS).forEach(label); }
  function schedule() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(sweep); setTimeout(() => { if (queued) sweep(); }, 250); } }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  window.DexA11y = { sweep };
})();
