# SDCPP Workbench

A local-only Automatic1111-style workbench for the BigMac SDCPP image-generation workflow.

This replaces the earlier backend-first Operator Console with a creative task structure:

- **Create** — text-to-image generation cockpit
- **Batch / Sweep** — batch generation plus gated X/Y/Z plot planning
- **Edit** — gated img2img, inpaint, and outpaint workflows
- **Enhance** — gated upscale, Hires Fix, face restore, and PNG-info recovery workflows
- **Library** — generated outputs as reusable workflow starting points
- **Models** — checkpoint, VAE, and extra-network visibility
- **System** — server, diagnostics, seed test, and job logs

## Launch

```sh
cd /Users/andrew/Image_Gen/operator-console
npm install
npm start
```

Then open:

```text
http://127.0.0.1:31337/
```

## Architecture

- Frontend: vanilla HTML/CSS/JavaScript.
- Backend bridge: Express bound to `127.0.0.1` only.
- Workflow backend: approved shell scripts under `../sdcpp-workflow/bin`.
- Safety posture: no arbitrary command execution; all actions route through allowlisted endpoints.

## Prompt privacy

Prompts are redacted by default.

When **Save prompts in run records** is off, the bridge sets:

```sh
SDCPP_REDACT_PROMPTS=1
```

The UI can still generate, but history reuse is limited because the prompt text is intentionally not preserved.

## Supported now

- txt2img generation
- batch generation
- server start/stop/status
- verification
- seed test
- run/gallery loading
- safe image file serving
- prompt styles in browser storage
- aspect presets
- wider size validation: multiples of 8, 64–2048
- sampler/scheduler visibility from `/api/capabilities`

## Gated until backend support exists

- X/Y/Z Plot execution
- img2img
- inpaint
- outpaint
- Hires Fix
- upscale / extras
- face restore
- LoRA scanning
- textual inversion / embeddings browser
- hypernetwork browser
- VAE switching
- full PNG-info recovery

These features are deliberately visible in the UI so the missing backend work is obvious instead of buried.

## Validation

```sh
cd /Users/andrew/Image_Gen/operator-console
node --check server.js
node --check public/app.js
```
