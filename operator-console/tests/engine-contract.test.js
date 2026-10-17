'use strict';
// Engine compatibility contract (docs/parity/ENGINE_CONTRACT.json): every feature
// names the pinned engine mechanism it relies on, and its state agrees with the
// parity ledger. PROVEN can only come from a ledger row with live proof; a flag that
// merely exists is ENGINE_AVAILABLE; a missing mechanism must name an approval packet.
// The live pin (binary hash + flag list) is checked by docs/parity/tools/probe_engine_contract.sh.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/ENGINE_CONTRACT.json'), 'utf8'));
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json'), 'utf8'));
const PACKETS = fs.readFileSync(path.join(ROOT, 'docs/parity/OPUS_TASK_PACKETS.md'), 'utf8');
const ROWS = new Map(LEDGER.atomic_requirements.map(r => [r.id, r]));
const ENGINES = new Map(C.engines.map(e => [e.id, e]));
const STATES = ['PROVEN', 'ENGINE_AVAILABLE', 'ENGINE_ABSENT'];

test('contract is pinned to the production sd-cli and MFLUX', () => {
  assert.equal(C.schema, 'dexdiffusion.engine-contract.v1');
  const cli = ENGINES.get('sd-cli');
  assert.equal(cli.rev, '7f0e728');
  assert.match(cli.sha256, /^[0-9a-f]{64}$/);
  assert.ok(cli.flags.length > 100 && cli.flags.every(f => /^--[a-z0-9-]+$/.test(f)));
  assert.equal(ENGINES.get('mflux').version, '0.20.0');
});

test('every feature cites only flags present in its pinned engine and only real ledger rows', () => {
  const ids = new Set();
  for (const f of C.features) {
    assert.ok(!ids.has(f.id), 'duplicate ' + f.id); ids.add(f.id);
    assert.ok(STATES.includes(f.state), f.id + ' state ' + f.state);
    assert.ok(ENGINES.has(f.engine), f.id + ' engine');
    const flagSource = f.engine === 'orchestration' ? ENGINES.get('sd-cli') : ENGINES.get(f.engine);
    for (const fl of f.flags) assert.ok(flagSource.flags.includes(fl), `${f.id}: ${fl} not in the pinned ${flagSource.id}`);
    for (const r of f.ledger_rows) assert.ok(ROWS.has(r), `${f.id}: ledger row ${r} missing`);
  }
});

test('PROVEN needs live ledger evidence; ENGINE_AVAILABLE needs flags; ENGINE_ABSENT names an approval packet', () => {
  for (const f of C.features) {
    const rows = f.ledger_rows.map(r => ROWS.get(r));
    if (f.state === 'PROVEN') assert.ok(rows.some(r => r.live_proof === 'LIVE_PROVEN'), f.id + ' is PROVEN without a LIVE_PROVEN ledger row');
    if (f.state === 'ENGINE_AVAILABLE') {
      assert.ok(f.flags.length > 0, f.id + ' has no engine flag');
      assert.ok(f.packet, f.id + ' must say what unlocks it');
      for (const r of rows) assert.notEqual(r.release_status, 'COMPLETE', `${f.id}: ${r.id} cannot be COMPLETE without proof`);
    }
    if (f.state === 'ENGINE_ABSENT') {
      assert.equal(f.flags.length, 0, f.id + ' claims flags for an absent mechanism');
      assert.ok(f.packet && new RegExp('^## ' + f.packet + '\\b', 'm').test(PACKETS), `${f.id}: packet ${f.packet} not found in OPUS_TASK_PACKETS.md`);
      for (const r of rows) {
        assert.notEqual(r.release_status, 'COMPLETE', `${f.id}: ${r.id} COMPLETE despite an absent engine mechanism`);
        assert.notEqual(r.live_proof, 'LIVE_PROVEN', `${f.id}: ${r.id} live-proven despite an absent mechanism`);
      }
    }
    if (f.packet === 'MODELS') assert.ok(fs.existsSync(path.join(ROOT, 'docs/parity/APPROVAL_PACKET_MODELS.md')));
  }
});
