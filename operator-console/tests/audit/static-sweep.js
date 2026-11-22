'use strict';
// Fast source-pattern inventory. Every result is a REVIEW CANDIDATE, never a confirmed bug.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const RULES = [
  { id: 'SILENT_CATCH', family: 'error-observability', label: 'Ignored exception', pattern: /\bcatch\s*(?:\(\s*\w+\s*\))?\s*\{\s*\}/ },
  { id: 'SYNC_SUBPROCESS', family: 'event-loop-pressure', label: 'Synchronous child process', pattern: /\b(?:spawnSync|execFileSync)\s*\(/, scope: 'server' },
  { id: 'SYNC_FILE_READ', family: 'event-loop-pressure', label: 'Synchronous disk read', pattern: /\b(?:readFileSync|readdirSync)\s*\(/, scope: 'server' },
  { id: 'RELATIVE_API', family: 'cross-origin-identity', label: 'Relative /api client request', pattern: /\bfetch\s*\(\s*['"`]\/api\//, scope: 'frontend' },
  { id: 'CLIENT_POLL_TIMER', family: 'browser-owned-work', label: 'Browser-owned polling interval', pattern: /\bsetInterval\s*\(/, scope: 'frontend' },
  { id: 'LOG_APPEND', family: 'resource-lifecycle', label: 'Potential unbounded log append', pattern: /\b(?:job|j)\.(?:stdout|stderr|passLog)\s*\+=/, scope: 'server' },
  { id: 'ERROR_ONLY_LOG', family: 'false-persistence-ack', label: 'Error only logged; caller behavior needs review', pattern: /\bconsole\.error\s*\(\s*['"`](?:Failed|Could not|Error)/i, scope: 'server' },
];
function walk(dir, role, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ['node_modules', 'dist', 'vendor', '__pycache__', 'tests'].includes(ent.name)) continue;
    const next = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(next, role, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push({ file: next, role });
  }
}
function main() {
  const candidates = [];
  const sourceFiles = [];
  for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.js')) sourceFiles.push({ file: path.join(ROOT, ent.name), role: 'server' });
  }
  walk(path.join(ROOT, 'public', 'dexdiffusion'), 'frontend', sourceFiles);
  for (const source of sourceFiles) {
    const lines = fs.readFileSync(source.file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const rule of RULES) {
        if (rule.scope && rule.scope !== source.role) continue;
        if (!rule.pattern.test(lines[i])) continue;
        candidates.push({ rule: rule.id, family: rule.family, file: path.relative(ROOT, source.file).replaceAll('\\', '/'), line: i + 1, status: 'REVIEW_CANDIDATE' });
      }
    }
  }
  const byFamily = {};
  for (const c of candidates) byFamily[c.family] = (byFamily[c.family] || 0) + 1;
  const report = {
    schema: 'dexdiffusion.audit.static-sweep.v1', at: new Date().toISOString(), git_ref: process.env.GITHUB_SHA || null,
    status: 'CANDIDATES_ONLY_NOT_VERIFIED', scope: 'operator-console root JS + public/dexdiffusion JS (excluding tests)',
    scanned_files: sourceFiles.length, candidate_count: candidates.length, by_family: byFamily,
    rules: RULES.map(({ id, family, label }) => ({ id, family, label })), candidates,
  };
  const output = process.env.DEX_AUDIT_STATIC_REPORT || path.join(os.tmpdir(), `dex-static-${process.pid}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'w', mode: 0o600 });
  process.stdout.write(`STATIC SWEEP: ${sourceFiles.length} files, ${candidates.length} review candidates (not proven bugs)\n`);
  for (const [family, n] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${family}: ${n}\n`);
  process.stdout.write(`Report: ${output}\n`);
}
try { main(); } catch (err) { console.error('STATIC SWEEP ERROR:', err); process.exitCode = 2; }
