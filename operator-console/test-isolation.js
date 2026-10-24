'use strict';
// Isolated automated-test safety mode (DEX_TEST_ISOLATION=1, set for every browser-suite server by tests/browser/helpers.js).
//
// A console started for an automated test must never act on Big Mac, a model selection, a service or real generation,
// even when a suite forgets a browser-side fixture. This module enforces that server-side, before anything launches:
//   1. child_process guard: spawn/exec*/fork of SSH-family and service-control binaries, of any sdcpp-workflow/bin script
//      (directly or through a shell/env), and of the local-engine generators is refused. The caller gets a normal-looking
//      failure (exit 97, "DEX_TEST_ISOLATION: … blocked") instead of a process.
//   2. PATH shim: the same binaries resolve to refusing stubs for every grandchild (python, bash), so nothing reaches
//      Big Mac indirectly.
//   3. Route guard: requests whose only purpose is a Big Mac, model, service or Ollama mutation get a structured
//      423 {gate:'test-isolation'} before any handler runs.
//   4. fetch guard: non-GET requests to the Ollama forward ports are refused.
// Every refusal is appended (command name and route only, never arguments or text) to DEX_TEST_VIOLATIONS_FILE. A refusal
// caused by a state-changing request is fatal: the browser harness fails the suite. Background probes are recorded only.
// Outside this mode nothing here runs: install() returns without touching any module.

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { AsyncLocalStorage } = require('async_hooks');

const ENV_FLAG = 'DEX_TEST_ISOLATION';
const VIOLATIONS_ENV = 'DEX_TEST_VIOLATIONS_FILE';
const BLOCKED_EXIT = 97;
const REMOTE_BINARIES = Object.freeze(['ssh', 'scp', 'sftp', 'rsync', 'launchctl', 'tailscale', 'ollama', 'osascript', 'open', 'pkill', 'killall', 'shutdown', 'reboot', 'blender', 'Blender']);
const WORKFLOW_BIN = path.resolve(__dirname, '..', 'sdcpp-workflow', 'bin');
const LOCAL_ENGINE = Object.freeze([path.join(__dirname, 'bin', 'local-engine-generate.js'), path.join(__dirname, 'bin', 'local-engine-control.js')]);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const SHELL_WORD = new RegExp('(^|[^A-Za-z0-9_./-])(' + REMOTE_BINARIES.join('|') + ')(?=$|[^A-Za-z0-9_-])');
// Requests that exist only to act on Big Mac, a model, a service or Ollama. Everything else is still covered by (1)-(4).
const BLOCKED_ROUTES = Object.freeze([
  ['POST', /^\/api\/models\/secondary\/activate$/],
  ['POST', /^\/api\/actions\/(server-start|server-stop|server-status|verify|check-model-stage|discover-assets|inventory-models|clean-old-runs|flux-smoke|sdxl-smoke|sdxl-turbo-smoke|seed-test|probe-image-edit|probe-upscale)$/],
  ['POST', /^\/api\/remote-workers\/reconcile$/],
  ['POST', /^\/api\/cleanup\/reconcile$/],
  ['POST', /^\/api\/3d\/open-in-blender$/],
  ['POST', /^\/api\/ollama\//],
]);
const OLLAMA_PORTS = new Set(['11434', '11435', '11436']);

const enabled = (env = process.env) => env[ENV_FLAG] === '1';
const als = new AsyncLocalStorage();
let installed = false;

// Relative paths resolve against the child's cwd (runAction spawns 'bin/…' with cwd = the workflow root).
const isUnder = (p, dir, cwd) => { const r = path.resolve(cwd || process.cwd(), p); return r === dir || r.startsWith(dir + path.sep); };

// -> null (allowed) or { command, reason } (refused). Only executable and script names are reported, never arguments.
function classify(file, args = [], cwd = null) {
  const f = String(file || '');
  const base = path.basename(f);
  if (REMOTE_BINARIES.includes(base)) return { command: base, reason: 'remote-or-service-binary' };
  if (f.includes('/') && isUnder(f, WORKFLOW_BIN, cwd)) return { command: 'sdcpp-workflow/bin/' + base, reason: 'workflow-script' };
  const list = Array.isArray(args) ? args.map(String) : [];
  if (base === 'env') {
    const i = list.findIndex(a => !a.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a));
    return i < 0 ? null : classify(list[i], list.slice(i + 1), cwd);
  }
  if (SHELLS.has(base)) {
    const ci = list.indexOf('-c');
    if (ci > -1) return classifyShell(list[ci + 1] || '');
    const script = list.find(a => !a.startsWith('-'));
    if (script && isUnder(script, WORKFLOW_BIN, cwd)) return { command: 'sdcpp-workflow/bin/' + path.basename(script), reason: 'workflow-script' };
    return null;
  }
  if (base === 'node' || f === process.execPath) {
    const script = list.find(a => !a.startsWith('-'));
    if (script && LOCAL_ENGINE.includes(path.resolve(cwd || process.cwd(), script))) return { command: 'operator-console/bin/' + path.basename(script), reason: 'local-generation' };
  }
  return null;
}
function classifyShell(cmd) {
  const s = String(cmd || '');
  const m = SHELL_WORD.exec(s);
  if (m) return { command: m[2], reason: 'remote-or-service-binary' };
  if (s.includes(WORKFLOW_BIN) || /sdcpp-workflow\/bin\//.test(s)) return { command: 'sdcpp-workflow/bin (shell)', reason: 'workflow-script' };
  if (LOCAL_ENGINE.some(p => s.includes(p) || s.includes(path.basename(p)))) return { command: 'local-engine (shell)', reason: 'local-generation' };
  return null;
}

function record(hit, kind) {
  const ctx = als.getStore();
  const v = {
    at: new Date().toISOString(), kind, command: hit.command, reason: hit.reason,
    origin: ctx ? `${ctx.method} ${ctx.path}` : 'background',
    fatal: !!(ctx && !['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)),
  };
  const file = process.env[VIOLATIONS_ENV];
  if (file) { try { fs.appendFileSync(file, JSON.stringify(v) + '\n'); } catch (_) {} }
  try { process.stderr.write('[dex-test-isolation] BLOCKED ' + JSON.stringify(v) + '\n'); } catch (_) {}
  return v;
}
const message = hit => `DEX_TEST_ISOLATION: ${hit.command} is blocked in isolated test mode (${hit.reason}); use a fixture.`;
function blockedError(hit, extra = {}) {
  const e = new Error(message(hit));
  return Object.assign(e, { code: BLOCKED_EXIT, status: BLOCKED_EXIT, signal: null, dexTestIsolation: true, killed: false, cmd: hit.command }, extra);
}
const asOutput = (s, opts) => (opts && opts.encoding && opts.encoding !== 'buffer' ? String(s) : Buffer.from(String(s)));

// A child that exits at once with the refusal on stderr, so stream-based callers see an ordinary failed process.
function fakeChild(hit, file, args) {
  const cp = new EventEmitter();
  cp.stdout = new PassThrough(); cp.stderr = new PassThrough(); cp.stdin = new PassThrough();
  cp.stdio = [cp.stdin, cp.stdout, cp.stderr];
  Object.assign(cp, { pid: undefined, exitCode: null, signalCode: null, killed: false, connected: false, spawnfile: String(file), spawnargs: [String(file)], dexTestIsolation: true });
  cp.kill = () => false; cp.ref = () => cp; cp.unref = () => cp; cp.disconnect = () => {};
  process.nextTick(() => {
    cp.stderr.end(message(hit) + '\n'); cp.stdout.end();
    cp.exitCode = BLOCKED_EXIT;
    cp.emit('exit', BLOCKED_EXIT, null);
    setImmediate(() => cp.emit('close', BLOCKED_EXIT, null));
  });
  return cp;
}

function splitExecFileArgs(rest) {
  let args = [], opts = undefined, cb = undefined;
  const a = [...rest];
  if (typeof a[a.length - 1] === 'function') cb = a.pop();
  if (Array.isArray(a[0])) args = a.shift();
  if (a[0] && typeof a[0] === 'object') opts = a.shift();
  return { args, opts, cb };
}

function shimDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-test-isolation-'));
  for (const name of REMOTE_BINARIES) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\n[ -n "$${VIOLATIONS_ENV}" ] && printf '{"kind":"subprocess","command":"${name}","reason":"remote-or-service-binary","origin":"subprocess","fatal":false}\\n' >> "$${VIOLATIONS_ENV}" 2>/dev/null\necho "DEX_TEST_ISOLATION: ${name} is blocked in isolated test mode" >&2\nexit ${BLOCKED_EXIT}\n`, { mode: 0o755 });
  }
  return dir;
}

function install({ env = process.env, childProcess = require('child_process') } = {}) {
  if (!enabled(env) || installed) return { enabled: enabled(env), installed };
  installed = true;
  const cp = childProcess;
  const orig = { spawn: cp.spawn, spawnSync: cp.spawnSync, execFile: cp.execFile, execFileSync: cp.execFileSync, exec: cp.exec, execSync: cp.execSync, fork: cp.fork };

  cp.spawn = function (file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = Array.isArray(rest[0]) ? rest[1] : rest[0];
    const hit = opts && opts.shell ? classifyShell([file, ...args].join(' ')) : classify(file, args, opts && opts.cwd);
    if (hit) { record(hit, 'spawn'); return fakeChild(hit, file, args); }
    return orig.spawn.call(this, file, ...rest);
  };
  cp.fork = function (modulePath, ...rest) {
    const fopts = rest.find(x => x && typeof x === 'object' && !Array.isArray(x));
    const hit = classify(process.execPath, [String(modulePath)], fopts && fopts.cwd);
    if (hit) { record(hit, 'fork'); return fakeChild(hit, modulePath, []); }
    return orig.fork.call(this, modulePath, ...rest);
  };
  cp.spawnSync = function (file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = Array.isArray(rest[0]) ? rest[1] : rest[0];
    const hit = opts && opts.shell ? classifyShell([file, ...args].join(' ')) : classify(file, args, opts && opts.cwd);
    if (hit) {
      record(hit, 'spawnSync');
      const out = asOutput('', opts), err = asOutput(message(hit) + '\n', opts);
      return { pid: 0, status: BLOCKED_EXIT, signal: null, stdout: out, stderr: err, output: [null, out, err], dexTestIsolation: true };
    }
    return orig.spawnSync.call(this, file, ...rest);
  };
  cp.execFile = function (file, ...rest) {
    const { args, opts, cb } = splitExecFileArgs(rest);
    const hit = opts && opts.shell ? classifyShell([file, ...args].join(' ')) : classify(file, args, opts && opts.cwd);
    if (hit) {
      record(hit, 'execFile');
      const stdout = asOutput('', opts), stderr = asOutput(message(hit) + '\n', opts);
      if (cb) process.nextTick(() => cb(blockedError(hit, { stdout, stderr }), stdout, stderr));
      return fakeChild(hit, file, args);
    }
    return orig.execFile.call(this, file, ...rest);
  };
  cp.execFile[util.promisify.custom] = (file, ...rest) => new Promise((resolve, reject) => {
    cp.execFile(file, ...rest, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
  cp.execFileSync = function (file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0] : [];
    const opts = Array.isArray(rest[0]) ? rest[1] : rest[0];
    const hit = opts && opts.shell ? classifyShell([file, ...args].join(' ')) : classify(file, args, opts && opts.cwd);
    if (hit) { record(hit, 'execFileSync'); throw blockedError(hit, { stdout: asOutput('', opts), stderr: asOutput(message(hit) + '\n', opts) }); }
    return orig.execFileSync.call(this, file, ...rest);
  };
  cp.exec = function (command, ...rest) {
    const hit = classifyShell(command);
    if (hit) {
      record(hit, 'exec');
      const cb = typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : null;
      const opts = rest[0] && typeof rest[0] === 'object' ? rest[0] : undefined;
      const stdout = asOutput('', opts), stderr = asOutput(message(hit) + '\n', opts);
      if (cb) process.nextTick(() => cb(blockedError(hit, { stdout, stderr }), stdout, stderr));
      return fakeChild(hit, '/bin/sh', []);
    }
    return orig.exec.call(this, command, ...rest);
  };
  cp.exec[util.promisify.custom] = (command, ...rest) => new Promise((resolve, reject) => {
    cp.exec(command, ...rest, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
  cp.execSync = function (command, ...rest) {
    const hit = classifyShell(command);
    if (hit) { record(hit, 'execSync'); throw blockedError(hit, { stdout: asOutput('', rest[0]), stderr: asOutput(message(hit) + '\n', rest[0]) }); }
    return orig.execSync.call(this, command, ...rest);
  };

  // Grandchildren (bash, python) find refusing stubs first on PATH.
  const shim = shimDir();
  env.PATH = shim + path.delimiter + (env.PATH || '');
  env.DEX_LOCAL_ENGINE_BRIDGE = '0';

  if (typeof globalThis.fetch === 'function') {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function (input, init = {}) {
      let url, method;
      try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); } catch (_) { return origFetch(input, init); }
      if (!['GET', 'HEAD'].includes(method) && OLLAMA_PORTS.has(url.port)) {
        record({ command: 'ollama-http ' + url.pathname, reason: 'ollama-mutation' }, 'fetch');
        return Promise.resolve(new Response(JSON.stringify({ error: 'Blocked in isolated test mode', gate: 'test-isolation' }), { status: 423, headers: { 'Content-Type': 'application/json' } }));
      }
      return origFetch(input, init);
    };
  }
  return { enabled: true, installed: true, shim };
}

// Express middleware: request context for every refusal, and the route guard.
function middleware(req, res, next) {
  als.run({ method: req.method, path: req.path }, () => {
    const hit = BLOCKED_ROUTES.find(([m, re]) => m === req.method && re.test(req.path));
    if (hit) {
      record({ command: `${req.method} ${req.path}`, reason: 'blocked-route' }, 'route');
      return res.status(423).json({ error: 'Blocked in isolated test mode: this request would act on Big Mac, a model selection, a service or Ollama. Use a browser fixture.', gate: 'test-isolation', route: `${req.method} ${req.path}` });
    }
    next();
  });
}

// Simulated Big Mac asset probe for isolated mode (the real probe is an SSH command and is refused). Deterministic and
// labelled as a fixture: image targets and every worker that has an execution bridge read as installed, so suites can
// exercise their UI; a worker without a bridge (e.g. LTX Video) reads as missing, so nothing unrunnable is claimed ready.
// It never reports a real host or a real secondary-slot state.
function simulatedAssetProbe({ targetModels = {}, dormantKeys = [], unbridgedWorkerIds = [] } = {}) {
  const unbridged = new Set(unbridgedWorkerIds);
  return {
    reachable: true, simulated: 'test-isolation', identity: 'fixture@isolated-test',
    mfluxRuntime: true, mfluxModel: true, sdCli: true, sd15Model: true, photonicModel: true, sdxlBaseModel: true, sdxlTurboModel: true, esrganModel: true,
    wc2tb: true, wc2tbReadable: true,
    dormant: Object.fromEntries(dormantKeys.map(k => [k, !unbridged.has(String(k).split(':')[0])])),
    models: Object.fromEntries([...new Set(Object.values(targetModels))].map(p => [p, true])),
    secondaryModelState: 'inactive', activeSecondaryModel: null, secondarySourcePath: null, secondaryActivePath: null, secondaryModelIdentity: null, secondaryLastSwitchResult: null,
  };
}

function readViolations(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return { kind: 'unparsable', fatal: true }; } });
}

module.exports = { install, middleware, enabled, classify, classifyShell, readViolations, simulatedAssetProbe, BLOCKED_ROUTES, REMOTE_BINARIES, BLOCKED_EXIT, ENV_FLAG, VIOLATIONS_ENV, _als: als };
