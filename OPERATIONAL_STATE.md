# Operational State: Image_Gen / DexDiffusion

Current resumption index, captured 2026-10-04. Historical reports below retain their original evidence scope; this documentation/identity pass did not rerun their product gates.

## Current identity

- Repository `/Users/andrew/Image_Gen`, `main`, HEAD `424c914f2b6c1348719b9cfc78a669411e9e83f1`. Clean before this documentation slice; cached `origin/main` matched 0/0 at capture. Live remote parity not checked here.
- Existing console PID 33767 on 127.0.0.1:31337: `/api/version` reports HEAD 424c914 and cwd `/Users/andrew/Image_Gen/operator-console`, matching source/listener.
- Installed `/Applications/DexDiffusion.app`, bundle `local.image-gen.wrapper`, root `/Users/andrew/Image_Gen`. Build source stamp 10aaa2b is older than current console; it identifies wrapper build lineage, not served UI revision.
- Safe cold wrapper open observed from inactive app with no active jobs and idle lease. Native UI rendered correct URL with Backend Idle/no job; console PID remained 33767. Cold server boot, generation and human acceptance were not checked. [Identity receipt](docs/operations/target-identity-20261004.json).

## Architecture and invariants

[AGENTS.md](AGENTS.md) owns narrow onboarding and applicable gates; [DEXDIFFUSION.md](DEXDIFFUSION.md) owns operations. MacBook UI/control/storage plus `ssh westcat` Big Mac compute. Preserve protected Klein 4B primary, secondary SDCPP targets, canonical `/Users/andrew/images_made`, ephemeral remote outputs, privacy policy and truthful progress. Console stays loopback; Serve 8443 is tailnet-only; separate DEX//REACH 443 remains untouched.

## Latest reported product closeout and open gaps

[Rev19 report](output/rev19/FINAL_REPORT.md) reports 295/295 unit, 37/37 focused, Edit 24/24, Voice 8/8, chain 24+8, matrix 180/180 and one validated live Klein 4B publication. [Command receipts](output/rev19/final-gates.json) and [runtime receipt](output/rev19/final-runtime-closeout.json) are historical direct evidence, not newly rerun checks. Earlier [Rev18 report](output/rev18/FINAL_REPORT.md) remains retained.

- Physically wedged Apple Neural Engine behavior remains unverified; installed-LoRA render unavailable in the reported environment.
- Rev19 storage inventory reports 502 historical missing identities, cause unknown; four historical remote exposure logs remain preserved.
- Legacy image progress/list migration and broader temporary-resource ownership are partial. Power-loss durability, automatic crash-journal recovery, production bootstrap latency under host pressure and general human acceptance remain uncertified.
- FLUX.1 Schnell FP8 remains failed/unresolved in revision 15's exact-model proof. Do not promote it from family history or a solid-white frame.
- Next work must bind a specific gap, its owner and acceptance witness. No broad repair or historical-data deletion is authorized by this index.

## History and preservation

The complete original 541-line state is byte-identical in [immutable history](docs/history/OPERATIONAL_STATE-through-rev19-20261004.md). SHA-256 `435eff15248666f0b57db7cc9a44a61d54186295dd28e17fd5a9fd3fd5b7017d`. [Preservation mapping](docs/history/PRESERVATION.md) describes section/identifier coverage and the original root for historical relative references. Nothing was removed from history; contradictions, superseded claims and failed runs remain historical rather than silently becoming current facts.


## Storage migration — 2026-10-04

- Big Mac model storage migration completed for exactly three SDCPP checkpoints:
  - SD1.5: `/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors` (4,265,146,304 bytes)
  - SDXL Base: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors` (6,938,078,334 bytes)
  - SDXL Turbo: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors` (6,938,081,905 bytes)
- The old `/Users/bigmac/sdcpp-staging/models/` names are now symlinks only; the model bytes live on `wc2tb`. Photonic Fusion and FLUX.1 Schnell were not moved.
- Migration integrity: source/destination exact byte sizes matched. Start/middle/end 4 MiB SHA-256 samples matched for all three model pairs. Full-file hashing of the external SSD exceeded the DEX 60-second command window and is not claimed.
- Big Mac internal Data volume immediately free changed from 7,330,316 KiB (~6.99 GiB) before migration to 25,049,660 KiB (~23.89 GiB) after migration, a measured gain of 17,719,344 KiB (~16.90 GiB). The ~20 GiB target is satisfied.
- Active runtime/config path references were migrated to the canonical external locations. Historical reports/receipts were intentionally left unchanged.
- Focused validation: `node --test operator-console/tests/capabilities.test.js operator-console/tests/system-info.test.js` passed 15/15; `git diff --check` passed; active runtime/config stale-path scan returned no references to the three old internal model files.
- Direct Big Mac verification after deletion: all three legacy symlinks resolve and `test -s` passes for every target. A separate `bin/dexdiffusion status` launch was blocked by the platform execution gate before execution, so no status-command result is claimed.

## Individual 3D asset capability — 2026-10-04

- The actual Big Mac proof target is Hunyuan3D-Swift commit `292331f4d26ddb80b9dcea6bcb5629ff82f12b82`, built with the installed Metal toolchain. Shape-small and RGB paint-small are installed under `/Volumes/wc2tb/generative-models/3d/hunyuan3d-swift/`; the capability receipt is [3d-capability-evidence.json](sdcpp-workflow/state/3d-capability-evidence.json).
- Mesh GLB passed a direct Big Mac run and local validation: 6,324,096 bytes, SHA-256 `620cd66d2b7849e92ec924f6d5d957e5bf2e991c6ebabd1850a9755bd05570bc`, 175,654 position vertices, finite non-degenerate bounds, and Blender 5.2.2 import. Shape-large also passed characterization at 7,128,528 bytes with 197,982 position vertices.
- Textured GLB passed a direct Big Mac run and local validation: 14,202,932 bytes, SHA-256 `91c739c94dfbafd3d17031e5d7d8605cfbaa0f61a6ca6f72ff4c9edcfafb15ea`, 235,283 position vertices, one embedded PNG texture, and Blender 5.2.2 import. Peak footprint was approximately 25.1 GB; swap increased during this run, so PBR remains disabled.
- The implementation uses the generic job store, shared heavy-compute lease, staging, canonical media store, checksum-verified SSH byte streaming, and exact remote cleanup. `scp` is not used for large result retrieval because an observed large transfer was incomplete despite a zero exit status.
- The new top-level `3D` tab owns individual image-to-asset jobs. `World` remains the environment/360 workspace; existing SHARP Quick3D remains available as the PLY comparison path. Integrated API/runtime acceptance is recorded only after the live console is restarted and `/api/3d/jobs` completes.
