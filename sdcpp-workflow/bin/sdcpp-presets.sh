#!/usr/bin/env bash
# sdcpp-presets.sh — list/inspect speed presets from config/presets.env. Read-only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config
load_presets

ALL="smoke thumbnail fast balanced quality quality_plus"

show_one() {
  apply_preset "$1" >/dev/null 2>&1 || { echo "unknown preset: $1"; return 1; }
  printf '%-13s %sx%-4s steps=%-3s cfg=%-4s sampler=%s\n' \
    "$PRESET_NAME" "$PRESET_W" "$PRESET_H" "$PRESET_STEPS" "$PRESET_CFG" "$PRESET_SAMPLER"
}

if [ "$#" -ge 1 ]; then
  case "$1" in -h|--help) echo "Usage: $(basename "$0") [preset-name]"; exit 0 ;; esac
  show_one "$1"
  exit 0
fi

echo "Available presets (config/presets.env):"
for p in $ALL; do show_one "$p"; done
echo
echo "Use: --preset NAME on sdcpp-cli-generate.sh / sdcpp-server-generate.sh / sdcpp-benchmark.sh"
echo "Explicit flags (--steps/--width/--height/--cfg/--sampler) override preset values."
exit 0
