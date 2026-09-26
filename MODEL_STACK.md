<!-- Generated from /Volumes/wc2tb/generative-models/MANIFEST.md on Big Mac. Model weights are NOT stored in Git. -->
# DexDiffusion Big Mac Voice/Music Model Stack

Date: 2026-09-26
Big Mac: bigmac@bigmac

| Model | Repository | Local path | Disk size | Runtime | Validation |
|---|---|---|---:|---|---|
| Kokoro | mlx-community/Kokoro-82M-bf16 | `/Volumes/wc2tb/generative-models/voice/kokoro/Kokoro-82M-bf16` | 0.36 GiB | mlx-audio 0.5.6 | short WAV generation PASS |
| Qwen3-TTS Base | mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16 | `/Volumes/wc2tb/generative-models/voice/qwen3-tts-base/Qwen3-TTS-12Hz-1.7B-Base-bf16` | 4.23 GiB | mlx-audio 0.5.6 | reference-audio voice-clone WAV smoke PASS |
| Qwen3-TTS VoiceDesign | mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit | `/Volumes/wc2tb/generative-models/voice/qwen3-tts-voice-design/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit` | 2.87 GiB | mlx-audio 0.5.6 | VoiceDesign WAV generation smoke PASS |
| ACE-Step 1.5 Turbo + 0.6B LM | ACE-Step/Ace-Step1.5 (selected VAE, Qwen3 embedding, turbo)<br>ACE-Step/acestep-5Hz-lm-0.6B | `/Volumes/wc2tb/generative-models/music/ace-step/checkpoints` | 7.18 GiB | ACE-Step git ca1e85fe9430179831e6bc6be790c332190a3866 / MLX (models: Ace-Step1.5@19671f406d60, acestep-5Hz-lm-0.6B@148d8ea0225b) | runtime imports + safetensors headers + official 0.6B MLX LM loader PASS |
| Magenta RealTime 2 Small | google/magenta-realtime-2 (resources + mrt2_small) | `/Volumes/wc2tb/generative-models/music/magenta-realtime/magenta-rt-v2` | 1.71 GiB | magenta-rt 2.0.3 (MLX pinned 0.31.1) | 4-second MLX audio generation PASS |

Total `/Volumes/wc2tb/generative-models`: 16.36 GiB
Remaining `/Volumes/wc2tb` free: 52.22 GiB

## Protected / unchanged
- Video models: not installed.
- Proven internal FLUX.2 Klein 4B MFLUX model/venv: unchanged.
- `/Volumes/wc2tb/ImageGen`: unchanged.
- `/Users/bigmac/.ollama/models`: unchanged.
- Google Drive rclone migration: never modified or interrupted by this installer.

## Integration status
- Model/runtime acquisition and validation are complete when this manifest reports PASS.
- DexDiffusion voice/music execution bridges and dormant-worker probe paths are not changed by this installer; enabling them remains a separate evidence-gated integration step.

## Repository revisions
- `mlx-community/Kokoro-82M-bf16`: `a71e4d38b236d968966a2002c4c895dbd12b1c3c`
- `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16`: `a6eb4f68e4b056f1215157bb696209bc82a6db48`
- `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit`: `f90d617701d9f7f4ca499291e0b57f2b3c2fd2ee`
- `ACE-Step/Ace-Step1.5`: `19671f406d603126926c1b7e2adc169acbcade22`
- `ACE-Step/acestep-5Hz-lm-0.6B`: `148d8ea0225bdab342ee1ae3a354275ccd60ca80`
- `google/magenta-realtime-2`: `010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc`
- `ACE-Step/ACE-Step-1.5` runtime: `ca1e85fe9430179831e6bc6be790c332190a3866`

## Validation depth / known limitations
- **Kokoro**: Validation used a short American-English WAV smoke test.
- **Qwen3-TTS Base**: Validated with a short synthetic reference-audio clone smoke; production voice quality was not evaluated.
- **Qwen3-TTS VoiceDesign**: Validated with one short VoiceDesign generation; production voice quality was not evaluated.
- **ACE-Step 1.5 Turbo + 0.6B LM**: Validated runtime, safetensors readability, and ACE-Step official 0.6B MLX LM loader; no full-song generation was run.
- **Magenta RealTime 2 Small**: mrt2_small selected intentionally for practical real-time use on Apple Silicon; 4-second MLX smoke only.
