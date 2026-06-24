#!/usr/bin/env bash
# sdcpp-img2img.sh — img2img via sd-cli on BigMac.
# Conditions generation on an existing image via --init-img + --strength.
# Init image must be an existing PNG within the local runs directory.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

# ----- args ------------------------------------------------------------------
ARG_INIT_IMG=""
ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
ARG_STRENGTH="0.75"
ARG_SEED=""
ARG_OUT_NAME=""
ARG_SCHEDULER="discrete"
ARG_VAE=""
EX_STEPS=""; EX_W=""; EX_H=""; EX_CFG=""; EX_SAMPLER=""; EX_SCHEDULER=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --init-img PATH      path to init image (must be within sdcpp-workflow/runs/)
  --strength N         denoising strength 0.01-0.99 (default: 0.75)
  --prompt "..."       positive prompt (default from config)
  --negative "..."     negative prompt (default from config)
  --steps N
  --width N
  --height N
  --cfg N
  --sampler NAME
  --scheduler NAME
  --vae PATH
  --seed N|random|fixed
  --out-name NAME      base name for output PNG (no extension)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --init-img) ARG_INIT_IMG="${2:?}"; shift 2 ;;
    --strength) ARG_STRENGTH="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --steps) EX_STEPS="${2:?}"; shift 2 ;;
    --width) EX_W="${2:?}"; shift 2 ;;
    --height) EX_H="${2:?}"; shift 2 ;;
    --cfg|--cfg-scale) EX_CFG="${2:?}"; shift 2 ;;
    --sampler) EX_SAMPLER="${2:?}"; shift 2 ;;
    --scheduler) EX_SCHEDULER="${2:?}"; shift 2 ;;
    --vae) ARG_VAE="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --out-name) ARG_OUT_NAME="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

[ -z "$ARG_INIT_IMG" ] && fail "args" "--init-img is required"

# ----- validate init image path ---------------------------------------------
# Must be an absolute path within SDCPP_RUNS_DIR (no arbitrary filesystem paths).
INIT_IMG_ABS="$(cd "$(dirname "$ARG_INIT_IMG")" 2>/dev/null && pwd)/$(basename "$ARG_INIT_IMG")" \
  || fail "init-img" "Cannot resolve init image path: $ARG_INIT_IMG"
case "$INIT_IMG_ABS" in
  "$SDCPP_RUNS_DIR/"*) ;;
  *) fail "init-img" "Init image must be within $SDCPP_RUNS_DIR (got: $INIT_IMG_ABS)" ;;
esac
[ -f "$INIT_IMG_ABS" ] || fail "init-img" "Init image file not found: $INIT_IMG_ABS"

# ----- validate strength ---------------------------------------------------
python3 -c "
import sys
try:
    s = float(sys.argv[1])
except ValueError:
    print('not-a-number', end=''); sys.exit(0)
if s < 0.01 or s > 0.99:
    print('out-of-range', end=''); sys.exit(0)
print('ok', end='')
" "$ARG_STRENGTH" | grep -q '^ok$' \
  || fail "args" "--strength must be a number between 0.01 and 0.99 (got: $ARG_STRENGTH)"

# ----- apply defaults -------------------------------------------------------
ARG_STEPS="$STEPS"; ARG_W="$WIDTH"; ARG_H="$HEIGHT"; ARG_CFG="$CFG_SCALE"; ARG_SAMPLER="$SAMPLER"
[ -n "$EX_STEPS" ] && ARG_STEPS="$EX_STEPS"
[ -n "$EX_W" ] && ARG_W="$EX_W"
[ -n "$EX_H" ] && ARG_H="$EX_H"
[ -n "$EX_CFG" ] && ARG_CFG="$EX_CFG"
[ -n "$EX_SAMPLER" ] && ARG_SAMPLER="$EX_SAMPLER"
[ -n "$EX_SCHEDULER" ] && ARG_SCHEDULER="$EX_SCHEDULER"

RUN_DIR="$(make_run_dir img2img)"
SDCPP_LOGFILE="$RUN_DIR/img2img.log"; export SDCPP_LOGFILE
NAME="${ARG_OUT_NAME:-img2img_$(timestamp)}"
LOCAL_PNG="$RUN_DIR/$NAME.png"
REPORT="$RUN_DIR/img2img-run-report.md"
CREATED_AT="$(iso_now)"

REPORT_PROMPT="$ARG_PROMPT"
REPORT_NEGATIVE_PROMPT="$ARG_NEG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  REPORT_PROMPT="[REDACTED]"
  REPORT_NEGATIVE_PROMPT="[REDACTED]"
fi

log "=== Pre-flight verification ==="
verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
verify_model >/dev/null
ensure_remote_dirs

REMOTE_INIT_IMG="$REMOTE_OUTPUT_DIR/${NAME}-init.png"
REMOTE_PNG="$REMOTE_OUTPUT_DIR/$NAME.png"
REMOTE_LOG="$REMOTE_LOG_DIR/$NAME.log"

# Resolve seed
SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
SEED_FRAG=""
[ "$SEED_CONTROLLED" = "yes" ] && SEED_FRAG="--seed $SEED_VALUE"

# ----- metadata --------------------------------------------------------------
cat > "$RUN_DIR/run-metadata.json" <<EOF
{
  "kind": "img2img",
  "timestamp": "$(date)",
  "prompt": $(printf '%s' "$REPORT_PROMPT" | jq -Rs .),
  "negative_prompt": $(printf '%s' "$REPORT_NEGATIVE_PROMPT" | jq -Rs .),
  "init_image": $(printf '%s' "$INIT_IMG_ABS" | jq -Rs .),
  "strength": $ARG_STRENGTH,
  "width": $ARG_W,
  "height": $ARG_H,
  "steps": $ARG_STEPS,
  "cfg_scale": $ARG_CFG,
  "sampler": "$ARG_SAMPLER",
  "scheduler": "$ARG_SCHEDULER",
  "vae": "$ARG_VAE",
  "seed": "$SEED_VALUE",
  "seed_label": "$SEED_LABEL",
  "build_dir": "$BUILD_DIR",
  "remote_init_img": "$REMOTE_INIT_IMG",
  "remote_png": "$REMOTE_PNG",
  "local_png": "$LOCAL_PNG"
}
EOF

{
  echo "# SDCPP img2img Run Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- Init image: $INIT_IMG_ABS"
  echo "- Strength: $ARG_STRENGTH"
  echo "- Prompt: $REPORT_PROMPT"
  echo "- Negative: $REPORT_NEGATIVE_PROMPT"
  echo "- Size: ${ARG_W}x${ARG_H}, steps=$ARG_STEPS, cfg=$ARG_CFG, sampler=$ARG_SAMPLER, scheduler=$ARG_SCHEDULER, vae=$ARG_VAE, seed=$SEED_LABEL"
  echo "- Build dir: $BUILD_DIR"
  echo "- Remote init: $REMOTE_INIT_IMG"
  echo "- Remote PNG: $REMOTE_PNG"
  echo "- Local PNG: $LOCAL_PNG"
  echo
} > "$REPORT"

# ----- upload init image to BigMac ------------------------------------------
log "=== Uploading init image to BigMac ==="
REMOTE_INIT_IMG_ABS="$(remote_eval_path "$REMOTE_INIT_IMG")"
scp "$INIT_IMG_ABS" "$SSH_TARGET:$REMOTE_INIT_IMG_ABS" >/dev/null \
  || fail "scp-init-img" "scp failed uploading init image to BigMac: $INIT_IMG_ABS -> $REMOTE_INIT_IMG_ABS"
log "Init image uploaded: $REMOTE_INIT_IMG_ABS"

# ----- generate (remote) ----------------------------------------------------
log "=== Generating img2img on BigMac (strength=$ARG_STRENGTH) ==="
Q_PROMPT="$(printf '%q' "$ARG_PROMPT")"
Q_NEG="$(printf '%q' "$ARG_NEG")"

SCHEDULER_FRAG=""
[ -n "$ARG_SCHEDULER" ] && SCHEDULER_FRAG="--scheduler $ARG_SCHEDULER"
VAE_FRAG=""
[ -n "$ARG_VAE" ] && [ "$ARG_VAE" != "none" ] && VAE_FRAG="--vae $ARG_VAE"

START_EPOCH="$(now_epoch)"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  ssh_remote "cd \"$REMOTE_REPO\" && \"$BUILD_DIR/bin/sd-cli\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -i \"$REMOTE_INIT_IMG\" --strength $ARG_STRENGTH -W $ARG_W -H $ARG_H --steps $ARG_STEPS --cfg-scale $ARG_CFG --sampling-method $ARG_SAMPLER $SEED_FRAG ${SCHEDULER_FRAG:-} ${VAE_FRAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\"" 2>&1 | python3 -c "
import sys, re
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
p_stripped = re.sub(r'<lora:[^>]*>', '', p).rstrip()
tok_re = re.compile(r'(to tokens\s*)\[.*\]')
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if p_stripped and p_stripped != p and p_stripped in line: line = line.replace(p_stripped, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    if 'to tokens' in line or 'bpe_tokenizer' in line:
        line = tok_re.sub(r'\1[REDACTED]', line)
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$RUN_DIR/remote-stdout.log" || true
else
  ssh_remote "cd \"$REMOTE_REPO\" && \"$BUILD_DIR/bin/sd-cli\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -i \"$REMOTE_INIT_IMG\" --strength $ARG_STRENGTH -W $ARG_W -H $ARG_H --steps $ARG_STEPS --cfg-scale $ARG_CFG --sampling-method $ARG_SAMPLER $SEED_FRAG ${SCHEDULER_FRAG:-} ${VAE_FRAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\"" > "$RUN_DIR/remote-stdout.log" 2>&1 || true
fi
END_EPOCH="$(now_epoch)"
ELAPSED="$(elapsed_seconds "$START_EPOCH" "$END_EPOCH")"
REMOTE_ELAPSED="$(grep -hoE 'generate_image completed in [0-9.]+s' "$RUN_DIR/remote-stdout.log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)"
[ -z "$REMOTE_ELAPSED" ] && REMOTE_ELAPSED="n/a"

# ----- verify remote PNG ----------------------------------------------------
log "=== Verifying remote PNG ==="
if ! remote_test "test -s \"$REMOTE_PNG\" && file \"$REMOTE_PNG\" | grep -q 'PNG image data'"; then
  tail -40 "$RUN_DIR/remote-stdout.log" >&2 || true
  record_run_report "$REPORT" "- RESULT: FAIL (no valid remote PNG; see remote-stdout.log)"
  fail "img2img-remote-png" "Remote PNG missing or invalid: $REMOTE_PNG"
fi
REMOTE_FILE_OUT="$(ssh_remote "file \"$REMOTE_PNG\"")"
REMOTE_LS_OUT="$(ssh_remote "ls -lh \"$REMOTE_PNG\"")"

# ----- copy to MacBook -------------------------------------------------------
log "=== Copying PNG to MacBook ==="
REMOTE_PNG_ABS="$(remote_eval_path "$REMOTE_PNG")"
scp "$SSH_TARGET:$REMOTE_PNG_ABS" "$LOCAL_PNG" >/dev/null \
  || fail "img2img-scp" "scp failed: $REMOTE_PNG_ABS -> $LOCAL_PNG"

# ----- verify locally + strip metadata when save_prompts=false ---------------
verify_png "$LOCAL_PNG" "img2img PNG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  strip_png_metadata "$LOCAL_PNG" \
    || log "Warning: strip_png_metadata failed (non-fatal); PNG may retain text chunks."
  log "PNG metadata stripped (save_prompts=false)."
fi
LOCAL_SUM="$(local_sha256 "$LOCAL_PNG")"
REMOTE_SUM="$(remote_sha256 "$REMOTE_PNG_ABS")"

{
  echo "## Remote verification"
  echo '```'
  echo "$REMOTE_FILE_OUT"
  echo "$REMOTE_LS_OUT"
  echo '```'
  echo
  echo "## Local verification"
  echo '```'
  file "$LOCAL_PNG"
  ls -lh "$LOCAL_PNG"
  echo '```'
  echo
  echo "## Checksums (sha256)"
  echo "- local:  $LOCAL_SUM"
  echo "- remote: $REMOTE_SUM"
  if [ -n "$LOCAL_SUM" ] && [ "$LOCAL_SUM" = "$REMOTE_SUM" ]; then
    echo "- match: YES"
  elif printf '%s' "$REMOTE_SUM" | grep -q '^md5:'; then
    echo "- match: n/a (remote used md5 fallback)"
  else
    echo "- match: NO (investigate)"
  fi
  echo
  echo "## Timing"
  echo "- elapsed_seconds (wall): $ELAPSED"
  echo "- remote_elapsed_seconds: $REMOTE_ELAPSED"
  echo
  echo "## Result"
  echo "- IMG2IMG GENERATE: PASS"
} >> "$REPORT"

# ----- machine-readable metrics ---------------------------------------------
PNG_BYTES="$(png_bytes "$LOCAL_PNG")"
{
  metrics_header
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$(sanitize_tsv "$REMOTE_HOST_EXPECTED")" "$SSH_TARGET" "7f0e728" \
    "$(sanitize_tsv "$BUILD_DIR")" "$(sanitize_tsv "$REMOTE_MODEL")" "img2img" "custom" \
    "$(sanitize_tsv "$REPORT_PROMPT")" "$(sanitize_tsv "$REPORT_NEGATIVE_PROMPT")" "$ARG_W" "$ARG_H" "$ARG_STEPS" "$ARG_CFG" "$ARG_SAMPLER" \
    "$SEED_VALUE" "$START_EPOCH" "$END_EPOCH" "$ELAPSED" "$REMOTE_ELAPSED" "n/a" \
    "$(sanitize_tsv "$LOCAL_PNG")" "$PNG_BYTES" "$LOCAL_SUM" "cold" "n/a" "n/a" "img2img-local" "PASS"
} > "$RUN_DIR/metrics.tsv"

# ----- UI run card ----------------------------------------------------------
PRIMARY_REL="$(basename "$LOCAL_PNG")"
write_ui_run_card "$RUN_DIR" "img2img" "PASS" "$PRIMARY_REL" "run-metadata.json" \
  "$REPORT_PROMPT" \
  "strength=$ARG_STRENGTH size=${ARG_W}x${ARG_H} steps=$ARG_STEPS cfg=$ARG_CFG sampler=$ARG_SAMPLER scheduler=$ARG_SCHEDULER seed=$SEED_LABEL elapsed=${ELAPSED}s" \
  "$CREATED_AT" >/dev/null

pass_banner "IMG2IMG PASS (strength=$ARG_STRENGTH, seed=$SEED_LABEL, ${ELAPSED}s wall / ${REMOTE_ELAPSED}s remote).
Local PNG: $LOCAL_PNG
Report:    $REPORT"
printf 'sha256 local=%s remote=%s\n' "$LOCAL_SUM" "$REMOTE_SUM"
exit 0
