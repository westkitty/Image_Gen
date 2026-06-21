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

// In-memory job store
const jobs = {};

function createJob() {
  const jobId = crypto.randomUUID();
  jobs[jobId] = {
    id: jobId,
    status: 'queued', // queued, running, PASS, PARTIAL, FAIL
    stdout: '',
    stderr: '',
    createdAt: Date.now()
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
    // Determine PASS/FAIL/PARTIAL from stdout if possible, or fallback to code.
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
  });
}

// ---- ACTIONS ----

app.post('/api/actions/verify', (req, res) => {
  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-verify.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-fast', (req, res) => {
  const { prompt, seed, mode } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });
  
  const args = ['--mode', mode || 'cli', '--prompt', prompt];
  if (seed) {
    args.push('--seed', String(seed));
  }

  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-run-fast.sh', args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/generate-batch', (req, res) => {
  const { prompt, count, preset, seedMode, seedStart, mode, api } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const args = ['--prompt', prompt];
  if (mode) args.push('--mode', mode);
  if (count) args.push('--count', String(count));
  if (preset) args.push('--preset', preset);
  if (seedMode) args.push('--seed-mode', seedMode);
  if (seedStart) args.push('--seed-start', String(seedStart));
  if (api) args.push('--api', api);

  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-batch-generate.sh', args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-start', (req, res) => {
  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-server-start.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-stop', (req, res) => {
  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-server-stop.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/server-generate', (req, res) => {
  const { prompt, preset, api, seed } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const args = ['--prompt', prompt];
  if (preset) args.push('--preset', preset);
  if (api) args.push('--api', api);
  if (seed) args.push('--seed', String(seed));

  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-server-generate.sh', args);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});

app.post('/api/actions/seed-test', (req, res) => {
  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-seed-test.sh', ['--preset', 'smoke', '--seed', '424242', '--mode', 'cli']);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});


// ---- JOBS ----

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, status: job.status });
});

app.get('/api/jobs/:jobId/log', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, stdout: job.stdout, stderr: job.stderr });
});


// ---- RUNS & DISCOVERY ----

app.get('/api/runs', (req, res) => {
  if (!fs.existsSync(RUNS_DIR)) return res.json({ runs: [] });
  
  const dirs = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort((a, b) => b.localeCompare(a)); // Newest first based on timestamp naming

  const runs = dirs.map(dirName => {
    const runPath = path.join(RUNS_DIR, dirName);
    const cardPath = path.join(runPath, 'ui-run-card.md');
    let metadata = { id: dirName };
    
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
  });

  res.json({ runs });
});

// ---- SERVER STATUS ----

app.get('/api/server-status', (req, res) => {
  // Rather than spawning a job, this is small enough to block or run quickly
  // But to be safe and consistent with non-blocking, we'll spawn a quick job
  const jobId = createJob();
  runAction(jobId, 'bin/sdcpp-server-status.sh', []);
  res.json({ job_id: jobId, status: jobs[jobId].status });
});


// ---- SAFE STATIC FILE SERVING ----

app.get('/api/run-file', (req, res) => {
  const queryPath = req.query.path;
  if (!queryPath) return res.status(400).send('Missing path');

  if (queryPath.includes('..') || path.isAbsolute(queryPath)) {
    return res.status(403).send('Forbidden: Path traversal not allowed');
  }

  const fullPath = path.resolve(RUNS_DIR, queryPath);
  
  // Extra boundary check
  if (!fullPath.startsWith(RUNS_DIR)) {
    return res.status(403).send('Forbidden: Outside boundaries');
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
