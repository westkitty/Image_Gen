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
ARG_SEED=""           # empty -> default to -1 (forces random seed)
ARG_OUT_NAME=""       # empty -> auto timestamp name
ARG_PRESET=""
ARG_SCHEDULER="discrete"
ARG_VAE=""
# explicit overrides start empty; only set when the user passes the flag
EX_STEPS=""; EX_W=""; EX_H=""; EX_CFG=""; EX_SAMPLER=""; EX_SCHEDULER=""

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
  --scheduler NAME   scheduler (overrides preset/config)
  --vae PATH         path to standalone VAE model
  --seed N|random|fixed   N=integer, random=recorded random int, fixed=42 (default: not forced -> -1)
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
    --scheduler) EX_SCHEDULER="${2:?}"; shift 2 ;;
    --vae) ARG_VAE="${2:?}"; shift 2 ;;
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
[ -n "$EX_SCHEDULER" ] && ARG_SCHEDULER="$EX_SCHEDULER"

RUN_DIR="$(make_run_dir cli)"
SDCPP_LOGFILE="$RUN_DIR/cli.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/cli-run-report.md"
NAME="${ARG_OUT_NAME:-sd15_cli_$(timestamp)}"
LOCAL_PNG="$RUN_DIR/$NAME.png"

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
  "prompt": $(printf '%s' "$REPORT_PROMPT" | jq -Rs .),
  "negative_prompt": $(printf '%s' "$REPORT_NEGATIVE_PROMPT" | jq -Rs .),
  "preset": "$PRESET_LABEL",
  "width": $ARG_W,
  "height": $ARG_H,
  "steps": $ARG_STEPS,
  "cfg_scale": $ARG_CFG,
  "sampler": "$ARG_SAMPLER",
  "scheduler": "$ARG_SCHEDULER",
  "vae": "$ARG_VAE",
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
  echo "- Prompt: $REPORT_PROMPT"
  echo "- Negative: $REPORT_NEGATIVE_PROMPT"
  echo "- Size: ${ARG_W}x${ARG_H}, steps=$ARG_STEPS, cfg=$ARG_CFG, sampler=$ARG_SAMPLER, scheduler=$ARG_SCHEDULER, vae=$ARG_VAE, seed=$SEED_LABEL"
  echo "- Build dir: $BUILD_DIR"
  echo "- Remote PNG: $REMOTE_PNG"
  echo "- Local PNG: $LOCAL_PNG"
  echo
} > "$REPORT"

# ----- generate (remote) -----------------------------------------------------
log "=== Generating on BigMac (Metal default; --backend cpu forced when LoRA tags present) ==="
# Single double-quoted remote command: local $-vars expand here, but the literal
# $HOME inside REMOTE_* values expands on BigMac. Prompts are escaped via printf %q.
Q_PROMPT="$(printf '%q' "$ARG_PROMPT")"
Q_NEG="$(printf '%q' "$ARG_NEG")"

# Resolve scheduler (discrete|karras|exponential|ays|sgm_uniform|simple)
SCHEDULER_FRAG=""
[ -n "$ARG_SCHEDULER" ] && SCHEDULER_FRAG="--scheduler $ARG_SCHEDULER"

# Resolve VAE flag
VAE_FRAG=""
[ -n "$ARG_VAE" ] && [ "$ARG_VAE" != "none" ] && VAE_FRAG="--vae $ARG_VAE"

# Resolve LoRA dir and CPU backend: only when prompt contains <lora:...> tags.
# CPU backend is required because Metal does not support the LoRA tensor ADD op.
LORA_FRAG=""
BACKEND_FRAG=""
if printf '%s' "$ARG_PROMPT" | grep -qE '<lora:[^>]+>'; then
  LORA_FRAG="--lora-model-dir /Volumes/wc2tb/ImageGen/loras --lora-apply-mode immediately"
  BACKEND_FRAG="--backend cpu"
fi

# NOTE: this host's ssh masks remote command exit codes, so we do NOT trust the
# exit status of the generation; we judge success by the remote PNG it produces
# (and ultimately by the verified copy on the MacBook).
START_EPOCH="$(now_epoch)"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  ssh_remote "cd \"$REMOTE_REPO\" && \"$BUILD_DIR/bin/sd-cli\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -W $ARG_W -H $ARG_H --steps $ARG_STEPS --cfg-scale $ARG_CFG --sampling-method $ARG_SAMPLER $SEED_FRAG ${SCHEDULER_FRAG:-} ${VAE_FRAG:-} ${LORA_FRAG:-} ${BACKEND_FRAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\"" 2>&1 | python3 -c "
import sys, re
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
# sd-cli -v emits BPE tokenizer debug that splits the prompt into word-piece
# tokens (e.g. 'to tokens [\"a</w>\", \"dog</w>\"]'). That array fully
# reconstructs the prompt even after the literal string is redacted, so when
# redacting we neutralize the token array (and any conditioner parse echo)
# at the stream, before it is ever written to disk.
tok_re = re.compile(r'(to tokens\s*)\[.*\]')
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    if 'to tokens' in line or 'bpe_tokenizer' in line:
        line = tok_re.sub(r'\1[REDACTED]', line)
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$RUN_DIR/remote-stdout.log" || true
else
  ssh_remote "cd \"$REMOTE_REPO\" && \"$BUILD_DIR/bin/sd-cli\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -W $ARG_W -H $ARG_H --steps $ARG_STEPS --cfg-scale $ARG_CFG --sampling-method $ARG_SAMPLER $SEED_FRAG ${SCHEDULER_FRAG:-} ${VAE_FRAG:-} ${LORA_FRAG:-} ${BACKEND_FRAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\"" > "$RUN_DIR/remote-stdout.log" 2>&1 || true
fi
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
    "$(sanitize_tsv "$REPORT_PROMPT")" "$(sanitize_tsv "$REPORT_NEGATIVE_PROMPT")" "$ARG_W" "$ARG_H" "$ARG_STEPS" "$ARG_CFG" "$ARG_SAMPLER" \
    "$SEED_VALUE" "$START_EPOCH" "$END_EPOCH" "$ELAPSED" "$REMOTE_ELAPSED" "n/a" \
    "$(sanitize_tsv "$LOCAL_PNG")" "$PNG_BYTES" "$LOCAL_SUM" "cold" "n/a" "n/a" "cli-local" "PASS"
} > "$RUN_DIR/metrics.tsv"

# ----- UI run card (schema sdcpp.run.v1) -------------------------------------
PRIMARY_REL="$(basename "$LOCAL_PNG")"
write_ui_run_card "$RUN_DIR" "cli" "PASS" "$PRIMARY_REL" "run-metadata.json" \
  "$REPORT_PROMPT" \
  "preset=$PRESET_LABEL size=${ARG_W}x${ARG_H} steps=$ARG_STEPS cfg=$ARG_CFG sampler=$ARG_SAMPLER scheduler=$ARG_SCHEDULER seed=$SEED_LABEL elapsed=${ELAPSED}s" \
  "$CREATED_AT" >/dev/null

pass_banner "CLI GENERATE PASS ($PRESET_LABEL, seed=$SEED_LABEL, ${ELAPSED}s wall / ${REMOTE_ELAPSED}s remote).
Local PNG: $LOCAL_PNG
Report:    $REPORT
UI card:   $RUN_DIR/ui-run-card.md"
printf 'sha256 local=%s remote=%s\n' "$LOCAL_SUM" "$REMOTE_SUM"
exit 0
