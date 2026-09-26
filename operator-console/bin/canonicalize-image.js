#!/usr/bin/env node
'use strict';

// canonicalize-image.js <run-dir>...
// Moves every generated image in the given run dirs into the canonical image
// root (same rules as the server, via image-store.js) and prints one line per
// image: CANONICAL_IMAGE: <run-dir>/<run-file> -> <canonical path>
// DEX_IMAGES_ROOT_OVERRIDE is honoured for tests only.

const path = require('path');
const { createImageStore } = require('../image-store');

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: canonicalize-image.js <run-dir>...');
  process.exit(2);
}
const override = process.env.DEX_IMAGES_ROOT_OVERRIDE;
const store = createImageStore(override ? { root: override } : {});
let failed = false;
for (const dir of dirs) {
  try {
    for (const e of store.finalizeRun(path.resolve(dir))) {
      console.log(`CANONICAL_IMAGE: ${path.join(dir, e.run_file)} -> ${e.image_path}`);
    }
  } catch (err) {
    failed = true;
    console.error(`canonicalize-image: ${dir}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
