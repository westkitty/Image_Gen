# QUICKSTART

All commands run from the project root:
```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
```

## 1. One-command smoke test (recommended first run)
Runs verify → CLI generate → server start → server generate (OpenAI, then SDAPI) → server stop, and checks the repo stays clean.
```sh
bin/sdcpp-run-smoke.sh
```
On PASS it prints the CLI PNG path, the OpenAI PNG path, the SDAPI PNG path, cleanup status, and the report path.

## 2. CLI-only generation
```sh
bin/sdcpp-cli-generate.sh --prompt "a lovely cat"
# more control:
bin/sdcpp-cli-generate.sh --prompt "a fox in snow" --negative "blurry" \
  --steps 20 --width 512 --height 512 --seed 1234 --out-name fox_snow
```

## 3. Server flow (manual)
```sh
bin/sdcpp-server-start.sh                         # start sd-server + tunnel
bin/sdcpp-server-generate.sh --prompt "a lovely cat" --api openai
bin/sdcpp-server-generate.sh --prompt "a lovely cat" --api both   # openai + sdapi
bin/sdcpp-server-status.sh                        # read-only health view
bin/sdcpp-server-stop.sh                          # safe shutdown
```
Pick non-default ports if needed:
```sh
bin/sdcpp-server-start.sh --remote-port 7871 --local-port 17871
```

## 4. Fast / quality presets (daily use)
```sh
bin/sdcpp-run-fast.sh --mode cli --prompt "a cozy concrete library"      # ~15s
bin/sdcpp-run-fast.sh --mode server --prompt "..." --keep-server-running  # warm, reuse
bin/sdcpp-run-quality.sh --mode both --prompt "..."                       # quality, CLI + server
# any generator also takes --preset smoke|thumbnail|fast|balanced|quality|quality_plus
bin/sdcpp-cli-generate.sh --preset balanced --prompt "..."
```

## 5. Benchmark & recommend
```sh
bin/sdcpp-benchmark.sh --modes both --presets smoke,fast,balanced,quality --repeats 1
bin/sdcpp-benchmark-server-warm.sh
bin/sdcpp-summarize-benchmarks.sh        # writes benchmark-summary.md + prints ranking
```

## 6. Seed & batch (Phase 2)
```sh
# deterministic single image:
bin/sdcpp-cli-generate.sh --preset fast --seed 42 --prompt "..."
# batch of 3, incrementing seeds, with a manifest:
bin/sdcpp-batch-generate.sh --mode cli --count 3 --preset fast --seed-mode increment --seed-start 42 --prompt "..."
# batch on a warm server (sdapi gives direct seed control):
bin/sdcpp-batch-generate.sh --mode server --api sdapi --count 3 --preset fast --prompt "..."
# prove reproducibility (same seed twice -> compare sha256):
bin/sdcpp-seed-test.sh --preset smoke --seed 424242 --mode cli
# hand the latest run to a UI (prints paths + ui-run-card.md):
bin/sdcpp-export-latest-markdown.sh
```
Batch outputs live in `runs/<ts>-batch/`: `images/`, `records/`, `batch-manifest.json`/`.tsv`, `batch-report.md`, `ui-run-card.md`.

## 7. See your images
```sh
bin/sdcpp-open-latest.sh        # prints + opens the newest PNG
```

## 5. Housekeeping (optional, safe)
```sh
bin/sdcpp-clean-old-runs.sh                          # dry run (lists only)
bin/sdcpp-clean-old-runs.sh --delete --older-than-days 14
```

## Where outputs appear
- `runs/<timestamp>-<kind>/` — one folder per command.
  - `*-report.md` — human-readable result.
  - `*.png` — verified images.
  - `*-response.json`, `*.b64`, `*.log` — raw evidence.
- `state/` — live server session, ports, SSH control socket (managed for you).

## 8. Operator Console (local UI)

```sh
cd /Users/andrew/Image_Gen/operator-console
node server.js > /tmp/operator-console.log 2>&1 &
# Then open: http://127.0.0.1:31337/
```

Provides an A1111-style web UI bound to 127.0.0.1 only. Supported screens: Create, Batch/Sweep, Enhance (Pillow upscale), Library, Models, System.

## 9. Pillow upscale (local, no inference, no SSH)

```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-upscale.sh --path "<run-id>/<image.png>" --scale 2 --resample lanczos
```

Output written to `runs/<run-id>/upscaled/`. Manifest at `runs/<run-id>/upscaled/upscale-manifest.json`.

Or via the Operator Console Enhance screen, or directly:

```sh
curl -s -X POST http://127.0.0.1:31337/api/actions/upscale \
  -H 'Content-Type: application/json' \
  -d '{"path":"<run-id>/<image.png>","scale":2,"resample":"lanczos"}'
```

## 10. SDXL Turbo / Flux staging check

Do not download models automatically. Stage files manually on BigMac external storage:

```text
/Volumes/wc2tb/ImageGen
```

First SDXL Turbo target:

```text
/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors
```

Flux Schnell targets:

```text
/Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell.safetensors
/Volumes/wc2tb/ImageGen/flux/shared/ae.safetensors
/Volumes/wc2tb/ImageGen/flux/shared/clip_l.safetensors
/Volumes/wc2tb/ImageGen/flux/shared/t5xxl_fp16.safetensors
```

Compatible GGUF or quantized Flux candidates are accepted if the BigMac stable-diffusion.cpp binary proves the required flags.

Validate staging:

```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-model-stage-check.sh
```

Operator Console:

```sh
curl -s http://127.0.0.1:31337/api/model-stage | python3 -m json.tool
curl -s -X POST http://127.0.0.1:31337/api/actions/check-model-stage | python3 -m json.tool
```

Staged files do not mean supported. SDXL Turbo, Flux, and SDXL remain gated until BigMac Metal smoke output proves a real PNG.
