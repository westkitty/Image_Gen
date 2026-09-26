#!/usr/bin/env bash
# mflux-controlled-generate.sh - FLUX.2 Klein 4B via MFLUX on Big Mac.
# This script is always launched on the MacBook. Every Big Mac operation
# goes through the configured SSH target (westcat) from sdcpp.env.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

ARG_TARGET="flux2-klein-4b"
ARG_PROMPT=""
ARG_WIDTH="1024"
ARG_HEIGHT="1024"
ARG_STEPS="4"
ARG_SEED=""
ARG_SAVE_PROMPTS="false"

usage() {
  cat <<'USAGE'
Usage: mflux-controlled-generate.sh [options]
  --target flux2-klein-4b
  --prompt "..."
  --width N
  --height N
  --steps N
  --seed N|random|fixed
  --save-prompts true|false
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) ARG_TARGET="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --width) ARG_WIDTH="${2:?}"; shift 2 ;;
    --height) ARG_HEIGHT="${2:?}"; shift 2 ;;
    --steps) ARG_STEPS="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --save-prompts) ARG_SAVE_PROMPTS="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done

[ "$ARG_TARGET" = "flux2-klein-4b" ] || fail "target" "Unsupported MFLUX target: $ARG_TARGET"
[ -n "$ARG_PROMPT" ] || fail "prompt" "Prompt is required."
case "$ARG_SAVE_PROMPTS" in true|false) : ;; *) fail "args" "--save-prompts must be true|false" ;; esac

is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
is_uint "$ARG_WIDTH" || fail "width" "Width must be an integer."
is_uint "$ARG_HEIGHT" || fail "height" "Height must be an integer."
is_uint "$ARG_STEPS" || fail "steps" "Steps must be an integer."
[ "$ARG_WIDTH" -ge 256 ] && [ "$ARG_WIDTH" -le 2048 ] || fail "width" "Width must be 256-2048."
[ "$ARG_HEIGHT" -ge 256 ] && [ "$ARG_HEIGHT" -le 2048 ] || fail "height" "Height must be 256-2048."
[ "$ARG_STEPS" -ge 1 ] && [ "$ARG_STEPS" -le 8 ] || fail "steps" "Steps must be 1-8."

if [ "$ARG_SAVE_PROMPTS" = "true" ]; then
  export SDCPP_REDACT_PROMPTS=0
else
  export SDCPP_REDACT_PROMPTS=1
fi

RUN_DIR="$(make_run_dir controlled-$ARG_TARGET)"
SDCPP_LOGFILE="$RUN_DIR/mflux-controlled-generate.log"
export SDCPP_LOGFILE

MANIFEST="$RUN_DIR/controlled-manifest.json"
REPORT="$RUN_DIR/controlled-generate-report.md"
RUN_ID="$(basename "$RUN_DIR")"
REMOTE_ROOT="/Volumes/wc2tb/dex-imagegen"
REMOTE_VENV="$REMOTE_ROOT/mflux-venv"
REMOTE_MFLUX="$REMOTE_VENV/bin/mflux-generate-flux2"
# Proven configuration (2026-09-25): 4-bit MFLUX checkpoint
# mlx-community/flux2-klein-4b-4bit staged on Big Mac INTERNAL storage.
# The full-precision model read from wc2tb hit Metal GPU watchdog timeouts.
REMOTE_MODEL_DIR='$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit'
REMOTE_CACHE="$REMOTE_ROOT/cache"
REMOTE_STDOUT_LOG="$RUN_DIR/remote-command.log"
CREATED_AT="$(iso_now)"
START_EPOCH="$(date +%s)"

# Image bytes only ever land in the canonical root: streamed into an
# .incoming file there, validated, then linked to a never-overwritten name.
mkdir -p "$DEX_IMAGES_ROOT"
INCOMING="$DEX_IMAGES_ROOT/.incoming-$RUN_ID.png"
RAW_STDERR="$(mktemp "${TMPDIR:-/tmp}/dexdiffusion-mflux-stderr.XXXXXXXX")"
trap 'rm -f -- "$INCOMING" "$RAW_STDERR"' EXIT

verify_route >/dev/null
remote_test "test -x \"$REMOTE_MFLUX\"" || fail "mflux-runtime" "MFLUX runtime missing on Big Mac: $REMOTE_VENV"
remote_test "test -s $REMOTE_MODEL_DIR/transformer/model.safetensors.index.json && test -s $REMOTE_MODEL_DIR/text_encoder/model.safetensors.index.json && test -s $REMOTE_MODEL_DIR/vae/model.safetensors.index.json" \
  || fail "mflux-model" "4-bit FLUX.2 Klein model missing on Big Mac: $REMOTE_MODEL_DIR"

SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
if [ "$SEED_CONTROLLED" != "yes" ]; then
  SEED_VALUE="$(date +%s)"
  SEED_LABEL="$SEED_VALUE"
fi

PROMPT_B64="$(python3 -c 'import base64,sys; print(base64.b64encode(sys.argv[1].encode("utf-8")).decode("ascii"))' "$ARG_PROMPT")"

# Remote side: PNG is generated into a private mktemp dir that a trap removes on
# any exit (success, failure, SSH hangup). stdout carries only the PNG bytes;
# every log line goes to stderr.
REMOTE_SCRIPT='set -euo pipefail
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dexdiffusion-mflux.XXXXXXXX")"
trap '"'"'rm -rf -- "$tmp"'"'"' EXIT
trap "exit 129" HUP; trap "exit 130" INT; trap "exit 143" TERM
echo "MFLUX_REMOTE_TMP: $tmp" >&2
export HF_HOME="$6/huggingface" XDG_CACHE_HOME="$6/xdg" TOKENIZERS_PARALLELISM=false HF_HUB_OFFLINE=1
prompt="$(printf %s "$1" | base64 --decode)"
"$7" --model "$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit" --base-model flux2-klein-4b \
  --prompt "$prompt" --steps "$2" --seed "$3" --width "$4" --height "$5" --output "$tmp/out.png" >&2
if [ ! -s "$tmp/out.png" ] || ! file "$tmp/out.png" | grep -q "PNG image data"; then
  echo "MFLUX_REMOTE_FAIL: missing or invalid PNG" >&2; exit 3
fi
echo "MFLUX_REMOTE_PNG_SHA256: $(shasum -a 256 "$tmp/out.png" | cut -d" " -f1)" >&2
cat "$tmp/out.png"'

log "Running FLUX.2 Klein 4B through MFLUX on Big Mac (ephemeral remote image)."
set +e
ssh -o ConnectTimeout=15 "$SSH_TARGET" "bash -c $(printf '%q' "$REMOTE_SCRIPT") dexdiffusion-mflux $PROMPT_B64 $ARG_STEPS $SEED_VALUE $ARG_WIDTH $ARG_HEIGHT $(printf '%q' "$REMOTE_CACHE") $(printf '%q' "$REMOTE_MFLUX")" \
  > "$INCOMING" 2> "$RAW_STDERR"
SSH_RC=$?
set -e
python3 -c '
import sys
prompt, redact = sys.argv[1], sys.argv[2] == "1"
for line in sys.stdin.buffer.read().decode("utf-8", "replace").replace("\r", "\n").splitlines(True):
    sys.stdout.write(line.replace(prompt, "[REDACTED]") if redact and prompt else line)
' "$ARG_PROMPT" "${SDCPP_REDACT_PROMPTS:-0}" < "$RAW_STDERR" > "$REMOTE_STDOUT_LOG" || true
rm -f -- "$RAW_STDERR"

REMOTE_TMP="$(sed -n 's/^MFLUX_REMOTE_TMP: //p' "$REMOTE_STDOUT_LOG" | head -1)"
REMOTE_SHA="$(sed -n 's/^MFLUX_REMOTE_PNG_SHA256: //p' "$REMOTE_STDOUT_LOG" | head -1)"
if [ -n "$REMOTE_TMP" ]; then
  case "$REMOTE_TMP" in
    */dexdiffusion-mflux.*) ;;
    *) fail "remote-ephemeral" "Unexpected remote temp path: $REMOTE_TMP" ;;
  esac
  # Defensive second cleanup (the remote trap normally already removed it), then prove it is gone.
  ssh_remote "rm -rf -- $(printf '%q' "$REMOTE_TMP")" >/dev/null 2>&1 || true
  remote_test "test ! -e $(printf '%q' "$REMOTE_TMP")" \
    || fail "remote-ephemeral" "Big Mac temporary image still present: $REMOTE_TMP"
fi
[ "$SSH_RC" -eq 0 ] || fail "mflux-remote" "Remote MFLUX generation failed (exit $SSH_RC); see $REMOTE_STDOUT_LOG"
[ -n "$REMOTE_SHA" ] || fail "remote-png" "Remote PNG was not validated on Big Mac."
LOCAL_SHA="$(shasum -a 256 "$INCOMING" | cut -d' ' -f1)"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || fail "transfer" "Streamed PNG checksum mismatch (remote $REMOTE_SHA, local $LOCAL_SHA)."

if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  strip_png_metadata "$INCOMING" || fail "png-redact" "Could not strip PNG metadata."
fi
verify_png "$INCOMING" "MFLUX FLUX.2 Klein PNG"

IMAGE_BASE="$RUN_ID-s$SEED_VALUE-controlled-$ARG_TARGET"
LOCAL_PNG=""
for n in 1 2 3 4 5 6 7 8 9; do
  candidate="$DEX_IMAGES_ROOT/$IMAGE_BASE$([ "$n" = 1 ] || printf -- '-%s' "$n").png"
  if ln "$INCOMING" "$candidate" 2>/dev/null; then LOCAL_PNG="$candidate"; break; fi
done
[ -n "$LOCAL_PNG" ] || fail "canonical-name" "No free canonical filename for $IMAGE_BASE"
rm -f -- "$INCOMING"
IMAGE_ID="$(basename "$LOCAL_PNG")"
IMAGE_URL="/api/images/$IMAGE_ID"

python3 - "$RUN_DIR" "$DEX_IMAGES_ROOT" "controlled-$ARG_TARGET.png" "$IMAGE_ID" "$LOCAL_PNG" "$IMAGE_URL" <<'PYINDEX'
import json, os, sys
run_dir, root, run_file, image_id, image_path, image_url = sys.argv[1:]
with open(os.path.join(run_dir, "canonical-images.json"), "w", encoding="utf-8") as f:
    json.dump({"schema": "dexdiffusion.canonical_images.v1", "root": root,
               "images": [{"run_file": run_file, "image_id": image_id,
                           "image_path": image_path, "image_url": image_url}]}, f, indent=2)
    f.write("\n")
PYINDEX
REMOTE_PNG="ephemeral:$REMOTE_TMP (deleted, verified absent)"

FINISHED_AT="$(iso_now)"
END_EPOCH="$(date +%s)"
ELAPSED="$((END_EPOCH - START_EPOCH))"
PNG_BYTES="$(wc -c < "$LOCAL_PNG" | tr -d '[:space:]')"
REPORT_PROMPT="$ARG_PROMPT"
[ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ] && REPORT_PROMPT="[REDACTED]"

python3 - "$MANIFEST" "$RUN_DIR" "$CREATED_AT" "$FINISHED_AT" "$ELAPSED" \
  "$LOCAL_PNG" "$REMOTE_PNG" "$PNG_BYTES" "$ARG_WIDTH" "$ARG_HEIGHT" \
  "$ARG_STEPS" "$SEED_LABEL" "$REPORT_PROMPT" <<'PY'
import json, sys
(manifest, run_dir, created, finished, elapsed, local_png, remote_png, png_bytes,
 width, height, steps, seed, prompt) = sys.argv[1:]
obj = {
    "schema": "dexdiffusion.mflux.controlled_generate.v1",
    "run_id": run_dir.rsplit("/", 1)[-1],
    "status": "PASS",
    "created_at": created,
    "finished_at": finished,
    "wall_elapsed_seconds": int(elapsed),
    "first_failed_gate": None,
    "controlledTarget": "flux2-klein-4b",
    "controlledTargetLabel": "FLUX.2 Klein 4B (MFLUX)",
    "controlledTargetMode": "MLX-native remote generation",
    "controlledTargetStatus": "proofed",
    "controlledTargetCaveat": "MFLUX/MLX path; not A1111 parity. FLUX.2 distilled mode uses guidance 1.0 and no negative prompt.",
    "proofDerived": True,
    "fullParityClaim": False,
    "controlledOutputImage": local_png,
    "controlledManifest": manifest,
    "backend": "mflux",
    "model": "mlx-community/flux2-klein-4b-4bit",
    "base_model": "flux2-klein-4b",
    "width": int(width),
    "height": int(height),
    "steps": int(steps),
    "guidance": 1.0,
    "seed_label": seed,
    "prompt": prompt,
    "negative_prompt": None,
    "remote_png": remote_png,
    "local_png": local_png,
    "image_id": local_png.rsplit("/", 1)[-1],
    "image_path": local_png,
    "image_url": "/api/images/" + local_png.rsplit("/", 1)[-1],
    "png_bytes": int(png_bytes),
    "png_valid": True,
    "runtime_controlled_proven": True
}
with open(manifest, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")
PY

cat > "$REPORT" <<'REPORT_HEAD'
# Controlled Generation Report
REPORT_HEAD
cat >> "$REPORT" <<REPORT_BODY

run_id: $(basename "$RUN_DIR")
created_at: $CREATED_AT
finished_at: $FINISHED_AT

## Target

- target: flux2-klein-4b
- label: FLUX.2 Klein 4B (MFLUX)
- backend: MFLUX / MLX
- remote host: $SSH_TARGET
- model: mlx-community/flux2-klein-4b-4bit (base flux2-klein-4b, Big Mac internal storage)
- size: ${ARG_WIDTH}x${ARG_HEIGHT}
- steps: $ARG_STEPS
- guidance: 1.0
- seed: $SEED_LABEL
- prompt: $REPORT_PROMPT

## Result

- canonical image: $LOCAL_PNG
- image URL: $IMAGE_URL
- remote PNG: $REMOTE_PNG
- PNG bytes: $PNG_BYTES
- elapsed seconds: $ELAPSED
- status: PASS
REPORT_BODY

write_ui_run_card \
  "$RUN_DIR" \
  "controlled-flux2-klein-4b" \
  "PASS" \
  "$(basename "$LOCAL_PNG")" \
  "controlled-manifest.json" \
  "$REPORT_PROMPT" \
  "target=flux2-klein-4b backend=mflux size=${ARG_WIDTH}x${ARG_HEIGHT} steps=$ARG_STEPS guidance=1.0 seed=$SEED_LABEL" \
  "$CREATED_AT" \
  >/dev/null

printf 'CONTROLLED_TARGET: flux2-klein-4b\n'
printf 'CONTROLLED_OUTPUT_IMAGE: %s\n' "$LOCAL_PNG"
printf 'CONTROLLED_MANIFEST: %s\n' "$MANIFEST"
printf 'TARGET_CAVEAT: MFLUX/MLX path; not A1111 parity. No negative prompt.\n'

pass_banner "CONTROLLED GENERATE PASS (flux2-klein-4b via MFLUX, seed=$SEED_LABEL).
Run: $RUN_DIR
PNG: $LOCAL_PNG
Manifest: $MANIFEST"
