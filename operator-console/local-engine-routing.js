'use strict';
const fs = require('node:fs');
const path = require('node:path');
function enabled(env = process.env) {
  if (env.DEX_LOCAL_ENGINE_BRIDGE === '0' || (env.DEX_STATE_DIR && env.DEX_LOCAL_ENGINE_BRIDGE !== '1')) return false;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../sdcpp-workflow/state/local-engine-bridge.json'))).enabled === true; }
  catch (_) { return false; }
}
function controlledScript(spec) {
  return enabled() ? '../operator-console/bin/local-engine-generate.js' : require('./controlled-args').controlledScriptFor(spec);
}
module.exports = { enabled, controlledScript };
