'use strict';

// Derived-audio cache with lineage. Effects, conforming (48 kHz stereo float) and previews are DERIVED versions of a
// clean source take: they live here (never in the canonical media library, never replacing the source), each with a ledger
// entry recording the source checksum, the settings that produced it and its own checksum. They are rebuildable at any
// time from the clean take, so the cache can be cleared without losing anything.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function sha256File(file) { return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }

function createDerivedStore({ root, now = () => Date.now() }) {
  const base = path.resolve(root); fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const ledgerFile = path.join(base, 'ledger.json'), inflight = new Map();
  let ledger = null;
  const load = () => { if (ledger) return ledger; try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch (_) { ledger = null; } if (!ledger || typeof ledger.entries !== 'object') ledger = { schema: 'dexdiffusion.derived.v1', entries: {} }; return ledger; };
  const save = () => { const tmp = `${ledgerFile}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(tmp, JSON.stringify(load(), null, 1) + '\n', { mode: 0o600 }); fs.renameSync(tmp, ledgerFile); };
  const key = parts => sha(JSON.stringify(parts));
  const pathOf = (k, ext) => { if (!/^[a-f0-9]{64}$/.test(k) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('invalid derived reference'); return path.join(base, k + '.' + ext); };
  function get(k) {
    const e = load().entries[k]; if (!e) return null;
    const f = pathOf(k, e.ext); let st; try { st = fs.statSync(f); } catch (_) { return null; }
    return st.size === e.bytes ? Object.assign({}, e, { path: f }) : null;
  }
  // producer(destPath) must create the file; the entry records lineage + checksum. Concurrent callers share one build.
  async function ensure(parts, { ext, kind, lineage = {}, meta = {} }, producer) {
    const k = key(parts), hit = get(k); if (hit) return Object.assign(hit, { cached: true });
    if (inflight.has(k)) return inflight.get(k).then(e => Object.assign({}, e, { cached: true }));
    const p = (async () => {
      const dest = pathOf(k, ext), tmp = dest + '.building';
      try { fs.unlinkSync(tmp); } catch (_) {}
      let out, st;
      try { out = (await producer(tmp)) || {}; st = fs.statSync(tmp); if (!st.size) throw new Error('derived build produced an empty file'); }
      catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      fs.renameSync(tmp, dest);
      const entry = Object.assign({ key: k, ext, kind, lineage, bytes: st.size, sha256: await sha256File(dest), created_at: now() }, meta, out);
      load().entries[k] = entry; save();
      return Object.assign({}, entry, { path: dest, cached: false });
    })().finally(() => inflight.delete(k));
    inflight.set(k, p); return p;
  }
  function clear({ olderThanMs = 0 } = {}) {
    let removed = 0; const l = load();
    for (const [k, e] of Object.entries(l.entries)) if (now() - e.created_at >= olderThanMs) { try { fs.unlinkSync(pathOf(k, e.ext)); } catch (_) {} delete l.entries[k]; removed++; }
    save(); return { removed };
  }
  return { key, get, ensure, pathOf, clear, entries: () => Object.values(load().entries), root: base };
}

module.exports = { createDerivedStore, sha256File };
