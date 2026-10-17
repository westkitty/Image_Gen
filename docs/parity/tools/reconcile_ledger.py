#!/usr/bin/env python3
"""P01 reconciliation of the DexDiffusion A1111 parity ledger (schema v2).

Inputs : the v1 ledger (258 provisional rows), the AST inventory written by
         enumerate_a1111.py, and this file's authored tables.
Outputs: the ledger upgraded in place to schema v2 (every original field and
         receipt preserved; structured proof fields added; summary computed)
         and docs/parity/A1111_UPSTREAM_INVENTORY.json (every upstream item
         mapped to a ledger row or classified with a reason).

Idempotent: re-running keeps receipts and any field already set on a row
unless the STATE table below names a newer value. The node test
tests/parity-ledger.test.js enforces the invariants.

Usage: python3 -I reconcile_ledger.py <inventory.json> <repo_root>
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

SCHEMA = "dexdiffusion.a1111.parity-ledger.v2"
PIN = "82a973c04367123ae98bd9abdf80d9eda9b910e2"
UP = f"https://github.com/AUTOMATIC1111/stable-diffusion-webui/blob/{PIN}/"

ENUMS = {
    "source_status": {"P": "PRESENT", "A": "ABSENT", "N": "NOT_APPLICABLE"},
    "ui_status": {"E": "EXPOSED", "D": "DISABLED_WITH_REASON", "A": "ABSENT", "N": "NOT_APPLICABLE"},
    "wiring_status": {"W": "WIRED", "R": "REJECTED_WITH_REASON", "A": "ABSENT", "N": "NOT_APPLICABLE"},
    "automated_proof": {"UB": "UNIT_AND_BROWSER", "U": "UNIT", "B": "BROWSER", "-": "NONE"},
    "live_proof": {"L": "LIVE_PROVEN", "R": "NOT_REQUIRED", "-": "NONE"},
    "release_status": {"C": "COMPLETE", "P": "PARTIAL", "Q": "PENDING", "B": "BLOCKED", "X": "EXCLUDED"},
}

# ---------------------------------------------------------------------------
# Area defaults: where a row lives in the product and which path executes it.
AREA = {
    "PR": ("Generate › Prompt (concept-a.js buildConceptGenerate; workstation-ui.js)",
           "POST /api/actions/generate-controlled {prompt, negative_prompt}; /api/preview/generation",
           "server.js normalizeControlledGenerationBody → prompt-parity.js validateForTarget → controlled-args.js buildControlledArgs → sdcpp-controlled-generate.sh | mflux-controlled-generate.sh",
           "SDCPP sd15/sdxl-* (A1111 attention parser); MFLUX FLUX.2 Klein 4B (literal text)"),
    "GN": ("Generate form (concept-a.js; workstation-ui.js _createBody)",
           "POST /api/actions/generate-controlled",
           "controlled-args.js → sdcpp-controlled-generate.sh (sd-cli 7f0e728) | mflux-controlled-generate.sh",
           "SDCPP sd15, sdxl-base, sdxl-turbo, sdxl-photonic; MFLUX FLUX.2 Klein 4B"),
    "SD": ("Generate › Seed / Advanced sampling; Seed Lab",
           "POST /api/actions/generate-controlled {seed, eta, rng}",
           "controlled-args.js normalizeSamplingFields → sd-cli --seed/--eta/--rng",
           "SDCPP targets (sd-cli); MFLUX seed only"),
    "HR": ("Generate › High-Res panel (workstation-ui.js)",
           "POST /api/actions/generate-controlled {hires, hires_*}",
           "controlled-args.js validateHiresFields → sd-cli --hires*",
           "SDCPP targets; not MFLUX"),
    "ED": ("Edit workbench › Img2Img (edit-ui.js, source-resize.js)",
           "POST /api/actions/img2img",
           "server.js img2img → bin/resize-source.py → sdcpp img2img script (sd-cli -i/--strength)",
           "SDCPP sd15 (capability img2img: sd15)"),
    "IP": ("Edit workbench › Inpaint / Outpaint (edit-ui.js mask editor, inpaint-options.js)",
           "POST /api/actions/inpaint, /api/actions/outpaint",
           "server.js handleInpaint → bin/inpaint-region.py → sd-cli --init-img/--mask → compositePasteBack",
           "SDCPP sd15"),
    "EX": ("Enhance › Extras / Real-ESRGAN (workstation-ui.js, extras-options.js)",
           "POST /api/actions/upscale {extras}; /api/actions/upscale-esrgan",
           "sdcpp-upscale.sh --extras-json → bin/extras-resize.py (Pillow); Big Mac RealESRGAN_x4plus",
           "Pillow resamplers (MacBook); RealESRGAN_x4plus.pth (Big Mac)"),
    "SC": ("Batch / Sweep (workstation-ui.js: X/Y/Z, Prompt Matrix, Prompts from list)",
           "POST /api/xyz, /api/promptmatrix, /api/promptlines (+ /plan); /api/queues",
           "durable queue → per-cell /api/actions/generate-controlled; /api/xyz/:id/grid",
           "SDCPP targets; MFLUX for axes it honours"),
    "RS": ("Settings › Capabilities; model picker; extra networks (component.js, network-tokens.js)",
           "GET /api/models, /api/extra-networks, /api/models/headers; POST /api/models/inspect, /api/models/secondary/activate",
           "model-inspect.js → safetensors-inspect.py (header only); sdcpp-secondary-slot.sh",
           "SDCPP checkpoints; MFLUX fixed model"),
    "MT": ("Library › PNG Info / image detail (workstation-ui.js, infotext.js)",
           "POST /api/pnginfo; GET /api/images/:id/infotext, /api/images/:id/export",
           "png-text.js; infotext.js; image-store.js (canonical originals untouched)",
           "All image outputs"),
    "JO": ("Job Center (dexdiffusion-v12.js); Create Interrupt; Batch queue",
           "GET /api/jobs, /api/events; POST /api/jobs/:id/cancel, /api/queues/:id/:action",
           "server.js job runner + cancellation.js + sdcpp-remote-cancel.sh; event-bus.js",
           "All Big Mac image jobs"),
    "ST": ("Generate › Advanced sampling; Settings",
           "POST /api/actions/generate-controlled",
           "controlled-args.js → sd-cli flags",
           "SDCPP targets"),
    "CN": ("Enhance › Reference edit (FLUX.2); Puppet Master (absent)",
           "POST /api/actions/flux2-edit; ControlNet: none",
           "mflux-controlled-edit.sh → mflux-generate-flux2-edit; sd-cli --control-net (no weights)",
           "FLUX.2 Klein 4B reference edit; no ControlNet weights installed"),
}

# ---------------------------------------------------------------------------
# Rows found missing by the P01 upstream scan (2026-10-16). Stable new IDs.
NEW_ROWS = [
    ("PR-23", "Prompt editor and prompt language", "Keyboard attention editing (Ctrl+Up/Down weight, Alt+Left/Right move)",
     "modules/shared_options.py", "keyedit_precision_attention, keyedit_precision_extra, keyedit_delimiters, keyedit_move (javascript/edit-attention.js)",
     "Ctrl/Cmd+Up/Down wraps the word or selection in (x:w) and steps the weight by the configured precision; Alt+Left/Right moves comma-separated elements; undo intact"),
    ("ED-22", "Img2img", "Upscaler used for img2img resize",
     "modules/shared_options.py", "upscaler_for_img2img",
     "When img2img must enlarge the source, the selected upscaler (default None = Lanczos) prepares it; recorded in metadata"),
    ("ST-17", "Settings", "K-sampler quantization",
     "modules/shared_options.py", "enable_quantization",
     "Apply sigma quantization in K samplers when enabled; reject where the engine has no equivalent"),
    ("ST-18", "Settings", "SDXL crop and aesthetic-score conditioning",
     "modules/shared_options.py", "sdxl_crop_top, sdxl_crop_left, sdxl_refiner_low_aesthetic_score, sdxl_refiner_high_aesthetic_score",
     "SDXL micro-conditioning values reach the model; refiner aesthetic scores apply when a refiner runs"),
    ("ST-19", "Settings", "SD3 T5 text-encoder toggle",
     "modules/shared_options.py", "sd3_enable_t5",
     "Enable/disable T5 for SD3 checkpoints; applicable only when an SD3 checkpoint is installed"),
    ("MT-20", "Metadata and output", "Save img2img init images",
     "modules/shared_options.py", "save_init_img, outdir_init_images",
     "Optionally keep a copy of the img2img init image linked to the result, without touching canonical originals"),
    ("EX-25", "Extras and postprocessing", "Postprocessing inside txt2img/img2img",
     "modules/shared_options.py", "postprocessing_enable_in_main_ui, postprocessing_disable_in_extras",
     "Selected postprocessing operations run automatically on generated images, producing a separate derived artifact"),
    ("SC-26", "Scripts and XYZ plot", "XYZ remaining axis types",
     "scripts/xyz_grid.py", "AxisOption: Styles, RNG source, Face restore, Image CFG Scale, Cond. Image Mask Weight, Token merging ratio(s), FP8 mode, Size, Var. seed/strength, Initial noise multiplier, Extra noise",
     "Each stock axis type is either executable on a compatible target or refused with the engine reason"),
]

EXCLUDE = {
    "PR-16": "Not stock at the pinned commit: no prompt-comment stripping exists in modules/prompt_parser.py, processing.py or styles.py (grep 'comment' finds only model-hijack comments). Retained as a row so the decision is visible; not a mandatory parity obligation.",
    "PR-19": "Not stock at the pinned commit: wildcards are a third-party extension (sd-dynamic-prompts); upstream source contains no wildcard expansion. DexDiffusion keeps its own /api/wildcards feature outside the parity gate.",
}

# ---------------------------------------------------------------------------
# Per-row structured state. Columns:
#   id | src | ui | wire | auto | live | release | blocker | next_action
# Codes: see ENUMS. Evidence for every L is a run directory under
# sdcpp-workflow/runs or a canonical image named in the row's receipts.
STATE = r"""
PR-01|P|E|W|UB|L|C||Prompt reaches the worker verbatim (redacted logs); every live run since P02 used it; focus/caret retained (form-stability.browser.js)
PR-02|P|E|W|UB|L|P|MFLUX has no negative prompt (hidden with reason) |Prove negative-prompt effect with a paired live SDCPP run recorded as a receipt
PR-03|P|E|W|-|R|Q||Audit workstation-ui clear-prompt; add restore-last-prompt and a browser test
PR-04|A|D|N|-|-|B|No tokenizer for sd.cpp/FLUX.2 available locally; count shown as 'unknown for this backend' |Ship CLIP BPE vocab (approval) or count via sd-cli
PR-05|A|D|N|-|-|B|Same as PR-04 |Same as PR-04
PR-06|P|E|W|UB|R|P||A1111 styles.csv import/export missing
PR-07|P|E|W|UB|R|P||Live use of an applied style not recorded; styles.csv interop missing
PR-08|P|E|W|UB|L|P|MFLUX treats emphasis as literal text (shown) |Complete for SDCPP; keep MFLUX note
PR-09|P|E|W|UB|L|P|As PR-08 |Live negative-weight receipt
PR-10|P|E|W|UB|L|P|As PR-08 |—
PR-11|A|D|R|UB|-|B|sd-cli 7f0e728 has no prompt-editing schedule; MFLUX none. Requests rejected with offset+reason |Needs approved stepwise-conditioning adapter or engine upgrade (Opus packet)
PR-12|A|D|R|UB|-|B|No alternation in sd-cli/MFLUX; rejected |As PR-11
PR-13|A|D|R|UB|-|B|No composable AND in sd-cli/MFLUX; rejected |As PR-11
PR-14|P|E|W|UB|-|P|BREAK supported by sd-cli parser, rejected on MFLUX |Live BREAK receipt
PR-15|A|A|N|-|-|Q||Chunk indicator (75-token CLIP chunks) needs a tokenizer (see PR-04)
PR-16|N|N|N|-|-|X|Not stock (see exclusion_reason) |—
PR-17|P|E|W|UB|R|P||In-editor offset highlighting missing
PR-18|P|E|W|UB|R|P||As PR-07
PR-19|N|N|N|-|-|X|Not stock (see exclusion_reason) |—
PR-20|P|E|N|-|R|Q||Not stock A1111 beyond browser undo; verify textarea undo survives re-render (form-stability)
PR-21|A|A|A|-|-|B|No CLIP/BLIP interrogator weights installed |Approval packet: BLIP/CLIP interrogator weights
PR-22|A|A|A|-|-|B|No DeepBooru weights installed |Approval packet: DeepDanbooru weights
PR-23|P|E|W|UB|R|C||Ported edit-attention.js + edit-order.js (Ctrl/Cmd+Up/Down weights, Alt+Left/Right order); tests/edit-attention.test.js + prompt-language.browser.js
GN-01|P|E|W|UB|L|C||Live runs on sdxl-photonic, sd15 (activation photonic→sd15 ~5 s) and MFLUX Klein 4B
GN-02|P|E|W|UB|L|P|17 sd-cli samplers live; stock LMS, DPM2 a, DPM++ SDE/2M SDE/3M SDE/2M SDE Heun, DPM fast/adaptive, DDIM, DDIM CFG++, PLMS, UniPC, Restart absent in sd-cli |Engine upgrade or adapter (P05 decision)
GN-03|P|E|W|UB|L|P|Stock Polyexponential, Beta, Align Your Steps, Normal/Uniform not shown equal to sd-cli schedulers |Map remaining sd-cli schedulers with live proof
GN-04|P|E|W|UB|L|C||XYZ Steps axis live (4 distinct images); progress n/n proves exact steps
GN-05|P|E|W|UB|L|C||XYZ CFG axis live; MFLUX guidance hidden per F07
GN-06|A|D|R|U|-|B|--img-cfg-scale only for instruct/edit models; none installed |Install an InstructPix2Pix-class model (approval)
GN-07|P|E|W|UB|L|C||Live 512/768/1024 and 640x576 outputs with exact dimensions; dimension-policy tests
GN-08|P|E|W|UB|L|C||As GN-07
GN-09|P|E|W|-|R|Q||Add browser assertion for swap width/height
GN-10|P|E|W|U|R|Q||Add browser assertion for aspect presets
GN-11|P|E|W|U|L|P|Quantity >16 runs sequentially; A1111 batch count semantics not separately proven |Live receipt: quantity 2 seeds s, s+1
GN-12|A|D|N|-|-|B|sd-cli has batch count only; quantity ≤16 is one native batch, not A1111 batch size |Document mapping; engine has no per-batch size
GN-13|P|E|W|UB|L|C||Live run with tiling: 'vae_tiling_params', 25 tiles (run 20261016-033232)
GN-14|A|D|R|U|-|B|No GFPGAN/CodeFormer weights or PyTorch |Approval packet (face restoration)
GN-15|A|A|A|-|-|Q||Per-job checkpoint override = choose target; prove target switch inside a queue
GN-16|P|D|A|-|-|B|No external VAE installed (discovery lists 0) |Install a VAE (approval) then prove --vae
GN-17|A|A|A|-|-|B|sd-cli has no UNet override flag for these families |Engine upgrade
GN-18|N|N|N|-|-|Q||Audit which legacy override params exist in A1111 override_settings
GN-19|P|E|W|UB|R|C||Server validators reject bad input before queueing (controlled-args tests, preview 400s)
GN-20|P|E|W|U|R|Q||Add test for seed + quantity overflow past 2^32-1
SD-01|P|E|W|UB|L|C||Identical pixels for identical seed: SDCPP e4f39cbb1b714ccf (independent runs), MFLUX ca58eda05947f901 (22 runs)
SD-02|P|E|W|U|L|C||-1 resolves to a recorded random seed (every live run's metadata)
SD-03|P|E|W|-|L|Q||Add browser test for 'Reuse last seed'
SD-04|A|D|R|U|-|B|sd-cli has no variation seed |Latent-noise adapter (Opus packet)
SD-05|A|D|R|U|-|B|As SD-04 |As SD-04
SD-06|A|D|R|U|-|B|As SD-04 |As SD-04
SD-07|A|D|R|U|-|B|As SD-04 |As SD-04
SD-08|A|D|R|U|-|B|sd-cli has no seed resize-from |As SD-04
SD-09|A|D|R|U|-|B|As SD-08 |As SD-04
SD-10|A|D|R|U|-|B|No subseed without SD-04 |As SD-04
SD-11|P|E|W|U|L|P|sd-cli batch seeds are seed+i; A1111 'enable_batch_seeds' equivalence unproven |Paired live comparison
SD-12|P|E|W|U|L|P||Seed Lab increment/same/random; add browser test
SD-13|P|E|W|UB|L|P|sd.cpp cuda/cpu/std_default RNG; equivalence to A1111 CPU/GPU/NV not claimed |—
SD-14|P|E|W|UB|L|C||eta live on ddim_trailing/tcd; disabled for samplers without eta
SD-15|P|E|W|UB|L|C||eta live on euler_a/dpm++2s_a
SD-16|A|D|R|U|-|B|No eta noise seed delta in sd-cli |Engine upgrade/adapter
SD-17|A|D|R|U|-|B|No s_churn in sd-cli |Engine upgrade/adapter
SD-18|A|D|R|U|-|B|No s_tmin/s_tmax |Engine upgrade/adapter
SD-19|A|D|R|U|-|B|No s_noise |Engine upgrade/adapter
SD-20|A|D|R|U|-|B|Only a custom --sigmas list exists |Engine upgrade/adapter
SD-21|A|D|R|U|-|B|No rho |Engine upgrade/adapter
SD-22|A|D|R|U|-|B|No beta schedule |Engine upgrade/adapter
SD-23|A|D|R|U|-|B|No UniPC |Engine upgrade/adapter
SD-24|A|D|R|U|-|B|No zero-terminal-SNR |Engine upgrade/adapter
SD-25|A|D|R|U|-|B|No skip-early-cond/NGMS |Engine upgrade/adapter
SD-26|A|D|R|U|-|B|No SGM noise multiplier |Engine upgrade/adapter
SD-27|A|D|R|U|-|B|No discard-penultimate-sigma |Engine upgrade/adapter
SD-28|A|D|R|U|-|B|No initial noise multiplier |Engine upgrade/adapter
SD-29|A|D|R|U|-|B|No extra noise |Engine upgrade/adapter
HR-01|P|E|W|UB|L|C||Five live hires runs with exact dimensions; disabled for MFLUX
HR-02|P|E|W|UB|L|C||scale 1.5 → 768x768 live
HR-03|P|E|W|UB|L|C||resize-to 640x576 live
HR-04|P|E|W|UB|L|C||resize-to 640x576 live
HR-05|P|E|W|UB|L|P|All 8 no-model upscalers allowlisted (3 proven live); model-backed hires upscalers need --hires-upscalers-dir weights |Live runs for remaining upscalers; ESRGAN dir
HR-06|P|E|W|UB|L|C||hires 4 steps live (sd-cli log)
HR-07|P|E|W|UB|L|C||denoise 0.5 live (sd-cli log)
HR-08|A|D|R|U|-|B|sd-cli has no second-pass prompt |Engine upgrade/adapter
HR-09|A|D|R|U|-|B|As HR-08 |As HR-08
HR-10|A|D|R|U|-|B|As HR-08 |As HR-08
HR-11|A|D|R|U|-|B|As HR-08 |As HR-08
HR-12|A|D|R|U|-|B|As HR-08 |As HR-08
HR-13|P|E|W|UB|L|C||Preview equals live output dimensions
HR-14|A|D|R|U|-|B|No SDXL refiner switch in sd-cli (--high-noise-* is Wan dual-expert) |Engine upgrade/adapter (Opus packet)
HR-15|A|D|R|U|-|B|As HR-14 |As HR-14
HR-16|A|D|R|U|-|B|As HR-14 |As HR-14
HR-17|A|D|R|U|-|B|As HR-14 |As HR-14
HR-18|A|A|A|-|-|B|A1111 post-hires on an existing image needs latent re-entry; sd-cli img2img is not equivalent |Engine adapter
ED-01|P|E|W|UB|L|P|Edit workers always load sdcpp.env REMOTE_MODEL (SD1.5); Edit now offers and records only that model (was: other checkpoints selectable but ignored, lineage mislabelled) |Prove SDXL img2img with its own worker model before offering it
ED-02|A|A|A|-|-|Q||Sketch mode: colour brush on canvas, composited into init image
ED-03|P|E|W|B|L|C||Mask editor (brush/eraser/undo/redo) used by live inpaint runs
ED-04|A|A|A|-|-|Q||Inpaint Sketch: colour strokes + derived mask
ED-05|A|A|A|-|-|Q||Upload a mask image for inpaint
ED-06|A|A|A|-|-|Q||Batch img2img over uploaded images via the queue
ED-07|A|A|A|-|-|Q||Directory input with a safe import boundary
ED-08|A|A|A|-|-|Q||Mask directory for batch inpaint
ED-09|A|A|A|-|-|Q||Per-file PNG-info overrides in batch img2img
ED-10|P|E|W|UB|L|C||Live img2img jobs with exact dimensions (P07)
ED-11|P|E|W|UB|L|C||As ED-10
ED-12|P|E|W|UB|L|C||As ED-10
ED-13|A|D|R|U|-|B|sd-cli has no latent-space resize for img2img |Engine adapter
ED-14|P|E|W|UB|L|C||As ED-10
ED-15|P|E|W|UB|L|C||As ED-10
ED-16|P|E|W|UB|R|C||Source dimensions detected and shown
ED-17|P|E|W|UB|L|C||Strength reaches sd-cli (--strength), exact-steps progress 5/5 vs 8/8
ED-18|A|D|R|U|-|B|No InstructPix2Pix model installed |As GN-06
ED-19|P|E|W|UB|L|C||Transparency flattened onto chosen colour (resize-source.py) live
ED-20|A|D|R|U|-|Q||Port A1111 colour correction (LAB histogram match via skimage) — needs numpy/skimage or a pure-Python port
ED-21|P|E|W|UB|L|C||Exact-steps formula corrected against live sd-cli t_enc
ED-22|A|A|A|-|-|Q||Use selected upscaler when img2img enlarges the source
IP-01|P|E|W|B|L|C||Mask paint/erase/undo/redo used by live inpaint runs
IP-02|P|E|W|B|R|C||Zoom/pan in the mask editor (edit-workbench.browser.js)
IP-03|P|E|W|B|R|C||Grow/shrink/feather/blur/invert (edit-workbench.browser.js)
IP-04|P|E|W|UB|L|C||mask_blur 12 widened the changed region live
IP-05|A|A|A|-|-|Q||Mask transparency (A1111 mask_alpha) for Inpaint Sketch
IP-06|P|E|W|UB|L|C||Mask mode masked / not masked (invert) live
IP-07|P|E|R|UB|L|P|original/fill live; latent noise/latent nothing need latent access |Engine adapter for latent modes
IP-08|P|E|W|UB|L|C||Whole/only-masked live, outside pixels identical
IP-09|P|E|W|UB|L|C||Padding 32 live
IP-10|A|D|R|U|-|B|sd-cli exposes no conditioning-mask weight |Engine adapter
IP-11|A|A|A|-|-|Q||Save mask and masked composite as derived artifacts
IP-12|P|E|W|UB|L|C||Paste-back keeps untouched pixels identical (live)
IP-13|A|D|R|U|-|B|Soft inpainting needs latent blending inside the sampler |Engine adapter
IP-14|P|E|W|UB|L|C||Poor man's outpainting (outpaint-a1111.py + script-chains.js): live run 20261016-213554-outpaint-poor (2 tiles, fill); mask blur within ±1 grey of OpenCV
IP-15|P|E|W|UB|L|C||Outpainting mk2: matched noise identical to upstream on reference canvases (numpy/pure-Python FFT); live run 20261016-213646-outpaint-mk2; mask blur within ±1 grey of OpenCV
IP-16|P|E|W|UB|L|C||Direction checkboxes + pixels to expand for both stock scripts (live)
IP-17|P|E|W|UB|L|C||Mask blur, fall-off exponent, colour variation (mk2) and tile overlap (poor man) per upstream
EX-01|P|E|W|UB|L|C||Single image Extras live (1024x768 crop, 1.5x bicubic)
EX-02|A|A|A|-|-|Q||Batch uploaded Extras
EX-03|A|A|A|-|-|Q||Directory Extras with safe import boundary
EX-04|P|E|W|UB|L|C||1.5x live
EX-05|P|E|W|UB|L|C||1024x768 live
EX-06|P|E|W|UB|R|C||Max side length (limit_size_by_one_dimention) + 4096 px cap; upstream //8 sizing (upscaler.py) — tests/extras-options.test.js
EX-07|P|E|W|UB|L|C||Crop-to-fit live
EX-08|P|E|W|UB|L|P|Pillow resamplers only; Upscaler 1 None refused as the A1111 no-op it is; Real-ESRGAN still a separate card |Real-ESRGAN as Extras upscaler 1/2
EX-09|P|E|W|UB|L|P|As EX-08 |As EX-08
EX-10|P|E|W|UB|L|C||0.3 Nearest blend live
EX-11|P|A|W|-|-|P|/api/actions/upscale-esrgan accepts tile_size 32-512 (sd-cli --upscale-tile-size); not exposed in the Extras UI |Expose tile size in Extras with Real-ESRGAN as upscaler
EX-12|A|A|A|-|-|B|sd-cli has no ESRGAN tile-overlap option (only --upscale-tile-size) |Engine upgrade
EX-13|P|E|W|UB|L|C||SD upscale overlap (split_grid/combine_grid port); live run 20261016-213425-sd-upscale (4 tiles, overlap 64)
EX-14|P|E|W|UB|L|C||Scale factor 1-4 step 0.05; live 512->768 (x1.5, //8 sizing)
EX-15|P|E|W|UB|L|P|Lanczos / Nearest (+Bicubic/Bilinear, None) work; model upscalers (Real-ESRGAN pre-upscale) refused with reason |Wire Real-ESRGAN as SD upscale pre-upscaler
EX-16|A|D|R|U|-|B|No GFPGAN weights or PyTorch |Approval packet
EX-17|A|D|R|U|-|B|Depends on EX-16 |Approval packet
EX-18|A|D|R|U|-|B|No CodeFormer weights or PyTorch |Approval packet
EX-19|A|D|R|U|-|B|Depends on EX-18 |Approval packet
EX-20|A|D|R|U|-|B|Depends on EX-18 |Approval packet
EX-21|A|A|A|-|-|Q||Postprocessing operation order
EX-22|P|E|W|-|L|P|Extras writes a derived artifact, original untouched; before-restoration copies need EX-16 |—
EX-23|A|D|R|U|-|B|No LDSR/ScuNET/SwinIR/DAT/HAT weights |Approval packet
EX-24|A|A|A|-|-|Q||PNG/JPEG/WebP output with quality
EX-25|A|A|A|-|-|Q||Auto-postprocess in Generate/Edit
SC-01|P|E|W|UB|L|P|Missing axis types (see SC-06..09, SC-26) |—
SC-02|P|E|W|UB|L|P|As SC-01 |—
SC-03|P|E|W|UB|L|P|As SC-01 |—
SC-04|P|E|W|UB|L|P|Var. seed/strength axes blocked (SD-04) |—
SC-05|P|E|W|UB|R|P||Live Prompt S/R receipt
SC-06|P|E|W|U|-|P||Prompt order axis (apply_order port, itertools order) wired UI->server; needs browser + live receipt
SC-07|A|A|A|-|-|Q||Checkpoint axis via slot activation per group of cells; VAE/Refiner blocked
SC-08|P|E|W|U|-|P||Hires steps / upscaler / Denoising axes (gated on High-Res on); needs browser + live receipt
SC-09|A|D|R|U|-|B|No sigma/noise flags in sd-cli |Engine upgrade
SC-10|P|E|W|U|-|P||Width, Height and Size (WxH) axes; live receipt for Size
SC-11|P|E|W|UB|L|P|Combined all-Z grid / sub grids missing |—
SC-12|P|E|W|UB|R|P|Value picker (dropdown mode) missing |Parser now matches xyz_grid.py (linspace truncation, arange overshoot, empty S/R values, -1 seeds, + signs)
SC-13|P|E|W|U|-|P||Swap X/Y, Y/Z, X/Z buttons + cost-ordered processing; browser test
SC-14|P|E|W|U|-|P||Per-axis Vary seeds (cell() offsets) and Keep -1; live receipt
SC-15|P|E|W|UB|R|C||64-cell cap and large-plot confirmation (tests)
SC-16|P|E|W|UB|-|P||Grid orientation fixed to draw_prompt_matrix (ceil(N/2) across); live Prompt Matrix receipt
SC-17|P|E|W|UB|-|P||Live receipt; margins in grid
SC-18|P|E|W|UB|-|P||Insert at start/end and per-line random seeds now as prompts_from_file.py; live receipt
SC-19|P|E|W|UB|R|P||Dry run shown via /plan; browser proven
SC-20|P|E|W|UB|L|C||Loopback (script-chains.js): live run 20261016-212926-loopback, 2 real sd-cli passes, only the final image published
SC-21|P|E|W|UB|L|C||calculate_denoising_strength port; live sd-cli logs show strength 0.5 then 0.3 (Linear, final 0.3)
SC-22|A|A|A|-|-|B|Interrogation weights absent (PR-21/22) |As PR-21
SC-23|A|A|A|-|-|B|Img2img Alternative needs Euler noise inversion inside the sampler |Engine adapter
SC-24|A|A|R|-|-|B|Arbitrary code execution is refused by policy; stock A1111 also requires --allow-code |User policy decision (keep refused)
SC-25|P|E|W|B|R|P|Edit script choice/options persist per browser; XYZ / Prompt Matrix option persistence not verified |Browser test for XYZ/Matrix persistence
SC-26|A|A|A|-|-|Q||Remaining axis types executable or refused with reason
RS-01|P|E|W|UB|L|C||19 checkpoints discovered and header-read live
RS-02|P|E|W|UB|L|P|Header facts shown; preview images and SHA-256 short hash missing |Add previews/hash
RS-03|P|E|W|U|L|P|Switch via secondary-slot activation (~5 s live); A1111 quick-switch dropdown parity |Browser test
RS-04|P|D|W|U|-|B|No LoRA installed on Big Mac |Install a LoRA (approval) then prove weight effect
RS-05|P|E|W|U|-|P||Needs installed LoRA for live proof
RS-06|A|A|A|-|-|Q||LoRA directory tree/filter/sort (fixture-testable)
RS-07|P|D|A|-|-|B|No textual-inversion embedding installed |Install an embedding (approval)
RS-08|A|D|R|U|-|B|sd-cli has no hypernetwork support; tags refused |Engine upgrade
RS-09|P|D|A|-|-|B|No external VAE installed |As GN-16
RS-10|A|A|A|-|-|B|No UNet override in sd-cli |Engine upgrade
RS-11|A|A|A|-|-|Q||Default LoRA multiplier setting applied by the token scanner
RS-12|P|E|W|UB|L|C||Strict scanner; refusals verified through the real validator
RS-13|P|E|W|UB|L|P|Header family check present; no LoRA to prove a live refusal |—
RS-14|P|E|W|U|L|C||wc2tb readability probed by an actual SSH read; doctor FAILs honestly
RS-15|P|E|W|U|R|Q||Audit turbo defaults (steps/CFG) against MODEL_CARDS
RS-16|A|A|A|-|-|B|sd-cli optimisation flags not mapped to A1111 settings |Map --diffusion-fa/--vae-on-cpu etc. where equivalent
RS-17|A|D|R|U|-|B|No hires/refiner checkpoint in sd-cli |As HR-10
MT-01|P|E|W|UB|L|C||Real exported PNG read back with every field restorable
MT-02|P|E|W|UB|L|C||Parser checked against hostile input
MT-03|P|E|W|UB|L|C||Send to Create restores all mapped fields
MT-04|P|E|W|UB|R|C||Unavailable fields labelled
MT-05|P|E|W|UB|R|P|Hash recomputation absent |Compare model hash when headers carry one
MT-06|P|E|W|UB|L|C||Export copy with embedded parameters; canonical file untouched; prompt only if saved
MT-07|P|E|W|U|L|C||Sidecar .txt in exports (settings only unless prompts saved); live export receipt 2026-10-16
MT-08|P|E|W|B|R|C||DexLightbox gallery/lightbox (concept-a, edit-workbench suites)
MT-09|P|E|W|UB|L|P|Grids exist for XYZ/Prompt Matrix only |Batch grid for quantity>1
MT-10|P|E|W|U|R|P|Row count / colours / margins partly |Grid options
MT-11|P|E|W|B|R|P|Library images can be sent; uploaded (non-library) images cannot |Send uploaded PNG Info image to Edit/Extras
MT-12|P|E|W|U|R|P||Export copy of the selected image; browser test for the export panel
MT-13|P|E|W|U|L|C||Save-all ZIP (Library) via POST /api/images/export; live ZIP verified by unzip
MT-14|P|E|W|U|L|C||A1111 filename tokens ([seed]-[steps]-[sampler] live); prompt tokens empty when prompts are not saved
MT-15|P|E|W|U|L|C||PNG/JPEG/WebP export copies; live JPEG with EXIF UserComment; canonical originals byte-identical
MT-16|P|E|W|U|L|C||Quality 1-100, WebP lossless, metadata none/infotext
MT-17|P|E|W|UB|L|C||Copy infotext from a real image
MT-18|P|E|W|U|L|P||Lineage diff endpoint exists; variations UI test
MT-19|P|E|W|U|L|P|Cancelled/partial outputs not published; A1111 'save incomplete' option absent |—
MT-20|A|A|A|-|-|Q||Keep init image copy for img2img results
JO-01|P|E|W|UB|L|C||Generate button → job → canonical image (every live run)
JO-02|P|E|W|UB|L|P|Remote stop verified for sd-cli/MFLUX/ESRGAN live; batch-generate and legacy xyz-plot unverified |Carry run id for shared sd-server paths
JO-03|A|A|A|-|-|Q||Skip current image in a multi-image job
JO-04|P|E|W|U|R|P|Queue stop-after-current exists; not for a single multi-image job |Extend to quantity jobs
JO-05|A|A|A|-|-|Q||Queue reorder/remove (DexDiffusion operational)
JO-06|P|E|W|UB|L|C||Measured totalPercent/currentRunPercent; indeterminate when unknown
JO-07|P|E|W|U|R|C||Median ETA from ≥3 comparable samples (timing-store)
JO-08|A|A|A|-|-|Q||Correction: sd-cli HAS --preview proj/vae/tae + --preview-path/--preview-interval. Design: remote preview file streamed back during the run without touching the protected generation contract
JO-09|A|A|A|-|-|Q||Incremental batch grid preview
JO-10|P|E|W|U|R|P||Resume after UI refresh: SSE snapshot; browser test
JO-11|P|E|W|U|R|C||Restart reconciliation marks running jobs INTERRUPTED (tests)
JO-12|P|E|W|U|R|C||/api/preflight for quantity ≥4 and queues
JO-13|P|E|W|UB|R|C||Preview request == sent request (generate-sampling.browser.js)
JO-14|P|E|W|U|L|P||Stage labels for generate; edit stages audit
JO-15|P|E|W|U|R|P|Cmd/Ctrl+Enter exists; no Interrupt/Skip shortcut |Add shortcut + test
ST-01|P|E|W|UB|L|P|Sigma settings blocked (SD-17..21) |—
ST-02|P|E|W|UB|L|C||clip_skip 1 live ('clip_skip: 1' in log); SDXL uses same flag
ST-03|A|A|A|-|-|B|sd-cli has one emphasis implementation; no mode switch |Engine upgrade
ST-04|A|A|A|-|-|B|TAESD weights not installed (9.8 MB, MIT; approval packet item 3); sd-cli --taesd exists |Install TAESD on approval, then map VAE decode method
ST-05|P|E|W|U|L|P|kl_optimal live; others see GN-03 |—
ST-06|A|A|A|-|-|B|FP8 storage is a PyTorch option; sd-cli uses its own quant types |Map --type where equivalent
ST-07|A|A|A|-|-|B|No token merging in sd-cli |Engine upgrade
ST-08|A|A|A|-|-|B|No Hypertile in sd-cli |Engine upgrade
ST-09|A|A|A|-|-|B|No pad/batch cond-uncond options |Engine upgrade
ST-10|A|A|A|-|-|B|No persistent cond cache |Engine upgrade
ST-11|A|A|A|-|-|B|Model cache/offload choices not mapped |Map --offload-to-cpu/--vae-on-cpu where equivalent
ST-12|A|A|A|-|-|B|Legacy compatibility modes are PyTorch-implementation specific |Engine upgrade
ST-13|A|A|A|-|-|B|No VAE precision rescue flag |Map --vae-tiling/precision where equivalent
ST-14|A|A|A|-|-|Q||Colour-correction and mask options (see ED-20, IP-05, IP-11)
ST-15|A|A|A|-|-|Q||Preview method / interval settings on top of JO-08 (tae needs approval packet item 3)
ST-16|P|E|W|U|R|P|Recipes/per-job overrides exist; A1111 override_settings mapping incomplete |—
ST-17|A|A|A|-|-|B|No K-sampler quantization in sd-cli |Engine upgrade
ST-18|A|A|A|-|-|B|sd-cli exposes no SDXL crop/aesthetic conditioning |Engine upgrade
ST-19|N|N|N|-|-|B|No SD3 checkpoint installed |Install SD3 (approval) — optional
CN-01|A|A|A|-|-|B|No ControlNet weights on either machine |Approval packet (ControlNet canny/openpose)
CN-02|A|A|A|-|-|B|Depends on CN-01 |Approval packet
CN-03|A|A|A|-|-|B|sd-cli --canny exists; OpenPose preprocessor absent |Approval packet
CN-04|A|A|A|-|-|B|--control-strength exists; unprovable without weights |Approval packet
CN-05|A|A|A|-|-|B|sd-cli has no start/end fraction |Engine upgrade
CN-06|A|A|A|-|-|B|Depends on CN-01 |Approval packet
CN-07|A|A|A|-|-|B|Depends on CN-01 |Approval packet
CN-08|A|A|A|-|-|B|Depends on CN-01 |Approval packet
CN-09|A|A|A|-|-|B|sd-cli takes one --control-net |Engine upgrade
CN-10|P|E|W|UB|R|P||Puppet Master OpenPose-18 PNG/JSON export (unit + harness browser); Edit mount needs a browser test
CN-11|P|E|W|B|R|P||Plain-DOM editor, data:/blob: backgrounds only, no iframe/remote code; mounted in Edit (browser test pending)
CN-12|P|E|W|UB|L|P|No multi-reference, no strength control in mflux-generate-flux2-edit |—
CN-13|A|A|A|-|-|B|No OpenPose ControlNet |Approval packet
CN-14|A|A|A|-|-|B|Depends on CN-13 |Approval packet
CN-15|A|A|A|-|-|Q||A/B comparison exists (F10); needs pose lineage from CN-10
"""


def parse_state() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for line in STATE.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 9:
            raise SystemExit("bad STATE line: " + line)
        rid, src, ui, wire, auto, live, rel, blocker, nxt = parts
        out[rid] = {
            "source_status": ENUMS["source_status"][src],
            "ui_status": ENUMS["ui_status"][ui],
            "wiring_status": ENUMS["wiring_status"][wire],
            "automated_proof": ENUMS["automated_proof"][auto],
            "live_proof": ENUMS["live_proof"][live],
            "release_status": ENUMS["release_status"][rel],
            "blocker": blocker or None,
            "next_action": None if nxt in ("", "—") else nxt,
        }
    return out


# ---------------------------------------------------------------------------
# Upstream inventory → row mapping. First matching rule wins.
# (kind, file regex, label/key regex, target) — target is a row id list or
# "CLASS:<classification>:<reason>".
RULES = [
    # exclusions
    ("component", r"modules/ui\.py", r"Embedding|Hypernetwork|Dataset|Log directory|Max steps|Learning rate|Gradient|Prompt template|Train|Create embedding|Create hypernetwork|Initialization text|Number of vectors|Overwrite Old|Modules|layer structure|activation function|Layer weights|layer normalization|dropout|Dropout|Do not resize images|PNG alpha channel|embedding in PNG|Read parameters|Shuffle tags|Drop out tags|latent sampling method|Save an image to log|Save a copy of embedding|^Name$|^Interrupt$", "CLASS:EXCLUDED_TRAINING:Train tab (training is excluded)"),
    ("setting", r".*", r"^training$", "CLASS:EXCLUDED_TRAINING:training section"),
    # top row
    ("component", r"ui_toprow", r"^Prompt$", ["PR-01"]), ("component", r"ui_toprow", r"^Negative prompt$", ["PR-02"]),
    ("component", r"ui_toprow", r"^Interrupt", ["JO-02"]), ("component", r"ui_toprow", r"^Skip$", ["JO-03"]),
    ("component", r"ui_toprow", r"^Generate$", ["JO-01"]), ("component", r"ui_toprow", r"📎", ["PR-21"]), ("component", r"ui_toprow", r"📦", ["PR-22"]),
    # ui_common gallery buttons
    ("component", r"ui_common", r"💾", ["MT-12"]), ("component", r"ui_common", r"🗃", ["MT-13"]), ("component", r"ui_common", r"🖼", ["MT-11"]),
    ("component", r"ui_common", r"🎨", ["MT-11"]), ("component", r"ui_common", r"📐", ["MT-11"]), ("component", r"ui_common", r"✨", ["HR-18"]),
    ("component", r"ui_common", r"Output", ["MT-08"]),
    ("component", r"ui_extra_networks", r"Save preview", ["RS-02"]), ("component", r"ui_extra_networks", r"Refresh", ["RS-01"]),
    # generation ui
    ("component", r"modules/ui\.py", r"^Override settings$", ["ST-16"]),
    ("component", r"modules/ui\.py", r"^Width$|^Height$", ["GN-07", "GN-08"]),
    ("component", r"modules/ui\.py", r"^CFG Scale$", ["GN-05"]), ("component", r"modules/ui\.py", r"^Image CFG Scale$", ["GN-06", "ED-18"]),
    ("component", r"modules/ui\.py", r"^Batch count$", ["GN-11"]), ("component", r"modules/ui\.py", r"^Batch size$", ["GN-12"]),
    ("component", r"modules/ui\.py", r"^Hires\. fix$", ["HR-01"]), ("component", r"modules/ui\.py", r"^Upscaler$", ["HR-05"]),
    ("component", r"modules/ui\.py", r"^Hires steps$", ["HR-06"]), ("component", r"modules/ui\.py", r"^Upscale by$", ["HR-02"]),
    ("component", r"modules/ui\.py", r"^Resize width to$", ["HR-03"]), ("component", r"modules/ui\.py", r"^Resize height to$", ["HR-04"]),
    ("component", r"modules/ui\.py", r"^Checkpoint$", ["HR-10"]), ("component", r"modules/ui\.py", r"^Hires sampling method$", ["HR-11"]),
    ("component", r"modules/ui\.py", r"^Hires schedule type$", ["HR-12"]), ("component", r"modules/ui\.py", r"^Hires prompt$", ["HR-08"]),
    ("component", r"modules/ui\.py", r"^Hires negative prompt$", ["HR-09"]),
    ("component", r"modules/ui\.py", r"^Denoising strength$", ["ED-17", "HR-07"]),
    ("component", r"modules/ui\.py", r"^Source$", ["ED-01"]), ("component", r"modules/ui\.py", r"^Output$", ["MT-08"]),
    ("component", r"modules/ui\.py", r"Image for img2img", ["ED-01"]), ("component", r"modules/ui\.py", r"Image for inpainting", ["ED-03"]),
    ("component", r"modules/ui\.py", r"Color sketch inpainting", ["ED-04"]), ("component", r"modules/ui\.py", r"^Mask$", ["ED-05"]),
    ("component", r"modules/ui\.py", r"Append png info|PNG info directory|Parameters to take from png info", ["ED-09"]),
    ("component", r"modules/ui\.py", r"^Input directory$|^Output directory$", ["ED-07"]), ("component", r"modules/ui\.py", r"mask directory", ["ED-08"]),
    ("component", r"modules/ui\.py", r"^Resize mode$", ["ED-10", "ED-11", "ED-12", "ED-13"]), ("component", r"modules/ui\.py", r"^Scale$", ["ED-15"]),
    ("component", r"modules/ui\.py", r"^Unused$", "CLASS:NOT_A_CONTROL:hidden placeholder slider in img2img resize tab"),
    ("component", r"modules/ui\.py", r"^Mask blur$", ["IP-04"]), ("component", r"modules/ui\.py", r"^Mask transparency$", ["IP-05"]),
    ("component", r"modules/ui\.py", r"^Mask mode$", ["IP-06"]), ("component", r"modules/ui\.py", r"^Masked content$", ["IP-07"]),
    ("component", r"modules/ui\.py", r"^Inpaint area$", ["IP-08"]), ("component", r"modules/ui\.py", r"Only masked padding", ["IP-09"]),
    # extras ui
    ("component", r"ui_postprocessing", r"^Source$", ["EX-01"]), ("component", r"ui_postprocessing", r"directory", ["EX-03"]),
    ("component", r"ui_postprocessing", r"Show result images", ["EX-02"]),
    # processing scripts
    ("component", r"processing_scripts/sampler", r"Sampling method", ["GN-02"]), ("component", r"processing_scripts/sampler", r"Schedule type", ["GN-03"]),
    ("component", r"processing_scripts/sampler", r"Sampling steps", ["GN-04"]),
    ("component", r"processing_scripts/seed", r"^Seed$", ["SD-01", "SD-02", "SD-03"]), ("component", r"processing_scripts/seed", r"^Extra$", ["SD-04"]),
    ("component", r"processing_scripts/seed", r"Variation seed", ["SD-04", "SD-06", "SD-07"]), ("component", r"processing_scripts/seed", r"Variation strength", ["SD-05"]),
    ("component", r"processing_scripts/seed", r"from width", ["SD-08"]), ("component", r"processing_scripts/seed", r"from height", ["SD-09"]),
    ("component", r"processing_scripts/refiner", r"^Refiner$", ["HR-14"]), ("component", r"processing_scripts/refiner", r"Checkpoint", ["HR-15"]),
    ("component", r"processing_scripts/refiner", r"Switch at", ["HR-16"]),
    # stock scripts
    ("component", r"custom_code", r".*", ["SC-24"]),
    ("component", r"img2imgalt", r".*", ["SC-23"]),
    ("component", r"loopback", r"Loops", ["SC-20"]), ("component", r"loopback", r"Final denoising|curve", ["SC-21"]), ("component", r"loopback", r"interrogated", ["SC-22"]),
    ("component", r"outpainting_mk_2", r".*", ["IP-15", "IP-16", "IP-17"]), ("component", r"poor_mans_outpainting", r".*", ["IP-14", "IP-16"]),
    ("component", r"postprocessing_codeformer", r"CodeFormer|Visibility", ["EX-18", "EX-19"]), ("component", r"postprocessing_codeformer", r"Weight", ["EX-20"]),
    ("component", r"postprocessing_gfpgan", r"GFPGAN", ["EX-16"]), ("component", r"postprocessing_gfpgan", r"Visibility", ["EX-17"]),
    ("component", r"postprocessing_upscale", r"^Upscale$", ["EX-01"]), ("component", r"postprocessing_upscale", r"^Upscaler 1$", ["EX-08"]),
    ("component", r"postprocessing_upscale", r"^Upscaler 2$", ["EX-09"]), ("component", r"postprocessing_upscale", r"visibility", ["EX-10"]),
    ("component", r"postprocessing_upscale", r"^Resize$|^Upscale by$", ["EX-04"]), ("component", r"postprocessing_upscale", r"Max side", ["EX-06"]),
    ("component", r"postprocessing_upscale", r"^Width$|^Height$", ["EX-05"]), ("component", r"postprocessing_upscale", r"Crop to fit", ["EX-07"]),
    ("component", r"postprocessing_upscale", r"^Upscaler$", ["EX-08"]),
    ("component", r"prompt_matrix", r"Select prompt|different seed", ["SC-16"]), ("component", r"prompt_matrix", r".*", ["SC-17"]),
    ("component", r"prompts_from_file", r".*", ["SC-18"]),
    ("component", r"sd_upscale", r"Tile overlap", ["EX-13"]), ("component", r"sd_upscale", r"Scale Factor", ["EX-14"]), ("component", r"sd_upscale", r"Upscaler", ["EX-15"]),
    ("component", r"xyz_grid", r"Swap", ["SC-13"]), ("component", r"xyz_grid", r"legend|Sub Images|Sub Grids|margins", ["SC-11"]),
    ("component", r"xyz_grid", r"Keep -1|Vary seeds", ["SC-14"]), ("component", r"xyz_grid", r"text inputs|values", ["SC-12"]),
    ("component", r"xyz_grid", r"X type", ["SC-01"]), ("component", r"xyz_grid", r"Y type", ["SC-02"]), ("component", r"xyz_grid", r"Z type", ["SC-03"]),
    ("component", r"soft_inpainting", r".*", ["IP-13"]),
    # xyz axes
    ("xyz_axis", r".*", r"^Nothing$", ["SC-01"]),
    ("xyz_axis", r".*", r"^(Seed|Steps|CFG Scale|Sampler|Eta)$", ["SC-04"]),
    ("xyz_axis", r".*", r"^Prompt S/R$", ["SC-05"]), ("xyz_axis", r".*", r"^Prompt order$", ["SC-06"]),
    ("xyz_axis", r".*", r"^(Checkpoint name|VAE|Refiner checkpoint|Refiner switch at)$", ["SC-07"]),
    ("xyz_axis", r".*", r"^(Hires steps|Hires sampler|Hires upscaler|Denoising)$", ["SC-08"]),
    ("xyz_axis", r".*", r"sigma|Sigma|rho|Beta schedule|UniPC|SGM|discard", ["SC-09"]),
    ("xyz_axis", r".*", r"^(Schedule type|Clip skip)$", ["SC-04"]),
    ("xyz_axis", r".*", r".*", ["SC-26"]),
    # samplers / schedulers
    ("sampler", r".*", r".*", ["GN-02"]), ("scheduler", r".*", r".*", ["GN-03"]),
]

SETTING_RULES = [
    # (section regex, key regex, target)
    (r"^saving-images$", r"^samples_format$|^grid_format$", ["MT-15"]),
    (r"^saving-images$", r"filename_pattern|save_images_add_number|replace_action|grid_extended_filename|use_upscaler_name_as_suffix|use_original_name_batch", ["MT-14"]),
    (r"^saving-images$", r"^samples_save$|^save_selected_only$|^save_write_log_csv$", ["MT-12"]),
    (r"^saving-images$", r"^grid_save$|grid_only_if_multiple|grid_prevent_empty_spots", ["MT-09"]),
    (r"^saving-images$", r"^n_rows$|^font$|grid_text|grid_background", ["MT-10"]),
    (r"^saving-images$", r"grid_zip_filename_pattern", ["MT-13"]),
    (r"^saving-images$", r"before_face_restoration|before_highres_fix|before_color_correction", ["EX-22"]),
    (r"^saving-images$", r"^save_mask", ["IP-11"]),
    (r"^saving-images$", r"jpeg_quality|webp_lossless|export_for_4chan|img_downscale_threshold|target_side_length", ["MT-16"]),
    (r"^saving-images$", r"img_max_size_mp", ["GN-19"]),
    (r"^saving-images$", r"save_init_img", ["MT-20"]),
    (r"^saving-images$", r"save_incomplete_images", ["MT-19"]),
    (r"^saving-images$", r"temp_dir|clean_temp_dir", "CLASS:NOT_GENERATION_AFFECTING:temporary-file housekeeping; DexDiffusion owns staging under state/"),
    (r"^saving-images$", r"notification", "CLASS:NOT_GENERATION_AFFECTING:notification sound"),
    (r"^saving-paths$", r"outdir_init_images", ["MT-20"]),
    (r"^saving-(paths|to-dirs)$", r".*", "CLASS:SUPERSEDED_BY_CANONICAL_STORE:A1111 output directory layout; DexDiffusion stores every original once under /Users/andrew/images_made (protected invariant). Export naming is MT-14"),
    (r"^upscaling$", r"ESRGAN_tile$", ["EX-11"]), (r"^upscaling$", r"ESRGAN_tile_overlap", ["EX-12"]),
    (r"^upscaling$", r"realesrgan_enabled_models", ["EX-08"]), (r"^upscaling$", r"(?i)dat_", ["EX-23"]),
    (r"^upscaling$", r"upscaler_for_img2img", ["ED-22"]), (r"^upscaling$", r"set_scale_by", ["EX-04"]),
    (r"^face-restoration$", r"code_former_weight", ["EX-20"]), (r"^face-restoration$", r".*", ["GN-14", "EX-16", "EX-18"]),
    (r"^(system|profiler|API)$", r".*", "CLASS:NOT_GENERATION_AFFECTING:console/profiling/API transport setting"),
    (r"^sd$", r"sd_model_checkpoint", ["GN-01"]), (r"^sd$", r"sd_checkpoints_limit|keep_in_cpu|checkpoint_cache", ["ST-11"]),
    (r"^sd$", r"sd_unet", ["GN-17", "RS-10"]), (r"^sd$", r"enable_quantization", ["ST-17"]), (r"^sd$", r"^emphasis$", ["ST-03"]),
    (r"^sd$", r"enable_batch_seeds", ["SD-11"]), (r"^sd$", r"comma_padding_backtrack", ["PR-15"]),
    (r"^sd$", r"clip_l_skip|CLIP_stop", ["ST-02"]), (r"^sd$", r"upcast_attn", ["RS-16"]), (r"^sd$", r"randn_source", ["SD-13"]),
    (r"^sd$", r"^tiling$", ["GN-13"]), (r"^sd$", r"hires_fix_refiner_pass", ["HR-14"]),
    (r"^sdxl$", r".*", ["ST-18"]), (r"^sd3$", r".*", ["ST-19"]),
    (r"^vae$", r"sd_vae_explanation", "CLASS:NOT_A_CONTROL:explanatory HTML"),
    (r"^vae$", r"^sd_vae$|overrides_per_model", ["GN-16", "RS-09"]), (r"^vae$", r"checkpoint_cache", ["ST-11"]),
    (r"^vae$", r"precision", ["ST-13"]), (r"^vae$", r"encode_method|decode_method", ["ST-04"]),
    (r"^img2img$", r"inpainting_mask_weight", ["IP-10"]), (r"^img2img$", r"initial_noise_multiplier", ["SD-28"]),
    (r"^img2img$", r"extra_noise", ["SD-29"]), (r"^img2img$", r"color_correction", ["ED-20"]), (r"^img2img$", r"fix_steps", ["ED-21"]),
    (r"^img2img$", r"background_color", ["ED-19"]), (r"^img2img$", r"sketch_default_brush|inpaint_sketch", ["ED-04"]),
    (r"^img2img$", r"sketch", ["ED-02"]), (r"^img2img$", r"mask_brush_color", ["IP-01"]), (r"^img2img$", r"return_mask", ["IP-11"]),
    (r"^img2img$", r"overlay_inpaint", ["IP-12"]), (r"^img2img$", r"editor_height|batch_show_results_limit", "CLASS:NOT_GENERATION_AFFECTING:editor/gallery display size"),
    (r"^optimizations$", r"cross_attention_optimization|cache_fp16_weight", ["RS-16"]), (r"^optimizations$", r"s_min_uncond", ["SD-25"]),
    (r"^optimizations$", r"token_merging", ["ST-07"]), (r"^optimizations$", r"pad_cond|batch_cond", ["ST-09"]),
    (r"^optimizations$", r"persistent_cond_cache", ["ST-10"]), (r"^optimizations$", r"fp8", ["ST-06"]),
    (r"^compatibility$", r"use_old_scheduling", ["PR-11"]), (r"^compatibility$", r"hires_fix_use_firstpass_conds|use_old_hires_fix_width_height", ["HR-01"]),
    (r"^compatibility$", r"refiner_switch_by_sample_steps", ["HR-17"]), (r"^compatibility$", r".*", ["ST-12"]),
    (r"^interrogate$", r"deepbooru", ["PR-22"]), (r"^interrogate$", r".*", ["PR-21"]),
    (r"^extra_networks$", r"default_multiplier", ["RS-11"]), (r"^extra_networks$", r"add_text_separator", ["RS-12"]),
    (r"^extra_networks$", r"textual_inversion_add_hashes", ["MT-05"]), (r"^extra_networks$", r"textual_inversion", ["RS-07"]),
    (r"^extra_networks$", r"sd_hypernetwork", ["RS-08"]), (r"^extra_networks$", r".*", ["RS-06"]),
    (r"^ui_prompt_editing$", r"token_counters", ["PR-04", "PR-05"]), (r"^ui_prompt_editing$", r".*", ["PR-23"]),
    (r"^ui_gallery$", r"return_grid", ["MT-09"]), (r"^ui_gallery$", r".*", ["MT-08"]),
    (r"^ui_alternatives$", r"interrupt_after_current", ["JO-04"]), (r"^ui_alternatives$", r"hires_fix_show_sampler", ["HR-10", "HR-11"]),
    (r"^ui_alternatives$", r"hires_fix_show_prompts", ["HR-08", "HR-09"]),
    (r"^ui_alternatives$", r".*", "CLASS:NOT_GENERATION_AFFECTING:layout alternative; DexDiffusion layout is governed by Concept A"),
    (r"^ui$", r"send_seed|send_size", ["MT-11"]), (r"^ui$", r"show_progress_in_title|show_progressbar|live_preview_refresh_period", ["JO-06"]),
    (r"^ui$", r"live_preview|show_progress_grid|show_progress_every|show_progress_type", ["ST-15", "JO-08"]),
    (r"^ui$", r".*", "CLASS:NOT_GENERATION_AFFECTING:shell preference (theme, localization, tab order, reload)"),
    (r"^infotext$", r"infotext_explanation", "CLASS:NOT_A_CONTROL:explanatory HTML"),
    (r"^infotext$", r"enable_pnginfo", ["MT-06"]), (r"^infotext$", r"save_txt", ["MT-07"]),
    (r"^infotext$", r"add_.*_to_info", ["MT-05"]), (r"^infotext$", r".*", ["MT-03"]),
    (r"^sampler-params$", r"hide_samplers", ["GN-02"]), (r"^sampler-params$", r"eta_ddim", ["SD-14"]), (r"^sampler-params$", r"eta_ancestral", ["SD-15"]),
    (r"^sampler-params$", r"ddim_discretize|sd_noise_schedule", ["ST-05", "SD-24"]), (r"^sampler-params$", r"s_churn", ["SD-17"]),
    (r"^sampler-params$", r"s_tmin|s_tmax", ["SD-18"]), (r"^sampler-params$", r"s_noise", ["SD-19"]),
    (r"^sampler-params$", r"sigma_min|sigma_max", ["SD-20"]), (r"^sampler-params$", r"^rho$", ["SD-21"]),
    (r"^sampler-params$", r"eta_noise_seed_delta", ["SD-16"]), (r"^sampler-params$", r"discard_next_to_last", ["SD-27"]),
    (r"^sampler-params$", r"sgm_noise", ["SD-26"]), (r"^sampler-params$", r"uni_pc", ["SD-23"]),
    (r"^sampler-params$", r"skip_early_cond", ["SD-25"]), (r"^sampler-params$", r"beta_dist", ["SD-22"]),
    (r"^postprocessing$", r"operation_order", ["EX-21"]), (r"^postprocessing$", r"enable_in_main_ui|disable_in_extras", ["EX-25"]),
    (r"^postprocessing$", r"upscaling_max_images_in_cache", "CLASS:NOT_GENERATION_AFFECTING:in-memory cache size"),
    (r"^postprocessing$", r"caption", "CLASS:EXCLUDED_TRAINING:caption files for training datasets"),
    (r"^None$", r"sd_checkpoint_hash", ["MT-05"]), (r"^None$", r".*", "CLASS:NOT_GENERATION_AFFECTING:extension management / config-state restore"),
    (r"^extension:LDSR$|^extension:ScuNET$|^extension:SwinIR$", r".*", ["EX-23"]),
    (r"^extension:Lora$", r"sd_lora|preferred_name", ["RS-04"]), (r"^extension:Lora$", r"hashes|bundled_ti", ["MT-05"]),
    (r"^extension:Lora$", r"show_all|hide_unknown", ["RS-13"]), (r"^extension:Lora$", r"memory_limit|functional|cache", ["RS-16"]),
    (r"^extension:Lora$", r"not_found", ["RS-12"]),
    (r"^extension:canvas-zoom-and-pan$", r".*", ["IP-02"]), (r"^extension:extra-options-section$", r".*", ["ST-16"]),
    (r"^extension:hypertile$", r".*", ["ST-08"]),
]


def map_item(item: dict) -> tuple[list[str] | None, str | None]:
    if item["kind"] == "setting":
        if item.get("excluded"):
            return None, "EXCLUDED_TRAINING:training section"
        sec = str(item.get("section"))
        for s_re, k_re, target in SETTING_RULES:
            if re.search(s_re, sec) and re.search(k_re, item["key"]):
                return (target, None) if isinstance(target, list) else (None, target[len("CLASS:"):])
        return None, None
    label = item.get("label") or ""
    for kind, f_re, l_re, target in RULES:
        if kind != item["kind"] or not re.search(f_re, item["file"]):
            continue
        if not re.search(l_re, label):
            continue
        return (target, None) if isinstance(target, list) else (None, target[len("CLASS:"):])
    return None, None


OPERATIONAL = {"PR-20", "GN-20", "SC-15", "RS-14", "MT-18", "JO-05", "JO-11", "JO-12", "JO-14"}


def source_kind(rid: str, refs: int) -> str:
    """Where the obligation comes from: a stock control/setting, stock behaviour
    with no single control (prompt_parser.py, javascript/*.js, symbol buttons),
    the explicitly requested ControlNet/Puppet scope, or DexDiffusion's own
    operational contract from the approved blueprint."""
    if rid.startswith("CN-"):
        return "requested-conditioning-scope"
    if rid in OPERATIONAL:
        return "dexdiffusion-operational"
    return "upstream-control-or-setting" if refs else "upstream-behaviour"


RUN_RE = re.compile(r"\b(2026\d{4}-\d{6}-[a-z0-9][a-z0-9-]*[a-z0-9])")


def main(argv: list[str]) -> int:
    inv_path, repo = Path(argv[1]), Path(argv[2])
    ledger_path = repo / "docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    rows = ledger["atomic_requirements"]
    by_id = {r["id"]: r for r in rows}

    for rid, area, feature, ufile, symbol, behavior in NEW_ROWS:
        if rid in by_id:
            continue
        row = {
            "id": rid, "area": area, "feature": feature, "upstream_file": ufile, "upstream_ref": UP + ufile,
            "dexdiffusion_owner_candidates": [], "observed_evidence": "P01 upstream AST scan 2026-10-16: no existing row",
            "baseline_status": "added by P01 reconciliation", "required_implementation": behavior,
            "proof_required": "Inspect UI → validate normalized request → inspect executed worker inputs → real or deterministic behavioral test → verify artifact/metadata and unsupported-target rejection.",
            "completion_status": "PENDING", "implementation_receipt": None, "runtime_receipt": None,
            "upstream_symbol": symbol, "added_in": "P01 2026-10-16",
        }
        rows.append(row)
        by_id[rid] = row

    state = parse_state()
    missing_state = sorted(set(by_id) - set(state))
    unknown_state = sorted(set(state) - set(by_id))
    if missing_state or unknown_state:
        raise SystemExit(f"STATE table mismatch: missing={missing_state} unknown={unknown_state}")

    inventory = json.loads(inv_path.read_text(encoding="utf-8"))
    mapped_to: dict[str, list[dict]] = {}
    unmapped = []
    for item in inventory["items"]:
        targets, cls = map_item(item)
        item["maps_to"] = targets
        item["classification"] = cls
        if targets:
            for t in targets:
                if t not in by_id:
                    raise SystemExit(f"rule maps to unknown row {t}: {item}")
                mapped_to.setdefault(t, []).append(item)
        elif not cls:
            unmapped.append(item)

    for r in rows:
        s = state[r["id"]]
        prefix = r["id"].split("-")[0]
        ui_owner, api, worker, models = AREA[prefix]
        receipts = " ".join(filter(None, [r.get("implementation_receipt"), r.get("runtime_receipt")]))
        runs = sorted(set(RUN_RE.findall(receipts)))
        refs = mapped_to.get(r["id"], [])
        r.update({
            "source_reference": {
                "commit": PIN,
                "file": r["upstream_file"],
                "symbols": sorted({(i.get("label") or i.get("key") or "") + f" (L{i['line']})" for i in refs if i["file"] == r["upstream_file"]})[:12]
                           or ([r["upstream_symbol"]] if r.get("upstream_symbol") else []),
                "inventory_items": len(refs),
            },
            "required_behavior": r["required_implementation"],
            "ui_owner": ui_owner, "api_contract": api, "effective_worker_path": worker, "supported_models": models,
            **{k: s[k] for k in ("source_status", "ui_status", "wiring_status", "automated_proof", "live_proof", "release_status", "blocker", "next_action")},
            "evidence_runs": [{"run": run, "present": (repo / "sdcpp-workflow/runs" / run).is_dir()} for run in runs],
        })
        r["source_kind"] = source_kind(r["id"], len(refs))
        if r["id"] in EXCLUDE:
            r["exclusion_reason"] = EXCLUDE[r["id"]]
        r["completion_status"] = r["release_status"]

    counts = {v: 0 for v in ENUMS["release_status"].values()}
    live = {v: 0 for v in ENUMS["live_proof"].values()}
    for r in rows:
        counts[r["release_status"]] += 1
        live[r["live_proof"]] += 1
    ledger["schema"] = SCHEMA
    ledger["reconciled"] = "2026-10-16"
    ledger["upstream_inventory"] = "docs/parity/A1111_UPSTREAM_INVENTORY.json"
    ledger["proof_states"] = ENUMS_DOC
    ledger["summary"] = {
        "total": len(rows),
        "release_status": counts,
        "live_proof": live,
        "complete_live_proven": sum(1 for r in rows if r["release_status"] == "COMPLETE" and r["live_proof"] == "LIVE_PROVEN"),
        "complete_other_verified": sum(1 for r in rows if r["release_status"] == "COMPLETE" and r["live_proof"] != "LIVE_PROVEN"),
        "verdict": "PARTIAL" if counts["COMPLETE"] + counts["EXCLUDED"] < len(rows) else "COMPLETE",
    }
    ledger["atomic_requirements"] = sorted(rows, key=lambda r: (ORDER.index(r["id"].split("-")[0]), int(r["id"].split("-")[1])))
    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    inv_out = repo / "docs/parity/A1111_UPSTREAM_INVENTORY.json"
    inventory["commit"] = PIN
    inventory["generated_by"] = "docs/parity/tools/enumerate_a1111.py + reconcile_ledger.py"
    inventory["unmapped"] = len(unmapped)
    inventory["counts"] = {
        "items": len(inventory["items"]),
        "mapped": sum(1 for i in inventory["items"] if i["maps_to"]),
        "classified": {c: sum(1 for i in inventory["items"] if (i["classification"] or "").split(":")[0] == c)
                       for c in sorted({(i["classification"] or "").split(":")[0] for i in inventory["items"] if i["classification"]})},
    }
    inv_out.write_text(json.dumps(inventory, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(ledger["summary"], indent=1))
    print("inventory", inventory["counts"], "unmapped", len(unmapped))
    for u in unmapped:
        print("UNMAPPED", u["kind"], u["file"], u.get("label") or u.get("key"), u.get("section"))
    return 1 if unmapped else 0


ORDER = ["PR", "GN", "SD", "HR", "ED", "IP", "EX", "SC", "RS", "MT", "JO", "ST", "CN"]
ENUMS_DOC = {k: sorted(v.values()) for k, v in ENUMS.items()} | {
    "rule": "COMPLETE requires source PRESENT, ui EXPOSED, wiring WIRED, automated proof != NONE, live_proof LIVE_PROVEN (or NOT_REQUIRED for UI/validation-only rows) and no blocker. A mock test never counts as live proof.",
}

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
