#!/usr/bin/env bash
# sdcpp-hires-fix.sh — two-pass txt2img → local Pillow upscale.
# NOT full A1111 latent Hires Fix. No denoising second pass.
# Pass 1: sdcpp-cli-generate.sh (BigMac SSH) at draft size → base/base.png
# Pass 2: sdcpp-upscale.sh (local Pillow resize)
#
# Usage:
#   bin/sdcpp-hires-fix.sh --prompt "..." [options]
#
# Options:
#   --preset <name>          Generation preset (default: fast)
#   --prompt <text>          Required. Generation prompt.
#   --negative <text>        Negative prompt.
#   --steps <n>              Step count.
#   --width <px>             Image width.
#   --height <px>            Image height.
#   --cfg <n>                CFG scale.
#   --sampler <name>         Sampler name.
#   --seed <n>               Seed.
#   --scale <2|3|4>          Upscale factor (default: 2).
#   --resample <name>        Resample filter: lanczos|bicubic|bilinear|nearest (default: lanczos).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

# ---- defaults ---------------------------------------------------------------
PRESET="fast"
ARG_PROMPT=""
ARG_NEGATIVE=""
ARG_STEPS=""
ARG_WIDTH=""
ARG_HEIGHT=""
ARG_CFG=""
ARG_SAMPLER=""
ARG_SEED=""
SCALE=2
RESAMPLE="lanczos"

# ---- arg parse --------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --preset)            PRESET="${2:?}"; shift 2 ;;
    --prompt)            ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative)          ARG_NEGATIVE="$2"; shift 2 ;;
    --steps)             ARG_STEPS="${2:?}"; shift 2 ;;
    --width)             ARG_WIDTH="${2:?}"; shift 2 ;;
    --height)            ARG_HEIGHT="${2:?}"; shift 2 ;;
    --cfg|--cfg-scale)   ARG_CFG="${2:?}"; shift 2 ;;
    --sampler)           ARG_SAMPLER="${2:?}"; shift 2 ;;
    --seed)              ARG_SEED="${2:?}"; shift 2 ;;
    --scale)             SCALE="${2:?}"; shift 2 ;;
    --resample)          RESAMPLE="${2:?}"; shift 2 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done

# ---- validate ---------------------------------------------------------------
[ -n "$ARG_PROMPT" ] || fail "prompt" "--prompt is required"

case "$SCALE" in
  2|3|4) ;;
  *) fail "scale" "Scale must be 2, 3, or 4 (got: $SCALE)" ;;
esac

case "$RESAMPLE" in
  lanczos|bicubic|bilinear|nearest) ;;
  *) fail "resample" "Resample must be lanczos, bicubic, bilinear, or nearest (got: $RESAMPLE)" ;;
esac

# ---- create hires-fix run dir -----------------------------------------------
HIRES_TS="$(timestamp)"
HIRES_RUN_ID="${HIRES_TS}-hires-fix"
HIRES_DIR="$SDCPP_RUNS_DIR/$HIRES_RUN_ID"
BASE_DIR="$HIRES_DIR/base"
mkdir -p "$BASE_DIR"

CREATED_AT="$(iso_now)"

printf >&2 '==> Hires Fix run: %s\n' "$HIRES_RUN_ID"
printf >&2 '    Pass 1: txt2img (%s preset) → base/base.png\n' "$PRESET"

# ---- pass 1: txt2img --------------------------------------------------------
export SDCPP_RUN_DIR_OVERRIDE="$BASE_DIR"

set -- --preset "$PRESET" --out-name base
[ -n "$ARG_PROMPT" ]   && set -- "$@" --prompt    "$ARG_PROMPT"
[ -n "$ARG_NEGATIVE" ] && set -- "$@" --negative  "$ARG_NEGATIVE"
[ -n "$ARG_STEPS" ]    && set -- "$@" --steps     "$ARG_STEPS"
[ -n "$ARG_WIDTH" ]    && set -- "$@" --width     "$ARG_WIDTH"
[ -n "$ARG_HEIGHT" ]   && set -- "$@" --height    "$ARG_HEIGHT"
[ -n "$ARG_CFG" ]      && set -- "$@" --cfg-scale "$ARG_CFG"
[ -n "$ARG_SAMPLER" ]  && set -- "$@" --sampler   "$ARG_SAMPLER"
[ -n "$ARG_SEED" ]     && set -- "$@" --seed      "$ARG_SEED"

"$HERE/sdcpp-cli-generate.sh" "$@" || fail "base-generation" "txt2img pass failed"
unset SDCPP_RUN_DIR_OVERRIDE

# ---- verify base PNG exists -------------------------------------------------
BASE_PNG="$BASE_DIR/base.png"
[ -f "$BASE_PNG" ] || fail "base-png" "Expected base PNG not found: $BASE_PNG"

printf >&2 '    Pass 1 complete: %s\n' "$BASE_PNG"
printf >&2 '    Pass 2: Pillow upscale %sx (%s)\n' "$SCALE" "$RESAMPLE"

# ---- pass 2: pillow upscale -------------------------------------------------
BASE_IMAGE_REL="base/base.png"

UPSCALE_OUT="$( "$HERE/sdcpp-upscale.sh" \
  --run-id   "$HIRES_RUN_ID" \
  --image    "$BASE_IMAGE_REL" \
  --scale    "$SCALE" \
  --resample "$RESAMPLE" \
  --overwrite 2>&1 )" || fail "upscale" "Pillow upscale pass failed"

# ---- parse upscale output ---------------------------------------------------
# sdcpp-upscale.sh prints: UPSCALED_IMAGE: <run-id>/upscaled/<name>
UPSCALED_ABS_REL="$(printf '%s\n' "$UPSCALE_OUT" | grep '^UPSCALED_IMAGE:' | sed 's/^UPSCALED_IMAGE:[[:space:]]*//')"
SOURCE_SIZE="$(printf '%s\n' "$UPSCALE_OUT" | grep '^SOURCE_SIZE:' | sed 's/^SOURCE_SIZE:[[:space:]]*//')"
OUTPUT_SIZE="$(printf '%s\n' "$UPSCALE_OUT" | grep '^OUTPUT_SIZE:' | sed 's/^OUTPUT_SIZE:[[:space:]]*//')"

[ -n "$UPSCALED_ABS_REL" ] || fail "upscale-parse" "Could not parse UPSCALED_IMAGE from upscale output"
[ -n "$SOURCE_SIZE" ]       || fail "upscale-parse" "Could not parse SOURCE_SIZE from upscale output"
[ -n "$OUTPUT_SIZE" ]       || fail "upscale-parse" "Could not parse OUTPUT_SIZE from upscale output"

# UPSCALED_ABS_REL = "<run-id>/upscaled/<name>" (relative to SDCPP_RUNS_DIR)
# Strip the run-id prefix to get path relative to HIRES_DIR:
FINAL_IMAGE_REL="${UPSCALED_ABS_REL#$HIRES_RUN_ID/}"
# e.g., "upscaled/base-upscale-2x-lanczos.png"

FINAL_IMAGE_FULL="$HIRES_DIR/$FINAL_IMAGE_REL"
[ -f "$FINAL_IMAGE_FULL" ] || fail "upscale-file" "Upscaled file not found: $FINAL_IMAGE_FULL"

printf >&2 '    Pass 2 complete: %s\n' "$FINAL_IMAGE_FULL"

# ---- write hires-fix-manifest.json (argv-based, no shell interpolation) -----
MANIFEST_REL="hires-fix-manifest.json"
MANIFEST_FULL="$HIRES_DIR/$MANIFEST_REL"

python3 - \
  "$HIRES_RUN_ID" \
  "base/base.png" \
  "$FINAL_IMAGE_REL" \
  "$SCALE" \
  "$RESAMPLE" \
  "$SOURCE_SIZE" \
  "$OUTPUT_SIZE" \
  "$CREATED_AT" \
  "$MANIFEST_FULL" \
  <<'PYMANIFEST'
import sys, json
(run_id, base_img, final_img,
 scale, resample, src_sz, out_sz,
 created, out_path) = sys.argv[1:]
obj = {
    "run_id": run_id,
    "base_image": base_img,
    "final_image": final_img,
    "scale": int(scale),
    "resample": resample,
    "source_size": src_sz,
    "output_size": out_sz,
    "created_at": created,
    "workflow": "txt2img_pillow_upscale",
    "note": "NOT full A1111 latent Hires Fix — no denoising second pass"
}
with open(out_path, 'w') as f:
    json.dump(obj, f, indent=2)
PYMANIFEST

# ---- write hires-fix-report.md ----------------------------------------------
REPORT_PROMPT="$ARG_PROMPT"
[ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ] && REPORT_PROMPT="[REDACTED]"

{
  printf '# Hires Fix Report\n\n'
  printf 'run_id: %s\n' "$HIRES_RUN_ID"
  printf 'created_at: %s\n\n' "$CREATED_AT"
  printf '## Passes\n\n'
  printf '| Pass | Description | Output |\n'
  printf '|------|-------------|--------|\n'
  printf '| 1 | txt2img (%s preset) | base/base.png |\n' "$PRESET"
  printf '| 2 | Pillow upscale %sx %s | %s |\n' "$SCALE" "$RESAMPLE" "$FINAL_IMAGE_REL"
  printf '\n## Sizes\n\n'
  printf '%s\n' "- Source: $SOURCE_SIZE" "- Output: $OUTPUT_SIZE"
  printf '\n'
  printf '## Prompt\n\n%s\n\n' "$REPORT_PROMPT"
  printf '## Note\n\nThis is NOT a full A1111 latent Hires Fix. There is no denoising second pass.\n'
  printf 'The upscale is a local Pillow resize only.\n'
} > "$HIRES_DIR/hires-fix-report.md"

# ---- write ui-run-card.md ---------------------------------------------------
SETTINGS_LINE="preset=$PRESET scale=${SCALE}x resample=$RESAMPLE src=$SOURCE_SIZE out=$OUTPUT_SIZE"

write_ui_run_card \
  "$HIRES_DIR" \
  "hires-fix" \
  "PASS" \
  "$FINAL_IMAGE_REL" \
  "$MANIFEST_REL" \
  "$ARG_PROMPT" \
  "$SETTINGS_LINE" \
  "$CREATED_AT"

# ---- parseable output -------------------------------------------------------
printf 'HIRES_RUN_ID: %s\n' "$HIRES_RUN_ID"
printf 'HIRES_BASE_IMAGE: %s/base/base.png\n' "$HIRES_RUN_ID"
printf 'HIRES_FINAL_IMAGE: %s\n' "$UPSCALED_ABS_REL"
printf 'HIRES_MANIFEST: %s/%s\n' "$HIRES_RUN_ID" "$MANIFEST_REL"
printf 'SOURCE_SIZE: %s\n' "$SOURCE_SIZE"
printf 'OUTPUT_SIZE: %s\n' "$OUTPUT_SIZE"

pass_banner "Hires Fix complete: $HIRES_RUN_ID | ${SOURCE_SIZE} → ${OUTPUT_SIZE}"
