'use strict';
const crypto = require('node:crypto');
// Exact immediate child, never a descendant, wildcard or arbitrary path.
function validRemotePath(p) { return typeof p === 'string' && /^(?:\$HOME|\/Users\/[A-Za-z0-9._-]+)\/Library\/Caches\/DexDiffusion\/tmp\/dexmedia\.[A-Za-z0-9]+$/.test(p); }
function ownedRemoteResource(jobId, host, p) {
  if (host !== 'westcat' || !validRemotePath(p)) throw new Error('invalid exact owned remote resource');
  return { resource_id: crypto.createHash('sha256').update(jobId + '\n' + host + '\n' + p).digest('hex'), job_id: jobId, host, path: p, kind: 'remote-directory', state: 'pending', attempts: 0, receipt: null };
}
function cleanupCommand(r) {
  if (!r || r.host !== 'westcat' || !validRemotePath(r.path) || !/^[a-f0-9]{64}$/.test(r.resource_id)) throw new Error('invalid exact owned remote resource');
  const q = s => "'" + s.replace(/'/g, "'\\''") + "'";
  const assign = r.path.startsWith('$HOME/') ? 'D="$HOME"' + q(r.path.slice(5)) : 'D=' + q(r.path);
  return assign + '; case "$D" in "$HOME/Library/Caches/DexDiffusion/tmp/dexmedia."*) [ ! -L "$D" ] || { echo DEXMEDIA_CLEANUP_REFUSED; exit 0; }; rm -rf -- "$D"; if [ ! -e "$D" ] && [ ! -L "$D" ]; then echo DEXMEDIA_CLEANED=' + r.resource_id + '; else echo DEXMEDIA_STILL_THERE; fi ;; *) echo DEXMEDIA_CLEANUP_REFUSED ;; esac';
}
module.exports = { validRemotePath, ownedRemoteResource, cleanupCommand };
