'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('CLI open activates only the installed native app after starting the backend', () => {
  const src = read('bin/dexdiffusion');
  assert.match(src, /open\)\s+cmd_start >/);
  assert.match(src, /\/usr\/bin\/open -a "\$APP_PATH"/);
  assert.match(src, /APP_PATH="\/Applications\/DexDiffusion\.app"/);
  assert.doesNotMatch(src, /open "\$LOCAL_URL"|open\s+"\$BASE\/dexdiffusion\//);
});

test('native wrapper exposes no browser escape menu or URL opener', () => {
  const src = read('native/macos/Image_Gen/ImageGenApp.swift');
  assert.doesNotMatch(src, /Open in Browser|openInBrowser|NSWorkspace\.shared\.open\(consoleURL\)/);
  assert.match(src, /applicationShouldHandleReopen[\s\S]*?showMainWindow\(\)/);
  assert.match(src, /applicationShouldTerminateAfterLastWindowClosed[\s\S]*?false/);
});

test('installer stamps full source SHA and artwork identity; status accepts legacy short SHA', () => {
  const installer = read('scripts/install-macos-app.sh');
  const launcher = read('bin/dexdiffusion');
  assert.match(installer, /rev-parse HEAD/);
  assert.match(installer, /DexDiffusionSourceHead/);
  assert.match(installer, /DexDiffusionSourceFingerprint/);
  assert.match(installer, /DexDiffusionIconFingerprint/);
  assert.match(launcher, /rev-parse HEAD/);
  assert.match(launcher, /"\$repo_head" = "\$ahead"\*/);
});

test('T-201 the wrapper implements the JavaScript dialog delegates instead of auto-rejecting confirms', () => {
  const src = read('native/macos/Image_Gen/ImageGenApp.swift');
  // Without these three WKUIDelegate methods every window.confirm() inside the app resolves false.
  assert.match(src, /runJavaScriptAlertPanelWithMessage message: String[\s\S]{0,200}completionHandler: @escaping \(\) -> Void/);
  assert.match(src, /runJavaScriptConfirmPanelWithMessage message: String[\s\S]{0,200}completionHandler: @escaping \(Bool\) -> Void/);
  assert.match(src, /runJavaScriptTextInputPanelWithPrompt prompt: String[\s\S]{0,260}completionHandler: @escaping \(String\?\) -> Void/);
  // The confirm delegate must forward the user's choice, not a constant.
  const confirm = src.slice(src.indexOf('runJavaScriptConfirmPanelWithMessage'), src.indexOf('runJavaScriptTextInputPanelWithPrompt'));
  assert.match(confirm, /completionHandler\(accepted\)/);
  // AppKit work stays on the main thread and a completion handler is always called exactly once.
  assert.match(src, /guard Thread\.isMainThread else/);
  assert.match(src, /win\.attachedSheet == nil/);
  assert.match(src, /presentJavaScriptDialog[\s\S]{0,1500}handle\(alert\.runModal\(\)\)/);
  // The existing file picker is preserved.
  assert.match(src, /runOpenPanelWith parameters: WKOpenPanelParameters/);
});

test('Dock startup loads the local Studio immediately rather than waiting for the shell helper', () => {
  const src = read('native/macos/Image_Gen/ImageGenApp.swift');
  const block = src.slice(src.indexOf('    private func ensureServicesThenLoad() {'), src.indexOf('    private func ensureOperatorConsoleViaHelper() {'));
  assert.match(block, /showMainWindow\(\)[\s\S]*?guard !serviceStartupInProgress/);
  assert.ok(block.indexOf('showMainWindow()') < block.indexOf('self.ensureOperatorConsoleViaHelper()'));
  assert.equal((block.match(/self\.loadConsole\(\)/g) || []).length, 1, 'no unconditional second page load on helper completion');
  assert.match(block, /pendingReconnectAfterStartup/);
  assert.match(src, /if isNewWindow \|\| !navigationStarted/);
});

test('Native white-screen failures have visible bootstrap and WebKit-process diagnostics', () => {
  const src = read('native/macos/Image_Gen/ImageGenApp.swift');
  assert.match(src, /underPageBackgroundColor/);
  assert.match(src, /WKWebView watchdog/);
  assert.match(src, /window\.__dex/);
  assert.match(src, /#app-root > \[data-v\]/);
  assert.match(src, /WKWebView Studio bootstrap verified/);
  assert.match(src, /WKWebView Studio bootstrap incomplete/);
  assert.match(src, /webViewWebContentProcessDidTerminate/);
  assert.match(src, /bootstrapRetryCount < 1/);
  assert.match(src, /reconnectAttempts < 2/);
  const reload = src.slice(src.indexOf('    @objc private func reloadPage()'), src.indexOf('    @objc private func openLogs()'));
  assert.match(reload, /loadConsole\(\)/, 'Reload must work even when no navigation has succeeded');
  assert.doesNotMatch(reload, /webView\?\.reload\(\)/);
});
