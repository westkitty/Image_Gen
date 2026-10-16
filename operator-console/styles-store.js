'use strict';

// Prompt styles store (P04 S04.2). Versioned `dexdiffusion.styles.v1`, atomic writes, unique names.
// These are templates the user authored on purpose (like A1111's styles.csv); they are not generation records and
// never contain the text of any particular generation unless the user saves it as a style.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./public/dexdiffusion/prompt-styles.js');

const SCHEMA = 'dexdiffusion.styles.v1';

function createStylesStore(filePath) {
  let styles = [];

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && parsed.schema === SCHEMA && Array.isArray(parsed.styles)) styles = parsed.styles.filter(s => s && s.id && s.name);
    } catch (_) { styles = []; }
  }
  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: SCHEMA, updatedAt: new Date().toISOString(), styles }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }
  load();

  const clean = body => ({ name: String(body.name || '').trim(), prompt: String(body.prompt || ''), negative_prompt: String(body.negative_prompt || '') });
  const clash = (name, exceptId) => styles.some(s => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());

  return {
    list: () => styles.map(s => ({ ...s })).sort((a, b) => a.name.localeCompare(b.name)),
    get: id => { const s = styles.find(x => x.id === id); return s ? { ...s } : null; },
    create(body) {
      const err = S.validateStyle(body); if (err) throw new Error(err);
      const c = clean(body);
      if (clash(c.name)) throw new Error(`A style named "${c.name}" already exists`);
      const now = new Date().toISOString();
      const style = { id: 'sty_' + crypto.randomBytes(6).toString('hex'), ...c, createdAt: now, updatedAt: now };
      styles.push(style); save();
      return { ...style };
    },
    // Partial update: rename and/or edit templates. Returns null when the id is unknown.
    update(id, body) {
      const i = styles.findIndex(x => x.id === id); if (i < 0) return null;
      const merged = { ...styles[i], ...Object.fromEntries(['name', 'prompt', 'negative_prompt'].filter(k => body && body[k] !== undefined).map(k => [k, body[k]])) };
      const err = S.validateStyle(merged); if (err) throw new Error(err);
      const c = clean(merged);
      if (clash(c.name, id)) throw new Error(`A style named "${c.name}" already exists`);
      styles[i] = { ...styles[i], ...c, updatedAt: new Date().toISOString() }; save();
      return { ...styles[i] };
    },
    remove(id) {
      const i = styles.findIndex(x => x.id === id); if (i < 0) return false;
      styles.splice(i, 1); save(); return true;
    },
  };
}

module.exports = { createStylesStore, SCHEMA };
