# Chatterbox Turbo compatibility — evidence report (Phase H)

Date: 2026-10-08. **Evidence only.** Nothing was downloaded, installed, imported or run; no engine was registered; `voice-engines.js` is unchanged.
Sources: Resemble AI's Hugging Face model card (fetched 2026-10-08) and third-party write-ups found by web search (marked *secondary*).

## Verdict: EXPERIMENT (do not ADOPT yet, do not REJECT)

Turbo is attractive for drama (native paralinguistic tags, small, MIT-licensed) but three facts the current engine contract requires are **unverified**
for our hardware/runtime, so nothing may be claimed or wired until the experiment below produces receipts.

## Findings

| Question | Finding | Confidence |
|---|---|---|
| License | MIT (model card header "License: mit"; mirrors agree) | primary |
| Size | 350 M parameters; "less compute and VRAM" than earlier Chatterbox models; **no file list / disk size / memory figure stated** | primary (size NOT stated) |
| Languages | English only (the 23-language list belongs to the separate Multilingual model) | primary |
| Paralinguistic tags | Native: `[cough]`, `[laugh]`, `[chuckle]` "and more" — **the full list is not published on the card** | primary (list incomplete) |
| Voice cloning | Uses a reference clip; example is a ~10 s clip; no minimum stated | primary |
| Watermark | Every output carries Resemble's PerTh watermark (imperceptible; survives MP3) | primary |
| Apple Silicon | **No statement on MPS or MLX on the card.** Community reports (secondary): the original Chatterbox falls back to CPU on MPS; one M4 Pro user ran Turbo on CPU and had to pin `huggingface-hub < 1.0` | secondary |
| Speed claims ("6× real-time") | Not from Resemble documentation; ignore until measured here | unverified |
| Deterministic seed / prompt caching | Not documented | unknown |

Local runtime state (read-only): the MacBook has `torch 2.10.0` but no `chatterbox` and no `mlx`. The Big Mac runtime is `mlx-audio 0.5.6`
(`voice-engines.js` `RUNTIME_REVISION`); I did **not** probe Big Mac for Chatterbox (it would be a remote action; not authorised for this phase).
Chatterbox is a PyTorch model, not an `mlx-audio` model, so it would need its own isolated runtime — a **runtime change that requires your explicit approval**.

## Fit with the Studio's contracts

- `voice-engines.js` capabilities are *probe-derived*: an engine may only claim `paralinguistic_tags` etc. after `inspect.signature`/a real render proves it. Chatterbox would therefore start with every control disabled-with-reason.
- Speech fingerprints include applied delivery/tags only when the engine can apply them; a Chatterbox engine would need its own `revision` string (model hash + library versions) so fingerprints change when the runtime changes.
- PerTh watermarking is a product/provenance fact that should be surfaced to the user in the Cast Bible (disclosed, not hidden). No removal is proposed.
- Our script syntax uses bracket delivery directions (`[quietly]`). Turbo's `[laugh]`-style tags use the same punctuation; they would need an explicit mapping layer so a direction is never confused with a sound tag.

## Experiment protocol (needs your go-ahead; all local, bounded)

1. Create an **isolated** venv on Big Mac (not the shared runtime, no changes to `mlx-audio`); install pinned `chatterbox-tts` and weights **only after you approve the download** (size to be recorded first from the Files tab).
2. Probe: device selection (MPS vs CPU), cold/warm load time, peak memory, real-time factor on 30 s of text, seed determinism (same seed → same hash?), tag rendering for `[laugh]/[chuckle]/[cough]`, reference-clip minimum (3/6/10 s).
3. Record results as ADOPT / EXPERIMENT / REJECT criteria: ADOPT only if MPS/MLX RTF ≥ 1× real time, deterministic or acceptably stable, tags audibly work, memory fits next to the other resident models, and a human listening pass prefers it for at least the laugh/chuckle cases.
4. Only then add an engine entry + capability probe + tests; until then it stays out of the product.

**Status: no experiment was run. Evidence level: documentation only.**

Sources: Hugging Face `ResembleAI/chatterbox-turbo` model card; tts.ai Chatterbox Turbo listing and community write-ups (secondary).
