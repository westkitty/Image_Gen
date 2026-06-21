# Seed & Batch Controls (SD 1.5)

Verified against build `7f0e728` on BigMac (output-based inspection of
`sd-cli --help` and `examples/server/routes_*.cpp`). Determinism is only claimed
where `sdcpp-seed-test.sh` proves matching SHA256.

## Seed support by path

| path | how seed is passed | default if omitted | notes |
|------|--------------------|--------------------|-------|
| CLI (`sd-cli`) | `--seed N` / `-s N` | `42` (fixed) | `< 0` = random. Confirmed in `--help`. |
| SDAPI (`/sdapi/v1/txt2img`) | JSON `"seed": N` | **`-1` (random)** | `routes_sdapi.cpp:101` `j.value("seed",-1)`. Must send seed for determinism. |
| Native (`/sdcpp/v1/img_gen`) | JSON top-level `"seed": N` | server default | body parsed via `gen_params.from_json_str` (`routes_sdcpp.cpp:355`). |
| OpenAI (`/v1/images/generations`) | **only** via `<sd_cpp_extra_args>{"seed":N,...}</sd_cpp_extra_args>` in the prompt | server default | handler reads only prompt/size/n/output_format; extra args parsed by the same `from_json_str`. |

### Key consequences
- **CLI default seed is 42 (fixed)** → CLI is naturally reproducible if you don't pass `--seed`.
- **SDAPI default seed is -1 (random)** → SDAPI is NOT reproducible unless you pass a seed.
- **OpenAI seed is indirect** (extra-args). The workflow embeds it automatically when a seed is set; prefer **CLI, SDAPI, or native** for deterministic server runs.

## Workflow seed flags (all generators)
- `--seed N` — use integer N.
- `--seed fixed` — use the fixed default `42`.
- `--seed random` — generate a local random integer (recorded) and pass it to the backend, so the actual seed is always known and reproducible later.
- (omitted) — preserve each path's native default; reports record the seed as the value passed, or `default(42)` for CLI, or `unknown/not-controlled` when the backend chose randomly and did not echo it.

We never silently claim determinism: a run report shows the *actual* seed passed to
the backend, or `unknown/not-controlled` if it wasn't controlled.

## Batch controls (`sdcpp-batch-generate.sh`)
- `--count N` (default 3, hard cap 12 unless `--force-large-batch`).
- `--seed-mode same|increment|random` (default `increment`), `--seed-start N` (default 42).
  - `same`: every image uses the same seed.
  - `increment`: image i uses `seed-start + (i-1)`.
  - `random`: each image gets a fresh recorded random integer.
- `--mode cli` (default) or `--mode server` with `--api openai|sdapi|native`.
- For **deterministic** server batches prefer `--api sdapi` or `--api native` (seed is
  passed directly). `--api openai` works via extra-args but is the least direct.

## Reproducibility (measured)
Run `bin/sdcpp-seed-test.sh --preset smoke --seed 424242 --mode cli` to verify. It
generates the same seed twice, verifies both PNGs, and compares SHA256. The result
(deterministic PASS / FAIL / UNKNOWN) is recorded in `seed-test-report.md` and in the
Bible. Do not assume reproducibility without that proof — sampler/threading/backend
nondeterminism can break it even with a fixed seed.
