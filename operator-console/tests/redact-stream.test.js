'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'redact_stream.py');
const run = (input, prompt, negative = '') => spawnSync('python3', [SCRIPT, prompt, negative], { input, encoding: 'utf8' }).stdout;

// What sd-cli -v really prints for a multi-line prompt (captured 2026-10-02 from a canary run, canary words kept).
const MULTI = 'a photo of a canarymultialpha heron,\nstanding in canarymultibeta marsh water, with odd spacing\n\nand a third canarymultigamma paragraph';
const NEG = 'neg canaryneglineone\ncanaryneglinetwo';
const LOG = [
  '  prompt: "' + MULTI + '",', '  negative_prompt: "' + NEG + '",',
  "[DEBUG] conditioner.hpp:319  - parse '" + MULTI + "' to [['" + MULTI + "', 1], ]",
  '[DEBUG] bpe_tokenizer.cpp:208  - split prompt "' + MULTI + '" to tokens ["a</w>", "photo</w>", "canarymultialpha</w>"]',
  "[DEBUG] conditioner.hpp:319  - parse '" + NEG + "' to [['" + NEG + "', 1], ]",
  '[DEBUG] bpe_tokenizer.cpp:208  - split prompt "' + NEG + '" to tokens ["neg</w>"]',
  '[INFO ] sampling 3/9 - 2.41s/it', ''
].join('\n');

test('redact_stream: a multi-line prompt and negative prompt leave no fragment in any echo', () => {
  const out = run(LOG, MULTI, NEG);
  for (const w of ['canarymultialpha', 'canarymultibeta', 'canarymultigamma', 'canaryneglineone', 'canaryneglinetwo', 'odd spacing', 'heron', 'marsh', 'paragraph', 'photo</w>']) {
    assert.ok(!out.toLowerCase().includes(w.toLowerCase()), `'${w}' leaked:\n${out}`);
  }
  assert.match(out, /sampling 3\/9 - 2\.41s\/it/, 'non-private log lines are preserved');
  assert.match(out, /to tokens \[REDACTED\]/);
});

test('redact_stream: single-line prompts, lora tags and collapsed whitespace are still redacted', () => {
  const prompt = 'a red fox <lora:style_a:0.7>  jumps  high';
  const log = ['prompt: "' + prompt + '"', "parse 'a red fox  jumps  high' to [['a red fox  jumps  high', 1], ]", 'split prompt "a red fox jumps high" to tokens ["a</w>"]', ''].join('\n');
  const out = run(log, prompt);
  assert.ok(!/red fox|jumps/.test(out), out);
});

test('redact_stream: carriage-return progress updates pass through unchanged and in order', () => {
  const out = run('step 1/9\rstep 2/9\rstep 3/9\n', 'secret words here');
  assert.equal(out, 'step 1/9\rstep 2/9\rstep 3/9\n');
});

test('redact_stream: empty prompt arguments change nothing', () => {
  assert.equal(run('hello world\n', '', ''), 'hello world\n');
});
