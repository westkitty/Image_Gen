#!/usr/bin/env bash
# sdcpp-image-edit-capabilities.sh — probe BigMac for img2img/inpaint/outpaint support.
# PASS = probe completed (result may be "not supported").
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

PROBE_TMP="$(mktemp /tmp/sdcpp_editcap_XXXXXX.txt)"
cleanup_tmp() { rm -f "$PROBE_TMP"; }
trap cleanup_tmp EXIT

log "Probing BigMac ($SSH_TARGET) for img2img/inpaint/outpaint capabilities"

# Single-quoted heredoc: $HOME expands on BigMac.
ssh -o ConnectTimeout=20 "$SSH_TARGET" <<'REMOTE' > "$PROBE_TMP" 2>/dev/null || true
STAGING="$HOME/sdcpp-staging"
BUILD_DIR_FILE="$STAGING/build_dir.txt"

# Find the sd binary
SD_BIN=""
if [ -f "$BUILD_DIR_FILE" ]; then
  bd="$(cat "$BUILD_DIR_FILE" 2>/dev/null)"
  for cand in "$bd/bin/sd-cli" "$bd/bin/sd" "$bd/sd-cli" "$bd/sd"; do
    if [ -x "$cand" ]; then SD_BIN="$cand"; break; fi
  done
fi
if [ -z "$SD_BIN" ]; then
  for cand in "$STAGING/bin/sd-cli" "$STAGING/bin/sd" \
              "$HOME/stable-diffusion.cpp/build/bin/sd-cli" \
              "$HOME/stable-diffusion.cpp/build/bin/sd" \
              "$HOME/stable-diffusion.cpp/build/sd-cli" \
              "$HOME/stable-diffusion.cpp/build/sd"; do
    if [ -x "$cand" ]; then SD_BIN="$cand"; break; fi
  done
fi

printf 'SD_BIN=%s\n' "$SD_BIN"

if [ -z "$SD_BIN" ]; then
  printf 'IMG2IMG_HELP=__NOT_FOUND__\n'
  printf '__PROBE_DONE__\n'
  exit 0
fi

# Check help output for img2img flags
HELP="$("$SD_BIN" --help 2>&1 || true)"
printf 'SD_VERSION=%s\n' "$(printf '%s' "$HELP" | head -3 | tr '\n' '|')"

for flag in --init-img --strength --control-image --style-ratio; do
  key="$(printf '%s' "$flag" | sed 's/^--//' | tr '-' '_' | tr '[:lower:]' '[:upper:]')"
  if printf '%s' "$HELP" | grep -q -- "$flag"; then
    printf 'FLAG_%s=yes\n' "$key"
  else
    printf 'FLAG_%s=no\n' "$key"
  fi
done

# Check for sdapi /img2img support in the server (look for routes in source)
REPO="$HOME/stable-diffusion.cpp"
if [ -d "$REPO" ]; then
  if grep -r 'img2img\|img_to_img\|init.img' "$REPO" --include='*.cpp' --include='*.h' -l 2>/dev/null | grep -qi 'server\|stable'; then
    printf 'SERVER_IMG2IMG_SOURCE=yes\n'
  else
    printf 'SERVER_IMG2IMG_SOURCE=no\n'
  fi
else
  printf 'SERVER_IMG2IMG_SOURCE=unknown\n'
fi

printf '__PROBE_DONE__\n'
REMOTE

if ! grep -q '__PROBE_DONE__' "$PROBE_TMP"; then
  fail "ssh-probe" "Remote probe did not complete (sentinel missing). Check SSH to $SSH_TARGET."
fi

log "Probe output:"
cat "$PROBE_TMP" >&2

# Parse results and emit JSON summary
python3 - "$PROBE_TMP" <<'PYSCRIPT'
import sys, json, datetime

probe_file = sys.argv[1]
kv = {}
with open(probe_file) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('__'):
            k, _, v = line.partition('=')
            kv[k.strip()] = v.strip()

sd_bin = kv.get('SD_BIN', '')
found_binary = bool(sd_bin)

has_init_img    = kv.get('FLAG_INIT_IMG', 'no') == 'yes'
has_strength    = kv.get('FLAG_STRENGTH', 'no') == 'yes'
has_control_img = kv.get('FLAG_CONTROL_IMAGE', 'no') == 'yes'
server_img2img  = kv.get('SERVER_IMG2IMG_SOURCE', 'unknown')

img2img_supported  = found_binary and has_init_img and has_strength
inpaint_supported  = img2img_supported  # inpaint uses --init-img + mask (same flag set)
server_support     = server_img2img == 'yes'

result = {
    'probed_at':           datetime.datetime.utcnow().isoformat() + 'Z',
    'sd_binary_found':     found_binary,
    'sd_binary_path':      sd_bin,
    'sd_version_header':   kv.get('SD_VERSION', ''),
    'cli_flags': {
        'init_img':      has_init_img,
        'strength':      has_strength,
        'control_image': has_control_img,
    },
    'server_img2img_source': server_img2img,
    'capabilities': {
        'img2img': {
            'supported': img2img_supported,
            'reason':    'CLI --init-img and --strength flags present' if img2img_supported
                         else ('Binary not found on remote' if not found_binary
                               else 'CLI --init-img or --strength flag absent in sd --help'),
        },
        'inpaint': {
            'supported': inpaint_supported,
            'reason':    'Uses same --init-img path as img2img; mask support needs confirmation'
                         if inpaint_supported else 'Blocked: img2img CLI flags absent',
        },
        'outpaint': {
            'supported': False,
            'reason':    'Outpaint requires canvas-extend pre-processing not present in SDCPP CLI',
        },
        'controlnet': {
            'supported': has_control_img,
            'reason':    '--control-image flag present' if has_control_img
                         else '--control-image flag absent',
        },
    },
}
print(json.dumps(result, indent=2))
PYSCRIPT

CACHE_FILE="$SDCPP_STATE_DIR/image-edit-capabilities.json"
python3 - "$PROBE_TMP" > "$CACHE_FILE" <<'PYSCRIPT2'
import sys, json, datetime

probe_file = sys.argv[1]
kv = {}
with open(probe_file) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('__'):
            k, _, v = line.partition('=')
            kv[k.strip()] = v.strip()

sd_bin = kv.get('SD_BIN', '')
found_binary = bool(sd_bin)
has_init_img    = kv.get('FLAG_INIT_IMG', 'no') == 'yes'
has_strength    = kv.get('FLAG_STRENGTH', 'no') == 'yes'
has_control_img = kv.get('FLAG_CONTROL_IMAGE', 'no') == 'yes'
server_img2img  = kv.get('SERVER_IMG2IMG_SOURCE', 'unknown')
img2img_supported = found_binary and has_init_img and has_strength

result = {
    'probed_at':           datetime.datetime.utcnow().isoformat() + 'Z',
    'sd_binary_found':     found_binary,
    'cli_flags':           {'init_img': has_init_img, 'strength': has_strength, 'control_image': has_control_img},
    'server_img2img_source': server_img2img,
    'capabilities': {
        'img2img':    {'supported': img2img_supported},
        'inpaint':    {'supported': img2img_supported},
        'outpaint':   {'supported': False},
        'controlnet': {'supported': has_control_img},
    },
}
print(json.dumps(result, indent=2))
PYSCRIPT2

log "Capabilities cached: $CACHE_FILE"

pass_banner "Image-edit capability probe complete.
Cache: $CACHE_FILE"
