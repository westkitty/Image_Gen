'use strict';

// Header-verified model facts (P11): runs bin/safetensors-inspect.py on the machine that holds the file (Big Mac over
// ssh) and caches the result by path + size. Reads the safetensors header only — never the tensor data.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { FAMILIES, inferAssetFamily } = require('./extra-networks');

const SCRIPT = path.join(__dirname, '..', 'sdcpp-workflow', 'bin', 'safetensors-inspect.py');
// Only files the discovery script itself lists may be opened.
const ALLOWED_ROOTS = ['/Users/bigmac/sdcpp-staging/', '/Volumes/wc2tb/ImageGen/', '/Volumes/wc2tb/dex-imagegen/'];
const MAX_PATHS = 25;

function pathAllowed(p) {
  return typeof p === 'string' && ALLOWED_ROOTS.some(r => p.startsWith(r)) && !p.includes('..') && /^[A-Za-z0-9_\-./ ]+$/.test(p);
}

// Detected architecture -> the console's asset family vocabulary.
function familyFromArch(arch) {
  return { sdxl: FAMILIES.SDXL, sdxl_refiner: FAMILIES.SDXL, sd15: FAMILIES.SD15, sd1x: FAMILIES.SD15, flux: FAMILIES.FLUX1 }[arch] || FAMILIES.UNKNOWN;
}

// Does a filename-based family agree with the header? Pony / Turbo / Lightning are SDXL architectures.
function agreement(filename, arch) {
  const byName = inferAssetFamily(filename), byHeader = familyFromArch(arch);
  if (byHeader === FAMILIES.UNKNOWN) return { state: 'unknown', byName, byHeader };
  const sdxlish = new Set([FAMILIES.SDXL, FAMILIES.PONY, FAMILIES.SDXL_TURBO]);
  const fluxish = new Set([FAMILIES.FLUX1, FAMILIES.FLUX2]);
  const same = byName === byHeader || (sdxlish.has(byName) && sdxlish.has(byHeader)) || (fluxish.has(byName) && fluxish.has(byHeader));
  if (byName === FAMILIES.UNKNOWN) return { state: 'header-only', byName, byHeader };
  return { state: same ? 'match' : 'mismatch', byName, byHeader };
}

function createModelInspector({ cacheFile, sshTarget = 'westcat', run } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).entries || {}; } catch (_) {}
  const keyOf = (p, size) => `${p}|${size || 0}`;
  const save = () => { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ schema: 'dexdiffusion.model-headers.v1', entries: cache }, null, 1) + '\n'); } catch (_) {} };

  // Default runner: pipe the script to python3 on the remote host.
  const exec = run || ((paths, timeoutMs) => new Promise((resolve, reject) => {
    const child = execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshTarget, 'python3', '-', ...paths], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      resolve(String(stdout).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean));
    });
    // ssh can exit before reading the script (unreachable host, host-key problem): an unhandled EPIPE here would crash the console.
    child.stdin.on('error', () => {});
    child.on('error', reject);
    const src = fs.createReadStream(SCRIPT);
    src.on('error', reject);
    src.pipe(child.stdin);
  }));

  function cached(p, size) { return cache[keyOf(p, size)] || null; }

  // items: [{ path, size_bytes, filename }] -> [{ ...item, header }] (header null when unreadable)
  async function inspect(items, { refresh = false, timeoutMs = 60000 } = {}) {
    const wanted = items.filter(i => pathAllowed(i.path)).slice(0, MAX_PATHS);
    const todo = wanted.filter(i => refresh || !cached(i.path, i.size_bytes));
    if (todo.length) {
      const out = await exec(todo.map(i => i.path), timeoutMs);
      for (const r of out) {
        const item = todo.find(i => i.path === r.path);
        if (!item) continue;
        if (r.error) cache[keyOf(r.path, item.size_bytes)] = { error: r.error, at: Date.now() };
        else if (r.bytes && item.size_bytes && r.bytes !== item.size_bytes) cache[keyOf(r.path, item.size_bytes)] = { error: `size on disk (${r.bytes}) differs from the catalog (${item.size_bytes}); refresh the catalog`, at: Date.now() };
        else cache[keyOf(r.path, item.size_bytes)] = { ...r, at: Date.now() };
      }
      save();
    }
    return wanted.map(i => {
      const h = cached(i.path, i.size_bytes);
      return { path: i.path, filename: i.filename, size_bytes: i.size_bytes, header: h && !h.error ? h : null, error: h && h.error || null, agreement: h && !h.error && i.filename ? agreement(i.filename, h.arch) : null };
    });
  }

  return { inspect, cached, pathAllowed };
}

module.exports = { createModelInspector, familyFromArch, agreement, pathAllowed, ALLOWED_ROOTS };
