# Advanced Feature Decision Memo

**Date:** 2026-06-22
**Session:** Autonomous Dexter Walk — Unit 8

## Summary

This memo documents the evidence-based decision about which advanced features
(SDXL Turbo, Flux, img2img, Real-ESRGAN, etc.) can be implemented next, and why
they remain blocked.

All evidence comes from actual probe results and asset discovery on the live system.
No feature is marked blocked without verified evidence.

---

## Feature Gate Status (2026-06-21)

### ✅ Implemented and validated

| Feature | Route | Notes |
|---|---|---|
| txt2img | `POST /api/actions/generate-single` | |
| Batch generation | `POST /api/actions/generate-batch` | max 24 |
| Pillow upscale | `POST /api/actions/upscale` | local only, not AI |
| **Hires Fix** | `POST /api/actions/hires-fix` | two-pass txt2img → Pillow; NOT latent Hires Fix |
| SDXL base smoke | `POST /api/actions/sdxl-smoke` | bounded proof only |
| SDXL Turbo smoke | `POST /api/actions/sdxl-turbo-smoke` | bounded Turbo proof only |
| Flux smoke | `POST /api/actions/flux-smoke` | bounded Flux proof only |

### 🔒 Blocked — evidence below

---

## SDXL Turbo

**Status: PROVED**

**Evidence:**
- `state/model-stage-cache.json` and `state/sdxl-smoke-cache.json`: SDXL base bounded smoke proof passed
- `state/model-stage-cache.json` and `state/sdxl-turbo-smoke-cache.json`: SDXL Turbo bounded smoke proof passed against `sd_xl_turbo_1.0_fp16.safetensors`
- `state/model-stage-cache.json` and `state/flux-smoke-cache.json`: Flux bounded smoke proof passed against the current fp8 candidate

**What is needed to unlock:**
1. Keep the staged fp16 checkpoint and smoke cache in sync with the console.
2. Preserve the 0B placeholder only as a reminder of the earlier bad target; do not smoke it.
3. Keep the bounded proof wording explicit so support is not confused with file presence.

**Why it matters:**
SDXL Turbo produces usable images at 1–4 steps (vs SD1.5's 20–50), making it the
highest-throughput path for draft generation. It is the highest-priority advanced feature
once a checkpoint is staged.

---

## Flux

**Status: PROVED**

**Evidence:**
- `state/model-stage-cache.json` shows the Flux component set staged
- `state/flux-smoke-cache.json` records a real PNG proof
- The current proof uses `flux1-schnell-fp8.safetensors`, `ae.safetensors`, `clip_l.safetensors`, and `t5xxl_fp16.safetensors`

**What is needed to unlock:**
1. Keep the proof cache aligned with the current accepted fp8 Flux candidate.
2. Document the file path choice so nobody assumes the full safetensors checkpoint is runtime-proven here.
3. Keep the smoke route fixed-path and proof-only.

**Why it matters:**
Flux is state-of-the-art for text-to-image quality as of mid-2026. Schnell variant
runs well on Apple Silicon. It is the highest-quality path once staged.

---

## img2img / Inpaint / Outpaint

**Status: BLOCKED**

**Evidence:**
- `state/image-edit-capabilities.json` (probed 2026-06-21):
  - `sd_binary_found: false`
  - `init_img: false`, `strength: false`, `control_image: false`
- The `sd-cli` binary on BigMac does not expose `--init-img` or `--strength` flags in the version currently staged

**What is needed to unlock:**
1. Verify whether the current `sd-cli` build supports img2img (check `--help` output on BigMac)
2. If not: rebuild `sd-cli` with img2img support or upgrade SDCPP version on BigMac
3. Update `sdcpp-image-edit-capabilities.sh` probe to also grep `sd-cli --help`
4. Write `sdcpp-img2img.sh` once flags are confirmed

---

## Real-ESRGAN / Face Restore (GFPGAN / CodeFormer)

**Status: BLOCKED**

**Evidence:**
- `state/upscale-capabilities.json` (probed 2026-06-21):
  - `remote.realesrgan: false`
  - `remote.gfpgan: false`
  - `remote.codeformer: false`
- None of these tools are installed on BigMac

**What is needed to unlock Real-ESRGAN:**
1. Install `realesrgan-ncnn-vulkan` or the Python `basicsr`/`realesrgan` package on BigMac
2. Update `sdcpp-upscale-capabilities.sh` and `sdcpp-upscale.sh` to use it
3. Expose as a new `resample` option or separate `model` parameter

**What is needed to unlock Face Restore:**
1. Install GFPGAN or CodeFormer on BigMac (requires Python environment setup)
2. Write `sdcpp-face-restore.sh`

---

## LoRA / Textual Inversion / Hypernetworks

**Status: BLOCKED — no files staged**

**Evidence:**
- `state/assets-cache.json`: `loras: []`, `embeddings: []`, `hypernetworks: []`
- Asset discovery ran and found nothing in the expected extra-network directories

**What is needed:**
1. Stage LoRA `.safetensors` files in BigMac's LoRA directory
2. Verify `sd-cli` supports `--lora` injection
3. Write LoRA injection bridge in `sdcpp-cli-generate.sh`

---

## Decision

**All advanced paths are blocked on missing model files or binary capabilities on BigMac.**

No amount of code changes on the MacBook side will unblock these until the required
files are staged on BigMac.

### Priority order for next unlock (in sequence)

1. **SDXL Turbo** — stage `sd_xl_turbo_1.0_fp16.safetensors` on BigMac wc2tb → probe flags → bounded smoke
2. **Flux Schnell** — stage official or compatible Flux files on BigMac wc2tb → probe flags → bounded smoke
3. **SDXL (base)** — stage SDXL checkpoint → validate higher-res output
4. **img2img** — rebuild or upgrade `sd-cli` on BigMac → test flags → write bridge
5. **LoRA / VAE** — stage LoRA files → wire injection into generate script
6. **Real-ESRGAN / Face Restore** — install realesrgan + GFPGAN/CodeFormer on BigMac → wire scripts
7. **Inpaint / Outpaint** — blocked until upstream SDCPP adds CLI support

### What was done instead

In the absence of advanced model support, the session completed:
- Hires Fix two-pass workflow (txt2img → Pillow upscale)
- Smoke check expanded to 15 tests
- This decision memo
- Honest capability gates with `reason` fields explaining blockers

### Model staging foundation added after this memo

- Manual staging guide: `operator-console/docs/model-staging-sdxl-turbo-flux.md`
- Validation script: `sdcpp-workflow/bin/sdcpp-model-stage-check.sh`
- API cache: `GET /api/model-stage`
- Job action: `POST /api/actions/check-model-stage`
- Capability gates: `sdxlTurbo`, `flux`, and `sdxl`

These detect staged files only. They do not mark runtime support true without a bounded BigMac Metal smoke run.

---

## How to re-probe

```sh
# Re-check available models/tools on BigMac
curl -s -X POST http://127.0.0.1:31337/api/actions/discover-assets | python3 -m json.tool
curl -s -X POST http://127.0.0.1:31337/api/actions/probe-image-edit | python3 -m json.tool
curl -s -X POST http://127.0.0.1:31337/api/actions/probe-upscale | python3 -m json.tool
```

State files updated at:
- `sdcpp-workflow/state/assets-cache.json`
- `sdcpp-workflow/state/image-edit-capabilities.json`
- `sdcpp-workflow/state/upscale-capabilities.json`

## Live Update — 2026-06-21

The current runtime state has moved past the original “no SDXL checkpoint” assumption:

- `sd_xl_base_1.0.safetensors` is staged on BigMac wc2tb and is nonzero.
- `sdxlTurbo` now has a bounded smoke proof and is supported after the real PNG run passes.
- Flux now has a bounded smoke proof and is supported after the real PNG run passes.
- `sdxl` continues to use its bounded smoke proof and should remain labeled proof-only.
