'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const consoleRoot = path.join(__dirname, '..');
const repo = path.dirname(consoleRoot);
const units = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js'));
const browserDir = path.join(__dirname, 'browser');
const browsers = fs.readdirSync(browserDir).filter(name => name.endsWith('.browser.js')).map(name => name.slice(0, -11));

const domains = {
  foundation: {
    paths: /^(?:\.github\/|scripts\/|bin\/|native\/|operator-console\/(?:package|server\.js|media\.js|media-bridge|job-|remote-workers|storage-|test-isolation|backend-quiescence|operational-jobs|tests\/(?:release-gate|affected-verification|fixtures\/|browser\/(?:helpers|safe-output|server-supervisor))))/,
    tests: /^(?:job-|media\.|media-bridge|storage-paths|server-publication|backend-quiescence|remote-cancel|browser-target|test-isolation)/,
    browsers: [],
  },
  image: {
    paths: /^(?:sdcpp-workflow\/|operator-console\/(?:controlled-|local-engine-|controlnet|image-|lora-|publication-|workstation|.*\/(?:edit-|lora-|workstation-ui|source-hover)))/,
    tests: /^(?:canonical-publication|publication-recovery|queued-lora|lora-unification|edit-resources|edit-core|sdcpp-upstream|local-engine-bridge|image-store)/,
    browsers: ['create-publication', 'edit-img2img-parity', 'edit-workbench', 'v2-parity-library-flow'],
  },
  resources: {
    paths: /^(?:operator-console\/(?:collections|recipes|styles|macro|wildcard|library|.*\/(?:prompt-|library|macro|wildcard)))/,
    tests: /^(?:collection|recipe|macro|wildcard|library-organize|prompt-styles)/,
    browsers: ['v2-parity-prompt-assets', 'v2-parity-library-flow', 'wildcard-placement'],
  },
  audio: {
    paths: /^operator-console\/(?:asr-|audio|voice|drama|music|.*\/(?:voice|drama|music|audio))/,
    tests: /^(?:asr-adapter|audio-qa|voice-production|drama-production-routes|drama-cancel-policy|voice-connection-status)/,
    browsers: ['voice-drama', 'drama-studio'],
  },
  chat: {
    paths: /^operator-console\/(?:chat-|ollama-|.*\/(?:chat-|omni-chat|prompt-intelligence))/,
    tests: /^(?:chat-compute|chat-stream|ollama-legacy|prompt-intelligence)/,
    browsers: ['omni-chat-modes'],
  },
  spatial: {
    paths: /^operator-console\/(?:world|3d-|video|glb|.*\/(?:world|3d-|video|v2-parity-3d))/,
    tests: /^(?:world-project|world-bridge|3d-|glb-|video-)/,
    browsers: ['v2-parity-3d-world'],
  },
  shell: {
    paths: /^operator-console\/public\/dexdiffusion\/(?:index\.html|component\.js|dc-runtime|concept-a|studio-|lightbox)/,
    tests: /^(?:studio-shell|browser-target)/,
    browsers: ['studio-first-screen-shapes', 'studio-masters-nav', 'studio-layout-theme'],
  },
};
const dependentDomains = {
  foundation: ['image', 'resources', 'audio', 'chat', 'spatial', 'shell'],
  shell: ['image', 'resources', 'audio', 'chat', 'spatial'],
  resources: ['image'],
};

function select(files) {
  const groups = new Set();
  const exactUnits = new Set();
  const exactBrowsers = new Set();
  for (const file of files) {
    if (/^(?:docs\/|\.github\/workflows\/pages\.yml$)|\.(?:md|txt)$/.test(file)
      && !file.endsWith('omni-test-requirements.txt')) continue;
    const direct = Object.entries(domains).filter(([, domain]) => domain.paths.test(file));
    direct.forEach(([key]) => groups.add(key));
    const name = path.basename(file);
    if (file === 'operator-console/tests/' + name && units.includes(name)) exactUnits.add(name);
    else if (file === 'operator-console/tests/browser/' + name && name.endsWith('.browser.js') && browsers.includes(name.slice(0, -11))) exactBrowsers.add(name.slice(0, -11));
    else if (!direct.length) groups.add('foundation');
  }
  for (const group of groups) for (const dependent of dependentDomains[group] || []) groups.add(dependent);
  for (const group of groups) {
    for (const name of units) if (domains[group].tests.test(name)) exactUnits.add(name);
    for (const name of domains[group].browsers) {
      if (!browsers.includes(name)) throw new Error('Missing browser suite: ' + name);
      exactBrowsers.add(name);
    }
  }
  return { domains: [...groups].sort(), units: [...exactUnits].sort(), browsers: [...exactBrowsers].sort() };
}

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function run(base, head, listOnly) {
  const baseCommit = git('rev-parse', '--verify', base + '^{commit}');
  const headCommit = git('rev-parse', '--verify', head + '^{commit}');
  const mergeBase = git('merge-base', baseCommit, headCommit);
  if (headCommit !== git('rev-parse', 'HEAD')) throw new Error('Verification head must be checked out');
  const files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', mergeBase, headCommit], {
    cwd: repo, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  const selection = select(files);
  const receipt = { base: baseCommit, mergeBase, head: headCommit, fileCount: files.length, ...selection };
  console.log(JSON.stringify(receipt));
  if (listOnly) return;

  function step(label, args, env = {}) {
    const result = spawnSync(process.execPath, args, {
      cwd: consoleRoot, stdio: 'inherit', env: { ...process.env, ...env },
    });
    console.log(JSON.stringify({ head: headCommit, step: label, exit: result.status, signal: result.signal }));
    if (result.status !== 0) process.exitCode = 1;
  }
  step('syntax', ['--check', 'server.js']);
  if (selection.units.length) step('unit', ['--test', '--test-concurrency=1', ...selection.units.map(name => 'tests/' + name)]);
  if (selection.browsers.length) step('browser', ['tests/release-gate.js'], {
    DEX_RELEASE_PARTITION: 'browser', DEX_RELEASE_ONLY: selection.browsers.join(','),
  });
}

if (require.main === module) {
  const [base, head = 'HEAD', option] = process.argv.slice(2);
  if (!base || (option && option !== '--list')) throw new Error('Usage: node tests/affected-verification.js <last-verified-ref> [head] [--list]');
  run(base, head, option === '--list');
}

module.exports = { select };
