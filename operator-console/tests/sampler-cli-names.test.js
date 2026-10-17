'use strict';
// Regression: SD1.5 img2img/inpaint jobs failed at gate img2img-remote-png because the UI sampler id `dpmpp2m`
// was passed verbatim to sd-cli, which only accepts `dpm++2m` (it printed its usage text and wrote no PNG).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BIN = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin');
for (const f of ['sdcpp-img2img.sh', 'sdcpp-inpaint.sh', 'sdcpp-cli-generate.sh']) {
  test(f + ' maps UI sampler ids to sd-cli names and never passes the raw id', () => {
    const s = fs.readFileSync(path.join(BIN, f), 'utf8');
    assert.ok(!/--sampling-method \$ARG_SAMPLER(?!_CLI)/.test(s), 'raw $ARG_SAMPLER reaches sd-cli');
    assert.ok(/--sampling-method \$ARG_SAMPLER_CLI/.test(s));
    for (const [ui, cli] of [['dpmpp2m', 'dpm++2m'], ['dpmpp2s_a', 'dpm++2s_a'], ['dpmpp2mv2', 'dpm++2mv2']])
      assert.ok(s.includes(`${ui})`) && s.includes(`ARG_SAMPLER_CLI="${cli}"`), ui + ' -> ' + cli);
  });
}
