'use strict';

const crypto = require('node:crypto');

const OWNER = /^[a-zA-Z0-9_-]{1,64}$/;

function createHistoryAuthenticator(accounts = {}) {
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) throw new Error('invalid-chat-history-accounts');
  const entries = Object.entries(accounts).map(([owner, digest]) => {
    if (!OWNER.test(owner) || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid-chat-history-account');
    return { owner, digest: Buffer.from(digest, 'hex') };
  });
  if (new Set(entries.map(e => e.digest.toString('hex'))).size !== entries.length) throw new Error('duplicate-chat-history-credential');
  function identify(header) {
    const match = typeof header === 'string' && /^Bearer ([\x21-\x7e]{32,512})$/.exec(header);
    if (!match) return null;
    const digest = crypto.createHash('sha256').update(match[1]).digest();
    let owner = null;
    for (const entry of entries) if (crypto.timingSafeEqual(digest, entry.digest)) owner = entry.owner;
    return owner;
  }
  return { configured: entries.length > 0, identify };
}

function accountsFromEnvironment(raw) {
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new Error('invalid-chat-history-accounts'); }
  return parsed;
}

module.exports = { createHistoryAuthenticator, accountsFromEnvironment };
