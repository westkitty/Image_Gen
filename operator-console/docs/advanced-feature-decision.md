# Advanced Feature Decision Memo

**Date:** 2026-06-21
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

### 🔒 Blocked — evidence below

---

## SDXL Turbo

**Status: BLOCKED**

**Evidence:**
- `state/assets-cache.json` (probed 2026-06-21): 1 checkpoint found — `v1-5-pruned-emaonly.safetensors` (SD 1.5)
- No SDXL checkpoint (`sd_xl_base_1.0.safetensors` or equivalent) present
- No SDXL Turbo checkpoint (`sd_xl_turbo_1.0_fp16.safetensors` or equivalent) present

**What is needed to unlock:**
1. Stage an SDXL or SDXL Turbo checkpoint on BigMac at the expected model path
2. Verify `sd-cli` on BigMac supports `--model` switching to SDXL format
3. Update `sdcpp-cli-generate.sh` to handle SDXL aspect-ratio defaults (512×512 is wrong for SDXL)
4. Re-run asset discovery

**Why it matters:**
SDXL Turbo produces usable images at 1–4 steps (vs SD1.5's 20–50), making it the
highest-throughput path for draft generation. It is the highest-priority advanced feature
once a checkpoint is staged.

---

## Flux

**Status: BLOCKED**

**Evidence:**
- No Flux model files staged on BigMac (no `ae.safetensors`, no `clip_l.safetensors`, no T5XXL)
- `assets-cache.json` shows 0 VAEs, 0 embeddings — all Flux-required components absent
- Flux requires a different inference path (separate clip/T5 encoders + autoencoder VAE)
- `sdcpp-cli-generate.sh` is structured for single-model `sd-cli` invocations

**What is needed to unlock:**
1. Stage Flux model files on BigMac:
   - `ae.safetensors` (Flux autoencoder)
   - `clip_l.safetensors` (CLIP-L text encoder)
   - T5XXL weights (or a quantized variant)
   - Flux base checkpoint (`flux1-dev.safetensors` or `flux1-schnell.safetensors`)
2. Verify `sd-cli` on BigMac supports Flux inference (`--flux` or equivalent flag)
3. Write `sdcpp-flux-generate.sh` (separate from sd1.5 path)

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

1. **SDXL Turbo** — stage checkpoint on BigMac → update generate script → test
2. **img2img** — rebuild or upgrade `sd-cli` on BigMac → test flags → write bridge
3. **Flux Schnell** — stage all Flux files → write dedicated generate script
4. **Real-ESRGAN** — install on BigMac → wire into upscale script
5. **Face Restore** — install GFPGAN/CodeFormer → write bridge script

### What was done instead

In the absence of advanced model support, the session completed:
- Hires Fix two-pass workflow (txt2img → Pillow upscale)
- Smoke check expanded to 15 tests
- This decision memo
- Honest capability gates with `reason` fields explaining blockers

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
