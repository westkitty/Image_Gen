'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSensitiveText, createStreamingRedactor } = require('../job-output-redaction');

test('redacts echoed prompt text without corrupting worker protocol markers or run identity', () => {
  const runId = '20261107-121314-controlled-sd15';
  const input = `SDCPP_RUN_ID: ${runId}\nCONTROLLED_OUTPUT_IMAGE: /images/a-fox.png\n==== PASS ====\nPrompt echo: A fox studies a lighthouse.`;
  const output = redactSensitiveText(input, ['a fox']);
  assert.match(output, new RegExp(`SDCPP_RUN_ID: ${runId}`));
  assert.match(output, /CONTROLLED_OUTPUT_IMAGE: \/images\/a-fox\.png/);
  assert.match(output, /==== PASS ====/);
  assert.match(output, /Prompt echo: \[REDACTED\] studies a lighthouse\./);
  assert.doesNotMatch(output, /Prompt echo: A fox/);
});

test('leaves text untouched when no prompt values need redaction', () => {
  assert.equal(redactSensitiveText('ordinary output', []), 'ordinary output');
});

test('streaming redaction handles prompt and protocol tokens split at every boundary', () => {
  const input = 'SDCPP_RUN_ID: 20261107-121314-controlled-sd15\n==== PASS ====\nPrompt echo: A fox studies the room.';
  for (let split = 1; split < input.length; split++) {
    const stream = createStreamingRedactor(['a fox']);
    const output = stream.push(input.slice(0, split)) + stream.push(input.slice(split)) + stream.flush();
    assert.match(output, /SDCPP_RUN_ID: 20261107-121314-controlled-sd15/);
    assert.match(output, /==== PASS ====/);
    assert.match(output, /Prompt echo: \[REDACTED\] studies the room\./);
    assert.doesNotMatch(output, /Prompt echo: A fox/);
  }
});
