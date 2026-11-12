'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { probeInternalFallbackAssets } = require('../capabilities');
const root = path.resolve(__dirname, '../..');

test('internal fallback probe does not touch external storage or follow symlinks', () => {
  const home = '/Users/bigmac';
  const checked = [];
  const files = {
    [home + '/Library/Caches/DexDiffusion/mflux/venv/bin/mflux-generate-flux2']: 11,
    [home + '/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit/transformer/model.safetensors.index.json']: 11,
    [home + '/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors']: 400,
    [home + '/sdcpp-staging/models/flux1-schnell-fp8.safetensors']: 600,
    [home + '/stable-diffusion.cpp/build/bin/sd-cli']: 11
  };
  const fakeFs = { lstatSync(p) { checked.push(p); if (p.startsWith('/Volumes/')) throw new Error('EXTERNAL ACCESSED');
    if (p.endsWith('bad-link.safetensors')) return {isFile:()=>false,size:20};
    if (!(p in files)) throw new Error('missing');
    return {isFile:()=>true,size:files[p]}; } };
  const assets = probeInternalFallbackAssets({
    home, filesystem: fakeFs, targetModels: {
      'flux2-klein-4b':'/Users/bigmac/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit/transformer/model.safetensors.index.json',
      'sdxl-photonic':'$HOME/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors',
      'flux-fp8':'$HOME/sdcpp-staging/models/flux1-schnell-fp8.safetensors',
      'sd15':'/Volumes/wc2tb/ImageGen/checkpoints/sd15/model.safetensors'
    }
  });
  assert.equal(assets.storageMode, 'internal-fallback');
  assert.equal(assets.wc2tbReadable, false);
  assert.equal(assets.mfluxRuntime, true);
  assert.equal(assets.mfluxModel, true);
  assert.equal(assets.sdCli, true);
  assert.equal(assets.photonicModel, true);
  assert.equal(assets.models['/Volumes/wc2tb/ImageGen/checkpoints/sd15/model.safetensors'], false);
  assert.ok(checked.every(x => x.startsWith('/Users/bigmac/')));
});

test('fallback is explicit, isolated and never claims the full external model library', () => {
  const runner = fs.readFileSync(path.join(root,'scripts/run-backend-service.sh'),'utf8');
  const server = fs.readFileSync(path.join(root,'operator-console/server.js'),'utf8');
  const html = fs.readFileSync(path.join(root,'operator-console/public/dexdiffusion/index.html'),'utf8');
  assert.match(runner,/DEX_STORAGE_MODE=internal-fallback/);
  assert.match(runner,/gtimeout -k 1s 3s \/bin\/ls -a "\$DATA_ROOT\/runs"/);
  assert.match(runner,/\[ ! -e "\$1" \] \|\| \/usr\/bin\/head -c 1/);
  assert.match(runner,/FALLBACK_ROOT="\/Users\/bigmac\/DexDiffusion-InternalFallback"/);
  assert.match(runner,/unset DEX_DATA_ROOT_MOUNT DEX_RUNS_DIR DEX_STATE_DIR/);
  assert.match(runner,/DEX_LOCAL_ENGINE_BRIDGE=0/);
  assert.match(server,/FALLBACK_TARGET_IDS = new Set\(\['flux2-klein-4b', 'sdxl-photonic', 'flux-fp8'\]\)/);
  assert.match(server,/IS_INTERNAL_FALLBACK.*FALLBACK_TARGET_IDS\.has/);
  assert.match(server,/IS_INTERNAL_FALLBACK \? cards\.filter\(card => FALLBACK_TARGET_IDS\.has\(card\.id\)\)/);
  assert.match(html,/data-storage-fallback/);
  assert.match(html,/External jobs and files are not loaded or merged/);
});

test('internal fallback neither advertises MacBook publication nor starts MacBook image sweep', () => {
  const server = fs.readFileSync(path.join(root, 'operator-console/server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'operator-console/public/dexdiffusion/component.js'), 'utf8');
  assert.match(server, /const crossHostPublicationEnabled = !IS_INTERNAL_FALLBACK &&/);
  assert.match(server, /const macbookImages = !IS_INTERNAL_FALLBACK && /);
  assert.match(server, /publication: 'paused-internal-fallback'/);
  assert.match(server, /canonicalImages: STORAGE_PATHS\.imageRoot/);
  assert.match(server, /Cross-host publication and automatic deletion are paused/);
  assert.match(server, /device: 'Big Mac internal'/);
  assert.match(ui, /si\.storageMode === 'internal-fallback' \? 'PAUSED/);
  assert.match(ui, /loc\.device === 'Big Mac internal'/);
});

test('every image publisher suppresses cross-host outbox records in internal fallback', () => {
  const canonical = fs.readFileSync(path.join(root, 'operator-console/bin/canonicalize-image.js'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'operator-console/bin/local-engine-generate.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'operator-console/server.js'), 'utf8');
  assert.match(canonical, /process\.env\.DEX_STORAGE_MODE !== 'internal-fallback' && !!paths\.dataRoot/);
  assert.match(engine, /env\.DEX_STORAGE_MODE !== 'internal-fallback' && !!paths\.dataRoot/);
  assert.match(server, /pending: crossHostPublicationEnabled \? unacknowledged : 0/);
  assert.match(server, /suspended: crossHostPublicationEnabled \? 0 : unacknowledged/);
});
