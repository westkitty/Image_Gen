'use strict';
const fs = require('node:fs');
const path = require('node:path');
function enabled(env = process.env, { legacyPath = path.join(__dirname, '../sdcpp-workflow/state/local-engine-bridge.json') } = {}) {
  // The Big Mac runner chooses this flag before starting Node. An explicit
  // decision must not depend on the readability of the selected data volume.
  if (env.DEX_LOCAL_ENGINE_BRIDGE !== undefined) return env.DEX_LOCAL_ENGINE_BRIDGE === '1';
  if (env.DEX_DATA_ROOT || env.DEX_STATE_DIR) return false;
  try { return JSON.parse(fs.readFileSync(legacyPath, 'utf8')).enabled === true; }
  catch (_) { return false; }
}
function controlledScript(spec) {
  return enabled() ? '../operator-console/bin/local-engine-generate.js' : require('./controlled-args').controlledScriptFor(spec);
}
module.exports = { enabled, controlledScript };
