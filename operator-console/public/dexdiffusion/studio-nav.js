// DexDiffusion Studio — canonical product navigation (V2 Studio).
//
// One product shell, one fixed category order. This module is the single source of truth for:
//   * the 14 top-level Studio destinations and their exact order (never sorted by worker availability)
//   * the restrained category tints (colour communicates grouping, never permission or success)
//   * the default product version and the one-time migration away from Workstation-first profiles
//
// It is a plain script (no build step) so both the browser shell and node tests can load it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DexStudioNav = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // I-01: V2 Studio is the only normal user-facing product shell.
  const STUDIO_VERSION = 2;

  // §2.3 — fixed semantic order. Do not reorder because a worker is dormant.
  const CATEGORIES = Object.freeze([
    { id: 'create', label: 'Create', group: 'image' },
    { id: 'batch', label: 'Batch', group: 'image' },
    { id: 'swap', label: 'Swap', group: 'image' },
    { id: 'voice', label: 'Voice', group: 'sound' },
    { id: 'drama', label: 'Drama', group: 'sound' },
    { id: 'music', label: 'Music', group: 'sound' },
    { id: 'video', label: 'Video', group: 'motion' },
    { id: 'world', label: 'World', group: 'motion' },
    { id: '3d', label: '3D', group: 'motion' },
    { id: 'library', label: 'Library', group: 'ops' },
    { id: 'edit', label: 'Edit', group: 'image' },
    { id: 'enhance', label: 'Enhance', group: 'image' },
    { id: 'models', label: 'Models', group: 'ops' },
    { id: 'system', label: 'System', group: 'ops' }
  ]);

  // Light tints on the dark Studio chrome: every one is readable at >= 7:1 on #0b0d11.
  const GROUPS = Object.freeze({
    image: { label: 'Image production', tint: '#7dd3fc' },
    sound: { label: 'Sound', tint: '#c4b5fd' },
    motion: { label: 'Moving image and 3D', tint: '#6ee7b7' },
    ops: { label: 'Library and operations', tint: '#fcd34d' }
  });

  const IDS = CATEGORIES.map(c => c.id);

  // Screens whose execution is truthfully unavailable today. They stay navigable and honest.
  const UNAVAILABLE_EXECUTION = Object.freeze({
    swap: 'Swap has no approved backend yet.',
    video: 'No verified video generator is configured on this installation.'
  });

  const DEFAULT_TINT = GROUPS.ops.tint;

  function isCategory(id) { return IDS.indexOf(id) > -1; }

  // A chip row built from the canonical order. Stable references are the caller's responsibility:
  // rebuild only when the active screen changes, never on every render tick.
  function chips({ activeScreen = 'create', onSelect = null, unavailable = UNAVAILABLE_EXECUTION } = {}) {
    return CATEGORIES.map(cat => {
      const group = GROUPS[cat.group] || GROUPS.ops;
      const active = cat.id === activeScreen;
      const note = unavailable && unavailable[cat.id];
      return {
        id: cat.id,
        label: cat.label,
        group: cat.group,
        groupLabel: group.label,
        tint: group.tint,
        active: String(active),
        ariaSelected: active ? 'true' : 'false',
        ariaCurrent: active ? 'page' : 'false',
        tabIndex: active ? '0' : '-1',
        title: note ? cat.label + ' — ' + note : cat.label,
        unavailable: note ? 'true' : 'false',
        onClick: () => { if (typeof onSelect === 'function') onSelect(cat.id); }
      };
    });
  }

  // ── Version policy and one-time migration ────────────────────────────────────────────────
  const MIGRATION_MARKER = 'dex_studio_nav_migrated';
  const LEGACY_VERSION_KEY = 'dex_legacy_version';

  function isDeveloperMode(storage, location) {
    try { if (storage && storage.getItem('dex_developer') === '1') return true; } catch (_) {}
    try { if (location && /[?&]dev=1(?:&|$)/.test(String(location.search || ''))) return true; } catch (_) {}
    return false;
  }

  // Normal users always land in Studio. Developer shells stay reachable on purpose for debugging but
  // never appear as a first-run choice.
  function resolveInitialVersion(storedVersion, { developerMode = false } = {}) {
    if (developerMode) {
      const v = Number(storedVersion);
      if (v === 1 || v === 2 || v === 3 || v === 4) return v;
    }
    return STUDIO_VERSION;
  }

  // Idempotent. Preserves every saved draft; it only records which shell the profile came from and
  // points the product preference at Studio. Run once per profile.
  function migratePreferences(storage, { now = Date.now() } = {}) {
    if (!storage) return { migrated: false, reason: 'no-storage' };
    let marker = null;
    try { marker = storage.getItem(MIGRATION_MARKER); } catch (_) { return { migrated: false, reason: 'storage-unavailable' }; }
    if (marker) return { migrated: false, reason: 'already-migrated' };

    let previous = null;
    try {
      const raw = storage.getItem('dex_version');
      const v = Number(raw);
      previous = (raw !== null && (v === 1 || v === 2 || v === 3 || v === 4)) ? v : null;
    } catch (_) {}

    try {
      if (previous !== null) storage.setItem(LEGACY_VERSION_KEY, String(previous));
      storage.setItem('dex_version', String(STUDIO_VERSION));
      storage.setItem(MIGRATION_MARKER, JSON.stringify({ at: now, previousVersion: previous, studioVersion: STUDIO_VERSION }));
    } catch (_) {
      return { migrated: false, reason: 'storage-write-failed', previousVersion: previous };
    }
    return { migrated: true, previousVersion: previous, studioVersion: STUDIO_VERSION };
  }

  // Initial Studio screen: Create for everyone, unless a valid Studio screen is already remembered.
  function resolveInitialScreen(storedScreen) {
    return typeof storedScreen === 'string' && isCategory(storedScreen) ? storedScreen : 'create';
  }

  return {
    STUDIO_VERSION,
    CATEGORIES,
    GROUPS,
    IDS,
    UNAVAILABLE_EXECUTION,
    DEFAULT_TINT,
    MIGRATION_MARKER,
    LEGACY_VERSION_KEY,
    isCategory,
    chips,
    resolveInitialVersion,
    resolveInitialScreen,
    migratePreferences,
    isDeveloperMode
  };
});
