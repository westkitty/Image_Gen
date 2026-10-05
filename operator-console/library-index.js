'use strict';

// F04: Library Turbo metadata index
// Rebuildable incremental index derived from authoritative artifact/run state.
// Atomic persistence, repair/rebuild path, fast querying, sorting, pagination.

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'dexdiffusion.library.v1';

function createLibraryIndex({
  indexPath,
  imageStore,
  imageMeta,
  runsDir
}) {
  let index = new Map(); // artifactId -> item
  let status = 'dormant'; // dormant, ready, rebuilding, error
  let lastRebuiltAt = null;

  function load() {
    if (!indexPath) return;
    try {
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.items)) {
          index.clear();
          for (const item of parsed.items) {
            if (item && item.id) {
              index.set(item.id, item);
            }
          }
          lastRebuiltAt = parsed.updatedAt || null;
          status = 'ready';
          return;
        }
      }
    } catch (_) {
      status = 'error';
    }
  }

  function save() {
    if (!indexPath) return;
    try {
      const dir = path.dirname(indexPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${indexPath}.tmp.${Date.now()}`;
      const payload = {
        version: SCHEMA_VERSION,
        updatedAt: Date.now(),
        count: index.size,
        items: Array.from(index.values())
      };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, indexPath);
      lastRebuiltAt = payload.updatedAt;
    } catch (err) {
      console.error('Failed to save library index:', err.message);
    }
  }

  function upsertItem(artifact) {
    if (!artifact || !artifact.id) return;
    const existing = index.get(artifact.id) || {};
    const updated = {
      id: artifact.id,
      runId: artifact.runId || existing.runId || null,
      mediaKind: artifact.mediaKind || existing.mediaKind || 'image',
      operation: artifact.operation || existing.operation || 'txt2img',
      model: artifact.model || artifact.target || existing.model || null,
      target: artifact.target || artifact.model || existing.target || null,
      dimensions: artifact.dimensions || existing.dimensions || null,
      width: artifact.width || existing.width || null,
      height: artifact.height || existing.height || null,
      createdAt: artifact.createdAt || existing.createdAt || Date.now(),
      status: artifact.status || existing.status || 'PASS',
      seed: artifact.seed != null ? artifact.seed : (existing.seed != null ? existing.seed : null),
      keeper: Boolean(artifact.keeper !== undefined ? artifact.keeper : existing.keeper),
      testArtifact: Boolean(artifact.testArtifact !== undefined ? artifact.testArtifact : (artifact.test_artifact !== undefined ? artifact.test_artifact : existing.testArtifact)),
      lineageParent: artifact.lineageParent || artifact.parent_id || existing.lineageParent || null,
      childCount: artifact.childCount != null ? artifact.childCount : (existing.childCount || 0),
      collectionIds: Array.isArray(artifact.collectionIds) ? artifact.collectionIds : (existing.collectionIds || []),
      tags: Array.isArray(artifact.tags) ? artifact.tags : (existing.tags || []),
      note: artifact.note !== undefined ? artifact.note : existing.note || null,
      promptSaved: Boolean(artifact.promptSaved !== undefined ? artifact.promptSaved : existing.promptSaved)
    };
    index.set(artifact.id, updated);
    save();
    return updated;
  }

  function removeItem(id) {
    if (index.delete(id)) {
      save();
      return true;
    }
    return false;
  }

  function rebuild({ onProgress } = {}) {
    status = 'rebuilding';
    try {
      const newIndex = new Map();
      const metaAll = imageMeta ? imageMeta.all() : {};

      // Find all resolved images from canonical store
      const canonicalIds = imageStore ? imageStore.listCanonicalImages() : [];

      for (const id of canonicalIds) {
        const meta = metaAll[id] || {};
        let width = meta.width || null;
        let height = meta.height || null;
        let dims = (width && height) ? `${width}x${height}` : null;

        const item = {
          id,
          runId: meta.runId || (id.includes('-') ? id.slice(0, 15) : null),
          mediaKind: 'image',
          operation: meta.operation || 'txt2img',
          model: meta.target || meta.model || null,
          target: meta.target || null,
          dimensions: dims,
          width,
          height,
          createdAt: meta.created_at || (id.includes('-') ? id.slice(0, 15) : Date.now()),
          status: 'PASS',
          seed: meta.seed != null ? meta.seed : null,
          keeper: Boolean(meta.keeper),
          testArtifact: Boolean(meta.test_artifact),
          lineageParent: meta.parent_id || null,
          childCount: Array.isArray(meta.children) ? meta.children.length : 0,
          collectionIds: Array.isArray(meta.collection_ids) ? meta.collection_ids : [],
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          note: meta.note || null,
          promptSaved: Boolean(meta.prompt_saved)
        };
        newIndex.set(id, item);
      }

      index = newIndex;
      status = 'ready';
      save();
      return { success: true, count: index.size };
    } catch (err) {
      status = 'error';
      return { success: false, error: err.message };
    }
  }

  function query({
    filter = 'all', // all, keepers, test, operation, collection:xyz
    collectionId = null,
    operation = null,
    model = null,
    showTest = false,
    search = '',
    sort = 'newest', // newest, oldest, seed
    offset = 0,
    limit = 50
  } = {}) {
    let items = Array.from(index.values());

    // Filter test artifacts unless asked
    if (!showTest) {
      items = items.filter(it => !it.testArtifact);
    }

    if (filter === 'keepers') {
      items = items.filter(it => it.keeper);
    } else if (filter === 'test') {
      items = items.filter(it => it.testArtifact);
    } else if (filter && filter !== 'all') {
      if (filter.startsWith('collection:')) {
        const cId = filter.slice(11);
        items = items.filter(it => it.collectionIds && it.collectionIds.includes(cId));
      } else {
        items = items.filter(it => it.operation === filter || it.target === filter);
      }
    }

    if (collectionId) {
      items = items.filter(it => it.collectionIds && it.collectionIds.includes(collectionId));
    }

    if (operation) {
      items = items.filter(it => it.operation === operation);
    }

    if (model) {
      items = items.filter(it => it.target === model || it.model === model);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(it => {
        return (it.id && it.id.toLowerCase().includes(q)) ||
               (it.target && it.target.toLowerCase().includes(q)) ||
               (it.operation && it.operation.toLowerCase().includes(q)) ||
               (it.note && it.note.toLowerCase().includes(q)) ||
               (it.tags && it.tags.some(t => t.toLowerCase().includes(q)));
      });
    }

    // Sort
    if (sort === 'oldest') {
      items.sort((a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
    } else if (sort === 'seed') {
      items.sort((a, b) => (Number(a.seed || 0)) - (Number(b.seed || 0)));
    } else {
      // Default: newest
      items.sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
    }

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);
    const nextOffset = offset + paginated.length;
    const hasMore = nextOffset < total;

    return {
      total,
      limit,
      offset,
      nextOffset,
      hasMore,
      items: paginated,
      indexStatus: status,
      lastRebuiltAt
    };
  }

  load();

  return {
    load,
    save,
    rebuild,
    upsertItem,
    removeItem,
    query,
    get: (id) => index.get(id) || null,
    count: () => index.size,
    status: () => status,
    lastRebuiltAt: () => lastRebuiltAt
  };
}

module.exports = {
  createLibraryIndex,
  SCHEMA_VERSION
};
