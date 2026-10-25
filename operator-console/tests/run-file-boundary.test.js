'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function route(root) {
  let handler;
  const start = source.indexOf("app.get('/api/run-file',");
  vm.runInNewContext(source.slice(start, source.indexOf('// Canonical generated images.', start)), {
    app: { get: (url, fn) => { handler = fn; } }, fs, path, RUNS_DIR: root,
    safeRunId: () => true, imageStore: { resolveRunImage: () => null },
  });
  return query => {
    const result = { code: 200 };
    const res = { status: code => { result.code = code; return res; }, send: body => { result.body = body; },
      sendFile: (file, opts) => { result.file = opts ? path.resolve(opts.root, file) : file; }, redirect: (code, url) => { result.code = code; result.url = url; } };
    handler({ query: { path: query } }, res);
    return result;
  };
}
test('run-file refuses file and directory symlink escapes and malformed query types', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-run-boundary-'));
  try {
    const root = path.join(tmp, 'runs'); fs.mkdirSync(root);
    const outside = path.join(tmp, 'synthetic-private.txt'); fs.writeFileSync(outside, 'synthetic canary');
    fs.symlinkSync(outside, path.join(root, 'escape.txt'));
    fs.symlinkSync(tmp, path.join(root, 'escape-dir'));
    fs.writeFileSync(path.join(root, 'owned.txt'), 'owned');
    const get = route(root);
    assert.equal(get('escape.txt').code, 403);
    assert.equal(get('escape-dir/synthetic-private.txt').code, 403);
    assert.equal(get('../synthetic-private.txt').code, 403);
    assert.equal(get(['owned.txt']).code, 400);
    assert.equal(get({ file: 'owned.txt' }).code, 400);
    assert.equal(get('owned.txt').file, fs.realpathSync(path.join(root, 'owned.txt')));
    assert.equal(get('missing.txt').code, 404);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('run-file judges the allowlist on the resolved target: an allowed-name link cannot serve a non-allowlisted file inside runs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-run-ext-'));
  try {
    const root = path.join(tmp, 'runs'); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'secret.env'), 'SYNTHETIC=1');
    fs.writeFileSync(path.join(root, 'real.png'), 'png');
    fs.symlinkSync(path.join(root, 'secret.env'), path.join(root, 'ok.png'));
    fs.symlinkSync(path.join(root, 'real.png'), path.join(root, 'alias.png'));
    const get = route(root);
    assert.equal(get('ok.png').code, 403, 'link to a .env target is refused');
    assert.equal(get('alias.png').file, fs.realpathSync(path.join(root, 'real.png')), 'link to an allowlisted in-root target still serves');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
