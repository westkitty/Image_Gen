'use strict';

// Keep machine-readable worker protocol intact while redacting echoed user text.
// These tokens carry job/run identity and terminal/image markers consumed later.
const PROTOCOL = /(SDCPP_RUN_ID:\s*20\d{6}-\d{6}-[a-zA-Z0-9_-]{1,80}|CONTROLLED_OUTPUT_IMAGE:\s*\S+|CONTROLLED_BATCH_IMAGE:\s*\S+|==== PASS ====)/g;

function redactSensitiveText(text, values) {
  if (!text || !values || values.length === 0) return text;
  return String(text).split(PROTOCOL).map((part, index) => {
    if (index % 2 === 1) return part;
    let redacted = part;
    for (const value of values) {
      if (!value) continue;
      const escaped = String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      redacted = redacted.replace(new RegExp(escaped, 'gi'), '[REDACTED]');
    }
    return redacted;
  }).join('');
}

// Worker stdout can split a prompt or protocol token at any stream boundary.
// Buffer through newline boundaries so complete lines are redacted and parsed
// atomically. flush() handles a final unterminated line on child close.
function createStreamingRedactor(values) {
  let pending = '';
  return {
    push(chunk) {
      pending += String(chunk || '');
      const end = pending.lastIndexOf('\n');
      if (end < 0) return '';
      const complete = pending.slice(0, end + 1);
      pending = pending.slice(end + 1);
      return redactSensitiveText(complete, values);
    },
    flush() {
      const tail = pending;
      pending = '';
      return redactSensitiveText(tail, values);
    },
  };
}

module.exports = { redactSensitiveText, createStreamingRedactor };
