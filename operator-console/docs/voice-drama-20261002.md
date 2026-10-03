# Voice profiles, long-form speech and Drama (2026-10-02)

Built on the proven Big Mac transport (job store, heavy-compute lease, `dexmedia_remote.py`, media store). Big Mac stays compute only;
the MacBook owns profiles, projects, chunking, stitching and canonical audio. No new model was downloaded; no second server exists.

## Durable locations

| What | Where |
|---|---|
| Voice profiles | `sdcpp-workflow/state/voice-profiles/<vp-id>/profile.json` (schema `dexdiffusion.voice_profile.v1`, atomic writes) |
| Reference samples | `sdcpp-workflow/state/voice-profiles/<vp-id>/samples/<sm-id>.wav` (re-encoded PCM16 mono 24 kHz; stay on the MacBook) |
| Drama projects | `sdcpp-workflow/state/drama/<dp-id>.json` — **only after an explicit Save** (schema `dexdiffusion.drama_project.v1`) |
| Generated speech (lines, long-form) | `/Users/andrew/audio_made/voice/` (registry `sdcpp-workflow/state/media-artifacts.json`) |
| Final drama exports | same voice root, `<stamp>-drama-<slug>[-<scene>].wav`, `worker: drama-assembler`, `meta.operation: drama-export` |

Nothing is written to Big Mac model directories. A per-render copy of the active sample goes to a private Big Mac job dir and is removed (verified).

## Engine adapter contract (`voice-engines.js`)

`render(profile, text, direction, …)` → `buildRenderPlan()` validates the profile against the engine, resolves delivery, and the bridge
(`startBatch`) runs ONE Big Mac invocation for all chunks (model loaded once; per-chunk `ITEM_START`/`ITEM` markers; failures name the chunk).
Capability flags carry evidence (runtime signature probe on Big Mac 2026-10-02, or an explicit DexDiffusion policy):

| | Kokoro | Qwen3-TTS Base (clone) | Qwen3-TTS VoiceDesign |
|---|---|---|---|
| voice types | preset | cloned | designed |
| delivery/performance direction | **no** (speed only) | **no** (Base never forwards `instruct`) | **yes** (appended to the voice description) |
| multiple samples per render | n/a | no — one active sample per render; profile keeps several | n/a |
| seed | no (deterministic) | yes | yes |
| streaming | no | runtime has it, bridge returns full WAVs | same |
| cached voice prompt | no | **no** — `generate()` recomputes the reference; no precomputed-prompt API | no |
| max chunk | 900 chars | 700 | 700 |

Unsupported directions are never silently passed: the render reports `delivery.applied=false` with the reason, takes show
"direction not applied", and the UI disables the field for engines that cannot honor it. Because prompt caching is unsupported,
none is implemented; the profile `fingerprint` (active sample + transcript + settings) is recorded with each render and would be the cache key.
Model-load amortisation is real: all chunks of a line/long text share one load.

## Long-form (`long-form.js`, `voice-audio.js`)

Text ≤ the engine's chunk limit is one chunk. Longer text splits paragraph → sentence → clause → whitespace → hard cut (flagged),
never inside `[tag]`, `<tag>`, `{tag}`, `(cue)`. Each chunk records the boundary that follows; the stitcher trims edge silence, inserts a
deliberate pause only at paragraph (520 ms) / sentence (260 ms) / clause (110 ms) boundaries, otherwise an equal-power 25 ms crossfade,
then peak-normalises to −1 dBFS. The result is ONE canonical artifact; `meta.long_form.lineage` holds per-chunk chars/duration/sha256/boundary
(no text). A failure reads `Long-form render failed at chunk 7/14: <reason>`.

## Drama (`drama.js`, `drama-service.js`, `voice-routes.js`, `drama-ui.js`)

* **Parser (deterministic, no LLM):** `NAME: text`, `NAME: [quietly] text`, `NAME (whispering): text`, wrapped lines, Fountain cues,
  `INT./EXT./# Title` headings, `[pause 2s]`, full-line stage directions (kept, not rendered), narration paragraphs → NARRATOR.
  Every line records `src` offsets into the original script, which stays authoritative.
* **LLM parse (optional):** local Ollama, strict JSON schema; every line must be a verbatim (whitespace-normalised) substring of the script,
  in order — otherwise the whole parse is rejected with the offending lines listed. It cannot rewrite dialogue.
* **Model:** project → scenes → lines (speaker, kind, direction, pause before/after, `render`, takes[], active_take) · actors (speaker → profile,
  default direction) · tracks (music/ambience/sfx) · exports. Re-render **adds** a take; the active take is chosen by the user (the first good take
  becomes active automatically; later ones do not steal it).
* **Cast:** rendering is blocked only for speakers that have renderable lines and no voice.
* **Runs:** line / scene / project, sequential, resume skips generated lines, per-line failures are reported and retried selectively. Each line is a normal
  voice job (lease, "waiting for Big Mac", chunk X/N). After a restart an in-flight take becomes `failed (interrupted)`, never `complete`.
* **Assembly:** active takes in scene/line order; gaps = previous `pause_after` (default `line_gap_s` 0.35) + next `pause_before`; scene gap 1.0 s;
  optional tracks (start, trim, gain, fades; stereo 48 kHz when present, else mono 24 kHz); peak −1 dBFS; WAV registered in the voice store with a manifest
  (no dialogue text) kept in the project's export history.
* **Privacy:** an unsaved project exists only in server memory; Save writes script + cast + take history to `state/drama/`; renders always pass
  `saveText:false`, so dialogue is never copied into generic job state or the media registry (verified by sweep, see OPERATIONAL_STATE rev 16).
  Reference-sample transcripts live in the voice profile because the user entered them for that purpose.

## API

`GET /api/voice/engines` · `GET|POST /api/voice/profiles` · `GET|PUT|DELETE /api/voice/profiles/:id` · `POST …/samples {staged_id,name,transcript}` ·
`PUT|DELETE …/samples/:sid` · `GET …/samples/:sid/audio` · `POST /api/voice/render` · `GET /api/voice/render/:job` ·
`POST /api/drama/parse` · `GET|POST /api/drama/projects` · `GET|PUT|DELETE /api/drama/projects/:id` · `…/reparse|save|unsave|render|assemble` ·
`PATCH|DELETE …/lines/:lid` · `PUT …/actors/:aid` · `POST …/lines/:lid/takes/:tid/select` · `…/tracks` · `GET /api/drama/runs/:rid`.

## Tests

`tests/long-form.test.js`, `voice-audio.test.js`, `voice-production.test.js` (profiles, capability gating, long-form through the real bridge with fake ssh,
chunk-failure attribution, privacy, cleanup), `drama.test.js`, `drama-service.test.js`; browser: `tests/browser/voice-drama.browser.js`.
