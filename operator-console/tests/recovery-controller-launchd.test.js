'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const controller = read('scripts/dexdiffusion-recovery-controller.py');
const plist = read('scripts/local.dexdiffusion.recovery.plist');
const installer = read('scripts/install-recovery-agent.sh');
const cli = read('bin/dexdiffusion');
const native = read('native/macos/Image_Gen/ImageGenApp.swift');
const appInstaller = read('scripts/install-macos-app.sh');

test('one user LaunchAgent runs a bounded periodic recovery tick', () => {
  assert.match(plist, /local\.dexdiffusion\.recovery/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>60<\/integer>/);
  assert.doesNotMatch(plist, /<key>KeepAlive<\/key>/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /preserving existing .* differs from project source/);
  assert.match(installer, /launchctl bootout/);
});

test('controller uses durable state, one lock, two checks, bounded retry and a circuit breaker', () => {
  assert.match(controller, /fcntl\.flock/);
  assert.match(controller, /"failed_checks"\] = prior_failures \+ 2/);
  assert.match(controller, /MAX_EPISODES = int\(os\.environ\.get\("DEX_RECOVERY_MAX_EPISODES", "3"\)\)/);
  assert.match(controller, /WINDOW_SECONDS = int\(os\.environ\.get\("DEX_RECOVERY_WINDOW_SECONDS", "900"\)\)/);
  assert.match(controller, /COOLDOWN_SECONDS = int\(os\.environ\.get\("DEX_RECOVERY_COOLDOWN_SECONDS", "60"\)\)/);
  assert.match(controller, /EPISODE_SECONDS = int\(os\.environ\.get\("DEX_RECOVERY_EPISODE_SECONDS", "105"\)\)/);
  assert.match(controller, /EPISODE_WALL_SECONDS = int\(os\.environ\.get\("DEX_RECOVERY_WALL_SECONDS", "180"\)\)/);
  assert.match(controller, /CIRCUIT_OPEN/);
  assert.match(controller, /latest_verified_healthy_at/);
});

test('repair delegates to the existing owner and checks remote jobs and resource lease first', () => {
  assert.match(controller, /subprocess\.Popen\(\[str\(CLI\), "__controller-start"\]/);
  assert.match(controller, /api\/resources/);
  assert.match(controller, /api\/jobs/);
  assert.match(controller, /DEX_RESOURCE_OR_ACTIVE_JOB_BUSY/);
  assert.match(cli, /lockf -t "\$\{DEX_RECOVERY_BUDGET:-105\}"/);
  assert.match(cli, /__controller-start\)\n\s*\[ "\$\{DEX_RECOVERY_CONTROLLER_ROOT:-\}" = "\$ROOT" \]/);
  assert.match(cli, /^  start\) cmd_recovery ;;$/m);
  assert.match(cli, /recovery-status\) cmd_recovery --status/);
  assert.match(cli, /recovery-retry\) cmd_recovery --manual/);
});

test('publication sync runs only from verified health with its own backoff and lock', () => {
  const healthy = controller.slice(controller.indexOf('if check["classification"] == "NONE":\n            healthy_since'), controller.indexOf('prior_failures = int('));
  assert.match(healthy, /_dispatch_publication\(state, check, now\)/);
  assert.match(controller, /\[str\(CLI\), "publication-sync"\]/);
  assert.match(controller, /publication_next_at/);
  assert.match(cli, /lockf -t 0 "\$HOME\/Library\/Caches\/DexDiffusion\/canonical-publication\.lock"/);
});

test('native repeated-failure request routes through the controller, not direct repair', () => {
  const request = native.slice(native.indexOf('Native Studio requested a policy-checked recovery tick'), native.indexOf('private func runPublicationSync'));
  assert.match(request, /recovery-tick/);
  assert.doesNotMatch(request, /helper\) start/);
});

test('native install stages and verifies fingerprints with a verified rollback path', () => {
  assert.match(appInstaller, /STAGE="\$WORK\/DexDiffusion\.app"/);
  assert.match(appInstaller, /DexDiffusionSourceFingerprint/);
  assert.match(appInstaller, /INSTALL_BACKUP=/);
  assert.match(appInstaller, /Rollback restored previous application/);
  assert.match(appInstaller, /dock-backup-/);
  assert.match(appInstaller, /Rollback restored Dock preferences/);
});
