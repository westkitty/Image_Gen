// Pure DexDiffusion client helpers, shared by component.js and the Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexClient = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The UI and API share one origin, so the default backend base is '' and every
  // request is a relative '/api/...' path. That works unchanged from
  // 127.0.0.1, localhost and the Tailscale HTTPS hostname. A stored loopback URL
  // (the old default) is ignored: on another tailnet device it would address
  // that device, not the MacBook.
  const LEGACY_LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/*$/i;
  function resolveBackendBase(stored) {
    const value = typeof stored === 'string' ? stored.trim() : '';
    if (!value || LEGACY_LOOPBACK.test(value)) return '';
    return value.replace(/\/+$/, '');
  }

  // Jobs report progress either as a number or as the sequential-run object
  // { totalPercent, currentRunPercent, ... }. Returns an integer 0-100 or null.
  function jobProgressPercent(progress) {
    let value = progress;
    if (value && typeof value === 'object') {
      value = value.totalPercent != null ? value.totalPercent : value.currentRunPercent;
    }
    if (value == null || value === '') return null;
    value = Number(value);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  // Pick the target to show once capabilities load:
  // 1. a saved preference that is still offered, else
  // 2. the backend-designated primary target if it is proofed, else
  // 3. the current selection (unchanged behaviour).
  function chooseInitialTarget(targets, savedId, currentId) {
    const list = Array.isArray(targets) ? targets : [];
    const has = id => !!id && list.some(t => t && t.id === id);
    if (has(savedId)) return savedId;
    const primary = list.find(t => t && t.primary === true && t.status === 'proofed');
    if (primary) return primary.id;
    return currentId;
  }

  // Dropdown label: marks the primary engine and dormant legacy targets.
  function targetOptionLabel(t) {
    const base = (t && (t.label || t.id)) || '';
    if (t && t.primary) return base + ' — Primary';
    if (t && t.runtime === 'dormant') return base + ' — dormant';
    return base;
  }

  return { resolveBackendBase, jobProgressPercent, chooseInitialTarget, targetOptionLabel };
});
