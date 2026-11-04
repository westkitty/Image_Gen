'use strict';
// The workflow scripts were written for a MacBook driving the Big Mac over ssh. When the
// server itself runs on the Big Mac, ssh to itself is neither authorised nor able to read
// the external drive, and its default python3 has no Pillow. This keeps those scripts
// unchanged: they find ssh and scp in on-host/ first, which run target commands directly.
const fs = require('node:fs');
const path = require('node:path');

const ON_HOST_DIR = path.join(__dirname, 'bin', 'on-host');

function hostToolPaths({ hostname, sshTarget, isolated, env = process.env }) {
  if (isolated || String(hostname).toLowerCase() !== 'bigmac') return null;
  if (sshTarget !== 'westcat' && sshTarget !== 'local') return null;
  let processPath = env.PATH || '';
  const python = env.DEX_IMAGE_VALIDATION_PYTHON;
  if (python) {
    try {
      fs.accessSync(python, fs.constants.X_OK);
      processPath = path.dirname(python) + path.delimiter + processPath;
    } catch (_) {}
  }
  return {
    processPath,
    scriptEnv: { PATH: ON_HOST_DIR + path.delimiter + processPath, DEX_ON_HOST_SSH_TARGET: sshTarget },
  };
}

module.exports = { hostToolPaths, ON_HOST_DIR };
