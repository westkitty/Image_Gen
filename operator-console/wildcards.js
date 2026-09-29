'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WILDCARDS_DIR = path.join(__dirname, 'wildcards');
const PROVENANCE_FILE = path.join(DEFAULT_WILDCARDS_DIR, 'HE_MAKER_PROVENANCE.json');

/**
 * Builds a case-insensitive map of wildcard names to their file paths and contents.
 */
function buildWildcardIndex(wildcardsDir = DEFAULT_WILDCARDS_DIR) {
  const index = new Map();
  if (!fs.existsSync(wildcardsDir)) return index;

  try {
    const files = fs.readdirSync(wildcardsDir).filter(f => f.endsWith('.txt'));
    for (const f of files) {
      const baseName = f.replace(/\.txt$/i, '');
      const filePath = path.join(wildcardsDir, f);
      // Case-insensitive key
      index.set(baseName.toLowerCase(), {
        originalName: baseName,
        fileName: f,
        filePath
      });
    }
  } catch (_) {}
  return index;
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
function getWildcardCatalog(wildcardsDir = DEFAULT_WILDCARDS_DIR) {
  const provenance = getProvenance();
  const provBanks = (provenance && provenance.banks) ? provenance.banks : {};

  if (!fs.existsSync(wildcardsDir)) return [];
  try {
    const files = fs.readdirSync(wildcardsDir).filter(f => f.endsWith('.txt'));
    return files.map(f => {
      const name = f.replace(/\.txt$/i, '');
      const fullPath = path.join(wildcardsDir, f);
      let lines = [];
      try {
        lines = fs.readFileSync(fullPath, 'utf8')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
      } catch (_) {}

      const prov = provBanks[f] || null;
      return {
        name,
        count: lines.length,
        preview: lines.slice(0, 3),
        source: prov ? 'he-maker' : 'dexdiffusion',
        provenance: prov ? {
          source_repo: provenance.source_repository || provenance.source_repo,
          source_commit: provenance.source_commit,
          sha256: prov.sha256
        } : null
      };
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch (_) {
    return [];
  }
}

/**
 * Expands wildcard tokens `__name__` recursively up to maxDepth.
 * Uses case-insensitive matching for robust resolution across platforms.
 */
function expandWildcards(prompt, options = {}) {
  if (typeof prompt !== 'string') return prompt;
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 6;
  const wildcardsDir = options.wildcardsDir || DEFAULT_WILDCARDS_DIR;
  const index = buildWildcardIndex(wildcardsDir);

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

module.exports = {
  buildWildcardIndex,
  getWildcardCatalog,
  expandWildcards,
  extractWildcardTokens,
  DEFAULT_WILDCARDS_DIR
};
