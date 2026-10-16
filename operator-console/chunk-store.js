'use strict';

// Durable, checksum-validated receipts for synthesised speech chunks.
//
// A receipt says: "this exact chunk (by fingerprint) was rendered, here is its audio, here is its checksum". It carries
// ordinals, engine/profile provenance, duration and a controlled reference to the WAV, and NEVER the spoken text.
// The WAV lives in a controlled MacBook directory (not the canonical media root): chunk audio is an internal build
// artifact; only assembled line takes and masters are published. Big Mac keeps nothing (ephemeral-output policy).
//
// Persistence follows the privacy rule for the project: receipts are written to disk only when the owning project is
// saved (persist(projectId) === true). Unsaved projects keep receipts in memory; their screenplay cannot survive a
// restart anyway, and Save flushes them.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./voice-audio');

const VERSION = 'dxck1';
const PID = /^dp-[a-f0-9]{8}$/, FP = /^[a-f0-9]{64}$/;
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { let o = 0; while (o < data.length) o += fs.writeSync(fd, data, o, data.length - o); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function createChunkStore({ root, persist = () => false, now = () => Date.now() }) {
  const base = path.resolve(root);
  fs.mkdirSync(path.join(base, 'chunks'), { recursive: true, mode: 0o700 });
  const ledgers = new Map(), invalid = new Map();
  const check = (project, fp) => { if (!PID.test(String(project)) || !FP.test(String(fp))) throw Object.assign(new Error('invalid chunk reference'), { status: 400 }); };
  const dirOf = project => path.join(base, 'chunks', project);
  const pathOf = (project, fp) => { check(project, fp); return path.join(dirOf(project), fp + '.wav'); };
  const ledgerFile = project => path.join(base, project + '.receipts.json');

  function ledger(project) {
    if (ledgers.has(project)) return ledgers.get(project);
    let d = null;
    if (persist(project)) { try { d = JSON.parse(fs.readFileSync(ledgerFile(project), 'utf8')); } catch (_) {} }
    const m = new Map(Object.entries((d && d.receipts) || {}));
    ledgers.set(project, m); return m;
  }
  function flush(project) {
    if (!persist(project) || !ledgers.has(project)) return false;
    const obj = { schema: 'dexdiffusion.chunk_receipts.v1', project_id: project, receipts: Object.fromEntries(ledgers.get(project)) };
    atomicWrite(ledgerFile(project), Buffer.from(JSON.stringify(obj, null, 1) + '\n')); return true;
  }

  // Copy a freshly delivered, already transfer-verified WAV into the controlled store and write its receipt.
  function put(project, fp, srcFile, meta = {}) {
    check(project, fp);
    const buf = fs.readFileSync(srcFile);
    let audio; try { audio = A.parseWav(buf); } catch (e) { throw new Error('chunk audio is not a decodable WAV: ' + e.message); }
    const stats = A.analyze(audio);
    if (!(stats.duration > 0.05)) throw new Error('chunk audio is too short to be speech');
    if (!(stats.peak > 0.002)) throw new Error('chunk audio is silent');
    atomicWrite(pathOf(project, fp), buf);
    const receipt = {
      schema: VERSION, fingerprint: fp, status: 'complete', project_id: project, line_id: meta.line_id || null, ordinal: meta.ordinal ?? null, total: meta.total ?? null, boundary: meta.boundary || null, gap_ms: meta.gap_ms ?? 0,
      inputs_sha: meta.inputs_sha || null, engine: meta.engine || null, engine_revision: meta.engine_revision || null, profile_id: meta.profile_id || null, profile_fp: meta.profile_fp || null, seed: meta.seed ?? null,
      duration: +stats.duration.toFixed(3), sample_rate: audio.sampleRate, channels: audio.channels.length, sha256: sha256(buf), bytes: buf.length, ref: `chunks/${project}/${fp}.wav`, created_at: now(),
    };
    ledger(project).set(fp, receipt); invalid.delete(project + fp); flush(project);
    return receipt;
  }
  // A receipt is only returned if its audio still matches it byte for byte.
  function get(project, fp) {
    check(project, fp);
    const r = ledger(project).get(fp); if (!r) return null;
    const file = pathOf(project, fp);
    let st; try { st = fs.statSync(file); } catch (_) { invalid.set(project + fp, { reason: 'file-missing' }); return null; }
    if (st.size !== r.bytes) { invalid.set(project + fp, { reason: 'size-mismatch' }); return null; }
    if (sha256(fs.readFileSync(file)) !== r.sha256) { invalid.set(project + fp, { reason: 'checksum-mismatch' }); return null; }
    return r;
  }
  function remove(project, fp) { check(project, fp); ledger(project).delete(fp); try { fs.unlinkSync(pathOf(project, fp)); } catch (_) {} flush(project); }
  function removeProject(project) { if (!PID.test(project)) return; ledgers.delete(project); try { fs.rmSync(dirOf(project), { recursive: true, force: true }); } catch (_) {} try { fs.unlinkSync(ledgerFile(project)); } catch (_) {} }

  // Remove chunk directories of projects the app no longer knows (unsaved projects that died with a restart).
  function sweepOrphans({ knownProjects = [], maxAgeMs = 7 * 24 * 3600 * 1000 } = {}) {
    const known = new Set(knownProjects); let removed = 0;
    let dirs = []; try { dirs = fs.readdirSync(path.join(base, 'chunks')).filter(d => PID.test(d)); } catch (_) {}
    for (const d of dirs) {
      if (known.has(d)) continue;
      const m = ledgers.get(d); let newest = 0;
      if (m && m.size) for (const r of m.values()) newest = Math.max(newest, r.created_at || 0);
      const age = m && m.size ? now() - newest : Date.now() - (fs.statSync(dirOf(d)).mtimeMs || 0);
      if (age >= maxAgeMs) { removeProject(d); removed++; }
    }
    return { removed };
  }
  return { put, get, remove, removeProject, flush, sweepOrphans, pathOf, lastInvalid: (p, fp) => invalid.get(p + fp) || null, receipts: p => [...ledger(p).values()], VERSION, root: base };
}

module.exports = { createChunkStore, VERSION };
