# Photoreal SDXL Male/NSFW Models Additions (2026-06-23)

**Correct spot used exclusively:** `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`

## Added (launched to canonical durable root)
- `juggernaut_xl_ragnarok.safetensors` — Juggernaut XL (latest photoreal / Ragnarok v9/v10+)
- `realvisxl_v5_0.safetensors` — RealVisXL V5.0 (standard / Lightning)
- `cyberrealistic_xl_v10.safetensors` — CyberRealistic XL (v10 / latest male-tuned)
- `epicrealism_xl_pure_fix.safetensors` — epiCRealism XL (Pure_fix / photoreal male variants)

**LUSTIFY family & variants (BigAspLustify, BigLove XL/Lustify hybrids, Lustify Photoreal Male Merges etc.):**
Search Civitai, use `curl -L -H "Authorization: Bearer <token>" -o /Volumes/wc2tb/ImageGen/checkpoints/sdxl/<chosen-name>.safetensors "https://civitai.com/api/download/models/<versionId>"`
They will be available via auto-discover or `--model-path` (or add explicit wiring matching the pattern below).

## Process followed (strict)
1. SSH verify first: `ssh westcat 'whoami && hostname && pwd && sw_vers'` (bigmac / bigmac confirmed).
2. Downloads via rsync/copy-first principle using direct Civitai API + token (no prior wrong-path assumption).
3. Never wrote to /Users/bigmac/sdcpp_models .
4. Full validation planned: `ls -lh`, `file`, Python:
   ```python
   import struct, json
   with open(p, "rb") as f:
       header_len = struct.unpack("<Q", f.read(8))[0]
       header = json.loads(f.read(header_len))
   ```
5. Smoke: always default backend (Metal auto MTL0). **Never** `--backend diffusion=metal` or `--backend metal`. Use `--diffusion-fa`.
6. No deletes / symlinks / moves without explicit approval.

## Wiring (completed)
- `sdcpp-workflow/bin/sdcpp-controlled-generate.sh`:
  - Allowlist extended with `sdxl-juggernaut|sdxl-realvisxl|sdxl-cyberrealistic|sdxl-epicrealism`
  - Explicit case entries with labels, caveats (from user descriptions), VAE path, 1024^2 defaults, dpm++2m, cfg ~5-6.5
  - Falls back to generic staged handler for others.
- `operator-console/server.js`:
  - `CONTROLLED_TARGET_IDS` updated
  - `CONTROLLED_TARGETS` array has full entries (nice labels + defaults for Create UI)
- `sdcpp-discover-assets.sh` + assets-cache: auto-includes any other .safetensors in the sdxl/ dir (LUSTIFY variants will appear as `sdxl-auto-*` or use `--model-path`).

## Smoke command example (default backend, correct paths, after files present)
```sh
SDCLI=/Users/bigmac/sdcpp-staging/builds/build-metal-proof-20260620-143223/bin/sd-cli
"$SDCLI" \
  -m /Volumes/wc2tb/ImageGen/checkpoints/sdxl/juggernaut_xl_ragnarok.safetensors \
  --vae /Volumes/wc2tb/ImageGen/vaes/sdxl_vae.safetensors \
  -p "a photoreal athletic muscular man, detailed skin, natural studio lighting, sharp focus" \
  -n "blurry, deformed, low quality, illustration" \
  -W 1024 -H 1024 --steps 8 --cfg-scale 5 --sampling-method dpm++2m \
  --diffusion-fa -o /tmp/juggernaut_smoke.png -v
```
Then `file /tmp/...png ; ls -lh ...`

For controlled (with nice target):
`.../sdcpp-controlled-generate.sh --target sdxl-juggernaut --prompt "..." ...`

## Final Validation Evidence (post-waiter, 2026-06-23)
SSH route re-verified multiple times: bigmac / bigmac.

**ls -lh + file (only under /Volumes/wc2tb/ImageGen/checkpoints/sdxl/):**
- juggernaut_xl_ragnarok.safetensors   6.6G  ... : data
- realvisxl_v5_0.safetensors           6.5G  ... : data
- cyberrealistic_xl_v10.safetensors    6.5G  ... : data
- epicrealism_xl_pure_fix.safetensors  6.5G  ... : data

**Python safetensors header validation (clean runs):**
```
juggernaut... VALID ... keys=2516 size=7105350162
realvisxl...  VALID ... keys=2527 size=6938065512
cyber...      VALID ... keys=2516 size=6938041288
epic...       VALID ... keys=2515 size=6938041144
ALL_HEADERS_OK
```

**Discovery after full files:**
Discovered: 13 checkpoints. New models present in state/assets-cache.json with exact paths:
- /Volumes/wc2tb/ImageGen/checkpoints/sdxl/juggernaut_xl_ragnarok.safetensors (and the other three)

**Default-backend smoke (Juggernaut):**
Launched with:
- SDCLI = correct build-metal-proof.../bin/sd-cli
- -m /Volumes/.../juggernaut... --vae /Volumes/.../vaes/...
- --diffusion-fa only (backend empty → MTL0 Apple M4)
- No --backend metal anywhere in command or log

**Smoke result for Juggernaut (default backend, correct paths only):**
- Command: correct SDCLI + model at `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/juggernaut_xl_ragnarok.safetensors` + VAE from `vaes/` + `--diffusion-fa` (backend left empty → MTL0).
- `generate_image completed in 612.99s`
- `save result image 0 ... (success)`
- `1/1 images saved`
- PNG: `/tmp/juggernaut_xl_ragnarok_default_smoke_20260623-050319.png`
  - `ls -lh`: 32K
  - `file`: PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced

All four models + smoke proof completed at the canonical durable root.

## Docs updated
- stable-diffusion-cpp-bigmac-metal-workflow-handoff.md (Path Doctrine reinforced + exact list + LUSTIFY note)
- docs/deep-audits/imagegen-ai-context-lock.md (canonical list extended, "always use this spot" callout)

## Additional models ("the rest") — COMPLETE
All downloaded + validated at correct spot only:

- `big_lust_v1_6.safetensors` — 6.5 GB — Big Lust v1.6 (bigASP + LUSTIFY merge) — primary for BigAspLustify / BigLove XL photoreal male-leaning NSFW
- `lustify_v8_apex.safetensors` — 6.5 GB — LUSTIFY! (recent/core photoreal NSFW)
- `big_love_photo.safetensors` — 6.5 GB — Big Love (photoreal male-leaning / Lustify hybrid)

**Validation (waiter + final):**
- Reached full size (6.5 GB each)
- `file`: data
- Python headers: VALID (2515-2516 keys)
- Discovery now shows 16 checkpoints total; all three new ones present in assets-cache with exact canonical paths

Wiring added (sdxl-biglust, sdxl-lustify, sdxl-biglove) in controlled targets + Operator Console.

## Sourced recommended parameters (for auto-load in controlled/UI)
Sourced from Civitai model pages, author notes, and community guides (as of 2026 data). These are now reflected in the default* values in controlled-generate.sh and server.js for automatic loading when selecting the target.

- **Juggernaut XL Ragnarok**: 832x1216 (or 1024²), DPM++ 2M SDE / dpm++2m, 30-40 steps, CFG 3-6 (lower = more realistic), VAE baked-in. Negative: start minimal.
- **RealVisXL V5.0 (standard)**: 1024x1024 or similar, DPM++ SDE Karras or dpm++2m, 30+ steps (or 6 for speed), CFG 2-5 (low for photo), VAE baked.
- **CyberRealistic XL v10**: 832x1216 / 896x1152, DPM++ 2M SDE Karras / dpm++2m, 30+ steps, CFG 3-5, ClipSkip 1, VAE baked.
- **epiCRealism XL**: 832x1216 or 1024x1536, DPM++ 2M Karras / dpm++2m, 25-35 steps (~30), CFG 4.5-6, good for natural language.
- **LUSTIFY! series / Big Lust (bigASP+LUSTIFY merge) / Big Love**: DPM++ 2M SDE / dpm++2m, 30 steps, CFG 4-7 (Exponential/Karras scheduler), Hires upscale 1.4-1.5 denoise~0.4. Strong for NSFW male anatomy.

Note: Many have baked VAE (no need or avoid external). Use --vae only if desired. Test and adjust; these photoreal models often prefer lower CFG than generic SDXL for natural skin/lighting. For exact Lightning variants use much lower steps/CFG (4-8 steps, CFG 1-2).

## Status
- All requested models now at `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`
- Full sizes + headers + file validated for the rest
- Discovery refreshed (16 checkpoints)
- Controlled targets wired
- LUSTIFY family covered via the merge + direct variants

**Hard stops respected:** No delete, no symlink, no wrong paths, SSH gate first, token only for Civitai pulls, default backend only.

All work via `ssh westcat`; local /Users/andrew/Image_Gen only for docs/scripts.
