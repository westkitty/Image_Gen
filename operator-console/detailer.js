'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const VISION_DETAILER_BIN = path.join(__dirname, 'bin', 'vision-detailer');

const DEFAULT_PROMPTS = {
  face: 'preserve identity, pose and expression; improve facial anatomy, eyes, mouth and skin detail',
  hand: 'preserve hand pose and interaction; correct hand anatomy and finger structure',
  person: 'preserve pose and scene composition; improve anatomy and clothing detail'
};

/**
 * Checks if the native Apple Vision detailer binary is available.
 */
function isVisionDetailerAvailable() {
  return fs.existsSync(VISION_DETAILER_BIN);
}

/**
 * Executes vision-detailer to detect regions in an image.
 */
async function detectRegions(imagePath, options = {}) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Source image not found: ${imagePath}`);
  }
  if (!isVisionDetailerAvailable()) {
    throw new Error('Native Apple Vision detailer binary not found; run compilation step.');
  }

  const mode = options.mode || 'face';
  const threshold = options.threshold !== undefined ? String(options.threshold) : '0.3';
  const padding = options.padding !== undefined ? String(options.padding) : '0.2';
  const feather = options.feather !== undefined ? String(options.feather) : '8.0';
  const maxTargets = options.maxTargets !== undefined ? String(options.maxTargets) : '5';
  const targetSelection = options.targetSelection || 'largest';

  const args = [
    '--image', imagePath,
    '--mode', mode,
    '--threshold', threshold,
    '--padding', padding,
    '--feather', feather,
    '--max-targets', maxTargets,
    '--target-selection', targetSelection
  ];

  if (options.outputMask) {
    args.push('--output-mask', options.outputMask);
  }

  try {
    const { stdout, stderr } = await execFileAsync(VISION_DETAILER_BIN, args, { timeout: 30000 });
    const parsed = JSON.parse(stdout.trim());
    return parsed;
  } catch (err) {
    throw new Error(`Vision detailer failed: ${err.message}`);
  }
}

/**
 * Returns default delta-oriented inpaint prompt for a given mode.
 */
function getDefaultDetailerPrompt(mode = 'face') {
  return DEFAULT_PROMPTS[mode] || DEFAULT_PROMPTS.face;
}

module.exports = {
  VISION_DETAILER_BIN,
  isVisionDetailerAvailable,
  detectRegions,
  getDefaultDetailerPrompt,
  DEFAULT_PROMPTS
};
