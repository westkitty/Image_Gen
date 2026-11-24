'use strict';

// F05: Collections / Boards store
// Persistent user-created collections referencing canonical artifact IDs.
// Versioned schema `dexdiffusion.collections.v1`, atomic persistence.
// Does NOT duplicate image bytes.

const { openResourceLedger } = require('./resource-ledger');
const crypto = require('crypto');

const SCHEMA_VERSION = 'dexdiffusion.collections.v1';

function createCollectionStore(filePath) {
  const ledger = openResourceLedger(filePath, { schema: SCHEMA_VERSION, key: 'collections', label: 'Collections' });
  let collections = new Map(ledger.items.map(item => [item.id, {
      ...item, name: item.name || 'Untitled Collection', description: item.description || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      artifactIds: Array.isArray(item.artifactIds) ? item.artifactIds : [],
      createdAt: item.createdAt || Date.now(), updatedAt: item.updatedAt || Date.now(),
    }]));

  function commit(next) {
    ledger.write(next.values());
    collections = next;
  }
  function save(record) {
    commit(new Map(collections).set(record.id, record));
    return record;
  }

  function list() {
    ledger.assertReadable();
    return Array.from(collections.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
    ledger.assertReadable();
    return collections.get(id) || null;
  }

  function create({ name, description = '', tags = [], artifactIds = [] }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Collection name is required');
    }
    const id = 'col_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36));
    const now = Date.now();
    const col = {
      id,
      name: name.trim(),
      description: String(description || '').trim(),
      tags: Array.isArray(tags) ? tags.map(String) : [],
      artifactIds: Array.isArray(artifactIds) ? [...new Set(artifactIds.map(String))] : [],
      createdAt: now,
      updatedAt: now
    };
    return save(col);
  }

  function update(id, { name, description, tags, artifactIds }) {
    const existing = get(id);
    if (!existing) return null;
    const col = { ...existing };
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Name cannot be empty');
      col.name = name.trim();
    }
    if (description !== undefined) col.description = String(description).trim();
    if (tags !== undefined && Array.isArray(tags)) col.tags = tags.map(String);
    if (artifactIds !== undefined && Array.isArray(artifactIds)) col.artifactIds = [...new Set(artifactIds.map(String))];
    col.updatedAt = Date.now();
    return save(col);
  }

  function addArtifacts(id, newIds = []) {
    const existing = get(id);
    if (!existing) return null;
    const col = { ...existing };
    const set = new Set(col.artifactIds);
    for (const aId of newIds) {
      if (aId) set.add(String(aId));
    }
    col.artifactIds = Array.from(set);
    col.updatedAt = Date.now();
    return save(col);
  }

  function removeArtifacts(id, targetIds = []) {
    const existing = get(id);
    if (!existing) return null;
    const col = { ...existing };
    const removeSet = new Set(targetIds.map(String));
    col.artifactIds = col.artifactIds.filter(aId => !removeSet.has(aId));
    col.updatedAt = Date.now();
    return save(col);
  }

  function remove(id) {
    if (!get(id)) return false;
    const next = new Map(collections);
    next.delete(id);
    commit(next);
    return true;
  }

  return {
    list,
    get,
    create,
    update,
    addArtifacts,
    removeArtifacts,
    remove,
    count: () => collections.size
  };
}

module.exports = {
  createCollectionStore,
  SCHEMA_VERSION
};
