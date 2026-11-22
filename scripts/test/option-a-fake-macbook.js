'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createImageService } = require('../../operator-console/bin/macbook-image-service');

const home = '/Users/bigmac/DexDiffusion-OptionA-Test-internal';
if (os.hostname() !== 'bigmac' || os.homedir() !== home || process.env.DEX_OPTION_A_TEST !== '1') {
  throw new Error('Gate E fake publication service requires its isolated home');
}
const root = path.join(home, 'fake-macbook');
if (fs.realpathSync(home) !== home || fs.realpathSync(root) !== root) throw new Error('Unsafe fixture paths');
if (process.argv[2] === 'pull') {
  const { run } = require('../../operator-console/bin/canonical-publication-worker');
  run({ base: 'http://127.0.0.1:31347', destination: root, receipts: path.join(home, 'fake-receipts') }).then(results => {
    console.log(JSON.stringify(results));
    if (results.some(row => row.state !== 'CANONICAL_VERIFIED')) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
} else if (process.argv[2] === 'serve') {
  createImageService({ root, thumbnailDir: path.join(root, 'thumbnails') }).listen(31348, '127.0.0.1');
} else {
  throw new Error('Expected serve or pull');
}
