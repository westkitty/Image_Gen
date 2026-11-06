#!/usr/bin/env bash
# Deploy ControlNet on the Big Mac. Run it in Terminal on the Big Mac (Terminal can write WC2TB; SSH cannot), from a
# checkout of the ControlNet branch, while nothing is generating.
#   1. Copies the patched ControlNet sd-cli (CONTROL_NET_GRAPH_SIZE = MAX_GRAPH_SIZE, built on WC2TB during the smoke
#      test) to WC2TB. The stock sd-cli used for every other job is not touched.
#   2. Compiles the Apple Vision pose detector (operator-console/bin/vision-pose).
#   3. Installs the new engine-worker.py and adds only `sdcli_control` and `controlnets` to the installed registry.json.
#      Both files are backed up first as *.bak-<timestamp>.
#   4. Restarts the engine worker and the server, then prints the ControlNet status.
# No model is downloaded or copied; ControlNet models stay on WC2TB and are read only by the job that uses them.
set -euo pipefail

say() { printf '\n=== %s\n' "$*"; }
stop() { printf '\nSTOPPED: %s\nNothing after this point was changed.\n' "$*" >&2; exit 1; }

[ "$(id -un)" = bigmac ] || stop "run this on the Big Mac as bigmac"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
root="$HOME/.dexdiffusion-engine"
wc=/Volumes/wc2tb/ImageGen
dest_dir="$wc/engines/sdcpp-controlnet-7f0e728"
build_root=/Volumes/wc2tb/DexDiffusion/controlnet-smoke/patched-build
stamp="$(date +%Y%m%d-%H%M%S)"
uid="$(id -u)"
# The branch that was checked out before this one, for the undo note.
prev_branch="$(git -C "$repo" rev-parse --abbrev-ref '@{-1}' 2>/dev/null || echo main)"

say "checks"
[ -d "$wc" ] && [ -w "$wc" ] || stop "WC2TB ($wc) is not writable from this shell"
if pgrep -fl 'sd-cli|sd-server|mflux-generate'; then stop "a generation is running; run this again when it has finished"; fi
for f in "$wc/controlnet/control_v11p_sd15_openpose_fp16.safetensors" "$wc/controlnet/xinsir-openpose-sdxl-1.0-ldm.safetensors"; do
  [ -r "$f" ] || stop "missing ControlNet model $f"
done
[ -f "$root/engine-worker.py" ] && [ -f "$root/registry.json" ] || stop "engine worker is not installed in $root"
command -v node >/dev/null || stop "node is not on PATH in this shell"
[ -f "$repo/operator-console/controlnet.js" ] || stop "$repo is not on the ControlNet branch"
echo "ok: WC2TB writable, nothing generating, both ControlNet models readable, repo at $(git -C "$repo" rev-parse --short HEAD)"

say "ControlNet engine -> $dest_dir/sd-cli"
if [ -x "$dest_dir/sd-cli" ]; then
  echo "already installed; leaving it as is"
else
  grep -rqs --include=control.hpp 'define CONTROL_NET_GRAPH_SIZE MAX_GRAPH_SIZE' "$build_root" || stop "the patched source was not found under $build_root"
  src="$(find "$build_root" -path '*/bin/sd-cli' -type f -perm -u+x 2>/dev/null)"
  [ -n "$src" ] && [ "$(printf '%s\n' "$src" | wc -l | tr -d ' ')" = 1 ] || stop "expected exactly one patched sd-cli under $build_root, found: ${src:-none}"
  echo "source: $src"
  echo "linked libraries outside macOS:"; otool -L "$src" | tail -n +2 | awk '{print "  " $1}' | grep -vE '^  (/usr/lib/|/System/)' || echo "  none"
  mkdir -p "$dest_dir"
  cp -p "$src" "$dest_dir/sd-cli"
  chmod 755 "$dest_dir/sd-cli"
fi
help_text="$("$dest_dir/sd-cli" --help 2>&1 || true)"
case "$help_text" in *--control-net*) ;; *) stop "$dest_dir/sd-cli does not start (or lacks --control-net)" ;; esac
shasum -a 256 "$dest_dir/sd-cli"

say "pose detector -> operator-console/bin/vision-pose"
/usr/bin/swiftc -O "$repo/operator-console/bin/vision-pose.swift" -o "$repo/operator-console/bin/vision-pose"
echo "compiled"

say "engine worker and registry (backups end in .bak-$stamp)"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
node "$repo/sdcpp-workflow/worker/build-registry.js" > "$tmp"
cp -p "$root/engine-worker.py" "$root/engine-worker.py.bak-$stamp"
cp -p "$root/registry.json" "$root/registry.json.bak-$stamp"
/usr/bin/python3 - "$root/registry.json" "$tmp" <<'PY'
import json, sys
installed_path, fresh_path = sys.argv[1:]
installed = json.load(open(installed_path)); fresh = json.load(open(fresh_path))
installed['sdcli_control'] = fresh['sdcli_control']
installed['controlnets'] = fresh['controlnets']
open(installed_path, 'w').write(json.dumps(installed, indent=2) + '\n')
for cid, c in installed['controlnets'].items(): print(f"  {cid}: {len(c['targets'])} models")
PY
cp "$repo/sdcpp-workflow/worker/engine-worker.py" "$root/engine-worker.py"
chmod 600 "$root/engine-worker.py" "$root/registry.json"

say "restart engine worker and server"
launchctl kickstart -k "gui/$uid/local.dexdiffusion.engine-worker"
launchctl kickstart -k "gui/$uid/local.dexdiffusion.server"
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:31337/api/controlnet/status >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:31337/api/controlnet/status | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print("engine:", d["engine"], "| pose detector:", d["poseDetector"], "| controlnets:", ", ".join(c["id"] for c in d.get("controlnets") or []) or "none")' \
  || stop "the server did not answer after the restart"

cat <<EOF

DEPLOYED. To undo:
  cp -p "$root/engine-worker.py.bak-$stamp" "$root/engine-worker.py"
  cp -p "$root/registry.json.bak-$stamp" "$root/registry.json"
  cd "$repo" && git checkout $prev_branch
  launchctl kickstart -k gui/$uid/local.dexdiffusion.engine-worker
  launchctl kickstart -k gui/$uid/local.dexdiffusion.server
EOF
