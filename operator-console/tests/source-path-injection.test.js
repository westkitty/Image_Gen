'use strict';
// Security regression (2026-10-16): img2img / inpaint / upscale-esrgan read `body.__initPath` as the worker's source file.
// It is an internal hand-off from resolveImageSource; a client-supplied value must never survive (it bypassed the
// runs-directory traversal checks and would have sent any local file to Big Mac).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function load(name, end, context) {
  const start = source.indexOf('function ' + name + '(');
  return vm.runInNewContext(source.slice(start, source.indexOf(end, start)) + '\n' + name, context);
}

test('resolveImageSource drops a client-supplied __initPath', () => {
  const resolve = load('resolveImageSource', '\nfunction ', { imageStore: { resolveImage: () => null, resolveRunImage: () => null }, staging: { get: () => null }, imageSourceMap: () => new Map(), pngSize: () => null, path, RUNS_DIR: '/nonexistent/runs', fs: { existsSync: () => false } });
  const body = { __initPath: '/etc/hosts', run_id: '20261016-000000-x', init_image_file: 'a.png' };
  resolve(body);
  assert.equal('__initPath' in body, false);
});

test('every route that honours __initPath resolves the source first (which clears any client value)', () => {
  for (const [route, marker] of [["app.post('/api/actions/img2img'", 'body.__initPath'], ['function handleInpaint(', 'body.__initPath'], ["app.post('/api/actions/upscale-esrgan'", 'body.__initPath']]) {
    const start = source.indexOf(route); assert.ok(start > 0, route);
    const use = source.indexOf('if (' + marker + ')', start), resolveAt = source.indexOf('resolveImageSource(body)', start);
    assert.ok(resolveAt > 0 && resolveAt < use, route + ': resolveImageSource must run before __initPath is read');
  }
});
