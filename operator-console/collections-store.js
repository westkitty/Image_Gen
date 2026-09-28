'use strict';

// F05: Collections / Boards store
// Persistent user-created collections referencing canonical artifact IDs.
// Versioned schema `dexdiffusion.collections.v1`, atomic persistence.
// Does NOT duplicate image bytes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 'dexdiffusion.collections.v1';

function createCollectionStore(filePath) {
  let collections = new Map(); // id -> collection

  function load() {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.collections)) {
          collections.clear();
          for (const c of parsed.collections) {
            if (c && c.id) {
              collections.set(c.id, {
                id: c.id,
                name: c.name || 'Untitled Collection',
                description: c.description || '',
                tags: Array.isArray(c.tags) ? c.tags : [],
                artifactIds: Array.isArray(c.artifactIds) ? c.artifactIds : [],
                createdAt: c.createdAt || Date.now(),
                updatedAt: c.updatedAt || Date.now()
              });
            }
          }
        }
      }
    } catch (_) {
      collections = new Map();
    }
  }

  function save() {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp.${Date.now()}`;
      const payload = {
        version: SCHEMA_VERSION,
        updatedAt: Date.now(),
        collections: Array.from(collections.values())
      };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('Failed to save collections:', err.message);
    }
  }

  load();

  function list() {
    return Array.from(collections.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(id) {
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
    collections.set(id, col);
    save();
    return col;
  }

  function update(id, { name, description, tags, artifactIds }) {
    const col = collections.get(id);
    if (!col) return null;
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Name cannot be empty');
      col.name = name.trim();
    }
    if (description !== undefined) col.description = String(description).trim();
    if (tags !== undefined && Array.isArray(tags)) col.tags = tags.map(String);
    if (artifactIds !== undefined && Array.isArray(artifactIds)) col.artifactIds = [...new Set(artifactIds.map(String))];
    col.updatedAt = Date.now();
    save();
    return col;
  }

  function addArtifacts(id, newIds = []) {
    const col = collections.get(id);
    if (!col) return null;
    const set = new Set(col.artifactIds);
    for (const aId of newIds) {
      if (aId) set.add(String(aId));
    }
    col.artifactIds = Array.from(set);
    col.updatedAt = Date.now();
    save();
    return col;
  }

  function removeArtifacts(id, targetIds = []) {
    const col = collections.get(id);
    if (!col) return null;
    const removeSet = new Set(targetIds.map(String));
    col.artifactIds = col.artifactIds.filter(aId => !removeSet.has(aId));
    col.updatedAt = Date.now();
    save();
    return col;
  }

  function remove(id) {
    if (collections.delete(id)) {
      save();
      return true;
    }
    return false;
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
