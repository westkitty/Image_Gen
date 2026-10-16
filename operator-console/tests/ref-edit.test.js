'use strict';

// P14 / CN-12: FLUX.2 Klein reference editing. The Big Mac render is proven live (see the ledger); these tests lock the
// local safety gates, which run before any ssh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin');
const EDIT = path.join(BIN, 'mflux-controlled-edit.sh');
const run = (args, env) => spawnSync(EDIT, args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } });

test('the edit script refuses references outside the canonical image root, non-PNGs and missing files before any ssh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-out-'));
  fs.writeFileSync(path.join(outside, 'a.png'), 'x');
  fs.writeFileSync(path.join(root, 'b.txt'), 'x');
  fs.symlinkSync(path.join(outside, 'a.png'), path.join(root, 'link.png'));
  const base = ['--prompt', 'p', '--width', '512', '--height', '512', '--steps', '4', '--seed', '1'];
  for (const ref of [path.join(outside, 'a.png'), path.join(root, 'b.txt'), path.join(root, 'link.png'), path.join(root, 'missing.png'), '/etc/hosts', path.join(root, '..', path.basename(outside), 'a.png')]) {
    const r = run(['--init-img', ref, ...base], { DEX_IMAGES_ROOT_OVERRIDE: root });
    assert.notEqual(r.status, 0, ref);
    assert.match(r.stdout + r.stderr, /First failed gate: init-img/, ref + '\n' + r.stdout + r.stderr);
  }
  const noRef = run(base, { DEX_IMAGES_ROOT_OVERRIDE: root });
  assert.match(noRef.stdout + noRef.stderr, /--init-img is required/);
  const badSteps = run(['--init-img', path.join(root, 'b.txt'), '--prompt', 'p', '--width', '512', '--height', '512', '--steps', '9'], { DEX_IMAGES_ROOT_OVERRIDE: root });
  assert.match(badSteps.stdout + badSteps.stderr, /Steps must be 1-8/);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
});

test('the remote half verifies the reference checksum, calls the edit binary with --image-paths and stops its own child', () => {
  const remote = fs.readFileSync(path.join(BIN, 'mflux-remote-edit.sh'), 'utf8');
  assert.match(remote, /head -c 41943040 > "\$tmp\/ref\.png"/);
  assert.match(remote, /\[ "\$got_sha" = "\$ref_sha" \]/);
  assert.match(remote, /--image-paths "\$tmp\/ref\.png"/);
  assert.match(remote, /pkill -TERM -P \$\$/);
  const local = fs.readFileSync(EDIT, 'utf8');
  assert.match(local, /mflux-generate-flux2-edit/);
  assert.match(local, /dexdiffusion-mflux-\$RUN_ID/, 'the run id label lets Interrupt find this run');
  assert.match(local, /SDCPP_RUN_ID: \$RUN_ID/);
  assert.match(local, /< "\$REF_PATH" > "\$INCOMING"/, 'the reference streams over ssh stdin');
});
