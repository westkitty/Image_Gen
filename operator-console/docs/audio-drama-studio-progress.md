# Audio Drama Studio uplift — implementation record

Additive project-local progress record (started 2026-10-08). `OPERATIONAL_STATE.md` remains the current-state index; this file holds the
milestone checklist, receipts and design decisions for the LOCAL-ONLY Audio Drama Studio work. Historical receipts elsewhere are untouched.

Baseline (before any change): repo `/Users/andrew/Image_Gen`, branch `main`, HEAD `169ad07`, working tree = only pre-existing untracked PNG/rev19 files.
`npm run check` OK; `npm test` 334 tests: 333 pass, 0 fail, 1 skipped (the conditional `prompt-intelligence` live-service test).
Local tooling: ffmpeg/ffprobe 9.0.2 (loudnorm, ebur128, atempo, aecho, chorus, flanger, acompressor, highpass/lowpass/equalizer, aac, libmp3lame, ipod muxer);
`whisper-cli` NOT installed (local ASR therefore reports UNAVAILABLE); Node 26.11, Python 3.14.

## Hard constraints carried through every milestone

No cloud TTS/ASR; MacBook owns UI/projects/profiles/canonical media; Big Mac is compute only through the existing bridge + heavy-compute lease;
no new queue/server; no model downloads; no commits/pushes without separate authorization; unsaved script text never enters generic jobs, SSE,
logs, media metadata or new caches.

## Milestones

| Phase | Scope | State |
|---|---|---|
| A | Versioned speech/assembly fingerprints, take freshness, reparse safety, source coverage, incremental planner | PASS (backend + UI; mocked/browser-tested) |
| B | Voice Designer, audition lab, design→clone promotion, sample inspection, portable voice bank, preview | PASS (backend + UI; no real-model audition run yet) |
| C | One-click production, durable chunk receipts, restart/cancel semantics, SSE/Job Center | PASS (fake Big Mac; no live production run yet) |
| D | Cast Bible, Actor FX rack, Sound Director, multitrack timeline | PASS (real FFmpeg/mixer in tests; UI browser-tested) |
| E | Pacing master, local ASR adapter, speech-boundary detection, audio integrity | PARTIAL — pacing/VAD/integrity real; ASR is UNAVAILABLE (whisper.cpp not installed); Silero not installed (energy VAD used) |
| F | Streaming mixer, loudness mastering, WAV/MP3/M4B/M4A/stems/package export, perf | PASS — hour-scale fixture measured (see Checkpoint 2) |
| G | Production Proof Report, Director's Revision Report, historical productions | PASS (snapshot/verify tested; human acceptance is a recorded user action, none given) |
| H | Chatterbox compatibility experiment (evidence only) | PASS as evidence-only: verdict EXPERIMENT, nothing installed/run (`docs/chatterbox-turbo-compat-20261008.md`) |

## Milestone receipts

(appended below as milestones complete)

### Checkpoint 1 — Phases A–C backend (2026-10-08)

Design decisions (all covered by tests):
- **Speech fingerprint** (`drama-fingerprint.js`, `dxsp1`): hash over per-component hashes (text, speaker, voice, reference, engine+runtime revision, language,
  settings/pipeline version, *applied* delivery, applied pronunciation rules, source). Seed is excluded from the eligibility key (`inputs_sha`) and included in `render_sha`.
  A delivery direction the engine cannot honor (Kokoro, Qwen3 Base) is not part of the key, so editing it cannot invalidate audio it cannot change.
- **Assembly fingerprint** (`dxas1`): clips (take checksum, order, gaps, trim, gain, fades, FX identity), cues, settings, mastering, mixer version. Never contains speech identity.
- **Take state** = lifecycle × freshness × approval, with display labels MISSING/QUEUED/RENDERING/FAILED/INTERRUPTED/COMPLETE/OUTDATED/APPROVED/REVIEW_REQUIRED (`D.takeState`).
  Old takes are never deleted; legacy (pre-fingerprint) takes are `REVIEW_REQUIRED` until explicitly adopted. A current master only uses fingerprint-current takes;
  a deliberately chosen old take is exportable only as a labelled `historical` snapshot.
- **Source safety**: parser emits classified spans; `verifySourceCoverage` proves every non-whitespace character is classified and every line equals its source slice;
  `verifyChunkReconstruction` proves ordered chunks tile the spoken text exactly. Project schema upgraded to `dexdiffusion.drama_project.v2` with a one-time byte-identical `*.pre-v2.bak.json`.
- **Reparse** (`drama-reparse.js`): content-based matching (never positional), mutual-best fuzzy match for edited lines, ambiguity → conflict list + explicit confirmation,
  removed lines archived with takes; preview and apply share one plan.
- **Planner** (`drama-planner.js`): reusable / new / stale / in-flight / blocked lines, cast problems, asset problems, review items, assembly-only rebuilds, chunk proofs.
- **Voice Designer backend**: design spec → composed identity description (performance prefs & pronunciation stay out of identity), `identity_version`, approve → lock → unlock, consent/permission,
  sample inspection (waveform, clipping, silence, labelled SNR *estimate*), audition lab (traceable seeds, text stored only as hash unless opted in), design→clone promotion with
  *exact transcript verification by hash*, multi-line clone trial (human acceptance required), scratch preview, portable voice bank (pure-JS ZIP, strict validation, cached state never imported).
- **Bridge item mode** (`media-bridge.js`, `mode:'items'`): one Big Mac job → N independently delivered, checksum-verified outputs; partial results before a remote failure are kept.
- **Production** (`drama-producer.js`, `chunk-store.js`): snapshot → validate → plan → reuse valid chunk receipts → group per voice (one model load per group) → stitch lines →
  re-mix only changed scenes → project master. Bounded retries (3), cooperative cancel, superseded detection, no script text in jobs/SSE/receipts. Durable generic jobs now publish
  lifecycle events on the existing SSE bus (`createGenericJobEventPublisher`), and the Job Center snapshot projects measured progress + index-only labels.
- **Interim**: scene/project assembly still uses the legacy in-memory mixer (Phase D/F replace it with the streaming FFmpeg assembler).

Receipts (this checkpoint): `npm run check` OK; `node --test tests/*.test.js` → 481 tests, 480 pass, 0 fail, 1 skipped (the conditional live-service test). New suites: fingerprint 15, source 8,
reparse 14, planner 16, migrate 2, service-incremental 9, inspect 5, profiles-v2 9, designer 10, archive 7, bank 11, routes-designer 3, bridge item-mode 7, chunk-store 5, producer 17,
production-routes 4, job-store-events 5. All with a fake Big Mac (no model inference): **no live/real-audio proof yet**.
Flaky note: `tests/system-info.test.js` "bin/dexdiffusion status" is timing-sensitive (11 s alone, can exceed its 30 s timeout under parallel load); unrelated to this work.

### Checkpoint 2 — Phases D–H, UI and verification (2026-10-08)

Delivered after Checkpoint 1 (every item has its own test file; see the list in the final report):
- **Phase D** `fx-rack.js` (versioned chain, clamped numerics, compiled to an FFmpeg `-af`; "reverb" is an honestly-labelled echo-tap simulation; Pedalboard deliberately not imported),
  `derived-store.js` (non-destructive derived audio with lineage; originals never rewritten), `sound-director.js` (script cues stay cues, bound only to local library audio or locally generated
  procedural effects; optional by default, required only when marked), `drama-timeline.js` (one authoritative timeline used by fingerprints, preview and export), `drama-studio-routes.js`.
- **Phase E** `pacing.js` (optional, off by default, atempo verified by *measured* duration/WPM), `asr-adapter.js` (whisper.cpp detection only → UNAVAILABLE here; comparison yields PASS/REVIEW, never a
  hard FAIL), `speech-boundary.js` (energy VAD; low-confidence speech is kept, never trimmed automatically), `audio-integrity.js` (hard vs advisory), `drama-qa.js`.
- **Phase F** `drama-mixer.js` (streaming, bounded memory, 24-bit WAV, stems, block-size independent determinism), `drama-render.js`, `drama-master.js` (bit-exact concat, loudness measured →
  static gain → limiter only if needed → re-measured; MP3/M4B with chapters/M4A/FLAC encoded from the verified master), `drama-assembly.js`, `portable-archive.js`/`drama-package.js` (hostile-archive protections).
- **Phase G** `drama-proof.js` + `proof-store.js` (proof tied to master checksum; revision report from fingerprint snapshots; historical productions never presented as current).
- **UI** (inside the single Drama module; Concept A preserved): `drama-studio-ui.js` (stage bar SCRIPT/CAST/DIRECT/PRODUCE/REVIEW/MASTER/EXPORT, reparse preview, produce/progress/cancel, review, master,
  export, package), `drama-direct-ui.js` (Cast Bible incl. FX/pacing/pronunciation, multitrack timeline with waveforms + keyboard nudge, Sound Director), `voice-designer-ui.js` (designer, audition lab, A/B,
  lifecycle, promotion, trial, bank). Controls the engine cannot honour are disabled with the recorded reason.
- Bug found by the new browser suite and fixed: after a keyboard nudge of a timeline clip the re-render dropped focus (keyboard users could not keep nudging) — focus is now restored.
  Another real finding: my first browser waits used async `waitForFunction` predicates that passed vacuously; replaced with Node-side polling so assertions now really wait for server state.

**Performance (measured, `scripts/measure-drama-perf.js --minutes 60 --scenes 12`, 2026-10-08, Node 26.11, darwin arm64, synthetic tone fixture — structure/memory/time are real, loudness numbers are fixture-specific):**
| Stage | Seconds |
|---|---|
| mix 12 scenes (dialogue every 7 s + looped ducked bed) | 13.1 |
| exact concat (bit-exact copy + gaps) → 3608.8 s programme | 4.0 |
| loudness master (measure → gain → re-measure; −16.45 → −17.98 LUFS, target −18, limiter not needed) | 254.3 |
| export MP3 (86.6 MB) + chaptered M4B (44.1 MB, 12 chapters) | 74.2 |
| **total** | **345.5** |

Peak RSS of the whole process tree (Node + ffmpeg children, 250 ms sampling): **174 MiB** (Node alone 105 MiB) for a 1.04 GB 24-bit master; a whole-programme float32 buffer would be 1.3 GB.
Not measured: real speech material (loudness stage time depends on duration, not content), speech *rendering* time (needs Big Mac), >7.7 h programmes (single-WAV limit; refused with a clear message).
Disk headroom note: the machine has ~6 GB free; the script refuses to start without 2.6× master size and removes its temp directory (verified).

**Receipts (final run, 2026-10-08):** `npm run check` OK; `npm test` → 601 tests, 600 pass, 0 fail, 1 skipped (the conditional live-service test); `git diff --check` clean and no trailing
whitespace in new files; `node --check` clean on every changed/new JS file; no shell or Python files changed (nothing for `bash -n`/py_compile).
Browser: Edit 24/24; Voice/Drama 8/8; **new Drama Studio 9/9** (`npm run test:browser:studio`); Concept A 8/8; interaction matrix 180/180.
Earlier in the session one full run had a single failure in `detailer` timing under CPU contention; it passes in isolation and is unrelated (pre-existing flake; also `system-info` status test).

**Evidence boundaries (do not read more into this):** everything above ran against a *fake Big Mac* and real local FFmpeg/mixer. **No real Qwen/Kokoro inference, no live production on Big Mac, no human
listening acceptance, no whisper.cpp ASR run and no Chatterbox run have happened.** Those are the remaining gates listed in the final report.

**Incident note:** the interaction-matrix harness writes `output/rev19/interaction-matrix.json` and `interaction-matrix-summary.md` by default. Running it for regression checks overwrote those two
untracked files (their 2026-10-04 contents are not recoverable from git). Future runs must set `DEX_MATRIX_OUTPUT_DIR`. No other `output/rev19` file was modified (verified by mtime).

### Checkpoint 3 — Operation Golden Reel, session of 2026-10-09 (live speech BLOCKED; everything else verified)

- **Source safety:** verified rescue snapshot of 93 source/test/doc files (2.26 MB) at `/Users/andrew/Image_Gen_rescue/golden-reel-20261009-001005-9453/` (+ `.tar.gz`, SHA-256 `d19a6ed72f03d2968e01ebf4664a476b072a50ef7dd7df40516a2642cbfd87eb`); per-file SHA-256 manifest, `tracked-changes.patch` reverse-applies cleanly to the working tree. Nothing was staged, committed, stashed or pushed; no destructive git command was used.
- **Harness overwrite defect (fixed):** root cause was `interaction-matrix.browser.js` defaulting to the historical `output/rev19` directory and writing fixed filenames with `writeFileSync`; four other harnesses wrote results/screenshots straight into a shared directory. New `tests/browser/safe-output.js` (`resolveOutputDir`, `createOwnedWriter`): default is a fresh unique directory under the gitignored `output/playwright/`; an explicit `DEX_MATRIX_OUTPUT_DIR`/`DEX_BROWSER_OUTPUT_DIR` is honoured, but a file that already exists is NEVER replaced (fresh names `*.run-<stamp>-<pid>` are used). Regression: `tests/test-output-safety.test.js` (5 tests, sentinel bytes + SHA-256 + mtime unchanged; static scan of every harness).
  The two overwritten files (`output/rev19/interaction-matrix.json`, `interaction-matrix-summary.md`) are unrecoverable: untracked, no Time Machine local snapshot, no other copy. Authentic matrix records survive in `output/rev19/matrix-final-v2/`, `publication-matrix/` etc. (the report cites `matrix-final-v2`). The two top-level files now hold the 2026-10-08 run (180/180). No speculative contents were restored.
- **Golden Reel project (real, saved):** `dp-68a4e78b` "STATION NINE — THE LAST REPLY [QA FIXTURE]" — 2 scenes, 10 dialogue lines, CONTROL + NINE only, no narrator, source coverage proven, saved to `sdcpp-workflow/state/drama/`. Fixture voices (labelled QA FIXTURE, **not** approved): CONTROL = Kokoro `am_michael` (`vp-8586921207`); NINE = Qwen3-TTS VoiceDesign (`vp-1eeb9a4599`, approval pending). Driver: `operator-console/scripts/golden-reel.js` (setup, audition, produce, revise-text, revise-fx, verify — only `setup` and `audition` have run live).
- **Live attempt (real Big Mac, the console started via `bin/dexdiffusion start`, pid verified to this checkout):** the VoiceDesign audition (round `ar-8d9705d0`, job `7b96d49f…`) FAILED honestly: `PermissionError: [Errno 1] Operation not permitted: '/Volumes/wc2tb/generative-models/voice/qwen3-tts-voice-design/…/config.json'`. Diagnosis (read-only): every path under `/Volumes/wc2tb` returns "Operation not permitted" to any SSH-launched process (also from a fresh non-multiplexed session; Kokoro and Qwen Base paths too); Big Mac's kernel log shows `System Policy … deny(1) file-read-data /Volumes/wc2tb/ImageGen` for `ls` and denials for background services on the same volume. This is macOS's privacy layer, not DexDiffusion code; `bin/dexdiffusion doctor` still reports "wc2tb mounted" because it only checks the mount. Last known-good use of the volume was 2026-10-07 05:23 (SDXL render); onset not otherwise pinned. Cleanup verified after the failure: 0 `dexmedia.*` directories on Big Mac, no worker processes, lease free, no foreign process touched.
  **Fix requires a person on Big Mac** (System Settings → Privacy & Security → Full Disk Access: enable the SSH daemon entry `sshd-keygen-wrapper`, or the equivalent Removable-Volumes/Files-and-Folders grant), then open a NEW ssh session and confirm `ssh westcat 'ls /Volumes/wc2tb/generative-models/voice'` lists directories. Changing privacy settings is outside what the agent may do even when asked.
- **Golden Reel regression fixtures (stand-in speech — tones, NOT speech):** `tests/golden-reel.test.js` (2) and `tests/golden-reel-negative.test.js` (5) run the exact script through the REAL producer, planner, mixer, FFmpeg mastering, MP3/M4B export, chapters, proof and revision report. State A: 2 Big Mac invocations (one per voice), 10 items, 10 unique verified takes, two scene chapters, loudness within 1 LU of −18 LUFS, true peak ≤ −1.4 dBTP, NINE-only radio processing with dry sources untouched, required cues resolved. State B (one NINE line edited): preview changes nothing; exactly 1 line stale, 9 reusable; 1 invocation / 1 item; the other nine takes keep identical hashes; scene 1 master reused, scene 2 and project master rebuilt; revision report names the line. State C (NINE Radio → Intercom): plan needs no speech; 0 invocations; all 10 clean takes and speech-input fingerprints unchanged; new derived lineage citing the unchanged dry takes; assembly fingerprint and master hash change; three distinct recoverable masters. Negative scenarios A (engine unavailable), B (required cue missing blocks; optional cue warns), F (outdated take never used), K (mixer failure publishes nothing and a retry reuses all speech), L (cancel only cleans its own remote directory and releases the lease); C/D/E/G/H/I and encoder failure were already covered by existing tests (see the audit table in the final report).
- **Receipts:** `npm run check` OK; `npm test` 613 tests, 612 pass, 0 fail, 1 skipped (conditional live-service test); `git diff --check` clean; no trailing whitespace in new files. UI journey at the real console (real server + real frontend, no network mocks, read-only): Drama → open `dp-68a4e78b` → SCRIPT (coverage ✓, 426 chars classified), CAST (both QA FIXTURE voices selectable), PRODUCE (plan: 0 reusable / 10 new / 0 out of date, 1 review item = the unapproved fixture voice; PRODUCE ENTIRE DRAMA enabled). PRODUCE was deliberately NOT pressed (it would repeat the blocked live call). Timeline preview, version comparison, playback and downloads of a real master are UNVERIFIED because no real master exists yet.
