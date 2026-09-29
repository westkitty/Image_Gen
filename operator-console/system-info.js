'use strict';

// Operational metadata for DexDiffusion: the single source the UI (System
// screen), GET /api/system-info and bin/dexdiffusion status read from.
// Static facts live in SYSTEM; live facts come from cheap, read-only,
// time-limited probes (tailscale serve status, the installed .app, the Dock).
// Never put credentials, tokens or keys in here.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { CANONICAL_IMAGE_ROOT } = require('./image-store');
const { CAPABILITIES, deriveStatus } = require('./capabilities');

const SYSTEM = {
  app: { name: 'DexDiffusion', docs: 'DEXDIFFUSION.md', operationalState: 'OPERATIONAL_STATE.md' },
  primaryTargetId: 'flux2-klein-4b',
  generation: {
    engine: 'MFLUX / MLX',
    machine: 'Big Mac (Apple M4 Mac mini, 32 GB)',
    remoteRetention: 'ephemeral',
    retentionNote: 'Final images are stored on the MacBook only. Big Mac generation output is temporary and deleted after transfer.',
  },
  mflux: {
    version: '0.20.0',
    model: 'mlx-community/flux2-klein-4b-4bit',
    baseModel: 'black-forest-labs/FLUX.2-klein-4B',
    license: 'Apache-2.0',
    quantization: '4-bit',
    remoteModelPath: '$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit',
    remoteVenv: '$HOME/Library/Caches/DexDiffusion/mflux/venv',
    remoteVenvFallback: '/Volumes/wc2tb/dex-imagegen/mflux-venv (package-identical; external USB, not used on the hot path)',
    typical: { steps: 4, guidance: 1, sizes: ['512x512', '1024x1024'], seed: 'supported' },
    unsupported: ['negative prompt', 'alternate VAE', 'SDCPP scheduler', 'SDCPP CFG scale'],
  },
  sdcpp: {
    role: 'secondary / optional (MFLUX stays primary)',
    upstream: 'https://github.com/leejet/stable-diffusion.cpp',
    revision: '7f0e728 (master-709), Metal',
    binary: '$HOME/stable-diffusion.cpp/build/bin/sd-cli (build dir in ~/sdcpp-staging/build_dir.txt)',
    build: 'cmake -S . -B build -DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release -j 8 (cmake via uvx)',
    models: [
      { use: 'SD1.5 txt2img / img2img / inpaint / hires-fix', path: '$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors', source: 'huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5', license: 'CreativeML OpenRAIL-M', sha256: '6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa' },
      { use: 'Real-ESRGAN x4 upscale', path: '/Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth', source: 'github.com/xinntao/Real-ESRGAN releases v0.1.0', license: 'BSD-3-Clause', sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1' },
    ],
    otherTargets: 'Available source checkpoints are reported by live capability probes. One validated SDCPP source is selected through the atomic managed secondary slot; FLUX is excluded.',
  },
  launcher: {
    platform: 'macOS',
    appName: 'DexDiffusion',
    appPath: '/Applications/DexDiffusion.app',
    bundleId: 'local.image-gen.wrapper',
    iconSource: 'operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg',
    installer: 'scripts/install-macos-app.sh',
  },
  network: { localHost: '127.0.0.1', localPort: 31337, localPath: '/dexdiffusion/', tailscalePort: 8443, tailscaleScope: 'tailnet-only' },
};

function run(cmd, args, timeoutMs = 4000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

function findTailscale() {
  for (const p of ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// From `tailscale serve status --json`, find the HTTPS listener that proxies
// to the local DexDiffusion backend. Pure, so it is unit-testable.
function parseServeStatus(json, localPort = SYSTEM.network.localPort) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (_) { return null; }
  if (!data || !data.Web) return null;
  const want = new Set([`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`]);
  for (const [hostPort, web] of Object.entries(data.Web)) {
    const handlers = (web && web.Handlers) || {};
    for (const [mount, h] of Object.entries(handlers)) {
      if (h && want.has(String(h.Proxy || '').replace(/\/+$/, ''))) {
        const funnel = !!(data.AllowFunnel && data.AllowFunnel[hostPort]);
        return {
          hostPort,
          url: `https://${hostPort.replace(/:443$/, '')}${mount === '/' ? '' : mount}${SYSTEM.network.localPath}`,
          proxy: h.Proxy,
          funnel,
          scope: funnel ? 'PUBLIC (Funnel enabled)' : 'tailnet-only',
        };
      }
    }
  }
  return null;
}

async function probeTailscale() {
  const bin = findTailscale();
  if (!bin) return { available: false, reason: 'tailscale CLI not found' };
  const out = await run(bin, ['serve', 'status', '--json']);
  if (out == null) return { available: false, reason: 'tailscale serve status failed (Tailscale down or logged out?)' };
  const serve = parseServeStatus(out);
  if (!serve) return { available: true, serveConfigured: false, reason: `no Tailscale Serve route proxies to 127.0.0.1:${SYSTEM.network.localPort}` };
  return { available: true, serveConfigured: true, ...serve };
}

async function probeLauncher() {
  const { appPath } = SYSTEM.launcher;
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const result = { appPath, installed: fs.existsSync(plist), installedBundleId: null, iconFile: null, iconPresent: false, dockEntries: null };
  if (result.installed) {
    const read = async key => ((await run('/usr/bin/plutil', ['-extract', key, 'raw', plist])) || '').trim() || null;
    result.installedBundleId = await read('CFBundleIdentifier');
    result.displayName = await read('CFBundleDisplayName');
    result.iconFile = await read('CFBundleIconFile');
    if (result.iconFile) {
      const icon = result.iconFile.endsWith('.icns') ? result.iconFile : result.iconFile + '.icns';
      result.iconPresent = fs.existsSync(path.join(appPath, 'Contents', 'Resources', icon));
    }
  }
  const dock = await run('/usr/bin/defaults', ['read', 'com.apple.dock', 'persistent-apps']);
  if (dock != null) {
    const target = 'file://' + encodeURI(appPath) + '/';
    result.dockEntries = dock.split(target).length - 1;
  }
  return result;
}


function createSystemInfo({ ttlMs = 30000, probes = { tailscale: probeTailscale, launcher: probeLauncher }, getAssets = () => null, getEvidence = () => ({}) } = {}) {
  let cache = null;
  let cachedAt = 0;
  return async function getSystemInfo({ targets = [], build = {} } = {}) {
    if (!cache || Date.now() - cachedAt > ttlMs) {
      const [tailscale, launcher] = await Promise.all([probes.tailscale(), probes.launcher()]);
      cache = { tailscale, launcher };
      cachedAt = Date.now();
    }
    const primary = targets.find(t => t.id === SYSTEM.primaryTargetId) || null;
    const { network } = SYSTEM;
    const assets = getAssets();
    return {
      app: { ...SYSTEM.app, version: build.version || null, gitHead: build.gitHead || null, pid: build.pid || null, startedAt: build.startedAt || null },
      primaryTarget: primary && { id: primary.id, label: primary.label, backend: primary.backend || 'sdcpp', status: primary.status },
      generation: { ...SYSTEM.generation, remoteHost: build.sshTarget || 'westcat', route: `ssh ${build.sshTarget || 'westcat'}`, mflux: SYSTEM.mflux },
      storage: { canonicalImages: CANONICAL_IMAGE_ROOT, rule: 'Sole durable location for generated images. Run directories keep metadata only.' },
      network: {
        localBind: `${network.localHost}:${network.localPort}`,
        localUrl: `http://${network.localHost}:${network.localPort}${network.localPath}`,
        tailscale: cache.tailscale,
      },
      launcher: { ...SYSTEM.launcher, ...cache.launcher, dockInstalled: cache.launcher.dockEntries == null ? null : cache.launcher.dockEntries > 0 },
      sdcpp: SYSTEM.sdcpp,
      modelState: {
        primaryModel: { id: SYSTEM.primaryTargetId, role: 'protected-primary', backend: 'mflux' },
        activeSecondaryModel: assets && assets.activeSecondaryModel || null,
        secondaryModelState: assets && assets.secondaryModelState || 'inactive',
        sourcePath: assets && assets.secondarySourcePath || null,
        activePath: assets && assets.secondaryActivePath || null,
        lastSwitchResult: assets && assets.secondaryLastSwitchResult || null,
      },
      capabilities: capabilitySummary(assets, getEvidence()),
      assets,
      checkedAt: new Date(cachedAt).toISOString(),
    };
  };
}

function capabilitySummary(assets, evidence) {
  return CAPABILITIES.map(cap => ({ id: cap.id, label: cap.label, backend: cap.backend, primary: !!cap.primary, ...deriveStatus(cap, assets, evidence) }));
}

module.exports = { SYSTEM, createSystemInfo, parseServeStatus, capabilitySummary, probeTailscale, probeLauncher };
