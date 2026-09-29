# External Capability Decisions & Evidence Matrix

This document records the architectural and licensing decisions for external models, runtimes, and precedents evaluated for DexDiffusion.

| Project / Model | Source / Revision Anchor | Role | Compatibility | Software / Model License | Acceleration Path | Decision | Status & Necessary Proof |
|---|---|---|---|---|---|---|---|
| **westkitty/He-Maker** | `5904d101e1a4a64f0cf477328bd97edfc65d581b` | Wildcard prompt banks | Platform-independent | Permissive text banks | N/A | **ADOPT** (vendor 15 exact files) | **PROVEN**: files vendored, hashes recorded, generation-time expansion tested. |
| **Bing-su/adetailer** | `3a599f5d...` | Detection & inpainting detailer | AUTOMATIC1111 extension | Apache-2.0 | Ultralytics / PyTorch | **ADAPT ALGORITHM** (reject extension) | **PROVEN**: native Apple Vision (Face, Person, Hand) + existing inpaint bridge. |
| **glucauze/sd-webui-faceswaplab** | `42d1c75b...` | Face replacement extension | AUTOMATIC1111 / Vlad only | AGPL-3.0 / Non-commercial InsightFace | CUDA / CPU | **REJECT DIRECT INTEGRATION** | **REJECTED**: incompatible extension model, AGPL copyleft, non-commercial restrictions. |
| **facefusion/facefusion** | `358f169e...` | Standalone face processing | Headless CLI / Python / macOS | Mixed / Restricted model licenses | ONNX Runtime / CoreML | **ADAPT / OPTIONAL RESTRICTED** | **UNPROVEN**: requires complete license audit per model component; content safety mechanisms must not be bypassed. |
| **mflux-community/mflux** | `0db68699...` | MLX FLUX.2 Klein generation | macOS Apple Silicon (Big Mac) | MIT / Apache-2.0 base | MLX / Metal | **ADOPT** (Primary Engine) | **PROVEN**: single-session generation + streaming + cleanup verification; zero Big Mac retention. |
| **leejet/stable-diffusion.cpp** | `3f8527a4...` (rev `7f0e728`) | Secondary SD engine | C++ / Metal on Big Mac | MIT | Metal (MTL0) | **ADOPT** (Secondary Engine) | **PROVEN**: SD1.5, SDXL, Turbo, Real-ESRGAN, native batch, LoRA/embeddings directory flags. |
| **mcmonkeyprojects/SwarmUI** | `aa85336f...` | Generative UI precedent | Web / .NET | MIT | N/A | **ADAPT UI PRECEDENTS** | Human-readable model cards, "Best for" metadata, compatibility-aware resource chips. |
| **invoke-ai/InvokeAI** | `e927a2eb...` | Generative UI precedent | Web / Python | Apache-2.0 | N/A | **ADAPT UI PRECEDENTS** | Dominant Hero Image, vertical sibling filmstrip rail, instant sibling promotion. |
| **lllyasviel/stable-diffusion-webui-forge** | `dfdcbab6...` | WebUI precedent | Web / Python | GPL-3.0 | N/A | **SECONDARY UI PRECEDENT** | Extra Networks card interaction and LoRA weight controls. |
| **ai-forever/ghost** | `44e58aad...` | Face swap research | Python / PyTorch / ONNX | Mixed | ONNX CoreML / CUDA | **EXPERIMENT** | **UNPROVEN**: Native CoreML worker evaluated. Without clean commercial weights, kept visibly UNAVAILABLE. |
| **PuLID (stable-diffusion.cpp)** | Upstream sd-cli | Identity conditioning | Big Mac sd-cli | Research | Metal sd-cli | **EXPERIMENT** | **UNPROVEN**: Identity conditioning is separate from post-hoc face swap; experimental. |
