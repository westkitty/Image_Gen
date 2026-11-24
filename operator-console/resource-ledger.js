'use strict';

const fs = require('node:fs');
const { atomicWriteJson } = require('./media');

function openResourceLedger(file, { schemaKey = 'version', schema, key, label }) {
  let items = [];
  let readError = null;
  function unavailable(error) {
    return Object.assign(new Error(label + ' storage unavailable', { cause: error }), {
      code: 'resource-storage-unavailable',
    });
  }

  if (file) {
    try {
      // A dangling link or unreadable ledger is an existing storage failure.
      const existing = fs.lstatSync(file, { throwIfNoEntry: false });
      if (existing) {
        if (!existing.isFile()) throw new Error('ledger is not a regular file');
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        const records = payload?.[key];
        if (payload?.[schemaKey] !== schema || !Array.isArray(records)
          || records.some(record => !record || typeof record.id !== 'string' || !record.id)
          || new Set(records.map(record => record.id)).size !== records.length) {
          throw new Error('unsupported or invalid ledger');
        }
        items = records;
      }
    } catch (error) {
      readError = unavailable(error);
      console.error(label + ' ledger requires recovery:', error.code || error.message);
    }
  }

  function assertReadable() {
    if (readError) throw readError;
  }

  function write(next, updatedAt = Date.now()) {
    assertReadable();
    if (!file) return;
    try {
      atomicWriteJson(file, { [schemaKey]: schema, updatedAt, [key]: Array.from(next) });
    } catch (error) {
      throw unavailable(error);
    }
  }

  return { items, assertReadable, write };
}

module.exports = { openResourceLedger };
