# TROUBLESHOOTING

Each entry: symptom → why → safe fix. Golden rule: **collect evidence, never
broad-kill, never touch port 7860's owner.**

## SSH timeout / `ssh westcat` hangs or fails
- Symptom: `verify_route` fails; `ssh: connect to host ... port 22: Operation timed out`.
- Why: BigMac unreachable — almost always **Tailscale is down** on the MacBook (the route is a Tailscale IP).
- Fix: bring Tailscale up (see next entry), then `bin/sdcpp-verify.sh`.

## Tailscale disconnected
- Symptom: route works intermittently or not at all.
- Fix: open the Tailscale menu-bar app and **Connect**. Verify:
  ```sh
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status
  ```
  Reconnecting manually preserves your prefs (exit-node/routes).

## Local Homebrew `tailscale` CLI can't reach the daemon
- Symptom: `failed to connect to local Tailscale service; is Tailscale running?` even though the app is running.
- Why: the GUI / App Store Tailscale uses a sandboxed socket; the Homebrew `tailscale` CLI looks at `/var/run/tailscaled.socket`.
- Fix: use the app's bundled CLI instead:
  ```sh
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status
  /Applications/Tailscale.app/Contents/MacOS/Tailscale ping 100.67.12.66
  ```

## Remote hostname is not `bigmac`
- Symptom: `verify_route` fails with `Remote hostname is 'X', expected 'bigmac'`.
- Why: `ssh westcat` resolved to the wrong host.
- Fix: check `~/.ssh/config` for the `westcat` alias. Do **not** continue — the workflow refuses to act on the wrong machine on purpose.

## Repo dirty
- Symptom: `repo-dirty` gate; `git status --short` non-empty on BigMac.
- Why: something modified `$HOME/stable-diffusion.cpp`.
- Fix (manual, on BigMac, your call): inspect with `ssh westcat 'cd "$HOME/stable-diffusion.cpp" && git status'`. The workflow will not modify or reset it for you.

## Build dir missing
- Symptom: `build-dir-file` / `build-dir` gate.
- Why: `$HOME/sdcpp-staging/build_dir.txt` missing or points to a deleted dir.
- Fix: confirm the build exists: `ssh westcat 'cat "$HOME/sdcpp-staging/build_dir.txt"; ls "$(cat "$HOME/sdcpp-staging/build_dir.txt")/bin"'`. Rebuilding is out of scope for this workflow (see the proof Bible for the build recipe).

## Model missing
- Symptom: `model` gate.
- Why: `$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors` absent/empty.
- Fix: stage it manually on BigMac (the workflow never downloads weights). Expected size ~4,265,146,304 bytes.

## `--backend metal` failure
- Symptom (only if you hand-edit a command): `backend 'metal' was not found`.
- Why: in build `7f0e728`, `--backend` takes a device token, not `metal`. Metal is `MTL0` and is the default.
- Fix: **never pass `--backend metal`.** The scripts already omit it.

## Port occupied
- Symptom: `remote-port` or `local-port` gate; status shows OCCUPIED.
- Why: something already listens (notably the unrelated Python on 7860 — leave it alone).
- Fix: choose free ports:
  ```sh
  bin/sdcpp-server-start.sh --remote-port 7871 --local-port 17871
  ```
  Inspect occupant without killing: `ssh westcat 'lsof -nP -iTCP:7870 -sTCP:LISTEN'`.

## Tunnel control socket already exists
- Symptom: `tunnel-exists` gate.
- Why: a previous workflow tunnel is still active (or a stale socket file remains).
- Fix: `bin/sdcpp-server-stop.sh` (closes the workflow socket and removes the file safely). Then start again.

## Server started but endpoint fails
- Symptom: `server-generate` gate; no verified PNG.
- Checks:
  1. `bin/sdcpp-server-status.sh` — is remote 7870 and local 17870 listening?
  2. Tail the remote log: `ssh westcat 'tail -40 "$(ls -t "$HOME/sdcpp-staging/logs"/sd-server-*.log | head -1)"'`
  3. Probe directly (informational only — not success): `curl -s http://127.0.0.1:17870/v1/models | jq .`
- Remember: a 200 from `/v1/models` is **not** success. Only a verified PNG is.

## base64 decode failure
- Symptom: `base64-decode` gate.
- Why: macOS `base64` flag differences.
- Fix: the scripts already try `base64 --decode` then `base64 -D`. If both fail, the API response likely wasn't valid base64 — inspect the `*-response.json` in the run dir.

## PNG verification failure
- Symptom: `png-missing` / `png-empty` / `png-type` gate.
- Why: the decoded file isn't a real PNG (truncated transfer, error response encoded as text, etc.).
- Fix: open the run dir, check the `*-response.json` and `.b64`; re-run. CLI path also compares sha256 vs BigMac.

## Cleanup failure / PARTIAL stop
- Symptom: `sdcpp-server-stop.sh` exits with PARTIAL.
- Safe, surgical recovery (workflow-owned only):
  ```sh
  # close just our tunnel socket:
  ssh -S state/sdcpp-tunnel.sock -O exit westcat 2>/dev/null || true
  # kill only our recorded session:
  ssh westcat 'S=$(cat "$HOME/sdcpp-staging/server_session.txt"); tmux has-session -t "$S" && tmux kill-session -t "$S"'
  # verify:
  bin/sdcpp-server-status.sh
  ```
- Never `pkill ssh`, never `killall sd-server`.

## Remote checks behave oddly / everything reports "occupied" or "OK"
- Symptom: a hand-rolled `ssh westcat 'test ...'`/`ssh westcat 'lsof ...'` in an
  `if` always takes the true branch (e.g. every port looks "occupied", every
  `test -x` looks present).
- Why: **this BigMac's sshd does not propagate remote *command* exit codes** —
  `ssh westcat 'exit 3'` returns `0` locally. (SSH-layer failures like an
  unreachable host still return `255`.)
- Fix: judge remote booleans by **output**, not exit status. The library does
  this via `remote_test` (evaluates the test in the remote shell and echoes a
  sentinel). If you script around the workflow, do the same:
  ```sh
  if ssh westcat 'lsof -nP -iTCP:7870 -sTCP:LISTEN | grep -q LISTEN'; then ... fi   # still unreliable for exit code
  # prefer capturing output:
  out=$(ssh westcat 'lsof -nP -iTCP:7870 -sTCP:LISTEN'); [ -n "$out" ] && echo occupied
  ```

## All server-openai benchmark cells take the same time / identical PNG size
- Symptom: every `server-openai` cell ~30s with identical `png_bytes`, regardless of preset.
- Why: the OpenAI `/v1/images/generations` handler only reads prompt/size/n/output_format;
  steps fall back to the server default (~20).
- Fix: already handled — `sdcpp-server-generate.sh` embeds
  `<sd_cpp_extra_args>{"sample_params":{"sample_steps":N,...}}</sd_cpp_extra_args>` in the
  prompt so presets take effect. SDAPI (`/sdapi/v1/txt2img`) honors `steps` natively.

## Benchmark seems slow / takes too long
- The matrix is bounded to ≤40 cells; narrow `--presets`/`--modes`/`--repeats`.
- Use `--skip-server` for CLI-only, or `--modes cli`.
- smoke/fast presets are fastest; quality/quality_plus are deliberately slow.

## Timing shows integer seconds only
- `now_epoch` prefers `gdate +%s.%N` (Homebrew coreutils) then `date +%s.%N`. If neither
  yields fractions it falls back to integer `date +%s`. Install coreutils for sub-second.

## Same seed produces different images
- Symptom: `sdcpp-seed-test.sh` reports `deterministic: FAIL` (both PNGs verify, hashes differ).
- Why: sampler/backend/threading nondeterminism on that path. CLI is verified deterministic;
  server paths may not be bit-identical even with a fixed seed.
- Fix: for reproducible outputs use `--mode cli`, or use the SDAPI/native server path and
  re-run `sdcpp-seed-test.sh --mode server-sdapi` to check that specific path. Never claim
  reproducibility a UI can rely on unless the seed test PASSed for that mode.

## SDAPI batch images look random despite a seed
- Why: SDAPI's default seed is `-1` (random). If you don't pass a seed it varies each call.
- Fix: always pass `--seed`/`--seed-start` for deterministic SDAPI batches (the workflow does this when a seed is set).

## Batch exited 0 but some images failed
- Batch returns 0 for `PARTIAL` (some succeeded). Read `status` / `count_succeeded` in
  `batch-manifest.json` (or the `ui-run-card.md` front matter), not just the exit code.
  Failed images have `png_path: null` and a `logs/image-NNN.log`.

## How to collect evidence without breaking anything
```sh
bin/sdcpp-server-status.sh                  # full read-only snapshot
lsof -nP -iTCP:17870 -sTCP:LISTEN           # local tunnel
ssh westcat 'lsof -nP -iTCP:7870 -sTCP:LISTEN; tmux ls'   # remote server/sessions
```
Confirm the unrelated 7860 owner is untouched:
```sh
ssh westcat 'lsof -nP -iTCP:7860 -sTCP:LISTEN'
```
