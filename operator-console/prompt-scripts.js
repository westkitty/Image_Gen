'use strict';
// A1111 "Prompt matrix" and "Prompts from file or textbox" routes (SC-16..SC-19), modelled on the X/Y/Z plot (P10).
// Every cell is validated with the real controlled-generation validator and then runs as an ordinary generation through the
// durable queue (per-item `overrides` / `negative`); nothing is substituted after the fact. The matrix result grid reuses
// POST /api/xyz/:id/grid (queue kind 'promptmatrix' carries settings.private.xyz dims + axes, stripped when prompts are not saved).
//
//   POST /api/promptmatrix/plan   POST /api/promptmatrix      (matrix)
//   POST /api/promptlines/plan    POST /api/promptlines       (file / textbox)
const PromptMatrix = require('./public/dexdiffusion/prompt-matrix.js');

function mount(app, deps) {
  const { normalizeControlledGenerationBody, validateControlledGenerationParams, allControlledTargets, CONTROLLED_TARGETS,
    targetCapabilities, queueRunner, W, LARGE_REQUEST_IMAGES, crypto, expandWildcards = t => t } = deps;

  // kind: 'matrix' | 'lines'.  Returns { plan, settings, negative, target, fixedSeed, jobs } or { status, error, errors }.
  function planFor(kind, body) {
    const settings = { ...(body.settings || {}) };
    // Wildcards are expanded ONCE per plan (not per cell at run time), so cells differ only by the script's own variation.
    const prompt = expandWildcards(String(settings.prompt || ''));
    const negative = String(settings.negative_prompt || settings.negativePrompt || '');
    delete settings.negativePrompt;
    if (kind === 'matrix' && !prompt.trim()) return { status: 400, error: 'Enter a prompt first' };
    const probe0 = normalizeControlledGenerationBody({ ...settings, prompt: prompt || 'x', negative_prompt: negative });
    const target = allControlledTargets()[probe0.target] || CONTROLLED_TARGETS.find(t => t.id === probe0.target);
    if (!target) return { status: 400, error: `Unknown target: ${probe0.target}` };
    const caps = targetCapabilities(target);
    const base = { prompt, negative_prompt: negative };
    const plan = kind === 'matrix'
      ? PromptMatrix.buildMatrix(base, { target: body.target === 'negative' ? 'negative' : (body.target || 'positive'), putAtStart: !!body.put_at_start, joiner: body.joiner || 'comma', differentSeeds: !!body.different_seeds }, caps)
      : PromptMatrix.buildLines(expandWildcards(typeof body.text === 'string' ? body.text : ''), base, { iterateSeed: !!body.iterate_seed }, caps);
    if (!plan.ok) return { status: 400, error: plan.errors[0], errors: plan.errors };
    // Like A1111 (and the X/Y/Z plot) a random base seed (-1) is fixed once so cells differ only by the script's variation,
    // unless the user keeps random seeds. Per-cell seed offsets (different seed per image / iterate seed) need a fixed base.
    const explicitSeedLines = kind === 'lines' && plan.cells.every(c => c.overrides.seed !== undefined);
    const fixedSeed = Number(settings.seed) >= 0 ? Number(settings.seed)
      : (body.keep_random_seed || explicitSeedLines ? null : crypto.randomInt(0, W.MAX_SEED));
    if (fixedSeed !== null) settings.seed = fixedSeed;
    const allTargetById = allControlledTargets();
    const jobs = [];
    for (const c of plan.cells) {
      const overrides = { ...c.overrides };
      if (c.seedOffset && overrides.seed === undefined && fixedSeed !== null) overrides.seed = (fixedSeed + c.seedOffset) % W.MAX_SEED;
      c.overrides = overrides;
      const where = kind === 'lines' ? `Line ${c.line}` : `Cell ${c.index + 1} (${c.title})`;
      if (!String(c.prompt).trim()) return { status: 400, error: `${where}: Enter a prompt`, errors: [`${where}: Enter a prompt`] };
      const probe = normalizeControlledGenerationBody({ ...settings, ...overrides, prompt: c.prompt, negative_prompt: c.negative_prompt, quantity: 1 });
      const err = validateControlledGenerationParams(probe, allTargetById);
      if (err) return { status: 400, error: `${where}: ${err}`, errors: [`${where}: ${err}`] };
      jobs.push({ index: c.index, target: probe.target, prompt: probe.prompt, negative_prompt: probe.negative_prompt, seed: probe.seed, steps: probe.steps, cfg_scale: probe.cfg_scale, width: probe.width, height: probe.height, sampler: probe.sampler });
    }
    return { plan, settings, negative, target, fixedSeed, jobs };
  }

  const view = (kind, r) => ({
    ok: true, kind, total: r.plan.total, dims: r.plan.dims || [r.plan.total, 1, 1], axes: r.plan.axes || null, fixedSeed: r.fixedSeed, skipped: r.plan.skipped || 0,
    cells: r.plan.cells.map((c, i) => ({ index: c.index, ix: c.ix, iy: c.iy, iz: c.iz, line: c.line, title: c.title, prompt: c.prompt, negative_prompt: c.negative_prompt, overrides: c.overrides, job: r.jobs[i] })),
  });

  function enqueue(kind, body, res) {
    const r = planFor(kind, body);
    if (r.error) return res.status(r.status).json({ ok: false, error: r.error, errors: r.errors || [r.error] });
    if (r.plan.total > LARGE_REQUEST_IMAGES && body.confirm_large !== true) {
      return res.status(409).json({ error: `This ${kind === 'matrix' ? 'matrix' : 'list'} generates ${r.plan.total} images. Confirm to continue.`, needs_confirmation: true, total: r.plan.total });
    }
    const settings = r.settings;
    delete settings.prompt; delete settings.negative_prompt; delete settings.negativePrompt;
    const probe = normalizeControlledGenerationBody({ ...settings, prompt: 'x', quantity: 1 });
    const matrix = kind === 'matrix';
    const created = queueRunner.create({
      entries: r.plan.cells.map(c => ({
        number: String(c.index + 1), title: c.queueTitle, prompt: c.prompt, negative: c.negative_prompt, overrides: c.overrides,
        ...(matrix ? { xyz: { ix: c.ix, iy: c.iy, iz: 0 } } : {}),
      })),
      settings: {
        target: probe.target, quantity: 1, width: probe.width, height: probe.height, steps: probe.steps, seed: probe.seed, save_prompts: probe.save_prompts,
        kind: matrix ? 'promptmatrix' : 'promptlines', body: { ...settings, quantity: 1 },
        private: { negative_prompt: r.negative, ...(matrix ? { xyz: { dims: r.plan.dims, axes: r.plan.axes } } : {}) },
      },
    });
    const out = { ...queueRunner.get(created.id) };
    if (matrix) out.xyz = { dims: r.plan.dims, axes: r.plan.axes.map(a => a && { type: a.type, label: a.label }) };
    return res.json(out);
  }

  const plan = kind => (req, res) => {
    const r = planFor(kind, req.body || {});
    if (r.error) return res.status(r.status).json({ ok: false, error: r.error, errors: r.errors || [r.error] });
    res.json(view(kind, r));
  };
  app.post('/api/promptmatrix/plan', plan('matrix'));
  app.post('/api/promptmatrix', (req, res) => enqueue('matrix', req.body || {}, res));
  app.post('/api/promptlines/plan', plan('lines'));
  app.post('/api/promptlines', (req, res) => enqueue('lines', req.body || {}, res));
}

module.exports = { mount };
