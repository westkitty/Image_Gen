'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
// GUI apps and remote agents may resolve python3 to different interpreters.
// Choose the first one whose real Pillow inspection succeeds, without changing PATH.
let pillowPython = null;
function pillowCandidates() {
  const override = process.env.DEX_IMAGE_VALIDATION_PYTHON;
  return override ? [override] : ['python3', '/opt/homebrew/bin/python3.14', '/opt/homebrew/bin/python3.13'];
}
const VERIFY = `import json,sys
from PIL import Image
out=[]
for p in json.load(sys.stdin):
 try:
  with Image.open(p) as im: fmt=im.format; im.verify()
  with Image.open(p) as im: im.load(); size=list(im.size)
  out.append({'valid':True,'format':fmt,'dimensions':size})
 except Exception:
  out.append({'valid':False,'error':'image-format-invalid'})
print(json.dumps(out))`;
function inspectImageFiles(files) {
  if (!files.length) return [];
  const input = JSON.stringify(files);
  for (const executable of [...new Set([pillowPython, ...pillowCandidates()].filter(Boolean))]) {
    try {
      const result = JSON.parse(execFileSync(executable, ['-c', VERIFY], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
      if (Array.isArray(result) && result.length === files.length) {
        pillowPython = executable;
        return result;
      }
    } catch (_) {}
  }
  return files.map(() => ({ valid: false, error: 'image-validation-unavailable' }));
}
function validateImage(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile()) throw new Error('image-format-invalid: regular file required');
  const result = inspectImageFiles([file])[0];
  const expected = { '.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP', '.gif': 'GIF' }[require('path').extname(file).toLowerCase()];
  if (!result.valid || result.format !== expected) throw new Error(result.error || 'image-format-invalid: extension mismatch');
  return { sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), bytes: st.size, format: result.format, dimensions: result.dimensions };
}
module.exports = { inspectImageFiles, validateImage };
