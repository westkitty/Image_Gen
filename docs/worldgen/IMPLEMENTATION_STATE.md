# Local WorldGen Implementation State

repo_head: a2f7da48c7e97db5d658f1b79fa6f24e86166250
branch: codex/feature/local-worldgen-3d
phase: 14 — final validation, installation, and publication
status: PARTIAL
storage_internal_free: 26 GiB observed on Big Mac during Phase 0
storage_wc2tb_free: 182 GiB observed on /Volumes/wc2tb during Phase 0
quick3d: PASS — live product job d563869e-cb74-4aa3-b3d5-f2c479f53d22; SHARP MPS; 1,179,648 vertices; canonical PLY wp-b86ca45f-quick3d.ply; remote/local SHA fe09a1981da1f87e96f74d7716bc81d8a2c3150540c80a88be64495700a634d6
panorama: PASS — live product job 23164f66-8fd1-49a9-a5ce-4f62ebc2056a; canonical 1024×512 PNG wp-73e3136f-panorama.png; Base 4B + exact ERP LoRA; SHA 4f7e5f63fa9a8b92d87393ae1158fcafb1f6849b69d2aee98b5ad25830179404; 11.03 GB peak observed
viewer: PASS — live Codex viewer loaded canonical fused PLY with 27890 points; installed wrapper loaded canonical console UI; browser fallback remains supported
world_project: PASS — durable store/API, lineage, retry/failure records, and live Quick3D project persisted
complete360: PARTIAL — fresh live job 106095e6-c7c5-4070-a407-2354ccb57c72 / project wp-5689d7e3 completed: panorama PASS, LOW-confidence fallback depth WARN, 131072-point scaffold, six-camera 15° overlap rig, six MPS SHARP proposals, ERP-frame alignment, voxel-deduplicated fusion PASS with 27890 final points, collision/runtime/viewer READY, remote cleanup PASS; quality remains WARN only because learned global depth is unavailable
live_install: PASS — supported installer verified `/Applications/DexDiffusion.app`, bundle `local.image-gen.wrapper`, source HEAD a2f7da4; live API PID 28863 reports canonical cwd, loopback bind, Big Mac identity, and world project stages
last_green_test: operator-console suite — 300 passed, 0 failed; compiler depth/scaffold/rig/views/fuse probes passed; eight Drive assets compiler-only matrix passed in contract order; fresh SHARP/fusion project stages and canonical artifact checks passed
last_commit: a2f7da48c7e97db5d658f1b79fa6f24e86166250
last_push_remote_sha: a2f7da48c7e97db5d658f1b79fa6f24e86166250
next_exact_action: replace the historical low-confidence depth with a learned depth worker when installed, then rerun quality and human visual acceptance
blocker: learned global depth is unavailable in the current local runtime; quality is WARN/PARTIAL, while all available compiler, SHARP, fusion, runtime, viewer, install, and publication gates passed
