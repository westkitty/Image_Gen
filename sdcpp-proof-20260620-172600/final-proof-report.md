# BigMac stable-diffusion.cpp Metal Image-Gen Proof — Final Report

Generated: 2026-06-20 (proof workspace: `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600`)

## Result: PASS

- CLI PNG proof: PASS
- Server API PNG proof: PASS (3 of 3 paths verified)
- Native async proof: COMPLETED (optional, not required for PASS)

---

## Route proof
- whoami: `bigmac`
- hostname: `bigmac`
- HOME: `/Users/bigmac` (discovered, not guessed)
- macOS: ProductVersion 26.5.1, BuildVersion 25F80

## Hardware proof
- CPU: Apple M4
- hw.memsize: 34359738368 bytes (32 GiB)
- memory shown by system_profiler: Mac mini (Mac16,10), Apple M4, 10 cores (4P/6E), Memory 32 GB

## Tailscale proof
- tailscale status summary: MacBook (macbook-air, 100.120.7.127) and BigMac (bigmac, 100.67.12.66, online, tagged-devices) both on the tailnet. NOTE: local Homebrew `tailscale` CLI cannot reach the daemon (GUI/App Store variant uses a sandboxed socket); the GUI app's bundled CLI at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` was used for status/ping.
- BigMac tailscale IPv4: 100.67.12.66
- tailscale ping result: `pong from bigmac (100.67.12.66) via 70.67.102.164:2663 in 74ms`
- whether SSH route worked: YES. (Initially NO — Tailscale was stopped on the MacBook and `ssh westcat` timed out; user reconnected Tailscale manually, after which SSH succeeded and was the primary control channel.)

## Storage proof
- df -h HOME: /dev/disk3s1 on /System/Volumes/Data — 228Gi total, 34Gi avail, 84% used
- HOME write probe: PASS — wrote `$HOME/sdcpp-staging/probe/write.txt` (29 bytes), gtimeout-bounded, exit 0
- df -h /Volumes/wc2tb: /dev/disk4s1 — 1.9Ti total, 814Gi avail, 58% used
- /Volumes/wc2tb write probe: PASS — wrote `/Volumes/wc2tb/ImageGen/sdcpp_probe/write.txt` (29 bytes), gtimeout-bounded
- chosen proof path: `$HOME/sdcpp-staging` (inference kept off wc2tb)

## Build proof
- repo path: `/Users/bigmac/stable-diffusion.cpp`
- git commit: `7f0e728` ("fix: normalize CLIP prompts before special-token splitting (#1670)")
- build directory: `/Users/bigmac/sdcpp-staging/builds/build-metal-proof-20260620-143223`
- out-of-repo build confirmed: YES (build dir under `$HOME/sdcpp-staging/builds`, not in the checkout)
- post-build repo cleanliness: CLEAN (`git status --short` empty; HEAD still 7f0e728)
- cmake configure result: success — `-DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release`, "Configuring done"/"Generating done"
- build result: success — reached [100%] "Built target sd-server" and "Built target sd-cli" (warnings only)
- sd-cli help result: OK — banner "stable-diffusion.cpp version master-709-92a3b73-1-g7f0e728, commit 7f0e728"
- sd-server help result: OK — exposes `-l, --listen-ip <string>` and `--listen-port <int>` (no `--host`/`--port` used)

## Bible proof
- Bible path: `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/BigMac_SDCPP_Image_Gen_Proof_Bible.md`
- environment pointer path: `/Users/andrew/Image_Gen/latest-sdcpp-proof-env` -> `.proof-env`
- number of ledger entries: 9 (Entry 1 through Entry 9) + this Entry 10
- last ledger entry title (pre-report): "Entry 9 - Server API PNG Proof Completed and Process State Recorded"
- whether failure/correction entries were required: No hard FAILURE-stop entry. Correction/deviation notes were appended in Entry 3 (Tailscale-down blocker, resolved), Entry 7 (model found on BigMac wc2tb, not at prescribed paths; staged without download), Entry 8 (dropped `--backend metal`; Metal auto-selected), Entry 9 (used ports 7870/17870 because 7860 was occupied).

## CLI inference proof
- exact command (run on BigMac, Metal auto-selected; `--backend metal` removed — see note):
  ```
  sd-cli -m $HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors \
    -p "a lovely cat" -n "blurry, low quality" -W 512 -H 512 --steps 1 \
    --cfg-scale 7.0 --sampling-method euler_a --diffusion-fa \
    -o $HOME/sdcpp-staging/outputs/sd15_cli_smoke.png -v
  ```
  Note: the prescribed `--backend metal` was removed. In this pinned build `--backend` takes a device assignment (cpu/cuda0/vulkan0); the Metal device enumerates as `MTL0 (Apple M4)` and is the default when `SD_METAL=ON`. Metal use confirmed in log (`ggml_metal_device_init: GPU name: MTL0 (Apple M4)`).
- BigMac output path: `/Users/bigmac/sdcpp-staging/outputs/sd15_cli_smoke.png`
- BigMac file output: `PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced`
- BigMac ls -lh: 556K
- MacBook copied path: `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/sd15_cli_smoke.png`
- MacBook file output: `PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced`
- MacBook ls -lh: 556K
- integrity: MD5 match local==remote = `f82fdbbb1e860f0c53a4cbeaecbd3cc4`
- generation time: generate_image completed in 12.83s (1 step in 7.83s)

## Server proof
- tmux session: `sdcpp_sd15_20260620_145053`
- BigMac port 7870 listener: sd-server PID 70807 on 127.0.0.1:7870 (port 7860 was avoided — occupied by unrelated Python PID 95068, left untouched)
- MacBook tunnel 17870 listener: ssh PID 68314 on 127.0.0.1:17870 (IPv4+IPv6)
- endpoint(s) used: `/sdcpp/v1/capabilities`, `/v1/models`, `/v1/images/generations` (OpenAI), `/sdapi/v1/txt2img` (SD WebUI), `/sdcpp/v1/img_gen` + `/sdcpp/v1/jobs/<id>` (native async)
- response JSON path(s): `sdcpp-openai-image-response.json`, `sdcpp-sdapi-image-response.json`, `sdcpp-native-job-response.json` (+ capabilities.json, models.json)
- decoded PNG path(s): `sdcpp_openai_sd15.png`, `sdcpp_sdapi_sd15.png`, `sdcpp_native_sd15.png` (all decoded with `base64 -D`)
- file output: all three = `PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced`
- ls -lh output: OpenAI 501K, SDAPI 579K, native 556K
- cleanup performed or left running: CLEANUP PERFORMED (tunnel closed via control socket; named tmux session killed)
- cleanup verification: local 17870 CLOSED + control socket removed; remote 7870 CLOSED + tmux SESSION GONE; pre-existing Python on 7860 confirmed still LISTENING (untouched)
- if left running: N/A

## Native async proof
- attempted or skipped: ATTEMPTED
- status: completed (job `job_6a370bb6_00000000`, error null, completed on first poll)
- decoded PNG path: `sdcpp_native_sd15.png` (512x512 PNG, 556K)
- note: native async is OPTIONAL and not required for PASS.

## Decision
- PASS — CLI PNG proof passed AND multiple server API paths (OpenAI-compatible, SD WebUI-compatible, native async) each produced a verified PNG on the MacBook.

## Verified proof artifacts (MacBook)
- `sd15_cli_smoke.png` (CLI, 556K, MD5-matched to BigMac)
- `sdcpp_openai_sd15.png` (OpenAI API, 501K)
- `sdcpp_sdapi_sd15.png` (SD WebUI API, 579K)
- `sdcpp_native_sd15.png` (native async, 556K)
- plus response JSON, .b64 intermediates, capabilities.json, models.json, the Bible, and `.proof-env`
