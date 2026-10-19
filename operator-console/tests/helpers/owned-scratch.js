'use strict';
// Tests-only owner registry: remove only directories just created by this process.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after } = require('node:test');

const root = fs.realpathSync(os.tmpdir());
const scratchDirs = new Set();

function validateOwned(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new Error('scratch path must be absolute');
  }
  const full = path.resolve(dir);
  const parent = fs.realpathSync(path.dirname(full));
  if (parent !== root || !/^dex-[a-zA-Z0-9-]{1,80}$/.test(path.basename(full)) || !/^[a-zA-Z0-9]{6}$/.test(path.basename(full).slice(-6))) {
    throw new Error('refusing cleanup outside owned test scratch: ' + path.basename(full));
  }
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('scratch entry is not an owned directory');
  }
  return full;
}

function trackScratch(dir) {
  scratchDirs.add(validateOwned(dir));
  return dir;
}

function cleanupScratch() {
  const failures = [];
  for (const dir of scratchDirs) {
    try {
      if (fs.existsSync(dir)) {
        validateOwned(dir);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      scratchDirs.delete(dir);
    } catch (err) {
      failures.push(path.basename(dir) + ': ' + err.message);
    }
  }
  if (failures.length) throw new Error('test scratch cleanup failed: ' + failures.join('; '));
}

// Node's test lifecycle handles normal pass/fail; exit covers direct process.exit().
after(cleanupScratch);
process.once('exit', () => {
  try { cleanupScratch(); }
  catch (err) { fs.writeSync(2, '[scratch] ' + err.message + '\n'); process.exitCode = 1; }
});

module.exports = { trackScratch, cleanupScratch };
