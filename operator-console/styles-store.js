'use strict';

// Prompt styles store (P04 S04.2). Versioned `dexdiffusion.styles.v1`, atomic writes, unique names.
// These are templates the user authored on purpose (like A1111's styles.csv); they are not generation records and
// never contain the text of any particular generation unless the user saves it as a style.
const { openResourceLedger } = require('./resource-ledger');
const crypto = require('crypto');
const S = require('./public/dexdiffusion/prompt-styles.js');

const SCHEMA = 'dexdiffusion.styles.v1';

function createStylesStore(filePath) {
  const ledger = openResourceLedger(filePath, { schemaKey: 'schema', schema: SCHEMA, key: 'styles', label: 'Styles' });
  let styles = ledger.items;

  function commit(next) {
    ledger.write(next, new Date().toISOString());
    styles = next;
  }

  const clean = body => ({ name: String(body.name || '').trim(), prompt: String(body.prompt || ''), negative_prompt: String(body.negative_prompt || '') });
  const clash = (name, exceptId) => styles.some(s => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());

  return {
    list: () => { ledger.assertReadable(); return styles.map(s => ({ ...s })).sort((a, b) => a.name.localeCompare(b.name)); },
    get: id => { ledger.assertReadable(); const s = styles.find(x => x.id === id); return s ? { ...s } : null; },
    create(body) {
      const err = S.validateStyle(body); if (err) throw new Error(err);
      const c = clean(body);
      if (clash(c.name)) throw new Error(`A style named "${c.name}" already exists`);
      const now = new Date().toISOString();
      const style = { id: 'sty_' + crypto.randomBytes(6).toString('hex'), ...c, createdAt: now, updatedAt: now };
      commit([...styles, style]);
      return { ...style };
    },
    // Partial update: rename and/or edit templates. Returns null when the id is unknown.
    update(id, body) {
      ledger.assertReadable();
      const i = styles.findIndex(x => x.id === id); if (i < 0) return null;
      const merged = { ...styles[i], ...Object.fromEntries(['name', 'prompt', 'negative_prompt'].filter(k => body && body[k] !== undefined).map(k => [k, body[k]])) };
      const err = S.validateStyle(merged); if (err) throw new Error(err);
      const c = clean(merged);
      if (clash(c.name, id)) throw new Error(`A style named "${c.name}" already exists`);
      const next = { ...styles[i], ...c, updatedAt: new Date().toISOString() };
      commit(styles.map((style, index) => index === i ? next : style));
      return { ...next };
    },
    remove(id) {
      ledger.assertReadable();
      const i = styles.findIndex(x => x.id === id); if (i < 0) return false;
      commit(styles.filter(style => style.id !== id));
      return true;
    },
  };
}

module.exports = { createStylesStore, SCHEMA };
