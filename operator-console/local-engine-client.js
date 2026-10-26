'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OWNER_ROOT = path.join(os.homedir(), '.dexdiffusion-engine-client');
const ID = /^20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80}$/;
const LOCAL_SOCKET = path.join(os.homedir(), '.dexdiffusion-engine', 'engine.sock');
const LOCAL_WORKER = path.join(os.homedir(), '.dexdiffusion-engine', 'engine-worker.py');
const LOCAL_PYTHON = '/opt/homebrew/bin/python3';

function isLocalEngine() {
  if (process.env.DEX_LOCAL_ENGINE_DIRECT === '1') return true;
  if (process.env.DEX_LOCAL_ENGINE_DIRECT === '0') return false;
  try {
    return fs.existsSync(LOCAL_SOCKET) && fs.existsSync(LOCAL_WORKER);
  } catch (_) {
    return false;
  }
}

function ownerPath(id) {
  if (!ID.test(id)) throw new Error('Invalid engine run ID');
  return path.join(OWNER_ROOT, id + '.json');
}
function saveOwner(id, token) {
  fs.mkdirSync(OWNER_ROOT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ownerPath(id), JSON.stringify({ run_id: id, token }), { mode: 0o600, flag: 'wx' });
}
function readOwner(id) { try { return JSON.parse(fs.readFileSync(ownerPath(id))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function request(payload, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = isLocalEngine()
      ? spawn(LOCAL_PYTHON, [LOCAL_WORKER, 'client'], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'westcat',
          '/opt/homebrew/bin/python3 /Users/bigmac/.dexdiffusion-engine/engine-worker.py client'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
    const finish = (e, value) => { if (settled) return; settled = true; clearTimeout(timer); e ? reject(e) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Local engine transport timed out; owned job remains bounded on Big Mac.')); }, timeout);
    child.stdout.on('data', data => { out += data; if (out.length > 64 * 1024 * 1024) { child.kill(); finish(new Error('Engine response exceeds limit')); } });
    child.stderr.on('data', data => { err = (err + data).slice(-2000); });
    child.on('error', finish);
    child.stdin.on('error', () => {});
    child.on('close', () => {
      try { const result = JSON.parse(out); if (!result.ok) throw new Error(result.error || 'Engine rejected request'); finish(null, result); }
      catch (e) { finish(new Error('Big Mac local engine: ' + e.message + (out ? '' : ' ' + err))); }
    });
    child.stdin.end(JSON.stringify(payload) + '\n');
  });
}
async function ownedRequest(id, op) {
  const owner = readOwner(id);
  if (!owner) return null;
  return request({ ...owner, op });
}
module.exports = { request, ownedRequest, saveOwner, readOwner, ownerPath, OWNER_ROOT };
