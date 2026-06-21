# A1111-Style Workbench Implementation Notes

Date: 2026-06-21

## Intent

This console has been reframed from a backend-first operator panel into an Automatic1111-style image-generation workbench. The core product model is now:

- **Create** — text-to-image controls, model/parameter surface, seed controls, preview, and output actions.
- **Batch / Sweep** — supported batch generation plus a visible gated X/Y/Z Plot surface.
- **Edit** — visible gated img2img, inpaint, and outpaint workflows.
- **Enhance** — visible gated upscale, Hires Fix, face restore, and PNG-info style recovery workflows.
- **Library** — generated outputs as workflow starting points rather than passive thumbnails.
- **Models** — checkpoint, VAE, and extra-network status surfaced instead of hidden.
- **System** — server controls, diagnostics, seed test, and job logs.

## Fully wired features

These features call the existing SDCPP workflow scripts through the localhost Express bridge:

- txt2img generation through `/api/actions/generate-single`
- batch generation through `/api/actions/generate-batch`
- backend verification
- server status/start/stop
- seed test
- run/gallery discovery
- safe static serving of run files
- job status polling and log display
- prompt redaction toggle using `SDCPP_REDACT_PROMPTS`
- sampler/scheduler capability surfacing
- wider dimension validation: multiples of 8, 64–2048
- steps validation up to 150
- CFG validation up to 30
- prompt styles stored locally in browser `localStorage`
- aspect preset buttons
- random seed and reuse-last-seed UI behavior
- output actions for opening images, copying run parameters, and attempting reuse

## Visible but gated features

These workflows are intentionally present in the UI but disabled/gated because the current `sdcpp-workflow/bin` scripts do not implement the backend operation yet:

- X/Y/Z Plot / parameter sweep execution
- img2img
- inpaint mask editor
- upload-mask mode
- outpaint
- Hires Fix second-pass generation
- upscale / extras
- face restoration
- LoRA discovery and real insertion from scanned model files
- textual inversion / embeddings browser
- hypernetwork browser
- VAE switching
- full PNG-info parsing/recovery

The gate behavior is deliberate. It keeps the roadmap visible without lying to the operator.

## Backend bridge changes

`operator-console/server.js` now exposes:

- `GET /api/capabilities`
- `POST /api/actions/verify`
- `POST /api/actions/server-status`
- `GET /api/server-status`
- `POST /api/actions/server-start`
- `POST /api/actions/server-stop`
- `POST /api/actions/generate-single`
- `POST /api/actions/generate-batch`
- `POST /api/actions/unsupported`
- `POST /api/actions/seed-test`
- `POST /api/actions/clean-old-runs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/log`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/files`
- `GET /api/run-file?path=<safe-relative-run-path>`

## Validation performed

From `operator-console/`:

```sh
node --check server.js
node --check public/app.js
```

Both checks passed.

The server was also briefly started and `GET /api/capabilities` returned JSON successfully.

## Known limitations

This is not full Automatic1111 parity yet. It is the correct UI/product architecture plus honest feature gates. Full execution parity requires adding new backend scripts or API calls for image editing, highres/upscale, model scanning, LoRA/VAE management, PNG-info parsing, and X/Y/Z grid generation.

## Next backend work required

1. Add model discovery scripts for checkpoints, VAE files, LoRA, embeddings, and hypernetworks.
2. Add per-run model/CLIP/VAE override support where SDCPP allows it.
3. Add img2img and inpaint/outpaint scripts if the installed SDCPP build supports them.
4. Add upscale/face-restore scripts or choose an external local upscaler pipeline.
5. Add X/Y/Z plot orchestration script that loops through parameters and writes grid manifests.
6. Add parameter metadata in run manifests so the Library can fully reconstruct prior generations even when prompts are redacted by default.
