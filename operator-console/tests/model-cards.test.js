'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODEL_CARDS,
  getModelCards,
  getModelCardById,
  checkModelSwitchWarnings
} = require('../model-registry');

test('model-cards: all cards have required fields and honest provenance', () => {
  assert(MODEL_CARDS.length >= 6, 'expected at least 6 core models');

  for (const card of MODEL_CARDS) {
    assert(card.id, 'card has id');
    assert(card.display_name, 'card has display_name');
    assert(card.family, 'card has family');
    assert(card.backend, 'card has backend');
    assert(['PROVEN', 'STAGED', 'UNPROVEN'].includes(card.status), `valid status: ${card.status}`);
    assert(['exact-model', 'family-sample', 'placeholder'].includes(card.preview_provenance), `valid provenance: ${card.preview_provenance}`);
    assert(Array.isArray(card.best_for) && card.best_for.length > 0, 'has best_for entries');
    assert(Array.isArray(card.specialties) && card.specialties.length > 0, 'has specialties');
    assert(typeof card.caveat === 'string' && card.caveat.length > 0, 'has caveat');
  }

  // Check that the protected primary is FLUX.2 Klein 4B with exact-model preview
  const primary = MODEL_CARDS.find(c => c.primary);
  assert(primary, 'has primary card');
  assert.equal(primary.id, 'flux2-klein-4b');
  assert.equal(primary.status, 'PROVEN');
  assert.equal(primary.preview_provenance, 'exact-model');
});

test('model-cards: filtering by search, family, and status works', () => {
  const fluxOnly = getModelCards({ family: 'flux2' });
  assert.equal(fluxOnly.length, 1);
  assert.equal(fluxOnly[0].id, 'flux2-klein-4b');

  const provenOnly = getModelCards({ status: 'proven' });
  assert(provenOnly.length > 0);
  assert(provenOnly.every(c => c.status === 'PROVEN'));

  const searchResults = getModelCards({ search: 'photoreal' });
  assert(searchResults.length > 0);
  assert(searchResults.some(c => c.id === 'flux2-klein-4b'));
});

test('model-cards: switch warnings flag negative prompt and LoRA incompatibilities', () => {
  // Switching from SD1.5 to FLUX.2 with active negative prompt
  const warnings = checkModelSwitchWarnings('sd15', 'flux2-klein-4b', {
    negativePrompt: 'blurry, bad anatomy',
    loras: [{ name: 'test_lora', family: 'sd15' }]
  });

  assert(warnings.some(w => w.includes('does not support negative prompts')));
  assert(warnings.some(w => w.includes('does not currently support LoRAs')));
});

test('model-cards: dynamic resolution covers every selectable target without gaps', () => {
  const mockTargets = [
    { id: 'sd15', label: 'SD 1.5' },
    { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B' },
    { id: 'sdxl-base', label: 'SDXL Base' },
    { id: 'sdxl-juggernaut', label: 'Juggernaut XL' },
    { id: 'sd15-auto-v1-5-pruned-emaonly', label: 'Discovered SD1.5' },
    { id: 'flux-future-custom', label: 'Custom FLUX Model' }
  ];

  const cards = getModelCards({}, mockTargets);
  const cardIds = new Set(cards.map(c => c.id));
  const missing = mockTargets.filter(t => !cardIds.has(t.id));

  assert.equal(missing.length, 0, `All selectable targets must have a card. Missing: ${JSON.stringify(missing)}`);

  // Verify the synthetic/discovered model has all required fields with placeholder provenance
  const autoCard = cards.find(c => c.id === 'sd15-auto-v1-5-pruned-emaonly');
  assert(autoCard, 'auto-discovered model has card');
  assert.equal(autoCard.family, 'sd15');
  assert.equal(autoCard.preview_provenance, 'placeholder');
  assert(autoCard.description.length > 0);
  assert(autoCard.why_use.length > 0);
  assert(Array.isArray(autoCard.best_for) && autoCard.best_for.length > 0);
  assert(Array.isArray(autoCard.specialties) && autoCard.specialties.length > 0);
  assert(Array.isArray(autoCard.avoid_for) && autoCard.avoid_for.length > 0);
  assert(typeof autoCard.caveat === 'string' && autoCard.caveat.length > 0);

  const customFlux = cards.find(c => c.id === 'flux-future-custom');
  assert(customFlux, 'custom flux target has card');
  assert(customFlux.family.startsWith('flux'));
  assert.equal(customFlux.preview_provenance, 'placeholder');
});

test('model-cards: structured warnings serialize to JSON with required schema', () => {
  const warnings = checkModelSwitchWarnings('sd15', 'sdxl-base', {
    negativePrompt: '',
    loras: [{ name: 'epi_noise_offset', family: 'sd15' }]
  });

  assert(warnings.length > 0, 'has switch warning');
  const w = warnings[0];
  assert.equal(typeof w.code, 'string');
  assert.equal(typeof w.message, 'string');
  assert(['info', 'warning', 'error'].includes(w.severity));
  assert.equal(w.resource_id, 'epi_noise_offset');

  // Verify JSON serialization includes code, message, severity, resource_id
  const serialized = JSON.parse(JSON.stringify(warnings));
  assert.equal(serialized[0].code, 'LORA_FAMILY_MISMATCH');
  assert.equal(serialized[0].resource_id, 'epi_noise_offset');
  assert.equal(serialized[0].severity, 'warning');
});
