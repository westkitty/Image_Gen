'use strict';
// Never publish test names, assertion messages, fixture values or raw suite logs.
// This report is intentionally categorical, even if it sacrifices some diagnostic detail.
const MAX_MARKERS = 18;
const MAX_LOG_SAMPLE = 512 * 1024;

function signature(line) {
  const tap = /^\s*(?:#\s*)?not ok\s+(\d+)\s+-\s+.+$/i.exec(line);
  if (tap) return { kind: 'failed-test', index: Number(tap[1]) };
  if (/^\s*\[[^\]\r\n]{1,96}\]\s+(?:FAIL|BLOCKED)\s+.+$/i.test(line)) return { kind: 'failed-browser-check' };
  if (/^\s*[^\r\n]{1,155}\/[\w.-]+\/[\w.-]+\s+(?:FAIL|BLOCKED)\s*$/i.test(line)) return { kind: 'failed-matrix-cell' };
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

module.exports = { extractFailureMarkers };
