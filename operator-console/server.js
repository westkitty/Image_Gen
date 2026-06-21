const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 31337;
const HOST = '127.0.0.1';

const WORKFLOW_ROOT = path.resolve(__dirname, '../sdcpp-workflow');
const RUNS_DIR = path.join(WORKFLOW_ROOT, 'runs');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- VALIDATION CONSTANTS ----
const ALLOWED_PRESETS = new Set(["smoke", "thumbnail", "fast", "balanced", "quality", "quality_plus"]);
const ALLOWED_MODES = new Set(["cli", "server"]);
const ALLOWED_APIS = new Set(["openai", "sdapi", "native"]);
const ALLOWED_SEED_MODES = new Set(["same", "increment", "random"]);

function validatePrompt(prompt) {
  if (typeof prompt !== 'string') return false;
  return prompt.length > 0 && prompt.length <= 4000;
}

function validateNegativePrompt(neg) {
  if (neg === undefined || neg === null || neg === '') return true;
  if (typeof neg !== 'string') return false;
  return neg.length <= 2000;
}

// In-memory job store
const jobs = {};

function createJob(commandAction) {
  const jobId = crypto.randomUUID();
  jobs[jobId] = {
    id: jobId,
    commandAction: commandAction, // verify, server-status, cli-generate, server-generate, batch-generate, etc.
    status: 'queued', // queued, running, PASS, PARTIAL, FAIL
    stdout: '',
    stderr: '',
    createdAt: Date.now(),
    completedAt: null,
    exitCode: null,
    firstFailedGate: null,
    runId: null
  };
  return jobId;
}

function runAction(jobId, scriptPath, args) {
  jobs[jobId].status = 'running';
  
  const process = spawn(scriptPath, args, {
    cwd: WORKFLOW_ROOT,
    shell: false
  });

  process.stdout.on('data', (data) => {
    jobs[jobId].stdout += data.toString();
  });

  process.stderr.on('data', (data) => {
    jobs[jobId].stderr += data.toString();
  });

  process.on('close', (code) => {
    jobs[jobId].exitCode = code;
    jobs[jobId].completedAt = Date.now();
    
    const out = jobs[jobId].stdout;
    
    if (out.includes('==== PASS ====')) {
      jobs[jobId].status = 'PASS';
    } else if (out.includes('status: PARTIAL') || out.includes('==== PARTIAL ====')) {
      jobs[jobId].status = 'PARTIAL';
    } else if (out.includes('==== FAIL ====')) {
      jobs[jobId].status = 'FAIL';
    } else {
      jobs[jobId].status = code === 0 ? 'PASS' : 'FAIL';
    }

    // Try to extract failed gate
    const failMatch = out.match(/FAIL:\s*(.+?)(?=\n|$)/);
    if (failMatch) {
      jobs[jobId].firstFailedGate = failMatch[1].trim();
    } else if (out.includes('Unknown argument')) {
      jobs[jobId].firstFailedGate = 'args';
    }

    // Try to extract run ID
    const runIdMatch = out.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/);
    if (runIdMatch) {
      jobs[jobId].runId = runIdMatch[1];
    }
  });
}

// ---- ACTIONS ----

app.post('/api/actions/verify', (req, res) => {
  const jobId = createJob('verify');
  runAction(jobId, 'bin/sdcpp-verify.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-status', (req, res) => {
  const jobId = createJob('server-status');
  runAction(jobId, 'bin/sdcpp-server-status.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-single', (req, res) => {
  const { prompt, negative_prompt, seed, mode, preset } = req.body;
  if (!validatePrompt(prompt)) return res.status(400).json({ error: "Invalid prompt" });
  if (!validateNegativePrompt(negative_prompt)) return res.status(400).json({ error: "Invalid negative prompt" });
  if (preset && !ALLOWED_PRESETS.has(preset)) return res.status(400).json({ error: "Invalid preset" });
  
  const m = mode || 'cli';
  if (!ALLOWED_MODES.has(m)) return res.status(400).json({ error: "Invalid mode" });

  let script = '';
  let args = [];

  if (m === 'cli') {
    if (preset === 'fast' || preset === 'quality') {
      script = preset === 'fast' ? 'bin/sdcpp-run-fast.sh' : 'bin/sdcpp-run-quality.sh';
      args.push('--mode', 'cli', '--prompt', prompt);
      if (negative_prompt) args.push('--negative', negative_prompt);
      if (seed && /^(random|\d+)$/.test(String(seed))) args.push('--seed', String(seed));
    } else {
      script = 'bin/sdcpp-cli-generate.sh';
      args.push('--prompt', prompt);
      if (preset) args.push('--preset', preset);
      if (negative_prompt) args.push('--negative', negative_prompt);
      if (seed && /^(random|\d+)$/.test(String(seed))) args.push('--seed', String(seed));
    }
  } else {
    // server mode
    if (preset === 'fast' || preset === 'quality') {
      script = preset === 'fast' ? 'bin/sdcpp-run-fast.sh' : 'bin/sdcpp-run-quality.sh';
      args.push('--mode', 'server', '--prompt', prompt);
      if (negative_prompt) args.push('--negative', negative_prompt);
      if (seed && /^(random|\d+)$/.test(String(seed))) args.push('--seed', String(seed));
    } else {
      script = 'bin/sdcpp-server-generate.sh';
      args.push('--prompt', prompt);
      if (preset) args.push('--preset', preset);
      if (negative_prompt) args.push('--negative', negative_prompt);
      if (seed && /^(random|\d+)$/.test(String(seed))) args.push('--seed', String(seed));
    }
  }

  const jobType = m === 'cli' ? 'cli-generate' : 'server-generate';
  const jobId = createJob(jobType);
  runAction(jobId, script, args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-batch', (req, res) => {
  const { prompt, negative_prompt, count, preset, seedMode, seedStart, mode, api } = req.body;
  if (!validatePrompt(prompt)) return res.status(400).json({ error: "Invalid prompt" });
  if (!validateNegativePrompt(negative_prompt)) return res.status(400).json({ error: "Invalid negative prompt" });

  const args = ['--prompt', prompt];
  if (negative_prompt) args.push('--negative', negative_prompt);

  const m = mode || 'cli';
  if (!ALLOWED_MODES.has(m)) return res.status(400).json({ error: "Invalid mode" });
  args.push('--mode', m);

  if (count) {
    const c = parseInt(count);
    if (isNaN(c) || c < 1 || c > 12) return res.status(400).json({ error: "Invalid count (1-12)" });
    args.push('--count', String(c));
  }

  if (preset) {
    if (!ALLOWED_PRESETS.has(preset)) return res.status(400).json({ error: "Invalid preset" });
    args.push('--preset', preset);
  }

  if (seedMode) {
    if (!ALLOWED_SEED_MODES.has(seedMode)) return res.status(400).json({ error: "Invalid seed mode" });
    args.push('--seed-mode', seedMode);
  }

  if (seedStart) {
    if (!/^\d+$/.test(String(seedStart))) return res.status(400).json({ error: "Invalid seed start" });
    args.push('--seed-start', String(seedStart));
  }

  if (api && m === 'server') {
    if (!ALLOWED_APIS.has(api)) return res.status(400).json({ error: "Invalid API" });
    args.push('--api', api);
  }

  const jobId = createJob('batch-generate');
  runAction(jobId, 'bin/sdcpp-batch-generate.sh', args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-start', (req, res) => {
  const jobId = createJob('server-start');
  runAction(jobId, 'bin/sdcpp-server-start.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-stop', (req, res) => {
  const jobId = createJob('server-stop');
  runAction(jobId, 'bin/sdcpp-server-stop.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-generate', (req, res) => {
  const { prompt, negative_prompt, preset, api, seed } = req.body;
  if (!validatePrompt(prompt)) return res.status(400).json({ error: "Invalid prompt" });
  if (!validateNegativePrompt(negative_prompt)) return res.status(400).json({ error: "Invalid negative prompt" });

  const args = ['--prompt', prompt];
  if (negative_prompt) args.push('--negative', negative_prompt);

  if (preset) {
    if (!ALLOWED_PRESETS.has(preset)) return res.status(400).json({ error: "Invalid preset" });
    args.push('--preset', preset);
  }

  if (api) {
    if (!ALLOWED_APIS.has(api)) return res.status(400).json({ error: "Invalid API" });
    args.push('--api', api);
  }

  if (seed && /^(random|\d+)$/.test(String(seed))) {
    args.push('--seed', String(seed));
  }

  const jobId = createJob('server-generate');
  runAction(jobId, 'bin/sdcpp-server-generate.sh', args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/seed-test', (req, res) => {
  const jobId = createJob('seed-test');
  runAction(jobId, 'bin/sdcpp-seed-test.sh', ['--preset', 'smoke', '--seed', '424242', '--mode', 'cli']);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/clean-old-runs', (req, res) => {
  const { days } = req.body;
  const d = parseInt(days);
  if (isNaN(d) || d < 1) return res.status(400).json({ error: "Invalid days (must be >= 1)" });

  const jobId = createJob('clean-old-runs');
  runAction(jobId, 'bin/sdcpp-clean-old-runs.sh', ['--delete', '--older-than-days', String(d)]);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// ---- JOBS ----

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  res.json({ 
    id: job.id, 
    commandAction: job.commandAction,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    firstFailedGate: job.firstFailedGate,
    runId: job.runId
  });
});

app.get('/api/jobs/:jobId/log', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, stdout: job.stdout, stderr: job.stderr });
});


// ---- RUNS & DISCOVERY ----

function parseUiRunCard(cardPath) {
  let metadata = {};
  if (fs.existsSync(cardPath)) {
    const content = fs.readFileSync(cardPath, 'utf8');
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontMatterMatch) {
      const lines = frontMatterMatch[1].split('\n');
      lines.forEach(line => {
        const splitIdx = line.indexOf(':');
        if (splitIdx > -1) {
          const key = line.slice(0, splitIdx).trim();
          let value = line.slice(splitIdx + 1).trim();
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }
          metadata[key] = value;
        }
      });
    }
  }
  return metadata;
}

app.get('/api/runs', (req, res) => {
  if (!fs.existsSync(RUNS_DIR)) return res.json({ runs: [] });
  
  const dirs = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort((a, b) => b.localeCompare(a)); // Newest first based on timestamp naming

  const runs = dirs.map(dirName => {
    const runPath = path.join(RUNS_DIR, dirName);
    const cardPath = path.join(runPath, 'ui-run-card.md');
    let metadata = { id: dirName, type: 'unknown', status: 'UNKNOWN', title: dirName, prompt: null, primaryImage: null };
    
    // Infer basic info from dir name
    if (dirName.includes('-verify')) {
      metadata.type = 'verify';
      metadata.title = 'Verify Backend';
    } else if (dirName.includes('-cli')) {
      metadata.type = 'cli-generate';
      metadata.title = 'CLI Generate';
    } else if (dirName.includes('-batch')) {
      metadata.type = 'batch-generate';
      metadata.title = 'Batch Generate';
    } else if (dirName.includes('-server-gen')) {
      metadata.type = 'server-generate';
      metadata.title = 'Server Generate';
    } else if (dirName.includes('-server-start')) {
      metadata.type = 'server-start';
      metadata.title = 'Server Start';
    } else if (dirName.includes('-server-stop')) {
      metadata.type = 'server-stop';
      metadata.title = 'Server Stop';
    } else if (dirName.includes('-seedtest')) {
      metadata.type = 'seed-test';
      metadata.title = 'Seed Test';
    } else if (dirName.includes('-benchmark')) {
      metadata.type = 'benchmark';
      metadata.title = 'Benchmark';
    }

    if (fs.existsSync(cardPath)) {
      const parsed = parseUiRunCard(cardPath);
      metadata.status = parsed.status || metadata.status;
      metadata.prompt = parsed.prompt || null;
      if (parsed.run_type) metadata.type = parsed.run_type;
      metadata.primaryImage = parsed.primary_image || null;
    }

    return metadata;
  });

  res.json({ runs });
});

app.get('/api/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) return res.status(400).json({ error: "Invalid runId" });

  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: "Run not found" });

  const cardPath = path.join(runPath, 'ui-run-card.md');
  const metadata = parseUiRunCard(cardPath);
  metadata.id = runId;

  // Manifest
  const manifestPath = path.join(runPath, metadata.manifest_json || 'batch-manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.error("Failed to parse manifest", e);
    }
  }

  // Reports
  const reports = [];
  const candidateReports = ['cli-run-report.md', 'batch-report.md', 'verify-report.md', 'server-generate-report.md', 'metrics.tsv'];
  candidateReports.forEach(filename => {
    if (fs.existsSync(path.join(runPath, filename))) {
      reports.push(filename);
    }
  });

  res.json({ metadata, manifest, reports });
});

app.get('/api/runs/:runId/files', (req, res) => {
  const runId = req.params.runId;
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) return res.status(400).json({ error: "Invalid runId" });

  const runPath = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runPath)) return res.status(404).json({ error: "Run not found" });

  let files = [];
  try {
    const allItems = fs.readdirSync(runPath, { recursive: true, withFileTypes: true });
    for (const item of allItems) {
      if (item.isFile()) {
        const fullPath = path.join(item.path, item.name);
        const relPath = path.relative(runPath, fullPath);
        files.push(relPath);
      }
    }
  } catch (e) {
    console.error(e);
  }

  res.json({ files });
});

// ---- SERVER STATUS ----

app.get('/api/server-status', (req, res) => {
  const jobId = createJob('server-status');
  runAction(jobId, 'bin/sdcpp-server-status.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

// ---- SAFE STATIC FILE SERVING ----

app.get('/api/run-file', (req, res) => {
  const queryPath = req.query.path;
  if (!queryPath) return res.status(400).send('Missing path');

  const fullPath = path.resolve(RUNS_DIR, queryPath);
  const relPath = path.relative(RUNS_DIR, fullPath);

  // Hard boundary check
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
    return res.status(403).send('Forbidden: Path traversal not allowed');
  }

  const allowedExts = ['.png', '.md', '.json', '.tsv', '.txt', '.log'];
  const ext = path.extname(fullPath).toLowerCase();
  
  if (!allowedExts.includes(ext)) {
    return res.status(403).send('Forbidden: Extension not allowed');
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('File not found');
  }

  res.sendFile(fullPath);
});

app.listen(PORT, HOST, () => {
  console.log(`Operator Console listening on http://${HOST}:${PORT}`);
});
