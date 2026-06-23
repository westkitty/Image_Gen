#!/usr/bin/env bash
# sdcpp-upscale-capabilities.sh — probe local and remote tools for upscale/hires/face-restore.
# PASS = probe completed (result may be "not supported").
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

REMOTE_TMP="$(mktemp /tmp/sdcpp_upcap_remote_XXXXXX.txt)"
cleanup_tmp() { rm -f "$REMOTE_TMP"; }
trap cleanup_tmp EXIT

log "Probing local and remote tools for upscale/Hires Fix/face restore capabilities"

# ---- local probes ------------------------------------------------------------
has_tool() { command -v "$1" >/dev/null 2>&1 && printf 'yes' || printf 'no'; }

LOCAL_PYTHON3="$(has_tool python3)"
LOCAL_CONVERT="$(has_tool convert)"
LOCAL_FFMPEG="$(has_tool ffmpeg)"

LOCAL_PILLOW="no"
if [ "$LOCAL_PYTHON3" = "yes" ]; then
  python3 -c "from PIL import Image" 2>/dev/null && LOCAL_PILLOW="yes" || true
fi

LOCAL_CONVERT_VERSION="none"
if [ "$LOCAL_CONVERT" = "yes" ]; then
  LOCAL_CONVERT_VERSION="$(convert -version 2>/dev/null | head -1 || true)"
fi

log "Local: python3=$LOCAL_PYTHON3 pillow=$LOCAL_PILLOW convert=$LOCAL_CONVERT ffmpeg=$LOCAL_FFMPEG"

# ---- remote probe ------------------------------------------------------------
ssh -o ConnectTimeout=20 "$SSH_TARGET" <<'REMOTE' > "$REMOTE_TMP" 2>/dev/null || true
STAGING="$HOME/sdcpp-staging"

has_cmd() { command -v "$1" >/dev/null 2>&1 && printf 'yes' || printf 'no'; }

printf 'REMOTE_PYTHON3=%s\n' "$(has_cmd python3)"
printf 'REMOTE_CONVERT=%s\n' "$(has_cmd convert)"
printf 'REMOTE_FFMPEG=%s\n' "$(has_cmd ffmpeg)"

# Check for Real-ESRGAN executable
REALESRGAN="no"
for cand in "$STAGING/realesrgan-ncnn-vulkan" "$HOME/bin/realesrgan-ncnn-vulkan" \
            "/usr/local/bin/realesrgan-ncnn-vulkan"; do
  if [ -x "$cand" ]; then REALESRGAN="yes"; break; fi
done
printf 'REMOTE_REALESRGAN=%s\n' "$REALESRGAN"

# Check for GFPGAN/CodeFormer via python
GFPGAN="no"
CODEFORMER="no"
if command -v python3 >/dev/null 2>&1; then
  python3 -c "import gfpgan" 2>/dev/null && GFPGAN="yes" || true
  python3 -c "import codeformer" 2>/dev/null && CODEFORMER="yes" || true
fi
printf 'REMOTE_GFPGAN=%s\n' "$GFPGAN"
printf 'REMOTE_CODEFORMER=%s\n' "$CODEFORMER"

# Check if SDCPP server has /sdapi/v1/extra-single-image
BUILD_DIR_FILE="$STAGING/build_dir.txt"
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
UPSCALE_API="no"
REPO="$HOME/stable-diffusion.cpp"
if [ -d "$REPO" ]; then
  if grep -r 'extra.single.image\|upscale\|esrgan' "$REPO" --include='*.cpp' --include='*.h' -l 2>/dev/null | grep -qi server; then
    UPSCALE_API="yes"
  fi
fi
printf 'REMOTE_UPSCALE_API=%s\n' "$UPSCALE_API"

printf '__UPSCALE_PROBE_DONE__\n'
REMOTE

PROBE_DONE="no"
grep -q '__UPSCALE_PROBE_DONE__' "$REMOTE_TMP" && PROBE_DONE="yes" || true

if [ "$PROBE_DONE" = "no" ]; then
  log "Remote probe did not complete — SSH may have timed out. Proceeding with local results only."
fi

python3 - \
  "$LOCAL_PYTHON3" "$LOCAL_PILLOW" "$LOCAL_CONVERT" "$LOCAL_FFMPEG" \
  "$REMOTE_TMP" "$PROBE_DONE" \
  > "$SDCPP_STATE_DIR/upscale-capabilities.json" <<'PYSCRIPT'
import sys, json, datetime

local_python3 = sys.argv[1]
local_pillow  = sys.argv[2]
local_convert = sys.argv[3]
local_ffmpeg  = sys.argv[4]
remote_file   = sys.argv[5]
probe_done    = sys.argv[6]

def read_env(path):
    out = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('__'):
                    k, _, v = line.partition('=')
                    out[k.strip()] = v.strip()
    except Exception:
        pass
    return out

r = read_env(remote_file)

def yn(val): return val == 'yes'

remote_python3   = yn(r.get('REMOTE_PYTHON3', 'no'))
remote_convert   = yn(r.get('REMOTE_CONVERT', 'no'))
remote_realesrgan = yn(r.get('REMOTE_REALESRGAN', 'no'))
remote_gfpgan    = yn(r.get('REMOTE_GFPGAN', 'no'))
remote_codeformer = yn(r.get('REMOTE_CODEFORMER', 'no'))
remote_upscale_api = yn(r.get('REMOTE_UPSCALE_API', 'no'))

# Upscale: needs Real-ESRGAN remote OR ImageMagick local
upscale_supported = remote_realesrgan or yn(local_pillow)
if remote_realesrgan:
    upscale_reason = 'real-esrgan-ncnn-vulkan found on remote — upscale script feasible'
elif yn(local_pillow):
    upscale_reason = 'Pillow available locally — basic 2x Lanczos upscale feasible; Real-ESRGAN not found'
else:
    upscale_reason = 'No upscale tool found (Real-ESRGAN absent on remote; Pillow absent locally)'

# Hires Fix: needs upscale capability + txt2img working
hires_supported = upscale_supported
hires_reason = ('Two-pass hires fix feasible: txt2img → upscale pipeline'
                if hires_supported else
                'Blocked by missing upscale tool')

# Face restore
face_supported = remote_gfpgan or remote_codeformer
if remote_gfpgan:
    face_reason = 'GFPGAN found on remote'
elif remote_codeformer:
    face_reason = 'CodeFormer found on remote'
else:
    face_reason = 'No face restoration tool found (GFPGAN and CodeFormer absent on remote)'

result = {
    'probed_at':       datetime.datetime.utcnow().isoformat() + 'Z',
    'remote_probe_ok': probe_done == 'yes',
    'local': {
        'python3': yn(local_python3),
        'pillow':  yn(local_pillow),
        'convert': yn(local_convert),
        'ffmpeg':  yn(local_ffmpeg),
    },
    'remote': {
        'python3':     remote_python3,
        'convert':     remote_convert,
        'realesrgan':  remote_realesrgan,
        'gfpgan':      remote_gfpgan,
        'codeformer':  remote_codeformer,
        'upscale_api': remote_upscale_api,
    },
    'capabilities': {
        'upscale':     {'supported': upscale_supported,  'reason': upscale_reason},
        'hiresFix':    {'supported': hires_supported,    'reason': hires_reason},
        'faceRestore': {'supported': face_supported,     'reason': face_reason},
    },
}
print(json.dumps(result, indent=2))
PYSCRIPT

log "Capabilities cached: $SDCPP_STATE_DIR/upscale-capabilities.json"

pass_banner "Upscale/Hires/Face-restore capability probe complete.
Cache: $SDCPP_STATE_DIR/upscale-capabilities.json"
