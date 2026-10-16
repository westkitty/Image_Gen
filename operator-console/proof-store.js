'use strict';
// Durable production proofs: one JSON per production, written atomically, keyed by production id and tied to the master checksum
// inside the document. Human listening acceptance is recorded beside (never inside) the hashed proof so it can change without
// invalidating the software evidence.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ID = /^pr-[a-f0-9]{8}$/;

function createProofStore({ root, now = () => Date.now() }) {
  const dir = path.resolve(root); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = id => { if (!ID.test(String(id))) throw Object.assign(new Error('invalid production id'), { status: 400 }); return path.join(dir, id + '.json'); };
  const write = (id, obj) => { const f = file(id), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n', { mode: 0o600 }); fs.renameSync(tmp, f); };
  return {
    save(proof) { write(proof.production_id, proof); return proof; },
    get(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch (e) { if (e.status) throw e; return null; } },
    setAcceptance(id, { state, note }) {
      const p = this.get(id); if (!p) return null;
      if (!['pending', 'approved', 'rejected'].includes(state)) throw Object.assign(new Error('acceptance must be pending, approved or rejected'), { status: 400 });
      p.human_acceptance = { state, at: state === 'pending' ? null : now(), note: String(note || '').slice(0, 500) }; write(id, p); return p;
    },
    list: () => { try { return fs.readdirSync(dir).filter(f => /^pr-[a-f0-9]{8}\.json$/.test(f)).map(f => f.slice(0, -5)); } catch (_) { return []; } },
    root: dir,
  };
}
module.exports = { createProofStore };
