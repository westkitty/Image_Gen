'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createPublicationOutbox(root) {
  const dir = path.resolve(root);
  function syncDir() { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  function file(id) { if (typeof id !== 'string' || !/^[^/\\\0-\x1f]{1,255}$/.test(id)) throw new Error('invalid artifact id'); return path.join(dir, crypto.createHash('sha256').update(id).digest('hex') + '.json'); }
  function atomicWrite(target, value) {
    const tmp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    let fd;
    try { fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, target); syncDir(); }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} }
  }
  function read(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  function hashFile(target) {
    const hash = crypto.createHash('sha256'), fd = fs.openSync(target, 'r'), buffer = Buffer.alloc(1024 * 1024);
    try { let size = 0, count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { size += count; hash.update(buffer.subarray(0, count)); } return { size, sha256: hash.digest('hex') }; }
    finally { fs.closeSync(fd); }
  }
  function create(entry, artifactPath) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(artifactPath);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('artifact is not a regular file');
    const actual = hashFile(artifactPath), sha256 = actual.sha256;
    if (actual.size !== entry.bytes || sha256 !== entry.sha256) throw new Error('published artifact changed before outbox record');
    const record = { schema: 'dexdiffusion.publication_outbox.v1', image_id: entry.image_id, run_id: entry.run_id,
      run_file: entry.run_file, expected_bytes: actual.size, sha256, dev: st.dev, ino: st.ino,
      state: 'PUBLICATION_PENDING', attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const existing = read(entry.image_id);
    if (existing) { if (existing.sha256 !== sha256 || existing.ino !== st.ino) throw new Error('publication outbox identity collision'); return existing; }
    atomicWrite(file(entry.image_id), record); return record;
  }
  function all() {
    let names = []; try { names = fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.json$/.test(n)); } catch (_) { return []; }
    return names.map(n => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } }).filter(Boolean).sort((a,b) => a.created_at.localeCompare(b.created_at));
  }
  function update(id, patch) { const old = read(id); if (!old) return null; const next = { ...old, ...patch, updated_at: new Date().toISOString() }; atomicWrite(file(id), next); return next; }
  return { create, read, all, update, artifactPath: (imageRoot, id) => path.join(path.resolve(imageRoot), path.basename(id)) };
}

module.exports = { createPublicationOutbox };
