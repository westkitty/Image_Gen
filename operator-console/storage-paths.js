'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_IMAGE_ROOT = '/Users/andrew/images_made';

function resolved(value) { return path.resolve(String(value)); }

function resolveStoragePaths(env = process.env, legacyWorkflowRoot = path.resolve(__dirname, '../sdcpp-workflow')) {
  const dataRoot = env.DEX_DATA_ROOT ? resolved(env.DEX_DATA_ROOT) : null;
  // This root owns executable workflow scripts/configuration. DEX_DATA_ROOT
  // relocates their outputs, never the code that the server must execute.
  const workflowRoot = env.DEX_WORKFLOW_ROOT ? resolved(env.DEX_WORKFLOW_ROOT) : path.resolve(legacyWorkflowRoot);
  const runsDir = env.DEX_RUNS_DIR ? resolved(env.DEX_RUNS_DIR) : path.join(dataRoot || workflowRoot, 'runs');
  const stateDir = env.DEX_STATE_DIR ? resolved(env.DEX_STATE_DIR) : path.join(dataRoot || workflowRoot, 'state');
  const imageRoot = env.DEX_IMAGES_ROOT_OVERRIDE
    ? resolved(env.DEX_IMAGES_ROOT_OVERRIDE)
    : dataRoot ? path.join(dataRoot, 'images') : LEGACY_IMAGE_ROOT;
  let mediaRoots;
  if (env.DEX_MEDIA_ROOT_OVERRIDE) {
    const mediaRoot = resolved(env.DEX_MEDIA_ROOT_OVERRIDE);
    mediaRoots = { image: path.join(mediaRoot, 'image'), voice: path.join(mediaRoot, 'voice'), music: path.join(mediaRoot, 'music'), video: path.join(mediaRoot, 'video'), world: path.join(mediaRoot, 'world') };
  } else if (dataRoot) {
    mediaRoots = {
      image: imageRoot,
      voice: path.join(dataRoot, 'audio', 'voice'),
      music: path.join(dataRoot, 'audio', 'music'),
      video: path.join(dataRoot, 'video'),
      world: path.join(dataRoot, 'worlds'),
    };
  }
  const scratchRoot = env.DEX_SCRATCH_ROOT
    ? resolved(env.DEX_SCRATCH_ROOT)
    : dataRoot ? path.join(dataRoot, 'scratch') : path.join(workflowRoot, 'mask-uploads');
  const logsDir = env.DEX_LOGS_DIR ? resolved(env.DEX_LOGS_DIR) : path.join(dataRoot || workflowRoot, 'logs');
  const maskUploadsDir = env.DEX_MASK_UPLOADS_DIR
    ? resolved(env.DEX_MASK_UPLOADS_DIR)
    : dataRoot || env.DEX_SCRATCH_ROOT ? path.join(scratchRoot, 'mask-uploads') : scratchRoot;

  return { dataRoot, workflowRoot, runsDir, stateDir, imageRoot, mediaRoots, scratchRoot, maskUploadsDir, logsDir,
    dataRootMount: env.DEX_DATA_ROOT_MOUNT ? resolved(env.DEX_DATA_ROOT_MOUNT) : null };
}

// Optional mount binding prevents a configured external root from being
// silently created on the system volume when its named volume is absent.
function assertDataRootMount(paths, filesystem = fs) {
  if (!paths || !paths.dataRootMount) return;
  const mount = paths.dataRootMount;
  const relative = path.relative(mount, paths.dataRoot);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`DEX_DATA_ROOT must be inside DEX_DATA_ROOT_MOUNT (${mount})`);
  }
  const stat = typeof filesystem === 'function' ? filesystem : filesystem.statSync.bind(filesystem);
  const exists = typeof filesystem === 'function' ? () => true : filesystem.existsSync.bind(filesystem);
  const realpath = typeof filesystem === 'function' ? value => path.resolve(value) : filesystem.realpathSync.bind(filesystem);
  let mountStat;
  let parentStat;
  try {
    mountStat = stat(mount);
    parentStat = stat(path.dirname(mount));
  } catch (error) {
    throw new Error(`DEX_DATA_ROOT_MOUNT is unavailable (${mount}): ${error.message}`);
  }
  if (mountStat.dev === parentStat.dev) throw new Error(`DEX_DATA_ROOT_MOUNT is not a mounted volume (${mount})`);
  try {
    const mountReal = realpath(mount);
    let ancestor = paths.dataRoot;
    while (!exists(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error('no existing ancestor');
      ancestor = parent;
    }
    const ancestorReal = realpath(ancestor);
    const inside = ancestorReal === mountReal || ancestorReal.startsWith(mountReal.endsWith(path.sep) ? mountReal : mountReal + path.sep);
    if (!inside) throw new Error('resolved outside mount');
  } catch (error) {
    throw new Error(`DEX_DATA_ROOT does not resolve inside DEX_DATA_ROOT_MOUNT (${mount}): ${error.message}`);
  }
}

function childStorageEnvironment(paths, base = process.env) {
  const env = { ...base };
  // With no new root or explicit override, leave workflow scripts' historic
  // config-file resolution untouched. Once configured, bind every writer to
  // the same server-selected roots.
  if (paths.dataRoot || base.DEX_IMAGES_ROOT_OVERRIDE) env.DEX_IMAGES_ROOT_OVERRIDE = paths.imageRoot;
  if (paths.dataRoot || base.DEX_RUNS_DIR) env.DEX_RUNS_DIR = paths.runsDir;
  if (paths.dataRoot || base.DEX_STATE_DIR) env.DEX_STATE_DIR = paths.stateDir;
  if (paths.dataRoot || base.DEX_LOGS_DIR) env.DEX_LOGS_DIR = paths.logsDir;
  if (paths.dataRoot || base.DEX_MASK_UPLOADS_DIR) env.DEX_MASK_UPLOADS_DIR = paths.maskUploadsDir;
  if (!base.TMPDIR && (paths.dataRoot || base.DEX_SCRATCH_ROOT)) env.TMPDIR = paths.scratchRoot;
  return env;
}

module.exports = { LEGACY_IMAGE_ROOT, resolveStoragePaths, assertDataRootMount, childStorageEnvironment };
