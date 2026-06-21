#!/usr/bin/env bash
# sdcpp-cli-generate.sh — generate ONE image via sd-cli on BigMac, copy + verify.
# Never uses --backend metal (Metal auto-selects as MTL0). Uses --diffusion-fa.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

# ----- args ------------------------------------------------------------------
# Resolution order: config defaults  ->  --preset values  ->  explicit flags.
ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
ARG_SEED=""           # empty -> let sd-cli use its default (42)
ARG_OUT_NAME=""       # empty -> auto timestamp name
ARG_PRESET=""
# explicit overrides start empty; only set when the user passes the flag
EX_STEPS=""; EX_W=""; EX_H=""; EX_CFG=""; EX_SAMPLER=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --preset NAME      smoke|thumbnail|fast|balanced|quality|quality_plus
  --prompt "..."     positive prompt (default from config)
  --negative "..."   negative prompt (default from config)
  --steps N          sample steps (overrides preset/config)
  --width N          width  (overrides preset/config)
  --height N         height (overrides preset/config)
  --cfg N            cfg scale (overrides preset/config)
  --sampler NAME     sampler (overrides preset/config)
  --seed N|random|fixed   N=integer, random=recorded random int, fixed=42 (default: not forced -> 42)
  --out-name NAME    base name for the PNG (no extension)
  -h, --help         show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preset) ARG_PRESET="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --steps) EX_STEPS="${2:?}"; shift 2 ;;
    --width) EX_W="${2:?}"; shift 2 ;;
    --height) EX_H="${2:?}"; shift 2 ;;
    --cfg|--cfg-scale) EX_CFG="${2:?}"; shift 2 ;;
    --sampler) EX_SAMPLER="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --out-name) ARG_OUT_NAME="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

# start from config defaults
ARG_STEPS="$STEPS"; ARG_W="$WIDTH"; ARG_H="$HEIGHT"; ARG_CFG="$CFG_SCALE"; ARG_SAMPLER="$SAMPLER"
PRESET_LABEL="config"
# apply preset if requested
if [ -n "$ARG_PRESET" ]; then
  apply_preset "$ARG_PRESET"
  ARG_STEPS="$PRESET_STEPS"; ARG_W="$PRESET_W"; ARG_H="$PRESET_H"; ARG_CFG="$PRESET_CFG"; ARG_SAMPLER="$PRESET_SAMPLER"
  PRESET_LABEL="$PRESET_NAME"
fi
# explicit flags win
[ -n "$EX_STEPS" ] && ARG_STEPS="$EX_STEPS"
[ -n "$EX_W" ] && ARG_W="$EX_W"
[ -n "$EX_H" ] && ARG_H="$EX_H"
[ -n "$EX_CFG" ] && ARG_CFG="$EX_CFG"
[ -n "$EX_SAMPLER" ] && ARG_SAMPLER="$EX_SAMPLER"

RUN_DIR="$(make_run_dir cli)"
SDCPP_LOGFILE="$RUN_DIR/cli.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/cli-run-report.md"
NAME="${ARG_OUT_NAME:-sd15_cli_$(timestamp)}"
LOCAL_PNG="$RUN_DIR/$NAME.png"

log "=== Pre-flight verification ==="
verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
verify_model >/dev/null
ensure_remote_dirs

REMOTE_PNG="$REMOTE_OUTPUT_DIR/$NAME.png"
REMOTE_LOG="$REMOTE_LOG_DIR/$NAME.log"

# Resolve seed (N|random|fixed|omitted). Only pass --seed when controlled.
SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
SEED_FRAG=""
[ "$SEED_CONTROLLED" = "yes" ] && SEED_FRAG="--seed $SEED_VALUE"
CREATED_AT="$(iso_now)"

# ----- metadata --------------------------------------------------------------
cat > "$RUN_DIR/run-metadata.json" <<EOF
{
  "kind": "cli",
  "timestamp": "$(date)",
  "prompt": $(printf '%s' "$ARG_PROMPT" | jq -Rs .),
  "negative_prompt": $(printf '%s' "$ARG_NEG" | jq -Rs .),
  "preset": "$PRESET_LABEL",
  "width": $ARG_W,
  "height": $ARG_H,
  "steps": $ARG_STEPS,
  "cfg_scale": $ARG_CFG,
  "sampler": "$ARG_SAMPLER",
  "seed": "$SEED_VALUE",
  "seed_label": "$SEED_LABEL",
  "seed_controlled": "$SEED_CONTROLLED",
  "build_dir": "$BUILD_DIR",
  "remote_png": "$REMOTE_PNG",
  "local_png": "$LOCAL_PNG"
}
EOF

{
  echo "# SDCPP CLI Run Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- Preset: $PRESET_LABEL"
  echo "- Prompt: $ARG_PROMPT"
  echo "- Negative: $ARG_NEG"
  echo "- Size: ${ARG_W}x${ARG_H}, steps=$ARG_STEPS, cfg=$ARG_CFG, sampler=$ARG_SAMPLER, seed=$SEED_LABEL"
  echo "- Build dir: $BUILD_DIR"
  echo "- Remote PNG: $REMOTE_PNG"
  echo "- Local PNG: $LOCAL_PNG"
  echo
} > "$REPORT"

# ----- generate (remote) -----------------------------------------------------
log "=== Generating on BigMac (Metal auto-select, no --backend) ==="
# Single double-quoted remote command: local $-vars expand here, but the literal
# $HOME inside REMOTE_* values expands on BigMac. Prompts are escaped via printf %q.
Q_PROMPT="$(printf '%q' "$ARG_PROMPT")"
Q_NEG="$(printf '%q' "$ARG_NEG")"

# NOTE: this host's ssh masks remote command exit codes, so we do NOT trust the
# exit status of the generation; we judge success by the remote PNG it produces
# (and ultimately by the verified copy on the MacBook).
START_EPOCH="$(now_epoch)"
ssh_remote "cd \"$REMOTE_REPO\" && \"$BUILD_DIR/bin/sd-cli\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -W $ARG_W -H $ARG_H --steps $ARG_STEPS --cfg-scale $ARG_CFG --sampling-method $ARG_SAMPLER $SEED_FRAG --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\"" > "$RUN_DIR/remote-stdout.log" 2>&1 || true
END_EPOCH="$(now_epoch)"
ELAPSED="$(elapsed_seconds "$START_EPOCH" "$END_EPOCH")"
REMOTE_ELAPSED="$(grep -hoE 'generate_image completed in [0-9.]+s' "$RUN_DIR/remote-stdout.log" 2>/dev/null | tail -1 | grep -oE '[0-9.]+' || true)"
[ -z "$REMOTE_ELAPSED" ] && REMOTE_ELAPSED="n/a"

# ----- verify on BigMac (output-sentinel; not exit code) ---------------------
log "=== Verifying remote PNG ==="
if ! remote_test "test -s \"$REMOTE_PNG\" && file \"$REMOTE_PNG\" | grep -q 'PNG image data'"; then
  tail -40 "$RUN_DIR/remote-stdout.log" >&2 || true
  record_run_report "$REPORT" "- RESULT: FAIL (no valid remote PNG produced; see remote-stdout.log)"
  fail "cli-remote-png" "Remote PNG missing or not a PNG: $REMOTE_PNG (do NOT add --backend metal; see remote-stdout.log)"
fi
REMOTE_FILE_OUT="$(ssh_remote "file \"$REMOTE_PNG\"")"
REMOTE_LS_OUT="$(ssh_remote "ls -lh \"$REMOTE_PNG\"")"

# ----- copy to MacBook -------------------------------------------------------
log "=== Copying PNG to MacBook ==="
# Resolve the absolute remote path (avoid $HOME in scp source spec).
REMOTE_PNG_ABS="$(remote_eval_path "$REMOTE_PNG")"
scp "$SSH_TARGET:$REMOTE_PNG_ABS" "$LOCAL_PNG" >/dev/null \
  || fail "cli-scp" "scp failed copying $REMOTE_PNG_ABS to $LOCAL_PNG"

# ----- verify locally + checksums --------------------------------------------
verify_png "$LOCAL_PNG" "CLI PNG"
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
    echo "- match: n/a (remote used md5 fallback; compared by transfer integrity)"
  else
    echo "- match: NO (investigate)"
  fi
  echo
  echo "## Timing"
  echo "- elapsed_seconds (wall, incl. ssh): $ELAPSED"
  echo "- remote_elapsed_seconds (generate_image): $REMOTE_ELAPSED"
  echo
  echo "## Result"
  echo "- CLI GENERATE: PASS"
} >> "$REPORT"

# ----- machine-readable metrics ----------------------------------------------
PNG_BYTES="$(png_bytes "$LOCAL_PNG")"
{
  metrics_header
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$(sanitize_tsv "$REMOTE_HOST_EXPECTED")" "$SSH_TARGET" "7f0e728" \
    "$(sanitize_tsv "$BUILD_DIR")" "$(sanitize_tsv "$REMOTE_MODEL")" "cli" "$PRESET_LABEL" \
    "$(sanitize_tsv "$ARG_PROMPT")" "$(sanitize_tsv "$ARG_NEG")" "$ARG_W" "$ARG_H" "$ARG_STEPS" "$ARG_CFG" "$ARG_SAMPLER" \
    "$SEED_VALUE" "$START_EPOCH" "$END_EPOCH" "$ELAPSED" "$REMOTE_ELAPSED" "n/a" \
    "$(sanitize_tsv "$LOCAL_PNG")" "$PNG_BYTES" "$LOCAL_SUM" "cold" "n/a" "n/a" "cli-local" "PASS"
} > "$RUN_DIR/metrics.tsv"

# ----- UI run card (schema sdcpp.run.v1) -------------------------------------
PRIMARY_REL="$(basename "$LOCAL_PNG")"
write_ui_run_card "$RUN_DIR" "cli" "PASS" "$PRIMARY_REL" "run-metadata.json" \
  "$ARG_PROMPT" \
  "preset=$PRESET_LABEL size=${ARG_W}x${ARG_H} steps=$ARG_STEPS cfg=$ARG_CFG sampler=$ARG_SAMPLER seed=$SEED_LABEL elapsed=${ELAPSED}s" \
  "$CREATED_AT" >/dev/null

pass_banner "CLI GENERATE PASS ($PRESET_LABEL, seed=$SEED_LABEL, ${ELAPSED}s wall / ${REMOTE_ELAPSED}s remote).
Local PNG: $LOCAL_PNG
Report:    $REPORT
UI card:   $RUN_DIR/ui-run-card.md"
printf 'sha256 local=%s remote=%s\n' "$LOCAL_SUM" "$REMOTE_SUM"
exit 0
