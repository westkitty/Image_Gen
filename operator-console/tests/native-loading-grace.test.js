'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('slow WebKit transfer grace is bounded and cannot act on a stale navigation', () => {
 const source = fs.readFileSync(path.join(__dirname, '../../native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');
 const start = source.indexOf('private func finishStartupWatchdog');
 const body = source.slice(start, source.indexOf('let decision =', start));
 assert.match(body, /token == navigationToken, !studioVerified/);
 assert.match(body, /webView\.isLoading && Date\(\)\.timeIntervalSince\(studioLoadStartedAt\) < 180/);
 assert.doesNotMatch(body, /showLoadFailure|studioVerified = true|loadConsole\(/);
 assert.match(source, /studioLoadStartedAt = Date\(\)\n        let token = navigationToken/);
});
