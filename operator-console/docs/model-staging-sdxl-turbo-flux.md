# SDXL Turbo and Flux Model Staging

Last updated: 2026-06-21

## Target Root

Stage new BigMac image-generation models on the canonical home:

```text
/Volumes/wc2tb/ImageGen
```

Do not use the old `/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models` or older wc1tb proposal. The existing SD 1.5 compatibility path under `$HOME/sdcpp-staging/models` remains valid and should not be blindly replaced with a symlink.

## Directory Layout

```text
/Volumes/wc2tb/ImageGen/
  checkpoints/
    sd15/
      v1-5-pruned-emaonly.safetensors
    sdxl-turbo/
      sd_xl_turbo_1.0_fp16.safetensors
      # Optional/lower-priority if deliberately staged:
      # sd_xl_turbo_1.0.safetensors
    sdxl/
      # optional SDXL base checkpoint
  flux/
    flux1-schnell/
      flux1-schnell.safetensors
      # or stable-diffusion.cpp-compatible:
      # flux1-schnell*.gguf
      # flux1-schnell*Q*.gguf
      # flux1-schnell*fp8*.safetensors
    shared/
      ae.safetensors
      clip_l.safetensors
      t5xxl_fp16.safetensors
      # or compatible variants:
      # clip_l*.gguf
      # t5xxl*.gguf
      # t5-v1_1-xxl*.gguf
      # t5xxl_fp8*.safetensors
  loras/
  vaes/
  embeddings/
  hypernetworks/
```

## Manual Download Boundary

Codex must not download models automatically. Download with a browser or Hugging Face command-line interface (CLI) only after accepting any required model terms. The user is responsible for access and license compliance.

### SDXL Turbo

- Model ID: `stabilityai/sdxl-turbo`
- First BigMac Metal target: `sd_xl_turbo_1.0_fp16.safetensors`
- Stage at:

```text
/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors
```

Do not use the full fp32 `sd_xl_turbo_1.0.safetensors` as the first smoke target unless it is deliberately staged. Turbo smoke defaults should be low-step, usually 1-4 steps, start at 512x512, and should not depend on negative prompts or ordinary Stable Diffusion 1.5 classifier-free guidance (CFG) assumptions unless the local BigMac binary proves the exact flags.

### Flux Schnell

- Model ID: `black-forest-labs/FLUX.1-schnell`
- Access may require accepting Hugging Face model conditions.
- Official full model file: `flux1-schnell.safetensors`
- Official VAE: `ae.safetensors`
- Stable-diffusion.cpp on Apple Metal may be more practical with compatible GGUF or quantized components, but the exact flags must be proven by BigMac help output.

Stage official or compatible files under:

```text
/Volumes/wc2tb/ImageGen/flux/flux1-schnell/
/Volumes/wc2tb/ImageGen/flux/shared/
```

Flux minimum staging requires a diffusion/model candidate, VAE candidate, and text encoder candidates unless the local BigMac binary clearly proves an embedded/no-component path.

## Safe BigMac Path Setup

Use these as user-facing setup commands. They are not model downloads.

```sh
ssh westcat 'whoami && hostname && test -d /Volumes/wc2tb && df -h /Volumes/wc2tb'
ssh westcat 'mkdir -p /Volumes/wc2tb/ImageGen/{checkpoints/sd15,checkpoints/sdxl-turbo,checkpoints/sdxl,flux/flux1-schnell,flux/shared,loras,vaes,embeddings,hypernetworks}'
```

If SSH write fails with `Operation not permitted` or similar macOS Transparency, Consent, and Control (TCC) restrictions, do not chmod, chown, wipe access control lists (ACLs), or change FileVault/SecureToken state. Create folders and copy files with Finder, Server Message Block (SMB), or BigMac local Terminal, then rerun the validation script.

## Validate After Staging

```sh
ssh westcat 'find /Volumes/wc2tb/ImageGen -maxdepth 4 -type f \( -name "*.safetensors" -o -name "*.gguf" -o -name "*.ckpt" \) -print -exec ls -lh {} \;'
```

From this project:

```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-model-stage-check.sh
```

The script writes:

```text
sdcpp-workflow/state/model-stage-cache.json
```

The Operator Console reads that cache through `GET /api/model-stage`, and `POST /api/actions/check-model-stage` runs the script as a tracked job.

## License and Access Notes

- SDXL Turbo uses Stability AI community/non-commercial licensing terms; commercial use requires checking Stability AI's current license or membership terms.
- Flux Schnell is Apache-2.0, but Hugging Face may still require accepting model access conditions.
- A file being staged is not the same as runtime support.

## Metal Support Notes

Apple Metal support comes from the stable-diffusion.cpp build, not from the model file. The BigMac binary must prove:

- it supports the model family,
- it accepts the required flags,
- it can produce a real PNG.

Only after a successful bounded smoke run should the app mark SDXL Turbo, Flux, or SDXL supported.

## Live Update — 2026-06-21

- `sd_xl_base_1.0.safetensors` is present and nonzero under `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`.
- `sdxl-turbo` is still blocked on the missing fp16 file; the 0B `sd_xl_turbo_q6p_q8p.ckpt` is not a valid smoke target.
- Flux is partial: `flux1-schnell-fp8.safetensors` and `ae.safetensors` are staged, but CLIP-L and T5XXL are missing.
- `bin/sdcpp-model-stage-check.sh` now rejects zero-byte and tiny placeholders in the stage cache.
- The next bounded smoke to pursue is SDXL base, after inspecting live `sd-cli --help` output and confirming the required flags.
