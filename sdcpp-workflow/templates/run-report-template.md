---
schema: sdcpp.run.v1
run_id: "<YYYYMMDD-HHMMSS-batch>"
run_type: "batch"            # cli | server-openai | server-sdapi | server-native | batch | seed-test
status: "PASS"               # PASS | PARTIAL | FAIL
created_at: "<ISO8601 with offset, e.g. 2026-06-20T19:15:00-0400>"
mode: "cli"                  # cli | server
preset: "fast"
prompt: "<prompt>"
negative_prompt: "<negative>"
count: 3
verified_png_count: 3
seed_mode: "increment"       # same | increment | random | (omit for single runs)
seed_start: 42
manifest_json: "batch-manifest.json"
manifest_tsv: "batch-manifest.tsv"
primary_image: "images/image-001.png"
cleanup_state: "not_applicable"   # not_applicable | stopped | server_left_running
first_failed_gate: null      # null or "<gate name>"
---

# SDCPP Run Report

## Summary
One line: what ran, PASS/FAIL, how many verified.

## Settings
- mode / api
- preset (WxH, steps, cfg, sampler)
- seed-mode + base seed
- prompt / negative

## Outputs
- `images/` · `records/` · `responses/` · `logs/`
- `batch-manifest.json` · `batch-manifest.tsv` · `ui-run-card.md`

## Images table
| index | seed | status | bytes | png |
|-------|------|--------|-------|-----|
| 1 | 42 | PASS | 480910 | images/image-001.png |

## Failures
(only if any) - image N (seed S): see logs/image-00N.log

## Cleanup state
not_applicable | stopped | server_left_running (+ stop command if left running)

## Next action
What the operator/UI should do next (view grid, parse manifest, stop server, …).
