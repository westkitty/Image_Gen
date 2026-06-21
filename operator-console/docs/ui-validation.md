# UI Validation & Command Mapping

This document lists the exact mapping from Operator Console UI actions to backend scripts to ensure safe boundaries and correct parameter passing.

## Generate Fast CLI
- **Script**: `bin/sdcpp-run-fast.sh`
- **Arguments**: `--mode cli --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate Single" form with Preset = Fast, Mode = CLI.

## Generate Quality CLI
- **Script**: `bin/sdcpp-run-quality.sh`
- **Arguments**: `--mode cli --prompt "..." [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate Single" form with Preset = Quality, Mode = CLI.

## Generate Selected Preset CLI (Arbitrary Preset)
- **Script**: `bin/sdcpp-cli-generate.sh`
- **Arguments**: `--prompt "..." --preset <preset> [--negative "..."] [--seed <seed>]`
- **When**: UI "Generate Single" form with Preset = [smoke, thumbnail, balanced, quality_plus], Mode = CLI.

## Batch Generate CLI
- **Script**: `bin/sdcpp-batch-generate.sh`
- **Arguments**: `--prompt "..." --mode cli [--negative "..."] [--count <N>] [--preset <preset>] [--seed-mode <mode>] [--seed-start <N>]`
- **When**: UI "Batch Explore" form, Mode = CLI.

## Server Generate
- **Script**: `bin/sdcpp-server-generate.sh`
- **Arguments**: `--prompt "..." [--negative "..."] [--preset <preset>] [--api <api>] [--seed <seed>]`
- **When**: UI "Generate Single" form with Mode = Server AND Preset not fast/quality. (If Preset is fast/quality, we use the wrappers: `sdcpp-run-fast.sh --mode server` or `sdcpp-run-quality.sh --mode server`).

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
