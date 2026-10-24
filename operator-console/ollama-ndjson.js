'use strict';
// Incremental parser for Ollama's newline-delimited JSON stream (Phase 0 contract D.4).
// Bytes are split on '\n' before decoding, so a UTF-8 character or a JSON object split across chunks is reassembled intact.
// A line longer than maxLineBytes, or any line that is not a JSON object, is a parse error; the caller stops reading.

const MAX_LINE_BYTES = 1024 * 1024;

function createNdjsonParser({ maxLineBytes = MAX_LINE_BYTES } = {}) {
  let pending = [];
  let pendingBytes = 0;
  let failed = null;

  function parseLine(buf) {
    const line = buf.toString('utf8').replace(/\r$/, '');
    if (!line.trim()) return { skip: true };
    let obj;
    try { obj = JSON.parse(line); } catch (_) { return { error: 'malformed_line' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'not_an_object' };
    return { obj };
  }

  // -> { objects: [...], error: null | 'malformed_line' | 'not_an_object' | 'line_too_long' }
  function push(chunk) {
    const objects = [];
    if (failed) return { objects, error: failed };
    let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (;;) {
      const nl = buf.indexOf(0x0a);
      if (nl === -1) break;
      const piece = buf.subarray(0, nl);
      if (pendingBytes + piece.length > maxLineBytes) { failed = 'line_too_long'; return { objects, error: failed }; }
      const whole = pending.length ? Buffer.concat([...pending, piece]) : piece;
      pending = []; pendingBytes = 0;
      const r = parseLine(whole);
      if (r.error) { failed = r.error; return { objects, error: failed }; }
      if (!r.skip) objects.push(r.obj);
      buf = buf.subarray(nl + 1);
    }
    if (buf.length) {
      if (pendingBytes + buf.length > maxLineBytes) { failed = 'line_too_long'; return { objects, error: failed }; }
      pending.push(Buffer.from(buf)); pendingBytes += buf.length;
    }
    return { objects, error: null };
  }

  // Upstream EOF: a final unterminated line is still parsed; garbage there is a parse error.
  function end() {
    if (failed) return { objects: [], error: failed };
    if (!pendingBytes) return { objects: [], error: null };
    const r = parseLine(Buffer.concat(pending));
    pending = []; pendingBytes = 0;
    if (r.error) { failed = r.error; return { objects: [], error: failed }; }
    return { objects: r.skip ? [] : [r.obj], error: null };
  }

  return { push, end, bufferedBytes: () => pendingBytes };
}

module.exports = { createNdjsonParser, MAX_LINE_BYTES };
