'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-controlled-generate.sh'), 'utf8');
const LIB = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-lib.sh'), 'utf8');

test('SDCPP preflight reuses a private bounded SSH control socket and supports opt-out', () => {
  assert.match(SCRIPT, /DEX_SSH_MUX:-1/);
  assert.match(SCRIPT, /MUX_DIR="\$HOME\/\.ssh\/dexdiffusion-cm"/);
  assert.match(SCRIPT, /chmod 700 "\$MUX_DIR"/);
  assert.match(SCRIPT, /ControlMaster=auto/);
  assert.match(SCRIPT, /ControlPath=\$MUX_DIR\/%C/);
  assert.match(SCRIPT, /ControlPersist=120/);
  assert.match(LIB, /ssh -o ConnectTimeout=15 \$\{SDCPP_SSH_EXTRA_OPTS:-\}/);
  assert.ok(SCRIPT.indexOf('export SDCPP_SSH_EXTRA_OPTS') < SCRIPT.indexOf('verify_route >/dev/null'),
    'multiplexing is configured before the sequential remote preflight');
});
