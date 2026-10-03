'use strict';
// The server computes `recall` with the shared edit-core; fixtures use the same function.
const E = require('../../public/dexdiffusion/edit-core.js');
module.exports = { recall: view => E.buildRecall(view) };
