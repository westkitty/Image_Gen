'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { SYSTEM, createSystemInfo, parseServeStatus } = require('../system-info');
const { chooseInitialTarget, targetOptionLabel } = require('../public/dexdiffusion/client-helpers.js');

const ROOT = path.join(__dirname, '..', '..');
const TARGETS = [
  { id: 'sd15', label: 'SD1.5 standard', status: 'supported' },
  { id: 'flux2-klein-4b', label: 'FLUX.2 Klein 4B (MFLUX)', backend: 'mflux', status: 'proofed', primary: true },
];

test('Tailscale Serve route is found and classified tailnet-only vs Funnel', () => {
  const serve = {
    Web: {
      'mac.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } },
      'mac.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:31337' } } },
    },
    AllowFunnel: { 'mac.ts.net:443': true },
  };
  const r = parseServeStatus(JSON.stringify(serve));
  assert.equal(r.url, 'https://mac.ts.net:8443/dexdiffusion/');
  assert.equal(r.funnel, false);
  assert.equal(r.scope, 'tailnet-only');
  serve.AllowFunnel['mac.ts.net:8443'] = true;
  assert.equal(parseServeStatus(serve).scope, 'PUBLIC (Funnel enabled)');
  assert.equal(parseServeStatus({ Web: {} }), null);
  assert.equal(parseServeStatus('not json'), null);
});

test('system-info reports primary target, canonical storage, derived capabilities and no secrets', async () => {
  const getInfo = createSystemInfo({
    probes: {
      tailscale: async () => ({ available: false, reason: 'offline' }),
      launcher: async () => ({ appPath: SYSTEM.launcher.appPath, installed: false, dockEntries: null }),
    },
    getAssets: () => ({ reachable: true, mfluxRuntime: true, mfluxModel: true, sdCli: false, sd15Model: false, esrganModel: false,
      secondaryModelState: 'active', activeSecondaryModel: 'sd15', secondarySourcePath: '$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors',
      secondaryActivePath: '$HOME/Library/Caches/DexDiffusion/secondary-model/current/model.safetensors', secondaryLastSwitchResult: 'pass' }),
    getEvidence: () => ({ 'txt2img-mflux': { lastPass: { at: '2026-09-25T23:16:00Z', runId: 'r1' } } }),
  });
  const info = await getInfo({ targets: TARGETS, build: { sshTarget: 'westcat' } });
  assert.equal(info.primaryTarget.id, 'flux2-klein-4b');
  assert.equal(info.storage.canonicalImages, '/Users/andrew/images_made');
  assert.equal(info.generation.route, 'ssh westcat');
  assert.equal(info.generation.remoteRetention, 'ephemeral');
  assert.equal(info.modelState.primaryModel.id, 'flux2-klein-4b');
  assert.equal(info.modelState.activeSecondaryModel, 'sd15');
  assert.equal(info.modelState.secondaryModelState, 'active');
  assert.equal(info.network.localBind, '127.0.0.1:31337');
  assert.equal(info.network.tailscale.available, false, 'degrades when Tailscale is down');
  assert.equal(info.launcher.bundleId, 'local.image-gen.wrapper');
  const byId = Object.fromEntries(info.capabilities.map(c => [c.id, c.status]));
  assert.equal(byId['txt2img-mflux'], 'proven');
  assert.equal(byId['txt2img-sdcpp'], 'dormant', 'missing sd-cli => dormant, never proven');
  assert.equal(byId['upscale-resample'], 'available', 'no evidence => available, not proven');
  assert.match(info.sdcpp.revision, /^7f0e728/);
  const text = JSON.stringify(info);
  assert.doesNotMatch(text, /password|secret|authkey|private[_ -]?key|BEGIN [A-Z ]*KEY|hf_[A-Za-z0-9]{10}/i);
});

test('exactly one primary target (MFLUX), and capabilities carry per-target runtime', () => {
  const src = fs.readFileSync(path.join(ROOT, 'operator-console', 'server.js'), 'utf8');
  assert.equal((src.match(/^\s*primary: true,$/gm) || []).length, 1, 'exactly one primary target');
  assert.match(src, /primary: target\.primary === true,\n\s*runtime: targetRuntime\(target, assetCache, TARGET_MODELS\),/);
});

test('initial target: saved preference wins, else proofed primary, else current', () => {
  assert.equal(chooseInitialTarget(TARGETS, null, 'sd15'), 'flux2-klein-4b');
  assert.equal(chooseInitialTarget(TARGETS, 'sd15', 'sd15'), 'sd15', 'valid saved preference preserved');
  assert.equal(chooseInitialTarget(TARGETS, 'gone-target', 'sd15'), 'flux2-klein-4b', 'stale preference ignored');
  const unproofed = TARGETS.map(t => (t.primary ? { ...t, status: 'staged' } : t));
  assert.equal(chooseInitialTarget(unproofed, null, 'sd15'), 'sd15', 'unproofed primary is not forced');
  assert.equal(chooseInitialTarget([], null, 'sd15'), 'sd15');
  assert.equal(targetOptionLabel(TARGETS[1]), 'FLUX.2 Klein 4B (MFLUX) — Primary');
  assert.equal(targetOptionLabel({ ...TARGETS[0], runtime: 'dormant' }), 'SD1.5 standard — dormant');
});

test('bin/dexdiffusion status is read-only and degrades when services are unavailable', () => {
  const out = execFileSync(path.join(ROOT, 'bin', 'dexdiffusion'), ['status'], {
    encoding: 'utf8',
    env: { ...process.env, DEX_PORT: '1', DEX_SSH_TARGET: 'dexdiffusion-test-unreachable.invalid' },
    timeout: 30000,
  });
  assert.match(out, /status:\s+DOWN/);
  assert.match(out, /Big Mac:\s+ssh dexdiffusion-test-unreachable\.invalid — DOWN/);
  assert.match(out, /images:\s+\/Users\/andrew\/images_made/);
  assert.match(out, /sd-cli:\s+unknown/);
  assert.match(out, /server down — capability status unavailable/);
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'dexdiffusion'), 'utf8');
  assert.doesNotMatch(src, /pkill|killall|tailscale (serve|funnel) (reset|off|--)/);
});

test('macOS installer builds the DexDiffusion app from the brand icon without wiping the Dock', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'install-macos-app.sh'), 'utf8');
  assert.match(src, /^APP="\/Applications\/DexDiffusion\.app"$/m);
  assert.match(src, /^BUNDLE_ID="local\.image-gen\.wrapper"$/m);
  assert.match(src, /grok_image_1775521844329\.jpg/);
  assert.match(src, /<key>CFBundleIconFile<\/key>\n\s*<string>DexDiffusion<\/string>/);
  assert.doesNotMatch(src, /defaults delete com\.apple\.dock/);
  assert.match(src, /defaults export com\.apple\.dock "\$DOCK_BACKUP"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'operator-console', 'public', 'dexdiffusion', 'uploads', 'grok_image_1775521844329.jpg')));
});
