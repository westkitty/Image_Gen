#!/usr/bin/env node
'use strict';

// canonicalize-image.js <run-dir>...
// Moves every generated image in the given run dirs into the canonical image
// root (same rules as the server, via image-store.js) and prints one line per
// image: CANONICAL_IMAGE: <run-dir>/<run-file> -> <canonical path>
// DEX_IMAGES_ROOT_OVERRIDE is honoured for tests only.

const path = require('path');
const { createImageStore } = require('../image-store');

const args = process.argv.slice(2);
const sourceMode = args[0] === '--source';
const dirs = sourceMode ? [] : args;
if (!dirs.length && !sourceMode) {
  console.error('usage: canonicalize-image.js <run-dir>...');
  process.exit(2);
}
const override = process.env.DEX_IMAGES_ROOT_OVERRIDE;
const store = createImageStore(override ? { root: override } : {});
let failed = false;
if (sourceMode) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--run-dir', '--run-file', '--seed'].includes(args[i]) || args[i + 1] === undefined) { console.error('invalid publication argument'); process.exit(2); }
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--source'] || !opts['--run-dir']) { console.error('source and run-dir required'); process.exit(2); }
  try {
    const e = store.publishFile(path.resolve(opts['--source']), { runDir: path.resolve(opts['--run-dir']), runFile: opts['--run-file'], seed: opts['--seed'] });
    console.log('CANONICAL_RECORD: ' + JSON.stringify(e));
  } catch (err) { console.error('canonicalize-image: ' + err.message); process.exit(1); }
}
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
