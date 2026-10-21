'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCancellationManager } = require('../cancellation');
const { genericJobCanCancel } = require('../operational-jobs');

const componentSource = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/component.js'), 'utf8');
const nativeSource = fs.readFileSync(path.join(__dirname, '../../native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');

test('V2 normal launch migrates the obsolete shell preference without clearing saved drafts', () => {
  assert.match(componentSource, /const DEX_INITIAL_VERSION = \(\(\) =>/);
  assert.match(componentSource, /if \(saved !== 2\) localStorage\.setItem\('dex_version', '2'\)/);
  assert.match(componentSource, /version: DEX_INITIAL_VERSION/);
  assert.match(componentSource, /get\('debug'\) === '1'/, 'explicit debug query keeps legacy test shells reachable');
});

test('V2 Create cannot turn a second Generate click into a local-only cancellation', () => {
  assert.match(componentSource, /This image job is already in progress/);
  assert.doesNotMatch(componentSource, /clearInterval\(this\._pollTimer\);\s*this\.setState\(\{ jobStatus: 'idle', progress: 0 \}\)/);
  assert.match(componentSource, /async onCancelGenerate\(\)/);
  assert.match(componentSource, /this\.state\.backendUrl \+ '\/api\/jobs\/' \+ encodeURIComponent\(jobId\) \+ '\/cancel'/);
  assert.match(componentSource, /method: 'POST'/);
  assert.match(componentSource, /jobStatus: 'stopping', cancelRequested: true/);
});

test('a cancelled image is called cancelled only with stop evidence', () => {
  assert.match(componentSource, /const stopVerified = !!\(job\.remoteCancel && job\.remoteCancel\.ok\) \|\| job\.remoteStop === 'cancelled_verified'/);
  assert.match(componentSource, /jobStatus: 'cancel-unverified'/);
  assert.match(componentSource, /Could not verify that the worker stopped/);
});

test('generic Job Center projection only enables never-started queued cancellation', () => {
  assert.equal(genericJobCanCancel({ status: 'QUEUED' }), true);
  assert.equal(genericJobCanCancel({ status: 'RUNNING' }), false);
  assert.equal(genericJobCanCancel({ status: 'TRANSFERRING' }), false);
});

test('native WKWebView handles confirm, alert, and text input with explicit completion', () => {
  assert.match(nativeSource, /runJavaScriptConfirmPanelWithMessage/);
  assert.match(nativeSource, /runJavaScriptAlertPanelWithMessage/);
  assert.match(nativeSource, /runJavaScriptTextInputPanelWithPrompt/);
  assert.match(nativeSource, /completion\(!confirm \|\| response == \.alertFirstButtonReturn\)/);
  assert.match(nativeSource, /completionHandler\(response == \.alertFirstButtonReturn \? input\.stringValue : nil\)/);
  assert.match(nativeSource, /javaScriptDialogInProgress/);
});
