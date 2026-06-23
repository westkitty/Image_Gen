# A1111 Parity Foundation - 2026-06-23

## Audit Map

- Frontend files: `operator-console/public/index.html`, `operator-console/public/app.js`, `operator-console/public/styles.css`.
- Backend routes: `operator-console/server.js`.
- Generation scripts: `sdcpp-workflow/bin/sdcpp-controlled-generate.sh`, `sdcpp-cli-generate.sh`, `sdcpp-server-generate.sh`, `sdcpp-img2img.sh`, `sdcpp-inpaint.sh`, `sdcpp-hires-fix.sh`, `sdcpp-upscale.sh`, `sdcpp-upscale-esrgan.sh`, `sdcpp-batch-generate.sh`, `sdcpp-xyz-plot.sh`.
- Config/default handling: `sdcpp-workflow/config/sdcpp.env`, `sdcpp-workflow/config/sdcpp.env.example`, `sdcpp-workflow/config/presets.env`, plus `PRESET_DEFAULTS` and controlled target defaults in `operator-console/server.js`/`public/app.js`.
- Current control surfaces: Create/txt2img in `index.html` create screen; img2img/inpaint in the Edit screen; Hires Fix and upscale in the Enhance screen.
- Model/asset discovery: `sdcpp-workflow/bin/sdcpp-discover-assets.sh`, `sdcpp-model-stage-check.sh`, `sdcpp-model-inventory-wc2tb.sh`, and cache readers in `server.js`.
- Metadata writing/parsing: script-side `run-metadata.json`, `ui-run-card.md`, controlled/batch/xyz/upscale/hires manifests; server-side `parseUiRunCard`, `/api/runs/:runId`, `/api/runs/:runId/metadata`, `/api/run-index`.
- Queue/progress/cancel: in-memory `jobs` map, `createJob`, `runAction`, `/api/jobs/:jobId`, `/api/jobs/:jobId/log`; no cancel endpoint exists.
- API routes: `server.js` owns native operator APIs; no A1111-compatible `/sdapi/v1` adapter is claimed.
- Test/build commands: `npm --prefix operator-console run check`, `node --check operator-console/public/app.js`, `bash operator-console/scripts/smoke-check.sh`.

## Structures Added

- `operator-console/schemas/generation-job.schema.json`: typed generation job contract covering visible controls, debug preview fields, and known unsupported/deferred controls.
- `operator-console/schemas/model-compatibility.json`: model-family warnings and A1111 parity category status registry.
- `GET /api/generation-schema`
- `GET /api/model-compatibility`
- `POST /api/preview/generation`: read-only command and normalized JSON preview.
- `POST /api/validate/inpaint`: validation-only missing/corrupt/blank/valid mask checks without spawning a job.

## Controls Repaired

- img2img UI now sends sampler, scheduler, steps, CFG scale, seed, width, height, and VAE to the existing backend route.
- Inpaint UI now sends sampler, scheduler, steps, CFG scale, seed, width, height, and VAE to the existing backend route.
- Create, img2img, and inpaint now expose read-only command/JSON preview tied to backend validation and argument mapping.

## Parity Status

| Category | Status | Notes |
| --- | --- | --- |
| txt2img full control surface | partially implemented | Core fields exist; A1111 extras are gated or deferred. |
| img2img full control surface | partially implemented | Core script flags are now surfaced in UI. |
| inpainting | partially implemented | Mask editor, alpha conversion, blank rejection, and core params exist; A1111 mask blur/masked content/inpaint area are not claimed. |
| outpainting | external/deferred | No canvas extension workflow. |
| highres fix | partially implemented | Two-pass txt2img to Pillow upscale only. |
| upscale/extras | partially implemented | Pillow and Real-ESRGAN routes exist; face restoration gated. |
| model/VAE/LoRA registry | partially implemented | Discovery-backed visibility; LoRA is prompt-token based. |
| ControlNet | external/deferred | No fake ControlNet path. |
| metadata save/read/restore | partially implemented | Manifests/readback exist; arbitrary PNG restore remains partial. |
| send-to/history/gallery | implemented | Gallery filters and send-to workflows exist. |
| queue/progress/cancel | partially implemented | Queue/progress exist; cancel missing. |
| X/Y/Z plot | partially implemented | Bounded current script support only. |
| prompt matrix/variations | external/deferred or UI present but not wired | Visible disabled variation fields remain honestly blocked. |
| native API | partially implemented | Operator Console API only. |
| `/sdapi/v1` adapter | external/deferred | Not implemented. |
| command/JSON preview | partially implemented | Preview endpoint covers txt2img/img2img/inpaint. |
| BigMac Ollama prompt enhancement | external/deferred | Not part of this stable-diffusion.cpp pass. |

## Validation Evidence

- `npm --prefix operator-console run check`: pass.
- `node --check operator-console/public/app.js`: pass.
- `OPERATOR_CONSOLE_PORT=31338 bash operator-console/scripts/smoke-check.sh`: pass, 36 pass / 0 fail.
- Direct API probes: schema, compatibility, txt2img preview, and inpaint missing/corrupt/blank/valid mask checks passed.
- Chrome via local Google Chrome: Create/img2img/inpaint previews rendered expected scripts with no console errors and no failed responses.

## Known Risks

- `POST /api/preview/generation` intentionally uses a placeholder mask path for inpaint because the real mask file is created only during submit.
- img2img/inpaint still rely on the script paths for actual metadata fidelity; this pass did not rewrite script manifest generation.
- Cancel support, A1111 `/sdapi/v1`, prompt matrix, true variation controls, ControlNet, training, extensions, and checkpoint merger remain deferred.

## Next Phase

1. Extract duplicated real-route and preview-route command mapping into a small shared module so exact invocation parity is enforced by code shape.
2. Add cancel support to the job runner before broadening batch and long-running workflows.
3. Add metadata restore into Create from `run-metadata.json` for img2img/inpaint runs, with privacy redaction preserved.
4. Probe stable-diffusion.cpp prompt weighting behavior and record it in `model-compatibility.json`.
