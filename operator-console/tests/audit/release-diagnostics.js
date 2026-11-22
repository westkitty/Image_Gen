'use strict';
// Never publish arbitrary test names, assertion messages, fixture values or raw suite logs.
// This report is intentionally categorical, even if it sacrifices some diagnostic detail.
const MAX_MARKERS = 18;
const MAX_LOG_SAMPLE = 512 * 1024;

const matrixSpec = require('../browser/interaction-matrix.spec.json');
const matrixIds = new Set(matrixSpec.shells.flatMap(shell => matrixSpec.viewports.flatMap(
  ([width, height]) => matrixSpec.screens.map(screen => `V${shell}/${width}x${height}/${screen}`)
)));
const matrixContracts = new Set([...matrixSpec.contracts, 'studio-rail-geometry', 'model-disabled-state',
  'navigation-label-regression', 'runtime', 'execution']);
const priority = { PASS: 0, FAIL: 1, BLOCKED: 2 };

function parseMatrixCell(line) {
  const m = /^([^\t\r\n]+?)[ \t]+(PASS|FAIL|BLOCKED)(?:[ \t]|$)/.exec(line);
  if (!m || !matrixIds.has(m[1])) return null;
  return { id: m[1], status: m[2] };
}

function matrixContractLine(id, contracts) {
  const allowed = [...new Set(contracts.filter(key => matrixContracts.has(key)))].sort();
  return matrixIds.has(id) && allowed.length ? `DEX_MATRIX_CONTRACTS\t${id}\t${allowed.join(',')}` : '';
}

function tallyMatrixCells(output) {
  const outcomes = new Map();
  const contractsById = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const row = parseMatrixCell(line);
    if (row) {
      if (!outcomes.has(row.id) || priority[row.status] > priority[outcomes.get(row.id)]) outcomes.set(row.id,row.status);
      continue;
    }
    const category = /^DEX_MATRIX_CONTRACTS\t([^\t]+)\t([^\t]+)$/.exec(line);
    if (!category || !matrixIds.has(category[1])) continue;
    const contracts = contractsById.get(category[1]) || new Set();
    for (const key of category[2].split(',')) if (matrixContracts.has(key)) contracts.add(key);
    if (contracts.size) contractsById.set(category[1], contracts);
  }
  const nonPassing = [];
  let passed = 0, blocked = 0;
  for (const [id,status] of outcomes) {
    if (status === 'PASS') passed++;
    else {
      const contracts = contractsById.get(id);
      nonPassing.push({ id, status, ...(contracts ? { contracts: [...contracts].sort() } : {}) });
      if (status === 'BLOCKED') blocked++;
    }
  }
  // Keep failed backward-compatible: it counts all non-passing outcomes, including blocked.
  return { passed, failed: nonPassing.length, blocked, measured: outcomes.size, nonPassing };
}


function signature(line) {
  const tap = /^\s*(?:#\s*)?not ok\s+(\d+)\s+-\s+.+$/i.exec(line);
  if (tap) return { kind: 'failed-test', index: Number(tap[1]) };
  if (/^\s*\[[^\]\r\n]{1,96}\]\s+(?:FAIL|BLOCKED)\s+.+$/i.test(line)) return { kind: 'failed-browser-check' };
  const matrix = parseMatrixCell(line);
  if (matrix && matrix.status !== 'PASS') return { kind: 'failed-matrix-cell', ...matrix };
  const code = /^\s*(?:#\s*)?code:\s*['"]?((?:ERR_|E)[A-Z0-9_]{2,40})\b/.exec(line);
  if (code) return { kind: 'error-code', code: code[1] };
  const problem = /(?:^|\s)(AssertionError|TypeError|ReferenceError|SyntaxError|TimeoutError|RangeError|AggregateError|ModuleNotFoundError|FileNotFoundError|Error)(?:\s*\[([A-Z0-9_]{2,40})\])?\s*:/i.exec(line);
  if (problem) return { kind: 'error-class', name: problem[1], ...(problem[2] ? { code: problem[2] } : {}) };
  const source = /(?:\/|\\)(tests[\/][A-Za-z0-9._\/-]+\.js):(\d{1,6})(?::(\d{1,5}))?/.exec(line);
  if (source) return { kind: 'test-location', file: source[1].replaceAll('\\', '/'), line: Number(source[2]) };
  return null;
}

function extractFailureMarkers(output) {
  const raw = String(output || '');
  // Do not package any underlying text; sample bounded beginning and tail.
  const sample = raw.length > MAX_LOG_SAMPLE
    ? raw.slice(0, 64 * 1024) + '\n' + raw.slice(-(MAX_LOG_SAMPLE - 64 * 1024))
    : raw;
  const markers = [];
  const seen = new Set();
  for (const line of sample.split(/\r?\n/)) {
    const item = signature(line);
    if (!item) continue;
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    markers.push(item);
    if (markers.length >= MAX_MARKERS) break;
  }
  return { markers, sampled: raw.length > MAX_LOG_SAMPLE, truncated: markers.length >= MAX_MARKERS };
}

module.exports = { extractFailureMarkers, matrixContractLine, tallyMatrixCells };
