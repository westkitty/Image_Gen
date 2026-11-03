'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const launcher = read('bin/dexdiffusion');
const installer = read('scripts/install-backend-service.sh');
const runner = read('scripts/run-backend-service.sh');
const plist = read('scripts/local.dexdiffusion.server.plist');
const native = read('native/macos/Image_Gen/ImageGenApp.swift');

test('healthy backend and tunnel are reused without service or tunnel restart', () => {
  const block = launcher.slice(launcher.indexOf('cmd_start_unlocked() {'), launcher.indexOf('\n# All callers (CLI, Dock app, and Retry)'));
  assert.match(block, /if pid="\$\(owned_pid\)" && healthy/);
  const reuse = block.slice(0, block.indexOf('  else'));
  assert.doesNotMatch(reuse, /install-backend-service|kill -TERM|ssh -f -N/);
});

test('backend stopped behind a listening owned tunnel repairs remote service and preserves tunnel', () => {
  const branch = launcher.slice(launcher.indexOf('if [ "$(hostname -s)" != "bigmac" ] && owned_ssh_tunnel_pid'), launcher.indexOf('\n      else\n        echo "ERROR: port'));
  assert.match(branch, /install-backend-service\.sh/);
  assert.match(branch, /--user-session/);
  assert.match(branch, /SERVICE_READY\|SERVICE_ALREADY_LOADED/);
  assert.match(branch, /\( \|\$\)/);
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
});

test('user-session readiness checks are bounded and preserve an already registered unhealthy job', () => {
  const branch = installer.slice(installer.indexOf('if [[ "$USER_SESSION" == 1 ]]'), installer.indexOf('\n[[ "$EUID" -eq 0 ]]'));
  assert.match(branch, /for \(\(attempt=0; attempt<30; attempt\+\+\)\)/);
  assert.match(branch, /launchctl bootout "gui\/\$USER_UID\/\$LABEL"/);
  assert.match(branch, /SERVICE_REGISTERED" == 1/);
  assert.match(branch, /leaving the existing service untouched/);
  assert.doesNotMatch(branch, /launchctl disable|log show|TCC_MARKER/);
  assert.doesNotMatch(branch, /while true/);
});

test('disabled launchd services remain unchanged unless the operator explicitly opts in', () => {
  assert.doesNotMatch(installer, /TCC_MARKER|touch .*backend-service-tcc-disabled/);
  assert.match(installer, /ENABLE_AFTER_TCC" != 1/);
  assert.match(installer, /launchctl enable "gui\/\$USER_UID\/\$LABEL"/);
  assert.match(installer, /launchctl enable "system\/\$LABEL"/);
  assert.match(installer, /service is disabled in launchd; preserving its current state/);
  assert.doesNotMatch(installer, /launchctl disable/);
});

test('TCC log messages cannot automatically alter DexDiffusion launchd state', () => {
  assert.doesNotMatch(installer, /kTCCServiceSystemPolicyRemovableVolumes|log show|launchctl disable/);
  assert.match(installer, /--enable-after-tcc/);
  assert.match(installer, /Recent TCC messages are not attributed to this Node process/);
});

test('DD-11 unrelated TCC denial cannot auto-enable a disabled service', () => {
  const start = installer.indexOf("if /usr/bin/grep -F '\"local.dexdiffusion.server\" => disabled'");
  const end = installer.indexOf('\n  /bin/mkdir -p "$USER_HOME/Library/LaunchAgents"', start);
  assert.ok(start >= 0 && end > start);
  const policy = installer.slice(start, end).replaceAll('/bin/launchctl', 'launchctl');
  const script = `set -e\nlaunchctl(){ if [ "$1" = print-disabled ]; then echo '\"local.dexdiffusion.server\" => disabled'; else echo "UNEXPECTED:$*" >&2; return 1; fi; }\nENABLE_AFTER_TCC=0; USER_UID=503; LABEL=local.dexdiffusion.server; TCC_LOG='Unrelated app denied RemovableVolumes access'\n${policy}`;
  const result = cp.spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 9); assert.match(result.stderr, /service is disabled in launchd; preserving its current state/);
  assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED:enable/);
});

test('no GUI launch domain is required or hard-coded', () => {
  assert.doesNotMatch(launcher, /gui\/503/);
  assert.match(installer, /user\/\$USER_UID/);
  assert.match(installer, /system\//);
});

test('already-loaded project service is idempotent and unrelated loaded definitions are preserved', () => {
  assert.match(installer, /SERVICE_READY domain=system label=\$LABEL user=bigmac api=200 studio=200 existing=\$SYSTEM_REGISTERED/);
  assert.match(installer, /launchd did not retain the project runner/);
  assert.match(installer, /system service is loaded but its installed definition differs/);
  assert.match(installer, /existing LaunchAgent differs from the known project definition; preserving it/);
});

test('unrelated port owners are never signalled', () => {
  const block = launcher.slice(launcher.indexOf('cmd_start_unlocked() {'), launcher.indexOf('\n# All callers (CLI, Dock app, and Retry)'));
  assert.match(block, /port \$PORT is in use by a process that is not this checkout's operator-console or tunnel/);
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
  assert.match(native, /func webView\(_ webView: WKWebView, didFail navigation:[\s\S]+?handleNavigationFailure\(error, phase: "didFail", navigation:/);
  assert.match(native, /startupWatchdogPolicy\.evaluate/);
  assert.match(native, /startupIsProgressing: serviceStartupInProgress \|\| webView\.isLoading/);
  assert.match(native, /serviceStartupInProgress \|\| webView\.isLoading/);
});

test('a second normal startup does not create duplicate services or tunnels', () => {
  assert.match(installer, /launchctl print "system\/\$LABEL"/);
  assert.match(installer, /SERVICE_READY domain=system label=\$LABEL user=bigmac api=200 studio=200 existing=\$SYSTEM_REGISTERED/);
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
