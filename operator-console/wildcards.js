'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WILDCARDS_DIR = path.join(__dirname, 'wildcards');
const PROVENANCE_FILE = path.join(DEFAULT_WILDCARDS_DIR, 'HE_MAKER_PROVENANCE.json');
const BANK_NAME = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_ITEMS = 20000;
const MAX_ITEM_CHARS = 4000;

const REMOVED_FILE = '.removed.json';

function readRemoved(userDir) {
  if (!userDir) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(path.join(userDir, REMOVED_FILE), 'utf8')).map(n => String(n).toLowerCase())); } catch (_) { return new Set(); }
}

/**
 * Builds a case-insensitive map of wildcard names to their files. Banks shipped with the app are read-only; a bank
 * edited in Studio lives in userDir and wins, and a removed shipped bank is listed in userDir's removal record.
 */
function buildWildcardIndex(wildcardsDir = DEFAULT_WILDCARDS_DIR, userDir = null) {
  const index = new Map();
  const removed = readRemoved(userDir);
  const addDir = (dir, isUser) => {
    if (!dir || !fs.existsSync(dir)) return;
    try {
      for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.txt') && !n.startsWith('.'))) {
        const baseName = f.replace(/\.txt$/i, '');
        if (!isUser && removed.has(baseName.toLowerCase())) continue;
        index.set(baseName.toLowerCase(), { originalName: baseName, fileName: f, filePath: path.join(dir, f), user: isUser });
      }
    } catch (_) {}
  };
  addDir(wildcardsDir, false);
  addDir(userDir, true);
  return index;
}

const entryLines = text => text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
// A bank describes itself in its leading comment lines: "# description: ..." and "# tags: a, b", or one plain comment.
function bankHeader(text) {
  const header = { description: '', tags: [] };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith('#')) break;
    const body = line.replace(/^#+\s*/, '');
    const m = /^(description|tags)\s*:\s*(.*)$/i.exec(body);
    if (m && m[1].toLowerCase() === 'tags') header.tags = m[2].split(',').map(t => t.trim()).filter(Boolean);
    else if (m) header.description = m[2].trim();
    else if (!header.description) header.description = body;
  }
  return header;
}

/**
 * Read and cache provenance information for vendored banks.
 */
function getProvenance() {
  if (fs.existsSync(PROVENANCE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROVENANCE_FILE, 'utf8'));
    } catch (_) {}
  }
  return null;
}

/**
 * Returns the full catalog of wildcards with metadata.
 */
function getWildcardCatalog(wildcardsDir = DEFAULT_WILDCARDS_DIR, userDir = null) {
  const provenance = getProvenance();
  const provBanks = (provenance && provenance.banks) ? provenance.banks : {};
  const banks = [];
  for (const entry of buildWildcardIndex(wildcardsDir, userDir).values()) {
    let text = '';
    try { text = fs.readFileSync(entry.filePath, 'utf8'); } catch (_) {}
    const lines = entryLines(text);
    const prov = entry.user ? null : (provBanks[entry.fileName] || null);
    banks.push({
      name: entry.originalName,
      count: lines.length,
      preview: lines.slice(0, 3),
      ...bankHeader(text),
      source: entry.user ? 'user' : prov ? 'he-maker' : 'dexdiffusion',
      provenance: prov ? {
        source_repo: provenance.source_repository || provenance.source_repo,
        source_commit: provenance.source_commit,
        sha256: prov.sha256
      } : null
    });
  }
  return banks.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Expands wildcard tokens `__name__` recursively up to maxDepth.
 * Uses case-insensitive matching for robust resolution across platforms.
 */
function expandWildcards(prompt, options = {}) {
  if (typeof prompt !== 'string') return prompt;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 6;
  const wildcardsDir = options.wildcardsDir || DEFAULT_WILDCARDS_DIR;
  const index = buildWildcardIndex(wildcardsDir, options.userDir || null);

  const pattern = /__([a-zA-Z0-9_-]+)__/g;
  let result = prompt;

  // Cache lines per file path to avoid repeated disk reads
  const fileLinesCache = new Map();

  for (let depth = 0; depth < maxDepth; depth++) {
    const before = result;
    result = result.replace(pattern, (match, rawName) => {
      const key = rawName.trim().toLowerCase();
      const entry = index.get(key);
      if (!entry) return match; // unknown token, preserve literally

      let lines = fileLinesCache.get(entry.filePath);
      if (!lines) {
        try {
          lines = fs.readFileSync(entry.filePath, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
          fileLinesCache.set(entry.filePath, lines);
        } catch (_) {
          lines = [];
        }
      }

      if (!lines || lines.length === 0) return match;
      const pick = lines[Math.floor(Math.random() * lines.length)];
      return pick;
    });

    if (result === before) break;
  }

  return result;
}

/**
 * Extracts wildcard tokens from prompt without expanding them.
 */
function extractWildcardTokens(prompt) {
  if (typeof prompt !== 'string') return [];
  const pattern = /__([a-zA-Z0-9_-]+)__/g;
  const tokens = [];
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    tokens.push(match[1].trim());
  }
  return [...new Set(tokens)];
}

/**
 * One bank's items (comment and blank lines dropped), resolved case-insensitively through the index so no client
 * text ever becomes a path. Returns null for an unknown bank. `limit` caps the list for the UI.
 */
function getWildcardItems(name, wildcardsDir = DEFAULT_WILDCARDS_DIR, limit = 2000, userDir = null) {
  if (typeof name !== 'string' || !BANK_NAME.test(name)) return null;
  const entry = buildWildcardIndex(wildcardsDir, userDir).get(name.toLowerCase());
  if (!entry) return null;
  let text = '';
  try { text = fs.readFileSync(entry.filePath, 'utf8'); } catch (_) {}
  const lines = entryLines(text);
  return { name: entry.originalName, count: lines.length, items: lines.slice(0, limit), truncated: lines.length > limit, ...bankHeader(text), source: entry.user ? 'user' : 'shipped' };
}

function bankError(name, items) {
  if (typeof name !== 'string' || !BANK_NAME.test(name)) return 'Bank names use letters, numbers, _ and - (up to 120).';
  if (!Array.isArray(items) || !items.every(i => typeof i === 'string')) return 'items must be a list of text entries.';
  if (items.length > MAX_ITEMS) return `A bank holds at most ${MAX_ITEMS} entries.`;
  if (items.some(i => i.length > MAX_ITEM_CHARS)) return `An entry is longer than ${MAX_ITEM_CHARS} characters.`;
  return null;
}
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
// The previous version of a Studio-edited bank is kept, never overwritten or deleted.
function keepHistory(userDir, entry) {
  if (!entry || !entry.user) return;
  const history = path.join(userDir, '.history');
  fs.mkdirSync(history, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(entry.filePath, path.join(history, `${entry.originalName}-${stamp}.txt`));
}
function writeRemoved(userDir, set) { writeAtomic(path.join(userDir, REMOVED_FILE), JSON.stringify([...set].sort(), null, 2)); }

/** Writes a bank into userDir. Shipped files are never touched. -> { name, count } */
function saveBank(userDir, wildcardsDir, name, items, { description = '', tags = [] } = {}) {
  const seen = new Set();
  const clean = items.map(i => String(i).trim()).filter(i => {
    const key = i.toLowerCase();
    if (!i || i.startsWith('#') || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const problem = bankError(name, clean);
  if (problem) { const err = new Error(problem); err.status = 400; throw err; }
  fs.mkdirSync(userDir, { recursive: true });
  const entry = buildWildcardIndex(wildcardsDir, userDir).get(name.toLowerCase());
  const finalName = entry ? entry.originalName : name;
  const oneLine = v => String(v || '').replace(/\s+/g, ' ').trim();
  const header = [];
  if (oneLine(description)) header.push('# description: ' + oneLine(description));
  const tagList = (Array.isArray(tags) ? tags : []).map(oneLine).filter(Boolean);
  if (tagList.length) header.push('# tags: ' + tagList.join(', '));
  keepHistory(userDir, entry);
  writeAtomic(path.join(userDir, finalName + '.txt'), header.concat(clean).join('\n') + '\n');
  const removed = readRemoved(userDir);
  if (removed.delete(finalName.toLowerCase())) writeRemoved(userDir, removed);
  return { name: finalName, count: clean.length };
}

/** Removes a bank from Studio. An edited copy goes to history; a shipped bank is hidden, and its file stays. -> bool */
function removeBank(userDir, wildcardsDir, name) {
  if (typeof name !== 'string' || !BANK_NAME.test(name)) return false;
  let entry = buildWildcardIndex(wildcardsDir, userDir).get(name.toLowerCase());
  if (!entry) return false;
  fs.mkdirSync(userDir, { recursive: true });
  keepHistory(userDir, entry);
  // Removing an edited copy of a shipped bank must not bring the shipped one back.
  const removed = readRemoved(userDir);
  if (buildWildcardIndex(wildcardsDir, null).has(name.toLowerCase())) { removed.add(name.toLowerCase()); writeRemoved(userDir, removed); }
  return true;
}

module.exports = {
  buildWildcardIndex,
  getWildcardItems,
  getWildcardCatalog,
  saveBank,
  removeBank,
  expandWildcards,
  extractWildcardTokens,
  DEFAULT_WILDCARDS_DIR
};
