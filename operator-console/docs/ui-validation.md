# UI Validation & Command Mapping

This document lists the exact mapping from Operator Console UI actions to backend scripts to ensure safe boundaries and correct parameter passing.

## Generate Fast CLI
- **Script**: `bin/sdcpp-run-fast.sh`
- **Arguments**: `--mode cli --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate" form with Preset = Fast, Mode = CLI, AND steps, cfg, sampler, width, and height are not customized.

## Generate Quality CLI
- **Script**: `bin/sdcpp-run-quality.sh`
- **Arguments**: `--mode cli --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate" form with Preset = Quality, Mode = CLI, AND steps, cfg, sampler, width, and height are not customized.

## Generate Custom / Arbitrary Preset CLI
- **Script**: `bin/sdcpp-cli-generate.sh`
- **Arguments**: `--prompt "..." [--preset <preset>] [--negative "..."] [--steps <N>] [--width <N>] [--height <N>] [--cfg <N>] [--sampler <sampler>] [--seed <seed>]`
- **When**: UI "Generate" form with Mode = CLI AND EITHER the preset is Custom OR any steps, cfg, sampler, width, or height are customized.

## Generate Fast Server
- **Script**: `bin/sdcpp-run-fast.sh`
- **Arguments**: `--mode server --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate" form with Preset = Fast, Mode = Server, AND steps, cfg, sampler, width, and height are not customized.

## Generate Quality Server
- **Script**: `bin/sdcpp-run-quality.sh`
- **Arguments**: `--mode server --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate" form with Preset = Quality, Mode = Server, AND steps, cfg, sampler, width, and height are not customized.

## Generate Custom / Arbitrary Preset Server
- **Script**: `bin/sdcpp-server-generate.sh`
- **Arguments**: `--prompt "..." [--preset <preset>] [--negative "..."] [--steps <N>] [--width <N>] [--height <N>] [--cfg <N>] [--sampler <sampler>] [--api <api>] [--seed <seed>]`
- **When**: UI "Generate" form with Mode = Server AND EITHER the preset is Custom OR any steps, cfg, sampler, width, or height are customized.

## Batch Generate
- **Script**: `bin/sdcpp-batch-generate.sh`
- **Arguments**: `--prompt "..." --mode cli|server [--negative "..."] [--count <N>] [--preset <preset>] [--seed-mode <mode>] [--seed-start <N>] [--api <api>]`
- **When**: UI "Batch Explore" form.

## Verify
- **Script**: `bin/sdcpp-verify.sh`
- **Arguments**: (none)
- **When**: UI "Advanced Diagnostics" -> "Run Backend Verify".

## Server Status
- **Script**: `bin/sdcpp-server-status.sh`
- **Arguments**: (none)
- **When**: UI top status bar automated polling, or "Warm Server" -> "Check Status".

## Stop Server
- **Script**: `bin/sdcpp-server-stop.sh`
- **Arguments**: (none)
- **When**: UI "Warm Server" -> "Stop Server".

---

## Allowed Parameter Bounds

The Express server enforces these bounds before execution:
- **Steps**: Integer between 1 and 40 inclusive.
- **CFG Scale**: Float between 1.0 and 20.0 inclusive.
- **Width**: Must be exactly 384 or 512.
- **Height**: Must be exactly 384 or 512.
- **Sampler**: String matching alphanumeric or underscores (at least `euler_a`).
- **Seed**: Must be `random`, `fixed`, or a positive integer.
- **Save Prompts**: Boolean. If false/undefined, the job is run with environment variable `SDCPP_REDACT_PROMPTS=1`.

---

## Prompt Privacy Canary Test

A live canary generation proves prompt text does not persist when Save Prompts is OFF.

**Command (Save Prompts OFF):**
```
curl -s -X POST http://127.0.0.1:31337/api/actions/generate-single \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"PRIVACY_CANARY_DO_NOT_STORE_742913 a dog","negative_prompt":"",
       "mode":"cli","preset":"fast","steps":8,"cfg_scale":7.0,"sampler":"euler_a",
       "width":512,"height":512,"seed":"","save_prompts":false}'
```
Poll `/api/jobs/<job_id>` until `PASS`, then prove privacy:
```
grep -R "PRIVACY_CANARY_DO_NOT_STORE_742913" sdcpp-workflow/runs operator-console/server.log
# also check the tokenized reconstruction, which a literal grep misses:
grep -R "canary</w>" sdcpp-workflow/runs
```

**Result (2026-06-20):** Both canaries (`742913`, post-fix `842914`) generated
`PASS`. Run records (`run-metadata.json`, `cli-run-report.md`, `metrics.tsv`,
`ui-run-card.md`) stored `[REDACTED]`; the image output and metrics persisted
normally; the job-log API returned no canary text. The first canary also exposed a
**tokenizer reconstruction leak** in `remote-stdout.log` (see implementation-notes →
"Tokenizer token-array redaction"), which was fixed at source and re-verified clean.
Redaction is performed at write-time; **no recursive post-generation scrub is used**.
The canary run directories are runtime artifacts under the git-ignored `runs/` and
are not committed.

## Manual / DOM QA Checklist (vanilla, no framework)
1. `npm run check` and `node --check public/app.js` pass.
2. Start `node server.js`; load `http://127.0.0.1:31337` — title resolves, console
   is error-free (inline SVG favicon).
3. **Settings**: Save Prompts OFF, Auto-open OFF, privacy warning visible.
4. **Generate**: model dropdown disabled with helper text; steps/cfg/sampler/
   scheduler/width/height/seed/negative all present; `Generate Image` is the
   dominant primary button; result renders in the right preview (`object-fit:
   contain`) with metadata chips and View Run Detail / Open in Gallery.
5. **Gallery**: image-first grid, lazy thumbnails decode, prompts show "Prompt
   redacted", no verify/status runs present.
6. **Run History**: all runs listed; check runs use a neutral badge; no literal
   "undefined"; prompt search is **disabled** with a privacy note while Save Prompts
   is OFF.
7. **Advanced Diagnostics**: Verify and Seed Test actions; cleanup guarded by a
   confirm() dialog.
8. Job drawer is a non-blocking bottom-right toast; `prefers-reduced-motion` is
   honored.
