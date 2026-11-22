'use strict';
// Never publish arbitrary test names, assertion messages, fixture values or raw suite logs.
// This report is intentionally categorical, even if it sacrifices some diagnostic detail.
const MAX_MARKERS = 18;
const MAX_LOG_SAMPLE = 512 * 1024;

const matrixSpec = require('../browser/interaction-matrix.spec.json');
const matrixIds = new Set(matrixSpec.shells.flatMap(shell => matrixSpec.viewports.flatMap(
  ([width, height]) => matrixSpec.screens.map(screen => `V${shell}/${width}x${height}/${screen}`)
)));
const priority = { PASS: 0, FAIL: 1, BLOCKED: 2 };

function parseMatrixCell(line) {
  const m = /^([^\t\r\n]+?)[ \t]+(PASS|FAIL|BLOCKED)(?:[ \t]|$)/.exec(line);
  if (!m || !matrixIds.has(m[1])) return null;
  return { id: m[1], status: m[2] };
}

function tallyMatrixCells(output) {
  const outcomes = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const row = parseMatrixCell(line);
    if (!row) continue;
    if (!outcomes.has(row.id) || priority[row.status] > priority[outcomes.get(row.id)]) outcomes.set(row.id,row.status);
  }
  const nonPassing = [];
  let passed = 0, blocked = 0;
  for (const [id,status] of outcomes) {
    if (status === 'PASS') passed++;
    else {
      nonPassing.push({ id, status });
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

module.exports = { extractFailureMarkers, tallyMatrixCells };
