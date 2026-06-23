# stable-diffusion.cpp BigMac/MacBook Workflow Handoff

Date: 2026-06-20

Target repository snapshot inspected locally:

```txt
leejet/stable-diffusion.cpp
stable-diffusion.cpp version master-709-92a3b73-1-g7f0e728
commit 7f0e728
```

Adversarial review status:

```txt
Reviewed against built sd-cli --help.
Reviewed against built sd-server --help.
Reviewed against README.md.
Reviewed against docs/build.md.
Reviewed against docs/quantization_and_gguf.md.
Reviewed against docs/flux.md.
Reviewed against docs/lora.md.
Reviewed against docs/backend.md.
Reviewed against docs/performance.md.
Reviewed against examples/server/runtime.cpp.
Reviewed against examples/server/README.md.
Reviewed against examples/server/api.md.
Reviewed against examples/server/routes_openai.cpp.
Reviewed against examples/server/routes_sdapi.cpp.
Reviewed against examples/server/routes_sdcpp.cpp.
Reviewed against wiki Home.md.
Reviewed against wiki How-to-Use-Z-Image-on-a-GPU-with-Only-4GB-VRAM.md.
Corrected server flags from invalid --host/--port to --listen-ip/--listen-port.
Corrected server launch to include model/context arguments.
Corrected BigMac clone workflow to avoid pre-creating the git destination.
Corrected bounded write probes to account for macOS timeout/gtimeout availability.
Corrected API response decoding examples to avoid Python in the proof path.
Added BigMac hardware and memory verification gates for the Apple Silicon / 32 GB assumption.
Added model-file presence gates before generation commands.
Added server structured LoRA syntax because server APIs intentionally reject prompt-embedded LoRA tags.
```

## Purpose

This document is a raw technical handoff for another AI to proof before Codex executes the final workflow.

The target architecture is:

- Inference runs on BigMac.
- The user interface runs on the MacBook.
- BigMac is reached from the MacBook through Tailscale and/or SSH forwarding.
- Large models and generated assets must respect BigMac external-drive constraints.
- Do not stop at build success, server health, model listing, or UI rendering. The proof boundary is an actual generated image returned to the MacBook UI.

## Known Stack Boundary

| Layer | Machine | Responsibility |
|---|---|---|
| UI/control surface | MacBook | Browser/native wrapper, workflow controls, preview/result display |
| Inference runtime | BigMac | Apple Silicon `stable-diffusion.cpp`, Metal backend, model loading, image generation |
| Network path | Tailscale plus SSH | MacBook-to-BigMac access, local port forwarding when needed |
| Large model storage | BigMac external APFS volume | `/Volumes/wc2tb`, especially model roots and generated output roots |
| Proof artifacts | MacBook-visible | final PNG, logs, command transcript, route proof, storage proof |

## Path Doctrine (Canonical Roots)

- MacBook project root: `/Users/andrew/Image_Gen`
- BigMac canonical model root (durable storage for Image_Gen models): `/Volumes/wc2tb/ImageGen`
- BigMac staging/build root: `/Users/bigmac/sdcpp-staging`

**Required layout for SDCPP models:**
- SDXL checkpoints: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`
- SD 1.5 checkpoints: `/Volumes/wc2tb/ImageGen/checkpoints/sd15/`
- SDXL VAEs: `/Volumes/wc2tb/ImageGen/vaes/`
- LoRAs: `/Volumes/wc2tb/ImageGen/loras/`
- Flux etc. under appropriate subdirs.

**CRITICAL:** Always put new SDXL photoreal (Juggernaut, RealVisXL, CyberRealistic, epiCRealism, LUSTIFY/BigAspLustify/BigLove variants etc.) under `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`. This is the durable canonical root. Never /Users/bigmac/sdcpp_models or staging for runtime models.

Never assume or hardcode `/Users/bigmac/sdcpp_models` or `~/sdcpp_models` as the Image_Gen model home. 

Use `MODEL_STAGE_ROOT=/Volumes/wc2tb/ImageGen` (or equivalent) in scripts.

Added photoreal SDXL male/NSFW-focused (per user list; **placed ONLY in correct spot /Volumes/wc2tb/ImageGen/checkpoints/sdxl/** ):
- juggernaut_xl_ragnarok.safetensors (Juggernaut XL v9/v10 / latest photoreal variant)
- realvisxl_v5_0.safetensors (RealVisXL V5.0 Lightning or standard)
- cyberrealistic_xl_v10.safetensors (CyberRealistic XL or latest male-tuned)
- epicrealism_xl_pure_fix.safetensors (epiCRealism XL natural sin / photoreal male variants)
- For the LUSTIFY family (LUSTIFY! core/latest, BigAspLustify, Lustify XL vX, LUSTIFY Photoreal Male Merge, BigLove Lustify Hybrid, BigLove XL / BigAspLustify variants): use Civitai search, direct api/download with token to the *same* sdxl/ dir. They will be auto-discovered or can be wired like the above.

**Reminder (critical):** correct durable spot is always /Volumes/wc2tb/ImageGen/checkpoints/sdxl/ for these SDXL. SSH verify first. copy/rsync first. no delete/symlink without explicit OK. default backend only (no --backend metal). Validate with ls/file/python header.

## Required BigMac Hardware Gate

The planned target is an Apple Silicon BigMac/Mac mini class host with 32 GB unified memory. Verify the live host before assigning memory budgets:

```sh
ssh westcat 'sysctl -n machdep.cpu.brand_string; sysctl -n hw.memsize; system_profiler SPHardwareDataType | sed -n "1,80p"; sw_vers'
```

Expected proof shape:

```txt
Apple processor identity is visible.
hw.memsize is approximately 34359738368 for 32 GiB.
system_profiler shows the Mac model and memory.
macOS version is visible.
```

If `hw.memsize` is materially below 32 GiB, do not use the 24 GiB `--max-vram` examples without recalculating the budget.

## Required BigMac Route Gate

Run before any model, build, storage, or UI work:

```sh
ssh westcat 'whoami && hostname && pwd && sw_vers'
```

Expected identity proof:

```txt
bigmac
bigmac
```

If the first two output lines are not `bigmac` and `bigmac`, stop.

## Required Tailscale Gate

On MacBook:

```sh
tailscale status
tailscale status | grep -i westcat
tailscale ping westcat
ssh westcat 'tailscale status; tailscale ip -4'
```

Acceptable proof:

```txt
westcat is visible in tailscale status
tailscale ping westcat succeeds
BigMac reports a Tailscale IPv4 address
ssh westcat succeeds
```

Use Tailscale for stable device reachability. Use SSH local forwarding for services that should remain bound to BigMac loopback.

Example local tunnel from MacBook to a BigMac service on port `7860`:

```sh
ssh -N -L 17860:127.0.0.1:7860 westcat
```

MacBook UI URL:

```txt
http://127.0.0.1:17860
```

## Historical Failure Modes To Avoid

### Failure: stopping at rendering

Symptom:

```txt
The workflow reaches a UI rendering step, but no actual image is produced and returned.
```

Cause:

```txt
The agent treats frontend rendering, server health, or endpoint reachability as completion.
```

Required fix:

```txt
The workflow is not complete until BigMac generates a real PNG and the MacBook UI can display or download it.
```

Required proof:

```sh
file output.png
ls -lh output.png
```

Expected proof shape:

```txt
output.png: PNG image data
```

### Failure: external drive appears mounted but writes hang

Symptom:

```txt
/Volumes/wc2tb is mounted and readable, but SSH-launched writes time out.
```

Known prior result:

```txt
/Volumes/wc2tb was mounted and readable as external APFS with substantial free space.
SSH-launched writes timed out repeatedly.
Home-directory writes succeeded.
```

Required fix:

```txt
Treat readable mount metadata as insufficient. Use bounded write probes before creating model/output workflows on /Volumes/wc2tb.
```

Required storage gates:

```sh
ssh westcat 'df -h /Volumes/wc2tb; diskutil info /Volumes/wc2tb | sed -n "1,80p"'
ssh westcat 'command -v gtimeout || command -v timeout || echo MISSING_TIMEOUT'
ssh westcat 'T=$(command -v gtimeout || command -v timeout) && "$T" 10 sh -c "date > /Volumes/wc2tb/sdcpp_write_probe.txt && sync && ls -l /Volumes/wc2tb/sdcpp_write_probe.txt"'
ssh westcat 'T=$(command -v gtimeout || command -v timeout) && "$T" 10 sh -c "rm -f /Volumes/wc2tb/sdcpp_write_probe.txt"'
ssh westcat 'T=$(command -v gtimeout || command -v timeout) && "$T" 10 sh -c "mkdir -p /Volumes/wc2tb/ImageGen/sdcpp_probe && date > /Volumes/wc2tb/ImageGen/sdcpp_probe/write.txt && ls -l /Volumes/wc2tb/ImageGen/sdcpp_probe/write.txt"'
```

If the timeout probe prints `MISSING_TIMEOUT`, install GNU coreutils on BigMac first:

```sh
ssh westcat 'brew install coreutils'
ssh westcat 'command -v gtimeout'
```

If any write probe hangs or fails, do not launch the inference workflow against `/Volumes/wc2tb`. Use a BigMac home-directory staging path first:

```txt
/Users/andrew/sdcpp-staging
```

### Failure: model listed but inference broken

Symptom:

```txt
Models appear in an API listing, but generation fails.
```

Known prior result:

```txt
curl http://127.0.0.1:11434/v1/models was not proof of inference health.
The specific prior failure signature was llama-server binary not found.
```

Required fix:

```txt
Keep model visibility separate from actual inference.
```

Required proof:

```txt
Run a real generation or completion. Do not accept /v1/models, /health, process existence, or a listening port as final proof.
```

### Failure: MacBook runtime drift

Symptom:

```txt
The agent accidentally tries to run inference on the MacBook.
```

Required fix:

```txt
MacBook is the client and UI surface only. BigMac is the inference host.
```

## Stable Diffusion Repository Build Commands

Clone:

```sh
git clone --recursive https://github.com/leejet/stable-diffusion.cpp
cd stable-diffusion.cpp
```

If already cloned:

```sh
cd stable-diffusion.cpp
git pull origin master
git submodule init
git submodule update
```

macOS system dependencies:

```sh
xcode-select --install
brew install cmake git coreutils node pnpm jq
brew install --cask tailscale
```

Minimum build-only dependencies:

```sh
brew install cmake git
```

Additional dependencies used by this handoff:

```txt
coreutils: provides gtimeout for bounded /Volumes/wc2tb probes
node: required for server frontend build path
pnpm: required for server frontend build path
jq: required for shell-only JSON extraction in API proof commands
tailscale: required for MacBook-to-BigMac private network path
```

Metal build:

```sh
mkdir build && cd build
cmake .. -DSD_METAL=ON
cmake --build . --config Release
```

Expected binaries:

```txt
build/bin/sd-cli
build/bin/sd-server
```

CLI help:

```sh
./build/bin/sd-cli --help
```

## BigMac Build Location

Preferred BigMac source path:

```txt
/Users/andrew/stable-diffusion.cpp
```

Preferred BigMac build path:

```txt
/Users/andrew/stable-diffusion.cpp/build
```

Preferred BigMac staging path if `/Volumes/wc2tb` writes are not proven:

```txt
/Users/andrew/sdcpp-staging
```

Preferred BigMac external model/output roots only after write probes pass:

```txt
/Volumes/wc2tb/ImageGen/stable-diffusion.cpp
/Volumes/wc2tb/ImageGen/models
/Volumes/wc2tb/ImageGen/outputs
```

Known external model root from prior BigMac/Ollama work:

```txt
/Volumes/wc2tb/ollama-models
```

## BigMac Build Workflow

```sh
ssh westcat 'if [ -e /Users/andrew/stable-diffusion.cpp ] && [ ! -d /Users/andrew/stable-diffusion.cpp/.git ]; then echo "BLOCKED: /Users/andrew/stable-diffusion.cpp exists but is not a git checkout"; exit 2; fi'
ssh westcat 'test -d /Users/andrew/stable-diffusion.cpp/.git || git clone --recursive https://github.com/leejet/stable-diffusion.cpp /Users/andrew/stable-diffusion.cpp'
ssh westcat 'cd /Users/andrew/stable-diffusion.cpp && git submodule update --init --recursive'
ssh westcat 'cd /Users/andrew/stable-diffusion.cpp && cmake -S . -B build -DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release'
ssh westcat 'cd /Users/andrew/stable-diffusion.cpp && cmake --build build --config Release -j 8'
ssh westcat 'cd /Users/andrew/stable-diffusion.cpp && ./build/bin/sd-cli --help'
```

## Model Conversion

Full precision `.safetensors` to `.gguf`:

```sh
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v
```

Quantized conversion:

```sh
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type f16
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type f32
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q8_0
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q5_0
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q5_1
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q4_0
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q4_1
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q2_K
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q3_K
./build/bin/sd-cli -M convert -m model.safetensors -o output.gguf -v --type q4_K
```

Quantization types listed in `docs/quantization_and_gguf.md`:

```txt
f16
f32
q8_0
q5_0
q5_1
q4_0
q4_1
```

Quantization examples listed in `sd-cli --help`:

```txt
f32
f16
q4_0
q4_1
q5_0
q5_1
q8_0
q2_K
q3_K
q4_K
```

FLUX docs table:

```txt
q8_0
q4_0
q4_k
q3_k
q2_k
```

FLUX quantization status:

```txt
Official FLUX documented conversion example: q8_0
Official FLUX documented comparison table: q8_0, q4_0, q4_k, q3_k, q2_k
CLI --type spelling from sd-cli --help: q8_0, q4_0, q2_K, q3_K, q4_K
Use uppercase K spelling for --type values passed to sd-cli.
Lowercase k appears in FLUX documentation filenames/table labels.
```

FLUX documented example:

```sh
./build/bin/sd-cli -M convert -m flux1-dev.safetensors -o flux1-dev-q8_0.gguf -v --type q8_0
```

FLUX q4_K conversion using CLI-supported `--type` spelling:

```sh
./build/bin/sd-cli -M convert -m flux1-dev.safetensors -o flux1-dev-q4_k.gguf -v --type q4_K
```

## SD 1.5 Inference Syntax

```sh
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors -p "a lovely cat" -n "blurry, low quality" -W 512 -H 512 --steps 20 --cfg-scale 7.0 --sampling-method euler_a -o output.png
```

## SDXL Inference Syntax

```sh
./build/bin/sd-cli -m sd_xl_base_1.0.safetensors --vae sdxl_vae-fp16-fix.safetensors -p "a lovely cat" -n "blurry, low quality" -W 1024 -H 1024 --steps 20 --cfg-scale 7.0 --sampling-method euler_a -v -o output.png
```

## FLUX.1-dev Inference Syntax

```sh
./build/bin/sd-cli --diffusion-model flux1-dev-q8_0.gguf --vae ae.safetensors --clip_l clip_l.safetensors --t5xxl t5xxl_fp16.safetensors -p "a lovely cat holding a sign says 'flux.cpp'" --cfg-scale 1.0 --sampling-method euler -v --clip-on-cpu -o output.png
```

## FLUX.1-schnell Inference Syntax

```sh
./build/bin/sd-cli --diffusion-model flux1-schnell-q8_0.gguf --vae ae.safetensors --clip_l clip_l.safetensors --t5xxl t5xxl_fp16.safetensors -p "a lovely cat holding a sign says 'flux.cpp'" --cfg-scale 1.0 --sampling-method euler -v --steps 4 --clip-on-cpu -o output.png
```

## FLUX Required Architectural Deviations

| Purpose | Flag |
|---|---|
| standalone diffusion model | `--diffusion-model flux1-dev-q8_0.gguf` |
| standalone VAE | `--vae ae.safetensors` |
| CLIP-L text encoder | `--clip_l clip_l.safetensors` |
| T5 XXL text encoder | `--t5xxl t5xxl_fp16.safetensors` |
| recommended CFG | `--cfg-scale 1.0` |
| recommended sampler | `--sampling-method euler` |
| documented CPU text encoder placement | `--clip-on-cpu` |
| schnell step count | `--steps 4` |

## LoRA Syntax

```sh
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors -p "a lovely cat<lora:my_lora:1>" --lora-model-dir . -o output.png
```

```sh
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors -p "a lovely cat<lora:my_lora:1>" --lora-model-dir . --lora-apply-mode auto -o output.png
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors -p "a lovely cat<lora:my_lora:1>" --lora-model-dir . --lora-apply-mode immediately -o output.png
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors -p "a lovely cat<lora:my_lora:1>" --lora-model-dir . --lora-apply-mode at_runtime -o output.png
```

FLUX LoRA:

```sh
./build/bin/sd-cli --diffusion-model flux1-dev-q8_0.gguf --vae ae.safetensors --clip_l clip_l.safetensors --t5xxl t5xxl_fp16.safetensors -p "a lovely cat holding a sign says 'flux.cpp'<lora:my_lora:1>" --cfg-scale 1.0 --sampling-method euler -v --lora-model-dir . --clip-on-cpu -o output.png
```

## External VAE Syntax

```sh
./build/bin/sd-cli -m sd_xl_base_1.0.safetensors --vae sdxl_vae-fp16-fix.safetensors -p "a lovely cat" -W 1024 -H 1024 -o output.png
```

## ControlNet Syntax

```sh
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors --control-net controlnet.safetensors --control-image control.png -p "a lovely cat" --control-strength 0.9 -W 512 -H 512 --steps 20 --cfg-scale 7.0 --sampling-method euler_a -o output.png
```

ControlNet with Canny:

```sh
./build/bin/sd-cli -m v1-5-pruned-emaonly.safetensors --control-net controlnet.safetensors --control-image control.png --canny -p "a lovely cat" --control-strength 0.9 -W 512 -H 512 --steps 20 --cfg-scale 7.0 --sampling-method euler_a -o output.png
```

## Core Generation Flags

| Function | Flag |
|---|---|
| prompt | `-p "a lovely cat"` |
| prompt | `--prompt "a lovely cat"` |
| negative prompt | `-n "blurry, low quality"` |
| negative prompt | `--negative-prompt "blurry, low quality"` |
| width | `-W 512` |
| width | `--width 512` |
| height | `-H 512` |
| height | `--height 512` |
| steps | `--steps 20` |
| CFG scale | `--cfg-scale 7.0` |
| sampler | `--sampling-method euler_a` |
| scheduler | `--scheduler karras` |
| output | `-o output.png` |
| seed | `-s 42` |
| seed | `--seed 42` |

Samplers:

```txt
euler
euler_a
heun
dpm2
dpm++2s_a
dpm++2m
dpm++2mv2
ipndm
ipndm_v
lcm
ddim_trailing
tcd
res_multistep
res_2s
er_sde
euler_cfg_pp
euler_a_cfg_pp
```

Schedulers:

```txt
discrete
karras
exponential
ays
gits
smoothstep
sgm_uniform
simple
kl_optimal
lcm
bong_tangent
ltx2
```

## Metal and Memory Flags

CPU threads:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" -t 8
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --threads 8
```

Metal backend:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend metal
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend diffusion=metal,te=cpu,vae=metal
```

Memory map:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --mmap
```

Flash attention:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --diffusion-fa
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --fa
```

CPU/offload compatibility flags:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --clip-on-cpu
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-on-cpu
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --control-net-cpu
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --offload-to-cpu
```

Preferred backend and parameter placement:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend metal --params-backend cpu
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend metal --params-backend disk
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend diffusion=metal,te=cpu,vae=cpu --params-backend diffusion=metal,te=cpu,vae=cpu
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --offload-to-cpu --params-backend te=disk
```

VRAM budget and streaming:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend metal --max-vram 24
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend diffusion=metal,vae=cpu,te=cpu --max-vram metal=24
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --backend metal --max-vram 24 --stream-layers
```

VAE memory reduction:

```sh
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-tiling
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-conv-direct
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-tile-size 32x32
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-relative-tile-size 0.5x0.5
./build/bin/sd-cli -m model.safetensors -p "a lovely cat" --vae-tile-overlap 0.5
```

## Backend Assignment Syntax

```sh
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend cpu
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend te=cpu,vae=metal,diffusion=metal
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend metal --params-backend te=cpu,vae=cpu
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend metal --params-backend disk
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend diffusion=metal,vae=cpu --max-vram metal=24
./build/bin/sd-cli -m model.safetensors -p "a cat" --backend all=metal,te=cpu
```

Backend modules:

| Module | Accepted names |
|---|---|
| `diffusion` | `diffusion`, `model`, `unet`, `dit` |
| `te` | `te`, `clip`, `text`, `textencoder`, `textencoders`, `conditioner`, `cond`, `llm`, `t5`, `t5xxl` |
| `clip_vision` | `clip_vision`, `clipvision`, `clip-vision`, `vision` |
| `vae` | `vae`, `firststage`, `autoencoder`, `tae` |
| `controlnet` | `controlnet`, `control` |
| `photomaker` | `photomaker`, `photomakerid`, `pmid`, `photo` |
| `upscaler` | `upscaler`, `esrgan`, `hires` |

Backend names:

```txt
cpu
cuda0
vulkan0
metal
auto
default
gpu
```

Parameter backend special value:

```txt
disk
```

## BigMac CLI Proof Workflow

Run on BigMac through SSH after route and storage gates:

```sh
ssh westcat 'mkdir -p /Users/andrew/sdcpp-staging/models /Users/andrew/sdcpp-staging/outputs'
ssh westcat 'test -f /Users/andrew/sdcpp-staging/models/model.safetensors && ls -lh /Users/andrew/sdcpp-staging/models/model.safetensors'
ssh westcat 'cd /Users/andrew/stable-diffusion.cpp && ./build/bin/sd-cli -m /Users/andrew/sdcpp-staging/models/model.safetensors -p "a lovely cat" -n "blurry, low quality" -W 512 -H 512 --steps 1 --cfg-scale 7.0 --sampling-method euler_a --backend metal --diffusion-fa -o /Users/andrew/sdcpp-staging/outputs/output.png -v'
ssh westcat 'file /Users/andrew/sdcpp-staging/outputs/output.png && ls -lh /Users/andrew/sdcpp-staging/outputs/output.png'
scp westcat:/Users/andrew/sdcpp-staging/outputs/output.png ./output.png
file ./output.png
```

Use `--steps 1` only for smoke proof. Use normal step counts after the path is proven.

## BigMac Server/UI Proof Workflow

`sd-server` flags verified from `./build/bin/sd-server --help`:

```txt
-l, --listen-ip
--listen-port
--serve-html-path
-v, --verbose
--color
-h, --help
```

Server must run on BigMac with model/context arguments. SD 1.5 server example:

```sh
ssh westcat 'test -f /Users/bigmac/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors && ls -lh /Users/bigmac/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors'
ssh westcat 'cd /Users/bigmac/stable-diffusion.cpp && ./build/bin/sd-server -m /Users/bigmac/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors --listen-ip 127.0.0.1 --listen-port 7860 --backend metal --diffusion-fa -v'
```

SDXL server example:

```sh
ssh westcat 'test -f /Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors && test -f /Volumes/wc2tb/ImageGen/vaes/vae-ft-mse-840000-ema-pruned.safetensors && ls -lh /Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors /Volumes/wc2tb/ImageGen/vaes/vae-ft-mse-840000-ema-pruned.safetensors'
ssh westcat 'cd /Users/bigmac/stable-diffusion.cpp && ./build/bin/sd-server -m /Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors --vae /Volumes/wc2tb/ImageGen/vaes/vae-ft-mse-840000-ema-pruned.safetensors --listen-ip 127.0.0.1 --listen-port 7860 --backend metal --diffusion-fa -v'
```

FLUX.1-dev server example:

```sh
ssh westcat 'test -f /Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell-fp8.safetensors && test -f /Volumes/wc2tb/ImageGen/flux/shared/ae.safetensors && test -f /Volumes/wc2tb/ImageGen/flux/shared/clip_l.safetensors && test -f /Volumes/wc2tb/ImageGen/flux/shared/t5xxl_fp16.safetensors && ls -lh /Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell-fp8.safetensors /Volumes/wc2tb/ImageGen/flux/shared/ae.safetensors /Volumes/wc2tb/ImageGen/flux/shared/clip_l.safetensors /Volumes/wc2tb/ImageGen/flux/shared/t5xxl_fp16.safetensors'
ssh westcat 'cd /Users/bigmac/stable-diffusion.cpp && ./build/bin/sd-server --diffusion-model /Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell-fp8.safetensors --vae /Volumes/wc2tb/ImageGen/flux/shared/ae.safetensors --clip_l /Volumes/wc2tb/ImageGen/flux/shared/clip_l.safetensors --t5xxl /Volumes/wc2tb/ImageGen/flux/shared/t5xxl_fp16.safetensors --cfg-scale 1.0 --sampling-method euler --listen-ip 127.0.0.1 --listen-port 7860 --backend diffusion=metal,te=cpu,vae=metal --diffusion-fa -v'
```

MacBook tunnel:

```sh
ssh -N -L 17860:127.0.0.1:7860 westcat
```

MacBook UI URL:

```txt
http://127.0.0.1:17860
```

Server health/capability checks are allowed but not sufficient:

```sh
curl -s http://127.0.0.1:17860/sdcpp/v1/capabilities
curl -s http://127.0.0.1:17860/v1/models
curl -s http://127.0.0.1:17860/sdapi/v1/samplers
curl -s http://127.0.0.1:17860/sdapi/v1/schedulers
```

OpenAI-compatible image generation smoke proof:

```sh
curl -s http://127.0.0.1:17860/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a lovely cat","n":1,"size":"512x512","output_format":"png"}' \
  -o /tmp/sdcpp-openai-image-response.json
```

Decode OpenAI-compatible base64 output on MacBook without Python:

```sh
jq -r '.data[0].b64_json' /tmp/sdcpp-openai-image-response.json | base64 --decode > /tmp/sdcpp-openai-output.png
file /tmp/sdcpp-openai-output.png
ls -lh /tmp/sdcpp-openai-output.png
```

Stable Diffusion WebUI-compatible image generation smoke proof:

```sh
curl -s http://127.0.0.1:17860/sdapi/v1/txt2img \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a lovely cat","negative_prompt":"blurry, low quality","width":512,"height":512,"steps":1,"cfg_scale":7.0,"sampler_name":"euler_a","scheduler":"discrete","batch_size":1}' \
  -o /tmp/sdcpp-sdapi-image-response.json
```

Decode WebUI-compatible base64 output on MacBook without Python:

```sh
jq -r '.images[0]' /tmp/sdcpp-sdapi-image-response.json | base64 --decode > /tmp/sdcpp-sdapi-output.png
file /tmp/sdcpp-sdapi-output.png
ls -lh /tmp/sdcpp-sdapi-output.png
```

Native async image generation smoke proof:

```sh
curl -s -i http://127.0.0.1:17860/sdcpp/v1/img_gen \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a lovely cat","negative_prompt":"blurry, low quality","width":512,"height":512,"seed":42,"batch_count":1,"sample_params":{"scheduler":"discrete","sample_method":"euler_a","sample_steps":1,"guidance":{"txt_cfg":7.0}},"output_format":"png"}' \
  -o /tmp/sdcpp-native-submit-response.txt
```

Extract native async job ID:

```sh
sed -n '/^{/,$p' /tmp/sdcpp-native-submit-response.txt > /tmp/sdcpp-native-submit-response.json
jq -r '.id' /tmp/sdcpp-native-submit-response.json > /tmp/sdcpp-native-job-id.txt
cat /tmp/sdcpp-native-job-id.txt
```

Poll native async job:

```sh
JOB_ID=$(cat /tmp/sdcpp-native-job-id.txt)
curl -s "http://127.0.0.1:17860/sdcpp/v1/jobs/${JOB_ID}" -o /tmp/sdcpp-native-job-response.json
jq '.status, .error' /tmp/sdcpp-native-job-response.json
```

Decode native async output after status is `completed`:

```sh
jq -r '.result.images[0].b64_json' /tmp/sdcpp-native-job-response.json | base64 --decode > /tmp/sdcpp-native-output.png
file /tmp/sdcpp-native-output.png
ls -lh /tmp/sdcpp-native-output.png
```

If the status is `queued` or `generating`, repeat the poll. If the status is `failed`, inspect:

```sh
jq '.error' /tmp/sdcpp-native-job-response.json
```

Native async API endpoints:

```txt
GET /sdcpp/v1/capabilities
POST /sdcpp/v1/img_gen
GET /sdcpp/v1/jobs/{id}
POST /sdcpp/v1/jobs/{id}/cancel
POST /sdcpp/v1/vid_gen
```

Compatibility API endpoints:

```txt
POST /v1/images/generations
POST /v1/images/edits
GET /v1/models
POST /sdapi/v1/txt2img
POST /sdapi/v1/img2img
GET /sdapi/v1/loras
GET /sdapi/v1/upscalers
GET /sdapi/v1/latent-upscale-modes
GET /sdapi/v1/samplers
GET /sdapi/v1/schedulers
GET /sdapi/v1/sd-models
GET /sdapi/v1/options
```

Server LoRA rule:

```txt
Server APIs do not parse <lora:...> prompt tags.
CLI supports prompt-embedded <lora:...> tags.
Server APIs require structured LoRA fields where supported.
```

List server-visible LoRA files:

```sh
curl -s http://127.0.0.1:17860/sdapi/v1/loras
```

Expected `GET /sdapi/v1/loras` response shape:

```json
[
  {
    "name": "my_lora",
    "path": "my_lora.safetensors"
  }
]
```

Stable Diffusion WebUI-compatible LoRA generation syntax:

```sh
curl -s http://127.0.0.1:17860/sdapi/v1/txt2img \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a lovely cat","negative_prompt":"blurry, low quality","width":512,"height":512,"steps":1,"cfg_scale":7.0,"sampler_name":"euler_a","scheduler":"discrete","batch_size":1,"lora":[{"path":"my_lora.safetensors","multiplier":1.0}]}' \
  -o /tmp/sdcpp-sdapi-lora-response.json
```

Native async LoRA generation syntax:

```sh
curl -s -i http://127.0.0.1:17860/sdcpp/v1/img_gen \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a lovely cat","negative_prompt":"blurry, low quality","width":512,"height":512,"seed":42,"batch_count":1,"lora":[{"path":"my_lora.safetensors","multiplier":1.0}],"sample_params":{"scheduler":"discrete","sample_method":"euler_a","sample_steps":1,"guidance":{"txt_cfg":7.0}},"output_format":"png"}' \
  -o /tmp/sdcpp-native-lora-submit-response.txt
```

Do not call this complete until:

```txt
MacBook UI loads.
MacBook UI sends generation request to BigMac.
BigMac writes a PNG.
MacBook UI displays or downloads the PNG.
The PNG is verified with file and ls -lh.
```

## Required Another-AI Proof Checklist

The other AI should produce a plan and proof report with these gates:

```txt
1. BigMac route gate passed with ssh westcat identity proof.
2. Tailscale status and BigMac Tailscale IPv4 were captured.
3. BigMac hardware and memory were captured with sysctl and system_profiler.
4. /Volumes/wc2tb read and bounded write behavior was classified.
5. If /Volumes/wc2tb write failed, workflow used /Users/andrew/sdcpp-staging.
6. Required model files existed before generation commands ran.
7. stable-diffusion.cpp was cloned with submodules.
8. Metal build completed.
9. ./build/bin/sd-cli --help ran on BigMac.
10. ./build/bin/sd-server --help ran on BigMac.
11. A one-step CLI generation produced a real output.png on BigMac.
12. Server OpenAI-compatible or sdapi-compatible generation produced a real PNG on MacBook.
13. Native /sdcpp/v1/img_gen async generation produced a completed job and decodable PNG.
14. UI proof did not stop at rendering; it displayed or downloaded a real PNG.
15. The final report separated route proof, hardware proof, storage proof, build proof, inference proof, API proof, and UI proof.
```

## Non-Negotiable Completion Boundary

The workflow is complete only when all of the following are true:

```txt
BigMac identity is verified.
Tailscale/SSH route is verified.
BigMac Apple Silicon hardware and memory are verified.
Storage write behavior is verified or safely bypassed.
Required model files exist on the selected storage path.
Metal binary exists on BigMac.
Actual inference runs on BigMac.
Actual PNG is produced.
Actual PNG is accessible on MacBook.
MacBook UI is only the UI/control surface.
No claim depends solely on /health, /v1/models, /sdcpp/v1/capabilities, a listening port, or a rendered UI shell.
```
