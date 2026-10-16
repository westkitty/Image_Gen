'use strict';
// Output-safety helpers for browser harnesses. A harness may only write files it created itself during this process:
// it never replaces a pre-existing file (historical reports, other agents' evidence), whatever directory it is pointed at.
//   resolveOutputDir(envValue, {label})   env dir if given (created if absent), otherwise a FRESH unique directory under output/playwright/
//   createOwnedWriter(dir)                .write(name, data) → absolute path; first write per name reserves an exclusive, never-existing path
//                                         (`name` itself, else `<base>.run-<stamp>-<pid>[-n]<ext>`); later writes in this process update that same path
const fs = require('node:fs'); const path = require('node:path');
const DEFAULT_BASE = path.join(__dirname, '..', '..', '..', 'output', 'playwright');

function resolveOutputDir(envValue, { label = 'run', base = DEFAULT_BASE } = {}) {
  if (envValue) { const dir = path.resolve(envValue); fs.mkdirSync(dir, { recursive: true }); return dir; }
  fs.mkdirSync(base, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  return fs.mkdtempSync(path.join(base, `${label}-${stamp}-${process.pid}-`));
}

function reserve(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  for (let n = 0; n < 1000; n++) {
    const candidate = path.join(dir, n === 0 ? name : `${stem}.run-${stamp}-${process.pid}${n > 1 ? '-' + n : ''}${ext}`);
    try { fs.closeSync(fs.openSync(candidate, 'wx', 0o644)); return candidate; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not reserve a fresh output name for ' + name);
}

function createOwnedWriter(dir) {
  const owned = new Map();
  return {
    dir,
    pathFor(name) { if (!owned.has(name)) owned.set(name, reserve(dir, name)); return owned.get(name); },
    write(name, data) { const p = this.pathFor(name); fs.writeFileSync(p, data); return p; },
    owned: () => Object.fromEntries(owned),
  };
}

module.exports = { resolveOutputDir, createOwnedWriter, DEFAULT_BASE };
