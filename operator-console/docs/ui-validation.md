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
