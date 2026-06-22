#!/usr/bin/env bash
# sdcpp-sdxl-turbo-smoke.sh — bounded SDXL Turbo smoke proof on BigMac.
# Proves one thing only: the staged SDXL Turbo checkpoint can render a real PNG.
# Does not download models, move files, or touch Flux paths.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

RUN_DIR="$(make_run_dir sdxl-turbo-smoke)"
SDCPP_LOGFILE="$RUN_DIR/sdxl-turbo-smoke.log"
export SDCPP_LOGFILE

REPORT="$RUN_DIR/sdxl-turbo-smoke-report.md"
MANIFEST="$RUN_DIR/sdxl-turbo-smoke-manifest.json"
UI_CARD="$RUN_DIR/ui-run-card.md"
SMOKE_CACHE="$SDCPP_STATE_DIR/sdxl-turbo-smoke-cache.json"
LOCAL_PNG="$RUN_DIR/sdxl-turbo-smoke.png"
REMOTE_RUN_DIR="$REMOTE_OUTPUT_DIR/$(basename "$RUN_DIR")"
REMOTE_PNG="$REMOTE_RUN_DIR/sdxl-turbo-smoke.png"
REMOTE_LOG="$REMOTE_RUN_DIR/sdxl-turbo-smoke.log"
REMOTE_STDOUT_LOG="$RUN_DIR/remote-command.log"
CREATED_AT="$(iso_now)"
START_EPOCH="$(now_epoch)"
FIRST_FAILED_GATE=""
RUN_STATUS="FAIL"
PNG_VALID="false"
RUNTIME_SMOKE_PROVEN="false"
MODEL_VOLUME_PATH="/Volumes/wc2tb"
MODEL_ROOT="/Volumes/wc2tb/ImageGen"
MODEL_PATH="$MODEL_ROOT/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors"
MIN_MODEL_BYTES=$((1024 * 1024 * 1024))
WIDTH=512
HEIGHT=512
STEPS=4
PROMPT='a small red cabin beside a lake, sharp focus'
REPORT_PROMPT='[REDACTED]'
REMOTE_MODEL_BYTES=""
REMOTE_ELAPSED="n/a"
WALL_ELAPSED="n/a"
HELP_OUTPUT=""
BUILD_DIR=""
SDCLI=""
CFG_ARG="--cfg-scale 0"
GUIDANCE_ARG="--guidance 0"
PREDICTION_ARG="--prediction eps"

smoke_write_artifacts() {
  local status="$1"
  local finished_at elapsed png_bytes_value remote_png_abs
  finished_at="$(iso_now)"
  elapsed="$(elapsed_seconds "$START_EPOCH" "$(now_epoch)")"
  WALL_ELAPSED="$elapsed"
  if [ "$status" = "PASS" ]; then
    PNG_VALID="true"
    RUNTIME_SMOKE_PROVEN="true"
  fi
  png_bytes_value="$(png_bytes "$LOCAL_PNG")"
  remote_png_abs=""
  if [ -n "$REMOTE_PNG" ]; then
    remote_png_abs="$(remote_eval_path "$REMOTE_PNG" 2>/dev/null || true)"
  fi

  python3 - \
    "$MANIFEST" \
    "$SMOKE_CACHE" \
    "$RUN_DIR" \
    "$status" \
    "$CREATED_AT" \
    "$finished_at" \
    "$elapsed" \
    "$FIRST_FAILED_GATE" \
    "$MODEL_VOLUME_PATH" \
    "$MODEL_ROOT" \
    "$MODEL_PATH" \
    "$REMOTE_MODEL_BYTES" \
    "$BUILD_DIR" \
    "$SDCLI" \
    "$WIDTH" \
    "$HEIGHT" \
    "$STEPS" \
    "$CFG_ARG" \
    "$GUIDANCE_ARG" \
    "$PREDICTION_ARG" \
    "$REMOTE_RUN_DIR" \
    "$REMOTE_PNG" \
    "$REMOTE_LOG" \
    "$LOCAL_PNG" \
    "$png_bytes_value" \
    "$PNG_VALID" \
    "$RUNTIME_SMOKE_PROVEN" \
    "$PROMPT" \
    "$REPORT_PROMPT" \
    <<'PYMANIFEST'
import json
import sys

(manifest_path, smoke_cache_path, run_dir, status, created_at, finished_at, wall_elapsed, first_failed_gate,
 model_volume_path, model_root, model_path, remote_model_bytes, build_dir, sdcli_path,
 width, height, steps, cfg_arg, guidance_arg, prediction_arg, remote_run_dir,
 remote_png, remote_log, local_png, png_bytes_value, png_valid, runtime_smoke_proven,
 prompt, report_prompt) = sys.argv[1:]

cfg_scale = None
guidance = None
for arg, name in ((cfg_arg, "cfg"), (guidance_arg, "guidance")):
    arg = arg.strip()
    if arg.startswith(f'--{name} '):
        try:
            value = float(arg.split(' ', 1)[1])
        except ValueError:
            value = None
        if name == "cfg":
            cfg_scale = value
        else:
            guidance = value

route_ok = first_failed_gate not in ("route", "route-identity")

obj = {
    "schema": "sdcpp.sdxl_turbo_smoke.v1",
    "run_id": run_dir.rsplit('/', 1)[-1],
    "status": status,
    "created_at": created_at,
    "finished_at": finished_at,
    "wall_elapsed_seconds": float(wall_elapsed) if wall_elapsed else None,
    "first_failed_gate": first_failed_gate or None,
    "route_ok": route_ok,
    "model_volume_path": model_volume_path,
    "model_root": model_root,
    "model_path": model_path,
    "model_bytes": int(remote_model_bytes) if str(remote_model_bytes).isdigit() else None,
    "model_minimum_bytes": 1024 * 1024 * 1024,
    "build_dir": build_dir or None,
    "sdcli_path": sdcli_path or None,
    "width": int(width),
    "height": int(height),
    "steps": int(steps),
    "cfg_scale": cfg_scale,
    "guidance": guidance,
    "prediction": prediction_arg.split(' ', 1)[1] if prediction_arg.startswith('--prediction ') else None,
    "sampler": None,
    "prompt_redacted": True,
    "prompt": "[REDACTED]",
    "remote_run_dir": remote_run_dir or None,
    "remote_png": remote_png or None,
    "remote_log": remote_log or None,
    "local_png": local_png or None,
    "png_bytes": int(png_bytes_value) if str(png_bytes_value).isdigit() else 0,
    "png_valid": png_valid == "true",
    "runtime_smoke_proven": runtime_smoke_proven == "true",
    "notes": "Bounded SDXL Turbo smoke proof only. Flux and SDXL base remain separate gates."
}

with open(manifest_path, 'w') as f:
    json.dump(obj, f, indent=2)
    f.write('\n')

smoke_obj = {
    "checked_at": finished_at,
    "run_id": obj["run_id"],
    "status": status,
    "route_ok": route_ok,
    "runtime_smoke_proven": runtime_smoke_proven == "true",
    "png_valid": png_valid == "true",
    "prompt_redacted": True,
    "model_path": model_path,
    "model_bytes": obj["model_bytes"],
    "local_png": local_png or None,
    "local_png_bytes": obj["png_bytes"],
    "first_failed_gate": first_failed_gate or None,
}
with open(smoke_cache_path, 'w') as f:
    json.dump(smoke_obj, f, indent=2)
    f.write('\n')
PYMANIFEST

  {
    printf '# SDXL Turbo Smoke Report\n\n'
    printf 'run_id: %s\n' "$(basename "$RUN_DIR")"
    printf 'created_at: %s\n' "$CREATED_AT"
    printf 'finished_at: %s\n\n' "$finished_at"
    printf '## Route\n\n'
    printf '%s\n' "- ssh target: $SSH_TARGET" "- expected host: $REMOTE_HOST_EXPECTED" "- model volume: $MODEL_VOLUME_PATH" "- model root: $MODEL_ROOT"
    printf '\n## Checkpoints\n\n'
    printf '%s\n' "- model: $MODEL_PATH" "- model bytes: ${REMOTE_MODEL_BYTES:-unknown}" "- minimum required: $MIN_MODEL_BYTES"
    printf '\n## Binary\n\n'
    printf '%s\n' "- sd-cli: ${SDCLI:-unknown}" "- prompt: [REDACTED]" "- size: ${WIDTH}x${HEIGHT}" "- steps: $STEPS" "- cfg: ${CFG_ARG#--cfg-scale }" "- guidance: ${GUIDANCE_ARG#--guidance }" "- prediction: ${PREDICTION_ARG#--prediction }"
    printf '\n## Outputs\n\n'
    printf '%s\n' "- remote PNG: ${REMOTE_PNG}" "- local PNG: ${LOCAL_PNG}" "- local PNG bytes: ${png_bytes_value:-0}" "- local PNG valid: ${PNG_VALID}" "- runtime smoke proven: ${RUNTIME_SMOKE_PROVEN}"
    printf '\n## Logs\n\n'
    printf '%s\n' "- remote stdout/stderr: $REMOTE_STDOUT_LOG" "- remote log: $REMOTE_LOG" "- local workflow log: $SDCPP_LOGFILE"
    printf '\n## Result\n\n'
    if [ "$status" = "PASS" ]; then
      printf '%s\n' 'SDXL Turbo smoke proof passed.'
    else
      printf '%s\n' "First failed gate: ${FIRST_FAILED_GATE:-unknown}"
      printf '%s\n' 'SDXL Turbo smoke proof did not complete.'
    fi
  } > "$REPORT"

  if [ "$status" = "PASS" ]; then
    write_ui_run_card \
      "$RUN_DIR" \
      "sdxl-turbo-smoke" \
      "PASS" \
      "sdxl-turbo-smoke.png" \
      "sdxl-turbo-smoke-manifest.json" \
      "$REPORT_PROMPT" \
      "model=$MODEL_PATH size=${WIDTH}x${HEIGHT} steps=$STEPS cfg=${CFG_ARG#--cfg-scale } guidance=${GUIDANCE_ARG#--guidance }" \
      "$CREATED_AT" \
      >/dev/null
  fi
}

smoke_fail() {
  local gate="$1"
  shift || true
  FIRST_FAILED_GATE="$gate"
  smoke_write_artifacts "FAIL"
  fail "$gate" "$*"
}

log "Starting bounded SDXL Turbo smoke run in $RUN_DIR"

ROUTE_OUT="$(ssh -o ConnectTimeout=15 "$SSH_TARGET" 'printf "WHOAMI\t%s\n" "$(whoami)"; printf "HOSTNAME\t%s\n" "$(hostname)"; printf "PWD\t%s\n" "$PWD"; printf "__SDCPP_ROUTE_DONE__\n"' 2>&1 || true)"
printf '%s\n' "$ROUTE_OUT" > "$RUN_DIR/route-check.log"
if ! printf '%s\n' "$ROUTE_OUT" | grep -q '__SDCPP_ROUTE_DONE__'; then
  smoke_fail "route" "ssh $SSH_TARGET did not return the route sentinel."
fi

ROUTE_WHOAMI="$(printf '%s\n' "$ROUTE_OUT" | awk -F'\t' '$1=="WHOAMI"{print $2; exit}')"
ROUTE_HOSTNAME="$(printf '%s\n' "$ROUTE_OUT" | awk -F'\t' '$1=="HOSTNAME"{print $2; exit}')"
ROUTE_PWD="$(printf '%s\n' "$ROUTE_OUT" | awk -F'\t' '$1=="PWD"{print $2; exit}')"
if [ "$ROUTE_WHOAMI" != "bigmac" ] || [ "$ROUTE_HOSTNAME" != "bigmac" ] || [ "$ROUTE_PWD" != "/Users/bigmac" ]; then
  smoke_fail "route-identity" "Expected bigmac/bigmac at /Users/bigmac, got ${ROUTE_WHOAMI}/${ROUTE_HOSTNAME} at ${ROUTE_PWD}."
fi

remote_test "test -d \"$MODEL_VOLUME_PATH\"" || smoke_fail "model-volume" "Model volume is not mounted on BigMac: $MODEL_VOLUME_PATH"
remote_test "test -d \"$MODEL_ROOT\"" || smoke_fail "model-root" "Model root is missing on BigMac: $MODEL_ROOT"
remote_test "test -s \"$MODEL_PATH\"" || smoke_fail "model-present" "SDXL Turbo checkpoint is missing or empty: $MODEL_PATH"
REMOTE_MODEL_BYTES="$(ssh_remote "stat -f %z \"$MODEL_PATH\" 2>/dev/null || wc -c < \"$MODEL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
case "$REMOTE_MODEL_BYTES" in
  ''|*[!0-9]*)
    smoke_fail "model-size" "Could not read a numeric size for $MODEL_PATH."
    ;;
esac
if [ "$REMOTE_MODEL_BYTES" -lt "$MIN_MODEL_BYTES" ]; then
  smoke_fail "model-size" "SDXL Turbo checkpoint is too small (${REMOTE_MODEL_BYTES} bytes; need at least ${MIN_MODEL_BYTES})."
fi

BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
SDCLI="$BUILD_DIR/bin/sd-cli"

HELP_OUTPUT="$(ssh_remote "if [ -x \"$SDCLI\" ]; then \"$SDCLI\" --help 2>&1; fi" 2>&1 || true)"
printf '%s\n' "$HELP_OUTPUT" > "$RUN_DIR/sd-cli-help.log"
for flag in '--model' '--prompt' '--output' '--width' '--height' '--steps' '--cfg-scale' '--guidance' '--prediction'; do
  printf '%s\n' "$HELP_OUTPUT" | grep -q -- "$flag" || smoke_fail "sd-cli-help" "sd-cli help does not show required flag $flag."
done

ensure_remote_dirs
remote_test "mkdir -p \"$REMOTE_RUN_DIR\"" || smoke_fail "remote-run-dir" "Could not create remote run dir: $REMOTE_RUN_DIR"

Q_PROMPT="$(printf '%q' "$PROMPT")"
REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$MODEL_PATH\" -p $Q_PROMPT -o \"$REMOTE_PNG\" -W $WIDTH -H $HEIGHT --steps $STEPS $CFG_ARG $GUIDANCE_ARG $PREDICTION_ARG --diffusion-fa 2>&1 | tee \"$REMOTE_LOG\""
log "Running remote bounded Turbo smoke on BigMac"
ssh_remote "mkdir -p \"$REMOTE_RUN_DIR\" && $REMOTE_STDOUT_CMD" > "$REMOTE_STDOUT_LOG" 2>&1 || true

REMOTE_ELAPSED="$(extract_remote_elapsed "$REMOTE_LOG")"
[ -n "$REMOTE_ELAPSED" ] || REMOTE_ELAPSED="n/a"

if ! remote_test "test -s \"$REMOTE_PNG\" && file \"$REMOTE_PNG\" | grep -q 'PNG image data'"; then
  smoke_fail "remote-png" "Remote PNG missing or invalid: $REMOTE_PNG"
fi

REMOTE_PNG_ABS="$(remote_eval_path "$REMOTE_PNG")"
scp "$SSH_TARGET:$REMOTE_PNG_ABS" "$LOCAL_PNG" >/dev/null 2>&1 || smoke_fail "scp" "Could not copy remote PNG to $LOCAL_PNG"
verify_png "$LOCAL_PNG" "SDXL Turbo smoke PNG"
PNG_VALID="true"
RUNTIME_SMOKE_PROVEN="true"
RUN_STATUS="PASS"

smoke_write_artifacts "PASS"

pass_banner "SDXL Turbo smoke proof complete.
Run: $RUN_DIR
PNG: $LOCAL_PNG
Report: $REPORT
Manifest: $MANIFEST"
