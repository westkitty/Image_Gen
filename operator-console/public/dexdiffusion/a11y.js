// Accessible names for form controls whose visible label is a sibling element rather than a <label>.
// The console draws labels as small caps text above the control; screen readers and speech-control software need a real name.
// Conservative: never overrides an existing name, only uses short plain text from the control's nearest preceding sibling
// (or its parent's), and re-runs when the template runtime rebuilds the DOM.
(function () {
  'use strict';
  const targetStyle = document.createElement('style');
  targetStyle.textContent = `
    :where(button,select,input,textarea,a,summary,[role="button"],[tabindex]):focus-visible { outline:2px solid #38bdf8 !important; outline-offset:2px !important; }
    [data-v="2"] :where(button,select,input,textarea,a,summary,[role="button"],[tabindex]):focus-visible { outline-color:#f59e0b !important; }
    [data-v="3"] :where(button,select,input,textarea,a,summary,[role="button"],[tabindex]):focus-visible { outline-color:#a78bfa !important; }
    button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]) { min-height: 32px !important; }
    button, [role="button"] { min-width: 32px !important; }
    @media (pointer: coarse), (max-width: 600px) {
      button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]) { min-height: 44px !important; }
      button, [role="button"] { min-width: 44px !important; }
      label:has(input[type="checkbox"]), label:has(input[type="radio"]) { min-height: 44px; }
    }
  `;
  document.head.appendChild(targetStyle);
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
  function sweep() {
    queued = false;
    document.querySelectorAll(NAMELESS).forEach(label);
    // A model-off field must be disabled for keyboard and assistive technology,
    // as well as dimmed for pointer users. Restore only attributes we own.
    document.querySelectorAll('input,select,textarea').forEach(el => {
      const off = !!el.closest('[data-ctl-off="true"]');
      if (off && !el.disabled) { el.disabled = true; el.setAttribute('data-a11y-model-disabled', 'true'); }
      else if (!off && el.hasAttribute('data-a11y-model-disabled')) { el.disabled = false; el.removeAttribute('data-a11y-model-disabled'); }
    });
    document.querySelectorAll('[data-fullscreen]').forEach(el => {
      if (el.closest('[data-no-fullscreen]') || el.matches('button,a[href]')) return;
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Open fullscreen image ' + (el.getAttribute('data-fullscreen-caption') || el.getAttribute('data-fullscreen-image-id') || el.getAttribute('alt') || 'preview'));
    });
    const dialog = document.querySelector('[data-detailer-dialog]');
    if (dialog && !dialog.contains(document.activeElement)) dialog.querySelector('button')?.focus();
  }
  function schedule() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(sweep); setTimeout(() => { if (queued) sweep(); }, 250); } }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  window.DexA11y = { sweep };
})();
