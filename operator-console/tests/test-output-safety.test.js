'use strict';
// Browser harnesses must never replace pre-existing report files (the matrix harness once overwrote untracked output/rev19 evidence).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { resolveOutputDir, createOwnedWriter, DEFAULT_BASE } = require('./browser/safe-output');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-outsafe-'));
const NAMES = ['interaction-matrix.json', 'interaction-matrix-summary.md', 'model-bootstrap-snapshot.json'];

test('explicit output directory: sentinel files with the very same names keep their exact bytes; fresh reports land beside them under new names', () => {
  const dir = tmp(); const sentinels = {};
  for (const n of NAMES) { const body = Buffer.from('HISTORICAL EVIDENCE ' + n + '\u0000ÿ', 'latin1'); fs.writeFileSync(path.join(dir, n), body); sentinels[n] = { sha: sha(body), body, mtime: fs.statSync(path.join(dir, n)).mtimeMs }; }
  const out = resolveOutputDir(dir, { label: 'matrix' }); assert.equal(out, dir);
  const w = createOwnedWriter(out); const written = {};
  for (const n of NAMES) { written[n] = w.write(n, 'fresh report for ' + n + '\n'); w.write(n, 'fresh report updated ' + n + '\n'); }
  for (const n of NAMES) {
    const p = path.join(dir, n), b = fs.readFileSync(p);
    assert.ok(b.equals(sentinels[n].body), n + ' bytes unchanged'); assert.equal(sha(b), sentinels[n].sha); assert.equal(fs.statSync(p).mtimeMs, sentinels[n].mtime, n + ' not even touched');
    assert.notEqual(written[n], p, 'the fresh report was written elsewhere'); assert.equal(path.dirname(written[n]), dir);
    assert.match(path.basename(written[n]), /\.run-\d{8}T\d{6}-\d+/);
    assert.equal(fs.readFileSync(written[n], 'utf8'), 'fresh report updated ' + n + '\n', 'later writes by the same run update its own file');
  }
});

test('an empty explicit directory gets the plain names; a second run in the same directory never reuses the first run\'s files', () => {
  const dir = tmp(); const a = createOwnedWriter(dir).write('interaction-matrix.json', 'a');
  assert.equal(path.basename(a), 'interaction-matrix.json');
  const b = createOwnedWriter(dir).write('interaction-matrix.json', 'b');
  assert.notEqual(a, b); assert.equal(fs.readFileSync(a, 'utf8'), 'a'); assert.equal(fs.readFileSync(b, 'utf8'), 'b');
  const c = createOwnedWriter(dir); const c1 = c.pathFor('x.json'); fs.writeFileSync(path.join(dir, path.basename(c1).replace(/\.run-[^.]+\.json$/, '.json')), 'z');
  assert.ok(fs.existsSync(c1));
});

test('default output is a fresh unique directory under the gitignored output/playwright scratch area, never a historical report directory', () => {
  const base = tmp(); const d1 = resolveOutputDir('', { label: 'matrix', base }), d2 = resolveOutputDir(undefined, { label: 'matrix', base });
  assert.notEqual(d1, d2); assert.equal(path.dirname(d1), base); assert.deepEqual(fs.readdirSync(d1), []);
  assert.match(path.basename(d1), /^matrix-\d{8}T\d{6}-\d+-/);
  assert.equal(DEFAULT_BASE, path.resolve(__dirname, '..', '..', 'output', 'playwright')); assert.doesNotMatch(DEFAULT_BASE, /output\/rev\d+/);
});

test('no browser harness hard-codes a historical report directory or writes a report with a bare writeFileSync into a shared output directory', () => {
  const dir = path.join(__dirname, 'browser'); const offenders = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'safe-output.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/output['"\/, ]+rev\d+/.test(src.replace(/rev19-matrix-owned/g, ''))) offenders.push(f + ': historical output path');
    if (/writeFileSync\(\s*path\.join\(\s*(out|OUT|process\.env\.DEX_[A-Z_]*OUTPUT_DIR)\b/.test(src)) offenders.push(f + ': direct writeFileSync into the output directory');
  }
  assert.deepEqual(offenders, []);
});

test('the matrix harness reads its output location only through resolveOutputDir/createOwnedWriter', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'interaction-matrix.browser.js'), 'utf8');
  assert.match(src, /resolveOutputDir\(process\.env\.DEX_MATRIX_OUTPUT_DIR/); assert.match(src, /writer\.write\('interaction-matrix\.json'/); assert.match(src, /writer\.write\('interaction-matrix-summary\.md'/);
  assert.doesNotMatch(src, /output\/rev/);
});
