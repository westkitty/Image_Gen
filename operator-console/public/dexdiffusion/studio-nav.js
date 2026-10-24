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

  // ── Hierarchical navigation (Unified Studio, Phase 0 contract B) ─────────────────────────
  // Additive: five masters in fixed order, global utilities outside them, and 'chat' as a new leaf.
  // Leaf ids stay the only persisted navigation identity; the active master is always derived.
  // 'chat' is never a CATEGORY, an IDS entry or a chip, so the flat 14-chip row is unchanged.
  const MASTERS = Object.freeze([
    Object.freeze({ id: 'chat', label: 'Chat', leaves: Object.freeze(['chat']) }),
    Object.freeze({ id: 'image', label: 'Image', leaves: Object.freeze(['create', 'batch', 'swap', 'edit', 'enhance']) }),
    Object.freeze({ id: 'audio', label: 'Audio', leaves: Object.freeze(['voice', 'drama', 'music']) }),
    Object.freeze({ id: 'video', label: 'Video', leaves: Object.freeze(['video']) }),
    Object.freeze({ id: '3d', label: '3D', leaves: Object.freeze(['world', '3d']) })
  ]);
  // 'jobs' is the Job Center drawer, not a screen: it has no leaf id.
  const UTILITIES = Object.freeze([
    Object.freeze({ id: 'library', label: 'Library', leaf: 'library' }),
    Object.freeze({ id: 'models', label: 'Models', leaf: 'models' }),
    Object.freeze({ id: 'jobs', label: 'Jobs', leaf: null, drawer: true }),
    Object.freeze({ id: 'system', label: 'System', leaf: 'system' })
  ]);
  const CHAT_LEAF = Object.freeze({ id: 'chat', label: 'Chat', group: 'chat' });
  // The 14 legacy leaves in their canonical order, plus chat: 15 screens.
  const SCREENS = Object.freeze(IDS.concat(['chat']));
  // Product-level destinations reuse legacy screen IDs; a subroute may select an existing inner tab.
  const SUBROUTES = Object.freeze({
    chat: Object.freeze([{ id: 'conversation', label: 'Conversation', leaf: 'chat' }, { id: 'history', label: 'History', leaf: 'chat' }]),
    image: Object.freeze([{ id: 'create', label: 'Create', leaf: 'create' }, { id: 'batch', label: 'Batch', leaf: 'batch' }, { id: 'edit', label: 'Edit · Img2Img / Inpaint / Outpaint', leaf: 'edit' }, { id: 'enhance', label: 'Enhance', leaf: 'enhance' }, { id: 'swap', label: 'Swap', leaf: 'swap' }]),
    audio: Object.freeze([{ id: 'clips', label: 'Clips', leaf: 'voice', tab: 'quick' }, { id: 'script', label: 'Script', leaf: 'drama' }, { id: 'long-form', label: 'Long Form', leaf: 'voice', tab: 'profiles' }, { id: 'music', label: 'Music', leaf: 'music' }, { id: 'voices', label: 'Voices', leaf: 'voice', tab: 'designer' }]),
    video: Object.freeze([{ id: 'readiness', label: 'Readiness', leaf: 'video' }]),
    '3d': Object.freeze([{ id: 'assets', label: 'Assets', leaf: '3d' }, { id: 'worlds', label: 'Worlds', leaf: 'world' }]),
  });
  for (const routes of Object.values(SUBROUTES)) { for (const route of routes) Object.freeze(route); Object.freeze(routes); }
  const LAYOUT_KEY = 'dex_studio_layout';
  const MASTER_LAST_KEY = 'dex_master_last';
  const SUBROUTE_KEY = 'dex_studio_subroute';
  const LAYOUTS = Object.freeze(['flat', 'masters']);

  function isScreen(id) { return SCREENS.indexOf(id) > -1; }
  function resolveSubroute(id, leaf) {
    if (typeof id !== 'string' || !isScreen(leaf)) return null;
    for (const routes of Object.values(SUBROUTES)) {
      const route = routes.find(r => r.id === id && r.leaf === leaf);
      if (route) return route.id;
    }
    return null;
  }
  function masterOf(id) {
    for (const m of MASTERS) if (m.leaves.indexOf(id) > -1) return m.id;
    return null;
  }
  function utilityOf(id) {
    for (const u of UTILITIES) if (u.leaf && u.leaf === id) return u.id;
    return null;
  }
  function leafLabel(id) {
    if (id === 'chat') return CHAT_LEAF.label;
    const c = CATEGORIES.find(x => x.id === id);
    return c ? c.label : id;
  }
  // Like resolveInitialScreen, but 'chat' is also a valid remembered screen.
  function resolveInitialScreenV2(storedScreen) {
    return typeof storedScreen === 'string' && isScreen(storedScreen) ? storedScreen : 'create';
  }
  // Layout flag for rollback: anything but exactly 'masters' is the flat chip row (the default).
  function resolveLayout(storage) {
    try { return storage && storage.getItem(LAYOUT_KEY) === 'masters' ? 'masters' : 'flat'; } catch (_) { return 'flat'; }
  }
  function readMasterLast(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(MASTER_LAST_KEY) : null; } catch (_) { return {}; }
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = null; }
    const out = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const m of MASTERS) if (typeof parsed[m.id] === 'string' && m.leaves.indexOf(parsed[m.id]) > -1) out[m.id] = parsed[m.id];
    }
    return out;
  }
  // Remembered leaf for a master, only if it is still one of that master's leaves; else its first leaf.
  function lastLeafFor(masterId, storage) {
    const m = MASTERS.find(x => x.id === masterId);
    if (!m) return null;
    return readMasterLast(storage)[m.id] || m.leaves[0];
  }
  // Records the leaf as its master's last leaf. Returns the cleaned map; a non-master leaf changes nothing.
  function rememberLeaf(leaf, storage) {
    const master = masterOf(leaf);
    const map = readMasterLast(storage);
    if (!master) return map;
    map[master] = leaf;
    try { if (storage) storage.setItem(MASTER_LAST_KEY, JSON.stringify(map)); } catch (_) {}
    return map;
  }

  // Master bar items: tab semantics (aria-selected), roving tabIndex on the active master (or the first
  // when a utility is open). Same caching rule as chips(): rebuild only when the active screen changes.
  function masters({ activeScreen = 'create', onSelect = null } = {}) {
    const activeMaster = masterOf(activeScreen);
    const focusId = activeMaster || MASTERS[0].id;
    return MASTERS.map(m => {
      const active = m.id === activeMaster;
      const note = m.leaves.every(l => UNAVAILABLE_EXECUTION[l]) ? UNAVAILABLE_EXECUTION[m.leaves[0]] : null;
      return {
        id: m.id, label: m.label,
        active: String(active),
        ariaSelected: active ? 'true' : 'false',
        tabIndex: m.id === focusId ? '0' : '-1',
        title: note ? m.label + ' — ' + note : m.label,
        unavailable: note ? 'true' : 'false',
        onClick: () => { if (typeof onSelect === 'function') onSelect(m.id); }
      };
    });
  }
  // Sub-navigation for one master: navigation semantics (aria-current="page" on the open leaf).
  function subnav(masterId, activeLeaf, { onSelect = null, unavailable = UNAVAILABLE_EXECUTION } = {}) {
    const m = MASTERS.find(x => x.id === masterId);
    if (!m) return [];
    const focusLeaf = m.leaves.indexOf(activeLeaf) > -1 ? activeLeaf : m.leaves[0];
    return m.leaves.map(id => {
      const active = id === activeLeaf;
      const note = unavailable && unavailable[id];
      const label = leafLabel(id);
      return {
        id, label, master: m.id,
        active: String(active),
        ariaCurrent: active ? 'page' : 'false',
        tabIndex: id === focusLeaf ? '0' : '-1',
        title: note ? label + ' — ' + note : label,
        unavailable: note ? 'true' : 'false',
        onClick: () => { if (typeof onSelect === 'function') onSelect(id); }
      };
    });
  }
  function subroutes(masterId, activeLeaf, activeRoute = null, { onSelect = null } = {}) {
    const routes = SUBROUTES[masterId] || [];
    const selected = routes.find(r => r.id === activeRoute && r.leaf === activeLeaf) || routes.find(r => r.leaf === activeLeaf) || routes[0];
    return routes.map(r => ({ id: r.id, leaf: r.leaf, label: r.label, active: String(r === selected),
      ariaCurrent: r === selected ? 'page' : 'false', tabIndex: r === selected ? '0' : '-1',
      unavailable: UNAVAILABLE_EXECUTION[r.leaf] ? 'true' : 'false',
      title: UNAVAILABLE_EXECUTION[r.leaf] ? r.label + ' — ' + UNAVAILABLE_EXECUTION[r.leaf] : r.label,
      onClick: () => { if (typeof onSelect === 'function') onSelect(r.id); } }));
  }
  function utilities({ activeScreen = 'create', onSelect = null } = {}) {
    return UTILITIES.map(u => {
      const active = !!u.leaf && u.leaf === activeScreen;
      return {
        id: u.id, label: u.label, drawer: u.drawer ? 'true' : 'false',
        active: String(active),
        ariaCurrent: active ? 'page' : 'false',
        title: u.drawer ? 'Open the Job Center' : u.label,
        onClick: () => { if (typeof onSelect === 'function') onSelect(u.id); }
      };
    });
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
    isDeveloperMode,
    // Hierarchical navigation (additive)
    MASTERS,
    UTILITIES,
    SCREENS,
    SUBROUTES,
    LAYOUTS,
    LAYOUT_KEY,
    MASTER_LAST_KEY,
    SUBROUTE_KEY,
    masterOf,
    utilityOf,
    isScreen,
    resolveSubroute,
    leafLabel,
    subnav,
    subroutes,
    masters,
    utilities,
    resolveInitialScreenV2,
    resolveLayout,
    lastLeafFor,
    rememberLeaf,
    readMasterLast
  };
});
