'use strict';

const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const lib = path.resolve(__dirname, '../../sdcpp-workflow/bin/sdcpp-lib.sh');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

test('SDCPP preflight accepts only the pinned checkout and ordinary untracked Finder files', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcpp-preflight-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'engine.cpp'), 'source\n');
  git(repo, 'add', 'engine.cpp');
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture');
  const head = git(repo, 'rev-parse', 'HEAD');
  const verify = (pin = head) => spawnSync('bash', ['-c', [
    '. "$1"',
    'REMOTE_REPO="$2"',
    'ssh_remote() { bash -c "$1"; return 0; }',
    'verify_repo_clean "$3"',
  ].join('\n'), 'fixture', lib, repo, pin], { encoding: 'utf8' });
  const pass = () => {
    const result = verify();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), head.slice(0, 7));
  };
  const fail = (gate, pin) => {
    const result = verify(pin);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp('First failed gate: ' + gate + '\\b'));
  };

  pass();
  fs.mkdirSync(path.join(repo, 'assets'));
  fs.writeFileSync(path.join(repo, 'assets/.DS_Store'), 'Finder metadata');
  pass();
  fs.writeFileSync(path.join(repo, 'engine.cpp'), 'modified source\n');
  fail('repo-dirty');
  git(repo, 'restore', 'engine.cpp');
  fs.writeFileSync(path.join(repo, 'assets/untracked.cpp'), 'untracked source\n');
  fail('repo-dirty');
  fs.unlinkSync(path.join(repo, 'assets/untracked.cpp'));
  git(repo, 'add', 'assets/.DS_Store');
  fail('repo-dirty');
  git(repo, 'rm', '--cached', '-f', 'assets/.DS_Store');
  fs.unlinkSync(path.join(repo, 'assets/.DS_Store'));
  fs.symlinkSync('../engine.cpp', path.join(repo, 'assets/.DS_Store'));
  fail('repo-dirty');
  fail('repo-pin', '0'.repeat(40));
});
