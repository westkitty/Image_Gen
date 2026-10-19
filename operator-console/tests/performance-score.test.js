'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Score = require('../performance-score');
const Engines = require('../voice-engines');
const Bridge = require('../media-bridge');

test('performance score binds exact phrase spans to immutable source dialogue', () => {
  const sourceText = 'I assure you, that is a profoundly stupid proposition.';
  const phrases = [
    { start: 0, end: 13, text: 'I assure you,', preset: 'formal_dry' },
    { start: 14, end: 34, text: 'that is a profoundly', preset: 'restrained_irritation' },
    { start: 35, end: sourceText.length, text: 'stupid proposition.', preset: 'contempt', emphasis: [{ text: 'stupid', start: 35, end: 41 }] },
  ];
  const score = Score.createScore({ sourceText, profileId: 'vp-1', identityVersion: 2, lineId: 'line-1', phrases });
  assert.equal(Score.validateScore(score).ok, true);
  assert.throws(() => Score.createScore({ sourceText, profileId: 'vp-1', lineId: 'line-1', phrases: [{ start: 0, end: 13, text: 'I assure him,' }] }), /does not match/);
  assert.throws(() => Score.createScore({ sourceText, profileId: 'vp-1', lineId: 'line-1', phrases: [{ start: 0, end: 14 }, { start: 13, end: 20 }] }), /overlaps/);
  score.source.text = 'changed';
  assert.equal(Score.validateScore(score).ok, false);
});

test('VoiceDesign item directions are compiled independently for one batch', () => {
  const profile = { id: 'vp-1', type: 'designed', description: 'A clear, low voice', language: 'en' };
  const plan = Engines.buildRenderPlan('qwen3-tts-voice-design', profile, {
    texts: ['First phrase.', 'Second phrase.'], directions: ['formal and clipped', 'quietly furious'], seeds: [11, 12],
  });
  assert.match(plan.body.items[0].instruct, /formal and clipped/);
  assert.match(plan.body.items[1].instruct, /quietly furious/);
  assert.equal(plan.body.items[0].seed, 11);
  assert.equal(plan.body.items[1].seed, 12);
  assert.equal(plan.body.instruct, profile.description);
  const accepted = Bridge.validateBatchPlan('qwen3-tts-voice-design', plan.body);
  assert.equal(accepted.error, undefined);
  assert.equal(accepted.req.items[0].instruct, plan.body.items[0].instruct);
  assert.match(Bridge.validateBatchPlan('kokoro', { items: [{ text: 'x', instruct: 'ignored?' }], voice: 'af_heart' }).error, /does not support/);
});

test('control resolution marks unsupported instructions and unavailable candidates honestly', () => {
  const score = Score.createScore({ sourceText: 'Hello there.', profileId: 'vp-1', lineId: 'line-1', phrases: [{ start: 0, end: 12, preset: 'formal_dry' }] });
  const controls = Score.resolvePhraseControls(score, Engines.getEngine('qwen3-tts-base'))[0].controls;
  assert.equal(controls.delivery, 'unsupported');
  assert.equal(Engines.CANDIDATES.length, 5, 'tone-color conversion is not a text-generation candidate');
  assert.ok(Engines.CONVERTERS['openvoice-v2']);
  assert.equal(Engines.CONVERTERS['openvoice-v2'].capabilities.text_generation, false);
  assert.ok(Engines.CANDIDATES.every(candidate => candidate.status === 'UNAVAILABLE' && !candidate.selectable && candidate.blocker));
});

test('phrase compilation preserves every source character and dispatches only supported directions', () => {
  const source = 'Before: wait, listen. After.';
  const score = Score.createScore({ sourceText: source, profileId: 'vp-1', lineId: 'line-1', phrases: [
    { start: 8, end: 20, text: 'wait, listen', delivery: 'quietly, then urgently' },
  ] });
  const supported = Score.compileScoreItems(score, Engines.getEngine('qwen3-tts-voice-design'));
  assert.equal(supported.map(x => x.text).join(''), source);
  assert.deepEqual(supported.map(x => x.text), ['Before: ', 'wait, listen', '. After.']);
  assert.equal(supported[1].direction, 'quietly, then urgently');
  const unsupported = Score.compileScoreItems(score, Engines.getEngine('qwen3-tts-base'));
  assert.equal(unsupported.map(x => x.text).join(''), source);
  assert.equal(unsupported[1].direction, '');
  assert.equal(unsupported[1].controls.delivery, 'unsupported');
});

test('adjacent directed phrases attach separator whitespace instead of dispatching empty speech', () => {
  const source = 'Wait. I can explain. Leave the door open.';
  const phrases = ['Wait.', 'I can explain.', 'Leave the door open.'].map((text, i) => {
    const start = source.indexOf(text);
    return { id: `beat-${i + 1}`, start, end: start + text.length, text, delivery: `direction ${i + 1}` };
  });
  const score = Score.createScore({ sourceText: source, profileId: 'vp-1', lineId: 'line-1', phrases });
  const items = Score.compileScoreItems(score, Engines.getEngine('voxcpm2'));
  assert.equal(items.length, 3);
  assert.ok(items.every(item => item.text.trim()));
  assert.equal(items.map(item => item.text).join(''), source);
  assert.deepEqual(items.map(item => item.direction), phrases.map(p => p.delivery));
});

test('VoxCPM2 clone and design plans carry reference or approved profile description without conflating them', () => {
  const clone = { id: 'vp-clone', type: 'cloned', language: 'en', samples: [{ id: 'sm-1', active: true, transcript: 'reference words', validation: { ok: true } }] };
  const clonePlan = Engines.buildRenderPlan('voxcpm2', clone, { texts: ['line'], directions: ['calm and slow'], refPath: '/private/ref.wav', seeds: [7] });
  assert.equal(clonePlan.body.profile_type, 'cloned');
  assert.equal(clonePlan.body.ref_path, '/private/ref.wav');
  assert.equal(clonePlan.body.items[0].direction, 'calm and slow');
  const cloneValidated = Bridge.validateBatchPlan('voxcpm2', clonePlan.body);
  assert.equal(cloneValidated.refPath, '/private/ref.wav');
  const designed = { id: 'vp-design', type: 'designed', description: 'A clear, low, warm voice', language: 'en' };
  const designPlan = Engines.buildRenderPlan('voxcpm2', designed, { texts: ['line'], directions: ['whispered'], seeds: [8] });
  assert.equal(designPlan.body.profile_type, 'designed');
  assert.equal(designPlan.body.ref_path, undefined);
  assert.equal(Bridge.validateBatchPlan('voxcpm2', designPlan.body).req.voice_description, designed.description);
});
