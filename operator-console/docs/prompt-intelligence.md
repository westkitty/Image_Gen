# DexDiffusion Prompt Intelligence Architecture

## Overview

DexDiffusion integrates local model-aware prompt intelligence powered by Ollama running on Big Mac (`qwen3.8:27b-mlx`) accessed via the managed SSH tunnel on `127.0.0.1:11436`. The console endpoint can be overridden with `OLLAMA_BASE_URL` or `OLLAMA_HOST`; DexDiffusion does not create or manage SSH tunnels. Prompt intelligence enhances user prompts while strictly respecting model family grammar, protected syntax literals, and parameter separations.

## Core Principles

1. **Model Family Awareness**: Each target model family possesses distinct prompt grammar and formatting rules:
   - **FLUX (`flux2-klein-4b`)**: Natural language prose, detailed descriptions of lighting, textures, camera depth, and framing. Prohibits comma soup, quality tag spam (`masterpiece, best quality`), and negative prompts.
   - **SDXL (`sdxl`, `sdxl-turbo`, `sdxl-photonic`, `sdxl-realvisxl`)**: Medium-length descriptive phrases with camera/lens details, photographic cues, and focused negative prompts.
   - **Pony (`pony-autismmix`)**: Strict Danbooru tags prefixed by quality score ratings (`score_9, score_8_up, rating:safe, masterpiece`), artist tags, and anatomical tag controls.
   - **SD 1.5 (`sd15`, `sd15-homofidelis`)**: Comma-separated token syntax with explicit emphasis tags and broad negative prompts (`ugly, deformed, bad hands, lowres`).
   - **Media Models**: Specialized modalities including AudioLDM (`audio.sound`), MusicGen (`audio.music`), LTX-Video (`video.ltx`), and Inpaint/Detailer (`operation.detailer`).

2. **Protected Literals**:
   - Extraction of `<lora:...>`, `__wildcard__`, exact quoted phrases (`"..."`), Pony score tags, Danbooru rating tags, embeddings, and music structure tags (`[Intro]`, `[Chorus]`).
   - Hard validation: If any protected literal is dropped or corrupted during LLM enhancement, the system fails closed and preserves the exact original user input.

3. **Structured Extraction**:
   - The LLM returns structured JSON containing:
     - `enhanced_prompt`: The expanded, grammatically correct prompt.
     - `negative_prompt`: Target-appropriate negative tokens (or omitted for FLUX).
     - `setting_suggestions`: Recommendations for steps, CFG scale, sampler, and dimensions without silently mutating user generation settings.
     - `notes`: Human-readable summary of additions and adjustments.

4. **Review & Reversion UI**:
   - Non-destructive review panel in Create Workbench showing side-by-side Diff of original vs. enhanced prompt.
   - Clickable suggestion chips to apply suggested parameters.
   - One-click buttons to Apply, Append, Undo (reverting to prior prompt), or Dismiss.

5. **Resource Management**:
   - All Ollama inference calls enforce `keep_alive: 0` to immediately unload weights from Big Mac unified memory, preventing memory contention with Heavy diffusion generation leases.
