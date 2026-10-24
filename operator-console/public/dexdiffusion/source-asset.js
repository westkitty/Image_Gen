// DexDiffusion Studio — canonical source-asset resolution and handoffs (G3).
//
// One rule: a module that accepts a source image accepts exactly ONE canonical
// DexDiffusion image id, and it never substitutes a different image when that
// id is missing, stale, staged, or malformed.
//
// Before this module, World and 3D silently fell back to the newest entry in
// the run list (`runs[0].imageFile`) whenever the source picker was empty, so a
// user who had selected image A could reconstruct a 3D asset from image B just
// because B was generated last. Enhance had the same shape through
// `_resolveSource`. That fallback is the defect this file removes; every caller
// now gets a typed result it must handle.
//
// Plain script (no build step) so the browser shell and node tests share it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DexSourceAsset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Selection kinds the shell can carry between modules (see component.js
  // setActiveAssetSelection). Only `image` can be an image source.
  const KINDS = Object.freeze(['image', 'audio', 'voice-profile', 'drama-project', 'asset3d', 'world-project']);

  // Canonical images are flat files in one directory. These are the accepted
  // extensions on the server (image-store.js IMAGE_CONTENT_TYPES).
  const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

  const MAX_ID = 255;

  const MESSAGES = Object.freeze({
    'no-source': 'Choose a source image first.',
    'not-canonical': 'That is not a canonical DexDiffusion image id, so it cannot be used as a source.',
    'staged': 'That image is a temporary upload, not a published library image. Save it to the Library first.',
    'wrong-kind': 'Choose a source image to continue (that selection is not an image).',
    'not-image': 'That file is not a supported image (PNG, JPEG or WebP).',
    'stale': 'That image is no longer in the library. Pick another one.'
  });

  function fail(code, detail) {
    return { ok: false, code, message: MESSAGES[code] || 'That source cannot be used.', detail: detail || null };
  }

  // A canonical id is a single path segment with no scheme, no traversal and no
  // whitespace. Anything that could address a different file is refused rather
  // than cleaned up, because a silently "cleaned" id is a different asset.
  function isCanonicalId(value) {
    if (typeof value !== 'string') return false;
    const id = value.trim();
    if (!id || id.length > MAX_ID) return false;
    if (id !== value) return false;                       // no leading/trailing space
    if (id.startsWith('.') || id.includes('..')) return false;
    if (/[\s/\\:?#]/.test(id)) return false;              // no separators, drive letters, URLs or queries
    return true;
  }

  function isImageId(value) {
    return isCanonicalId(value) && IMAGE_EXT.test(value.trim());
  }

  // A run file name is not necessarily a published library image (sd-cli writes
  // several files per run). It still may never address another directory or a
  // non-image file.
  function isSafeImageName(value) {
    if (typeof value !== 'string') return false;
    const id = value.trim();
    if (!id || id.length > MAX_ID || id !== value) return false;
    if (id.startsWith('.') || id.includes('..')) return false;
    if (/[\s/\\:?#]/.test(id)) return false;
    return IMAGE_EXT.test(id);
  }

  // Normalize a shell selection object into {kind,id}. Rejects instead of guessing.
  function normalizeSelection(selection) {
    if (!selection || typeof selection !== 'object') return fail('no-source');
    const kind = String(selection.kind || '');
    const id = typeof selection.id === 'string' ? selection.id.trim() : '';
    if (!KINDS.includes(kind)) return fail('wrong-kind', kind || null);
    if (kind !== 'image') return fail('wrong-kind', kind);
    if (!id) return fail('no-source');
    if (/^staged:/i.test(id)) return fail('staged', id);
    if (!isImageId(id)) return fail('not-canonical', id);
    return { ok: true, kind, id };
  }

  // A run record (localStorage `dex_runs`) carries `imageFile` as a bare
  // canonical file name. Accept it only when it really is one.
  function fromRun(run) {
    if (!run || typeof run !== 'object') return fail('no-source');
    const raw = typeof run.imageFile === 'string' ? run.imageFile.trim() : '';
    if (!raw) return fail('no-source', 'run has no image');
    if (/^staged:/i.test(raw)) return fail('staged', raw);
    if (!isImageId(raw)) return fail('not-canonical', raw);
    return { ok: true, kind: 'image', id: raw, run };
  }

  /**
   * Resolve the image a module must act on.
   *
   * @param {object} input
   * @param {string} [input.explicitId] id chosen in that module's own picker
   * @param {object} [input.selection]  the shell's cross-module selection
   * @param {boolean} [input.allowNewest] only for flows that genuinely mean "the
   *   most recent result"; World, 3D, Enhance and Edit must not set this.
   * @param {Array} [input.runs] used ONLY for allowNewest and for choice lists
   * @returns {{ok:true,id:string,source:string}|{ok:false,code:string,message:string}}
   */
  function resolveSource(input) {
    const o = input || {};
    if (o.explicitId != null && String(o.explicitId).trim() !== '') {
      const raw = String(o.explicitId).trim();
      if (/^staged:/i.test(raw)) return fail('staged', raw);
      if (!isImageId(raw)) return fail('not-canonical', raw);
      return { ok: true, id: raw, source: 'explicit' };
    }
    if (o.selection != null) {
      const sel = normalizeSelection(o.selection);
      if (!sel.ok && sel.code !== 'no-source') return sel;
      if (sel.ok) return { ok: true, id: sel.id, source: 'selection' };
    }
    if (o.allowNewest === true && Array.isArray(o.runs)) {
      let firstFailure = null;
      for (const run of o.runs) {
        const r = fromRun(run);
        if (r.ok) return { ok: true, id: r.id, source: 'newest' };
        if (!firstFailure && r.code && r.code !== 'no-source') firstFailure = r;
      }
      return firstFailure || fail('no-source', 'no canonical run');
    }
    return fail('no-source');
  }

  // Picker options: only canonical ids, de-duplicated, order preserved.
  function choices(runs) {
    const seen = new Set();
    const out = [];
    for (const run of Array.isArray(runs) ? runs : []) {
      const r = fromRun(run);
      if (!r.ok || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, label: (run && run.id ? String(run.id) : r.id), run });
    }
    return out;
  }

  /**
   * Lineage for an image record as returned by /api/images/:id/meta.
   * Preserves the canonical ids without inventing any that were not recorded.
   */
  function lineage(record, maxDepth) {
    const ids = [];
    let current = record && typeof record === 'object' ? record : null;
    let depth = 0;
    const limit = Number.isInteger(maxDepth) ? maxDepth : 64;
    const seen = new Set();
    while (current && depth < limit) {
      const raw = typeof current.id === 'string' ? current.id : (typeof current.imageId === 'string' ? current.imageId : '');
      const id = raw.trim();
      if (!isImageId(id)) break;
      if (seen.has(id)) return { ok: false, code: 'cycle', message: 'This image lineage loops; it was not followed.', ids };
      seen.add(id);
      ids.push(id);
      const parent = current.parent;
      current = parent && typeof parent === 'object' ? parent : null;
      depth += 1;
    }
    return { ok: true, ids, root: ids.length ? ids[ids.length - 1] : null, id: ids.length ? ids[0] : null };
  }

  function sameAsset(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return String(a.kind || '') === String(b.kind || '') && String(a.id || '') === String(b.id || '');
  }

  return {
    KINDS,
    MESSAGES,
    isCanonicalId,
    isImageId,
    isSafeImageName,
    normalizeSelection,
    fromRun,
    resolveSource,
    choices,
    lineage,
    sameAsset
  };
});
