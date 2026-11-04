'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildConnectionReport } = require('../public/dexdiffusion/client-helpers.js');

test('connection report states failed probes and what answered when it was made', () => {
  const text = buildConnectionReport({
    generatedAt: '2026-11-04T03:08:43.000Z', backendUrl: '(same origin)', backendOnline: false, backendHealth: 'degraded', consecutiveFailures: 2,
    jobStatus: 'generating', activeJobId: 'job-1',
    probes: [{ at: Date.UTC(2026, 10, 4, 3, 8, 30), ok: false, ms: 12001, error: 'No answer within 12 s (timed out)' }],
    checks: [{ path: '/api/version', status: 200, ms: 40, body: '{"name":"x"}' }, { path: '/api/jobs?limit=5', ms: 6000, error: 'No answer within 6 s (timed out)' }]
  });
  assert.match(text, /Backend online: false/);
  assert.match(text, /Job status: generating \(job-1\)/);
  assert.match(text, /2026-11-04T03:08:30\.000Z {2}FAILED {2}12001 ms {2}No answer within 12 s/);
  assert.match(text, /\/api\/version {2}HTTP 200 {2}40 ms\n\{"name":"x"\}/);
  assert.match(text, /\/api\/jobs\?limit=5 {2}FAILED {2}6000 ms/);
});

test('connection report says when no probe has been recorded and cuts long bodies', () => {
  const text = buildConnectionReport({ checks: [{ path: '/api/system-info', status: 200, ms: 1, body: 'x'.repeat(5000) }] });
  assert.match(text, /none recorded since this page loaded/);
  assert.match(text, /\[cut, 5000 characters in all\]/);
});

test('page switching has no blocking prompt and the alert offers the report', () => {
  const dir = path.join(__dirname, '../public/dexdiffusion');
  const component = fs.readFileSync(path.join(dir, 'component.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(component, /Switch workspaces\?/);
  assert.match(html, /data-studio-offline[^\n]*Open System details<\/button><button type="button" data-copy-connection-report onClick="\{\{ onCopyConnectionReport \}\}">/);
});
