'use strict';
// Optional legacy SDCPP configuration is not a health or liveness dependency.
// A filesystem permission error on an external volume must not prevent Studio
// from describing the features that are independently evidenced by job records.
const fs = require('node:fs');
const path = require('node:path');
function parseKeyValue(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}
function readOptionalKeyValue(filePath, warnings = [], readFile = fs.readFileSync) {
  try { return parseKeyValue(readFile(filePath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      warnings.push({ file: path.basename(filePath), state: 'UNAVAILABLE', code: error.code });
      return {};
    }
    throw error;
  }
}
function getWorkflowConfig(configDir, stateDir, options = {}) {
  const warnings = [];
  const read = options.readFile || fs.readFileSync;
  const values = {
    ...readOptionalKeyValue(path.join(configDir, 'sdcpp.env'), warnings, read),
    ...readOptionalKeyValue(path.join(stateDir, 'current-ports.env'), warnings, read)
  };
  return { values, warnings };
}
module.exports = { parseKeyValue, readOptionalKeyValue, getWorkflowConfig };
