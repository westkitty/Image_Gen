# Sidecar engine promotion policy (infrastructure E, 2026-10-17)

This policy covers every engine change that an approval packet (OP-1A, OP-1B, OP-2, OP-3, OP-4B, OP-5, OP-6) may introduce. **Nothing here authorises building or installing anything.** It defines how a new engine build would be staged, proven and promoted once a packet is approved, so that the proven production engines are never at risk.

## Protected production engines (pinned in `docs/parity/ENGINE_CONTRACT.json`)

| Engine | Path on Big Mac | Pin |
|---|---|---|
| sd-cli | `~/stable-diffusion.cpp/build/bin/sd-cli` | rev `7f0e728`, sha256 `ee1bc2fe…bba9bb`, 56,620,648 bytes |
| sd-server | `~/stable-diffusion.cpp/build/bin/sd-server` | rev `7f0e728`, sha256 `443d924a…651cfb` |
| MFLUX | `~/Library/Caches/DexDiffusion/mflux/venv` | mflux 0.20.0 (protected runtime) |

These files are never rebuilt, patched, replaced, symlinked over or moved. Their repository checkout (`~/stable-diffusion.cpp`) is never switched to another revision.

## Stages

1. **Sidecar build (after packet approval only).**
   - Build from a separate worktree or clone: `~/sdcpp-sidecars/<packet>-<upstream-rev>-<patch-sha8>/`.
   - The build output lives only under that directory.
   - The source is the pinned upstream revision plus the packet's patch file, which is committed under `docs/parity/patches/`.
   - Record the toolchain (`cmake --version`, Xcode CLT) and the Metal flags. They must match the production build flags shown by `sd-cli --help` / `--version`.
2. **Registration.**
   - Add an engine entry to `ENGINE_CONTRACT.json` with `id: "sd-cli-<packet>"`, path, rev, sha256, bytes and its probed `--help` flag list.
   - Its features start as `ENGINE_AVAILABLE`.
   - `engine-contract.test.js` enforces that no feature cites a flag missing from its own engine.
3. **Non-regression against production.** Using the parity lab and the perf harness, the sidecar must reproduce the production binary on unchanged features:
   - **Same request:** identical pixels (decoded-RGB sha256) for txt2img, img2img and inpaint at a fixed seed, for every SDCPP target.
   - **New flag off:** bit-identical to production.
   - **Speed:** warm median wall time within 5% of production (`perf_harness.py`, same conditions, same session).
   - **Memory:** peak RSS within 10% (`/usr/bin/time -l` on Big Mac).
4. **Feature proof.** Run the packet's own numerical tests and live proof, as defined in `OPUS_TASK_PACKETS.md`. Results become ledger receipts. Only a live pass moves a feature to `PROVEN` for that sidecar.
5. **Opt-in routing.**
   - `capabilities.js` routes only the packet's new feature to the sidecar, per target. Every other request keeps using the production binary.
   - The route is a config entry, not a code path that replaces the default.
   - Requests that need the new feature on a target without a proven sidecar keep their current "unavailable, with reason" rejection.
6. **Promotion to default (separate approval).** Making a sidecar the default engine for all requests needs:
   - all of stage 3 re-run on the day;
   - two weeks (or 200 jobs) of opt-in use with no engine-attributed failure;
   - the user's explicit approval.

   Even then, the production binary stays on disk unchanged as the rollback target.

## Rollback (any stage)
- Remove the routing entry, which returns every request to the production binary. Then delete the sidecar directory.
- No production file is touched, so rollback never needs a rebuild.
- `probe_engine_contract.sh` must still report the production sha256 unchanged.

## Drift rule
If the production binary's sha256 ever differs from the pin, that engine's `PROVEN` features are suspended until re-proven, and the console reports drift. This holds whether or not a sidecar exists, and whatever the cause.

## Cancellation
A sidecar must:
- announce `SDCPP_RUN_ID` lines;
- name its output paths with the run id, exactly like production;
- be matched by `sdcpp-remote-cancel.sh --check-only` / `--scan-owned`.

OP-7 verified cancellation and quarantine apply to it unchanged. A sidecar that cannot be stopped by run id is not routable.

## Reject criteria (stop and roll back)
- any pixel difference on an unchanged feature with the new flag off;
- a crash or Metal error in non-regression;
- a performance or memory regression beyond the limits above;
- a cancel that cannot be verified;
- any prompt text in logs.
