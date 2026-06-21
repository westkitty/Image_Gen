# A1111-Style Workbench Implementation Notes

Last updated: 2026-06-21

## Intent

A local Automatic1111-style workbench bridging the BigMac SDCPP workflow via a localhost-only Express server. Feature parity is declared honestly via `/api/capabilities` featureGates.

## Screens

- **Create** — txt2img controls, model/sampler/seed surface, preview, output actions.
- **Batch / Sweep** — batch generation + X/Y/Z plot form (partial).
- **Edit** — gated img2img, inpaint, outpaint.
- **Enhance** — Pillow upscale (working) + gated AI upscale, Hires Fix, face restore.
- **Library** — gallery with upscale badges, "View upscaled" and "Upscale" buttons.
- **Models** — checkpoint/VAE/extra-network visibility + asset discovery.
- **System** — server lifecycle, capability gate panel grouped by status, job log.

## Supported features

These are fully wired and validated:

- `POST /api/actions/generate-single` — txt2img
- `POST /api/actions/generate-batch` — batch (max 24)
- `POST /api/actions/verify`, `server-{start,stop,status}`, `seed-test`, `clean-old-runs`
- `POST /api/actions/discover-assets` → `GET /api/assets` — asset discovery
- `POST /api/actions/probe-image-edit` — writes `state/image-edit-capabilities.json`
- `POST /api/actions/probe-upscale` — writes `state/upscale-capabilities.json`
- `POST /api/actions/upscale` — **Pillow local resize upscale** (NOT Real-ESRGAN; NOT AI)
- `GET /api/runs`, `GET /api/runs/:runId`, `GET /api/runs/:runId/metadata`
- `GET /api/run-index?limit=N` — paginated listing with `hasUpscaled` flag, 8s cache, max 500
- `GET /api/run-file?path=<safe-relative>` — path-contained, extension-allowlisted
- `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/log`
- `GET /api/capabilities` — featureGates contract, model/sampler lists, asset cache state

## Partial features

- **X/Y/Z Plot** (`POST /api/actions/xyz-plot`): script and endpoint exist, max 16 cells, client-side validation. Requires running BigMac server tunnel. Not end-to-end validated with real images.
- **Upscale (AI/Extras)**: Pillow local resize is available; Real-ESRGAN and A1111 Extras parity are not implemented.
- **PNG Info**: tEXt/iTXt chunks from run images via `/api/runs/:runId/metadata`; arbitrary PNG upload not supported.

## Gated (not wired)

img2img, inpaint, outpaint, Hires Fix, face restore (GFPGAN/CodeFormer), Real-ESRGAN, LoRA injection, VAE switching, textual inversion execution, hypernetwork execution.

Visible in UI to keep the roadmap obvious rather than buried.

## Pillow upscale

Direct script:
```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-upscale.sh --path "<run-id>/<image.png>" --scale 2 --resample lanczos
```

Endpoint:
```sh
curl -s -X POST http://127.0.0.1:31337/api/actions/upscale \
  -H 'Content-Type: application/json' \
  -d '{"path":"<run-id>/<image.png>","scale":2,"resample":"lanczos"}' | python3 -m json.tool
```

- Scales: `2`, `3`, `4`
- Resamples: `lanczos`, `bicubic`, `bilinear`, `nearest`
- Output: `runs/<run-id>/upscaled/<base>-upscale-<N>x-<resample>.png`
- Manifest: `runs/<run-id>/upscaled/upscale-manifest.json` — no prompt/negative_prompt fields
- Path validation: strict allowlist `A-Za-z0-9_-` for run-id, `A-Za-z0-9._/-` for image path
- All values passed to Python via `sys.argv` — no shell interpolation into Python source

## Security posture

- Express bound exclusively to `127.0.0.1:31337`; never 0.0.0.0
- All child spawns use `shell: false`
- All user-controlled values validated before use; path containment enforced via `path.resolve` + `path.relative`
- `SDCPP_REDACT_PROMPTS=1` set for all jobs unless user has enabled prompt saving
- Upscale jobs never receive or store prompt/negative_prompt
- `firstFailedGate` parsed from both stdout and stderr (scripts write `First failed gate: <gate>` to stderr via `fail()` in sdcpp-lib.sh)

## Validation

```sh
cd /Users/andrew/Image_Gen/operator-console
node --check server.js
node --check public/app.js
bash scripts/smoke-check.sh
```

## Next backend work

1. Hires Fix two-pass script: `sdcpp-workflow/bin/sdcpp-hires-fix.sh` — txt2img pass then Pillow upscale; all prerequisites exist.
2. XYZ end-to-end validation with BigMac tunnel to promote `xyzPlot` from partial → true.
3. Fix SD binary discovery in image-edit probe to unblock img2img path.
