# SDCPP Workbench

A local-only Automatic1111-style workbench for the BigMac SDCPP image-generation workflow.

- **Create** — text-to-image generation cockpit
- **Batch / Sweep** — batch generation + X/Y/Z plot (partial: requires server tunnel)
- **Edit** — gated img2img, inpaint, and outpaint workflows
- **Enhance** — Pillow upscale (working) + gated AI upscale / Hires Fix / face restore
- **Library** — generated outputs with upscale badges and workflow reuse
- **Models** — checkpoint, VAE, and extra-network visibility + asset discovery
- **System** — server lifecycle, diagnostics, capability gate panel, job logs

## Launch

```sh
cd /Users/andrew/Image_Gen/operator-console
node server.js > /tmp/operator-console.log 2>&1 &
```

Then open:

```text
http://127.0.0.1:31337/
```

## Architecture

- Frontend: vanilla HTML/CSS/JavaScript (no build step).
- Backend bridge: Express bound exclusively to `127.0.0.1:31337`.
- Workflow backend: approved shell scripts under `../sdcpp-workflow/bin`.
- Safety posture: no arbitrary command execution; all actions route through allowlisted endpoints; `shell: false` on all child spawns.

## Prompt privacy

Prompts are redacted by default. When **Save prompts in run records** is off, the bridge sets `SDCPP_REDACT_PROMPTS=1`. History reuse is limited, but upscale and other non-generative actions never touch prompt fields regardless of this setting.

## Supported

| Feature | Route | Notes |
|---|---|---|
| txt2img | `POST /api/actions/generate-single` | |
| Batch generation | `POST /api/actions/generate-batch` | max 24 |
| Server start/stop/status | `POST /api/actions/server-{start,stop,status}` | |
| Verification | `POST /api/actions/verify` | |
| Seed test | `POST /api/actions/seed-test` | |
| Gallery / run history | `GET /api/runs`, `GET /api/run-index` | |
| Paginated run index | `GET /api/run-index?limit=N` | max 500, 8s cache |
| Run metadata | `GET /api/runs/:runId/metadata` | tEXt/iTXt chunks, metrics.tsv |
| Safe file serving | `GET /api/run-file?path=...` | allowlisted extensions, path containment |
| Asset discovery | `POST /api/actions/discover-assets` → `GET /api/assets` | |
| img2img probe | `POST /api/actions/probe-image-edit` | writes state/image-edit-capabilities.json |
| Upscale probe | `POST /api/actions/probe-upscale` | writes state/upscale-capabilities.json |
| **Pillow upscale** | `POST /api/actions/upscale` | local resize only — not AI, not Real-ESRGAN |
| **Hires Fix** | `POST /api/actions/hires-fix` | two-pass txt2img → Pillow upscale — NOT A1111 latent Hires Fix |

### Pillow upscale direct usage

```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-upscale.sh --path "<run-id>/<image.png>" --scale 2 --resample lanczos
```

Accepted scales: `2`, `3`, `4`. Accepted resamples: `lanczos`, `bicubic`, `bilinear`, `nearest`.
Output written to `runs/<run-id>/upscaled/<base>-upscale-<N>x-<resample>.png`.
Manifest at `runs/<run-id>/upscaled/upscale-manifest.json` — no prompt or negative_prompt fields.

## Partial

| Feature | Notes |
|---|---|
| X/Y/Z Plot | Script and endpoint exist (max 16 cells). Requires running BigMac server tunnel. Not end-to-end validated with real images. |
| Upscale (AI/Extras) | Pillow local resize exists; Real-ESRGAN, A1111 Extras parity not implemented. |
| PNG Info | tEXt/iTXt chunks from run images via metadata endpoint; arbitrary PNG upload not supported. |

## Gated (not wired)

img2img, inpaint, outpaint, face restore, Real-ESRGAN, GFPGAN, CodeFormer, LoRA injection, VAE switching, textual inversion execution, hypernetwork execution.

These are visible in the UI so the missing backend work is obvious rather than buried.

## Validation

```sh
cd /Users/andrew/Image_Gen/operator-console
node --check server.js
node --check public/app.js
```

### Smoke check (no images generated, no BigMac required)

```sh
bash operator-console/scripts/smoke-check.sh
```

### Clean source package

```sh
bash scripts/package-source.sh
```

Writes `/tmp/Image_Gen_source_<timestamp>.zip` from `git archive HEAD` — excludes `.git/`, `node_modules/`, `runs/`, `logs/`, `state/`, `.proof-env`, runtime junk.
