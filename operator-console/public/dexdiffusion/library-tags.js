// library-tags.js — Library tags and grouping. Tags belong to this Mac, not to the Big Mac: inside the native app they are
// kept in ~/images_made/library-tags.json through the dexLibraryTags bridge, and any other browser keeps them in its own localStorage.
// The pure helpers are exported for Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DexLibraryTags = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOCAL_KEY = 'dexdiffusion.library.tags.v1';
  const MAX_TAG = 40;

  function normalizeTag(raw) { return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_TAG); }
  const parseTagInput = raw => [...new Set(String(raw == null ? '' : raw).split(',').map(normalizeTag).filter(Boolean))];

  function cleanStore(value) {
    const images = {};
    const source = value && typeof value === 'object' && value.images && typeof value.images === 'object' ? value.images : {};
    for (const id of Object.keys(source)) {
      const tags = Array.isArray(source[id]) ? [...new Set(source[id].map(normalizeTag).filter(Boolean))] : [];
      if (tags.length) images[id] = tags.sort();
    }
    return { version: 1, images };
  }
  const tagsFor = (store, id) => (store && store.images && store.images[id]) || [];
  function withTags(store, id, tags) {
    const images = Object.assign({}, store.images);
    if (tags.length) images[id] = [...new Set(tags)].sort(); else delete images[id];
    return { version: 1, images };
  }
  const addTags = (store, id, raw) => withTags(store, id, tagsFor(store, id).concat(parseTagInput(raw)));
  const removeTag = (store, id, tag) => withTags(store, id, tagsFor(store, id).filter(t => t !== tag));
  // Every tag in use, with how many images carry it, most used first.
  function tagCounts(store) {
    const counts = new Map();
    for (const tags of Object.values((store && store.images) || {})) for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
  // Images carrying ALL the chosen tags.
  const idsWithAllTags = (store, chosen) => Object.keys((store && store.images) || {}).filter(id => chosen.every(t => store.images[id].includes(t)));

  function mergeStores(a, b) {
    let out = cleanStore(a);
    const other = cleanStore(b);
    for (const id of Object.keys(other.images)) out = withTags(out, id, tagsFor(out, id).concat(other.images[id]));
    return out;
  }

  const GROUPS = [['none', 'No grouping'], ['day', 'Date'], ['model', 'Model'], ['operation', 'Operation'], ['tag', 'Tag']];
  function dayOf(id) { const m = /^(\d{4})(\d{2})(\d{2})-/.exec(String(id)); return m ? m[1] + '-' + m[2] + '-' + m[3] : 'Undated'; }
  // -> [{ label, items }] in first-seen order, so the chosen sort still decides what comes first.
  // Under Tag an image appears once for each tag it carries.
  function groupItems(items, mode, store) {
    if (!mode || mode === 'none') return [{ label: '', items }];
    const groups = new Map();
    const put = (label, it) => { if (!groups.has(label)) groups.set(label, []); groups.get(label).push(it); };
    for (const it of items) {
      const m = it.meta || {};
      if (mode === 'tag') { const tags = tagsFor(store, it.id); if (tags.length) tags.forEach(t => put(t, it)); else put('Untagged', it); }
      else if (mode === 'day') put(dayOf(it.id), it);
      else if (mode === 'model') put(m.target || 'Unknown model', it);
      else put(m.operation || 'Unknown operation', it);
    }
    return [...groups.entries()].map(([label, list]) => ({ label, items: list }));
  }

  function nativeBridge() {
    try { return (typeof window !== 'undefined' && window.__dexNativeWrapper === true && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dexLibraryTags) || null; } catch (_) { return null; }
  }
  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (_) { return null; } }
  function clearLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch (_) {} }

  // The file is only ever rewritten after it was read successfully: a save replaces the whole store, so saving before a good
  // read would wipe tags (a damaged file stays on disk for repair, and a tag added while loading cannot replace the lot).
  let nativeFileRead = false;

  // -> { store, where: 'mac'|'browser'|'unavailable', error }. Tags a browser stored before the bridge existed move into the file on first load.
  async function load() {
    const bridge = nativeBridge();
    if (!bridge) return { store: cleanStore(readLocal()), where: 'browser', error: null };
    nativeFileRead = false;
    try {
      const text = await bridge.postMessage({ action: 'load' });
      const fromFile = text ? JSON.parse(text) : null;
      if (text && !(fromFile && typeof fromFile === 'object' && fromFile.images && typeof fromFile.images === 'object' && !Array.isArray(fromFile.images))) throw new Error('library-tags.json is not a tag store');
      const earlier = readLocal();
      const store = mergeStores(fromFile, earlier);
      nativeFileRead = true;
      if (earlier) { await bridge.postMessage({ action: 'save', text: JSON.stringify(store) }); clearLocal(); }
      return { store, where: 'mac', error: null };
    } catch (err) {
      return { store: cleanStore(readLocal()), where: nativeFileRead ? 'mac' : 'unavailable', error: String(err && err.message || err) };
    }
  }
  async function save(store) {
    const text = JSON.stringify(store);
    const bridge = nativeBridge();
    if (bridge) {
      if (!nativeFileRead) throw new Error('library-tags.json has not been read, so it was left untouched');
      await bridge.postMessage({ action: 'save', text });
      return 'mac';
    }
    localStorage.setItem(LOCAL_KEY, text);
    return 'browser';
  }

  return { normalizeTag, parseTagInput, cleanStore, tagsFor, addTags, removeTag, tagCounts, idsWithAllTags, mergeStores, GROUPS, dayOf, groupItems, load, save };
});
