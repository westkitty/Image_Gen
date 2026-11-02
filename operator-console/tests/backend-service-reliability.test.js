'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const launcher = read('bin/dexdiffusion');
const installer = read('scripts/install-backend-service.sh');
const runner = read('scripts/run-backend-service.sh');
const plist = read('scripts/local.dexdiffusion.server.plist');
const native = read('native/macos/Image_Gen/ImageGenApp.swift');

test('healthy backend and tunnel are reused without service or tunnel restart', () => {
  const block = launcher.slice(launcher.indexOf('cmd_start() {'), launcher.indexOf('\ncmd_stop() {'));
  assert.match(block, /if pid="\$\(owned_pid\)" && healthy/);
  const reuse = block.slice(0, block.indexOf('  else'));
  assert.doesNotMatch(reuse, /install-backend-service|kill -TERM|ssh -f -N/);
});

test('backend stopped behind a listening owned tunnel repairs remote service and preserves tunnel', () => {
  const branch = launcher.slice(launcher.indexOf('if [ "$(hostname -s)" != "bigmac" ] && owned_ssh_tunnel_pid'), launcher.indexOf('\n      else\n        echo "ERROR: port'));
  assert.match(branch, /install-backend-service\.sh/);
  assert.match(branch, /--user-session/);
  assert.match(branch, /SERVICE_\(READY\|ALREADY_LOADED\)/);
  assert.match(branch, /preserving tunnel/);
  assert.match(branch, /existing SSH tunnel pid \$listener is healthy and preserved/);
  assert.match(branch, /local tunnel is still unresponsive|probes confirm it did not recover with the backend/);
  assert.match(branch, /ready/);
  assert.match(branch, /DEX_BACKEND_READY/);
  assert.match(branch, /kill -TERM/); // only after remote backend is healthy and owner is rechecked
  assert.ok(branch.indexOf('ready" -ne 1') < branch.indexOf('kill -TERM'));
  assert.ok(branch.indexOf('tunnel_ready" -eq 1') < branch.indexOf('kill -TERM'));
});

test('missing or unloaded service installs as a system daemon running as bigmac', () => {
  assert.match(installer, /launchctl bootstrap system/);
  assert.match(installer, /SERVICE_READY domain=system/);
  assert.match(plist, /<key>UserName<\/key>\s*<string>bigmac<\/string>/);
  assert.match(installer, /SUDO_USER.*bigmac/);
});

test('system service registration is verifiable without the GUI launch domain', () => {
  assert.match(installer, /launchctl print "system\/\$LABEL"/);
  assert.match(installer, /launchd did not retain the project runner/);
  assert.match(installer, /launchctl bootstrap system/);
});

test('TCC-compatible user-session installation requires an active Aqua session and refuses duplicates', () => {
  assert.match(installer, /--user-session/);
  assert.match(installer, /session = Aqua/);
  assert.match(installer, /launchctl bootstrap "gui\/\$USER_UID"/);
  assert.match(installer, /system service is loaded; refusing duplicate user-session service/);
  assert.match(installer, /SERVICE_READY domain=gui\/\$USER_UID/);
  assert.match(installer, /SERVICE_ALREADY_LOADED domain=gui\/\$USER_UID/);
});

test('user-session TCC failures are bounded and unload the job to prevent restart loops', () => {
  const branch = installer.slice(installer.indexOf('if [[ "$USER_SESSION" == 1 ]]'), installer.indexOf('\n[[ "$EUID" -eq 0 ]]'));
  assert.match(branch, /for _ in \{1\.\.30\}/);
  assert.match(branch, /launchctl bootout "gui\/\$USER_UID\/\$LABEL"/);
  assert.match(branch, /launchctl disable "gui\/\$USER_UID\/\$LABEL"/);
  assert.match(branch, /kTCCServiceSystemPolicyRemovableVolumes/);
  assert.match(branch, /TCC_MARKER/);
  assert.doesNotMatch(branch, /while true/);
});

test('a later app recovery retries only a TCC-disabled user job and disables it again if consent is still missing', () => {
  assert.match(installer, /TCC_MARKER="\$STATE_DIR\/backend-service-tcc-disabled"/);
  assert.match(installer, /ENABLE_AFTER_TCC.*! -f "\$TCC_MARKER"/);
  assert.match(installer, /launchctl enable "gui\/\$USER_UID\/\$LABEL"/);
  assert.match(installer, /touch "\$TCC_MARKER"/);
  assert.match(installer, /rm -f "\$TCC_MARKER"/);
});

test('Removable Volumes TCC denial disables the daemon and requires explicit consent before re-enable', () => {
  assert.match(installer, /kTCCServiceSystemPolicyRemovableVolumes/);
  assert.match(installer, /launchctl bootout "system\/\$LABEL"/);
  assert.match(installer, /launchctl disable "system\/\$LABEL"/);
  assert.match(installer, /--enable-after-tcc/);
  assert.match(installer, /intentionally disabled after a removable-volume privacy denial/);
});

test('no GUI launch domain is required or hard-coded', () => {
  assert.doesNotMatch(launcher, /gui\/503/);
  assert.match(installer, /user\/\$USER_UID/);
  assert.match(installer, /system\//);
});

test('already-loaded project service is idempotent and unrelated loaded definitions are preserved', () => {
  assert.match(installer, /SERVICE_ALREADY_LOADED/);
  assert.match(installer, /launchd did not retain the project runner/);
  assert.match(installer, /system service is loaded but its installed definition differs/);
  assert.match(installer, /existing LaunchAgent differs from the known project definition; preserving it/);
});

test('unrelated port owners are never signalled', () => {
  const block = launcher.slice(launcher.indexOf('cmd_start() {'), launcher.indexOf('\ncmd_stop() {'));
  assert.match(block, /port \$PORT is in use by a process that is not this checkout/);
  assert.match(block, /Not touching it/);
});

test('SSH unavailability and timed out probes remain distinct from confirmed backend-down', () => {
  assert.match(launcher, /SSH to Big Mac is unavailable or unverified/);
  assert.match(launcher, /SSH destination \$SSH_TARGET is unavailable or unverified/);
  assert.match(launcher, /service state unknown \(SSH\/service probe timed out\)/);
  assert.match(launcher, /Big Mac service recovery was not confirmed/);
});

test('external-volume loss fails closed and never selects a local fallback', () => {
  assert.match(runner, /mount \/dev\/filesystem|mount \| grep/);
  assert.match(runner, /refusing local-disk fallback/);
  assert.match(runner, /FATAL: DexDiffusion durable data root/);
  assert.match(plist, /<key>PathState<\/key>/);
  assert.match(plist, /<key>\/Volumes\/wc2tb\/DexDiffusion<\/key>/);
});

test('slow navigation gets a bounded startup window and transient connection errors trigger bounded recovery', () => {
  assert.match(native, /deadline: \.now\(\) \+ 35/);
  assert.match(native, /reconnectAttempts < 2/);
  assert.match(native, /pendingReconnectAfterStartup/);
  assert.match(native, /func webView\(_ webView: WKWebView, didFail navigation:[\s\S]+?handleNavigationFailure\(error, phase: "didFail"\)/);
  assert.match(native, /startupWatchdogDeferrals < 2/);
  assert.match(native, /serviceStartupInProgress \|\| wv\.isLoading/);
});

test('a second normal startup does not create duplicate services or tunnels', () => {
  assert.match(installer, /launchctl print "system\/\$LABEL"/);
  assert.match(installer, /SERVICE_ALREADY_LOADED/);
  assert.match(launcher, /already connected to Big Mac backend/);
});

test('MacBook recovery targets the TCC-compatible Big Mac user session and reports that domain', () => {
  assert.match(launcher, /install-backend-service\.sh --user-session/);
  assert.match(launcher, /launchctl print gui\/\\\$\(id -u\)\/local\.dexdiffusion\.server/);
  assert.doesNotMatch(launcher, /sudo -n bash \/Users\/bigmac\/Image_Gen\/scripts\/install-backend-service\.sh/);
});

test('startup failure reports live remote launchd and Big Mac error logs, not MacBook server.log', () => {
  const failure = launcher.slice(launcher.indexOf('if ! healthy; then'), launcher.indexOf('\n    pid="$(owned_pid)"'));
  assert.match(failure, /Big Mac service/);
  assert.match(failure, /\/Users\/bigmac\/Image_Gen\/operator-console\/server-error\.log/);
  const remoteDiagnostics = failure.slice(failure.indexOf('if [ "$(hostname'), failure.indexOf('\n      else'));
  assert.doesNotMatch(remoteDiagnostics, /tail -n 20 "\$LOG"/);
});

test('service recovery and readiness checks have explicit finite bounds', () => {
  const branch = launcher.slice(launcher.indexOf('if [ "$(hostname -s)" != "bigmac" ] && owned_ssh_tunnel_pid'), launcher.indexOf('\n      else\n        echo "ERROR: port'));
  assert.match(branch, /for _ in 1 2 3 4 5 6 7 8 9 10/);
  assert.match(branch, /PROBE_TIMEOUT \* 3/);
  assert.doesNotMatch(branch, /while true/);
});
