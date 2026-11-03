'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('backend identity reports stable process-start timestamp across requests', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  const begin = source.indexOf('const PROCESS_STARTED_AT =');
  const end = source.indexOf('function expandWildcards(', begin);
  assert.ok(begin >= 0 && end > begin, 'startup identity and build-info source must exist');
  const section = source.slice(begin, end);
  let clockReads = 0;
  class CountingDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(Date.UTC(2026, 0, 1, 0, 0, clockReads++));
    }
  }
  let gitReads = 0;
  const context = {
    Date: CountingDate,
    execFileSync: () => { gitReads++; return gitReads === 1 ? 'abc123\n' : 'changed456\n'; },
    path: { resolve: () => '/project' },
    __dirname: '/project/operator-console',
    APP_VERSION: 'test',
    process: { pid: 1234 },
    HOST: '127.0.0.1', PORT: 31337, WORKFLOW_ROOT: '/project/runs',
    first: null, second: null
  };
  vm.runInNewContext(section + '\nfirst = getBuildInfo(); second = getBuildInfo();', context);
  assert.equal(context.first.startedAt, context.second.startedAt);
  assert.equal(clockReads, 1, 'process start time must be measured once, not per request');
  assert.equal(context.first.pid, 1234);
  assert.equal(context.second.gitHead, 'abc123');
  assert.equal(context.first.gitHead, 'abc123');
  assert.equal(gitReads, 1, 'commit identity must be captured once per process');
});
