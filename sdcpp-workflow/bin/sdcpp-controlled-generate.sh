#!/usr/bin/env bash
# sdcpp-controlled-generate.sh — closed allowlist generation for proofed targets.
# Supports closed allowlist targets only: sd15, sdxl-base, sdxl-turbo, flux-fp8, and migrated named targets.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

: "${MODEL_STAGE_ROOT:=/Volumes/wc2tb/ImageGen}"
export MODEL_STAGE_ROOT

ARG_TARGET=""
ARG_PROMPT="$PROMPT"
ARG_NEG=""
ARG_WIDTH=""
ARG_HEIGHT=""
ARG_STEPS=""
ARG_CFG=""
ARG_SEED=""
ARG_API="openai"
ARG_SAVE_PROMPTS="false"
ARG_SCHEDULER=""
ARG_VAE=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --target sd15|sdxl-base|sdxl-turbo|flux-fp8|sdxl-photonic|sdxl-homochi|sdxl-pony|sd15-homofidelis
  --prompt "..."              positive prompt
  --negative-prompt "..."     negative prompt
  --width N                   width in pixels
  --height N                  height in pixels
  --steps N                   steps
  --cfg N                     cfg scale (Flux uses the proven guidance value)
  --seed N|random|fixed       seed control
  --scheduler NAME            scheduler to use (discrete, karras, etc.)
  --vae PATH                  path to standalone VAE model
  --api openai|sdapi|both|native
                              SD1.5 server-tunnel API path (default openai)
  --save-prompts true|false   persist prompts in run records (default false)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) ARG_TARGET="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative-prompt|--negative) ARG_NEG="${2:?}"; shift 2 ;;
    --width) ARG_WIDTH="${2:?}"; shift 2 ;;
    --height) ARG_HEIGHT="${2:?}"; shift 2 ;;
    --steps) ARG_STEPS="${2:?}"; shift 2 ;;
    --cfg|--cfg-scale) ARG_CFG="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --api) ARG_API="${2:?}"; shift 2 ;;
    --scheduler) ARG_SCHEDULER="${2:?}"; shift 2 ;;
    --vae) ARG_VAE="${2:?}"; shift 2 ;;
    --save-prompts) ARG_SAVE_PROMPTS="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

ARG_TARGET="$(printf '%s' "$ARG_TARGET" | tr '[:upper:]' '[:lower:]')"
case "$ARG_SAVE_PROMPTS" in true|false) : ;; *) fail "args" "--save-prompts must be true|false" ;; esac
case "$ARG_TARGET" in sd15|sdxl-base|sdxl-turbo|flux-fp8|sdxl-photonic|sdxl-homochi|sdxl-pony|sd15-homofidelis) : ;; *) fail "target" "Unknown target '$ARG_TARGET'." ;; esac
case "$ARG_API" in openai|sdapi|both|native) : ;; *) fail "args" "--api must be openai|sdapi|both|native" ;; esac
if [ "$ARG_SAVE_PROMPTS" = "true" ]; then
  export SDCPP_REDACT_PROMPTS=0
else
  export SDCPP_REDACT_PROMPTS=1
fi

TARGET_LABEL=""
TARGET_MODE=""
TARGET_STATUS=""
TARGET_CAVEAT=""
TARGET_PROOF_DERIVED="false"
TARGET_FULL_PARITY="false"
TARGET_MODEL_PATH=""
TARGET_VAE_PATH=""
TARGET_CLIP_L_PATH=""
TARGET_T5XXL_PATH=""
TARGET_VAE_FORMAT=""
TARGET_SAMPLER=""
TARGET_PREDICTION=""
TARGET_GUIDANCE=""
TARGET_MAX_WIDTH=1024
TARGET_MAX_HEIGHT=1024
TARGET_MIN_STEPS=1
TARGET_MAX_STEPS=8
TARGET_DEFAULT_STEPS=4
TARGET_DEFAULT_WIDTH=512
TARGET_DEFAULT_HEIGHT=512
TARGET_DEFAULT_CFG="7"
TARGET_REQUIRE_CFG_SCALE="false"
TARGET_REQUIRE_HELP_FLAGS="--model --prompt --output --width --height --steps"

case "$ARG_TARGET" in
  sd15)
    TARGET_LABEL="SD1.5 standard"
    TARGET_MODE="existing supported txt2img"
    TARGET_STATUS="supported"
    TARGET_CAVEAT="Normal supported generation path. Full Automatic1111 parity is still not claimed."
    TARGET_MAX_WIDTH=2048
    TARGET_MAX_HEIGHT=2048
    TARGET_MAX_STEPS=150
    TARGET_DEFAULT_STEPS=20
    TARGET_DEFAULT_CFG="7"
    TARGET_SAMPLER="euler_a"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sdxl-base)
    TARGET_LABEL="SDXL base"
    TARGET_MODE="proofed controlled generation"
    TARGET_STATUS="proofed"
    TARGET_CAVEAT="Controlled proofed path; not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl/sd_xl_base_1.0.safetensors"
    TARGET_DEFAULT_CFG="7"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sdxl-photonic)
    TARGET_LABEL="Photonic Fusion SDXL"
    TARGET_MODE="migrated controlled generation"
    TARGET_STATUS="staged"
    TARGET_CAVEAT="Migrated wc2tb SDXL checkpoint. Photonic has one direct smoke proof; not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl/photonic_fusion_sdxl_finale_v1.safetensors"
    TARGET_VAE_PATH="$MODEL_STAGE_ROOT/vaes/sdxl_vae.safetensors"
    TARGET_DEFAULT_WIDTH=1024
    TARGET_DEFAULT_HEIGHT=1024
    TARGET_DEFAULT_STEPS=10
    TARGET_MAX_STEPS=150
    TARGET_DEFAULT_CFG="6.5"
    TARGET_SAMPLER="dpm++2m"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sdxl-homochi)
    TARGET_LABEL="Homochi XL v2"
    TARGET_MODE="migrated controlled generation"
    TARGET_STATUS="staged"
    TARGET_CAVEAT="Migrated wc2tb SDXL checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl/homochi_xl_v2.safetensors"
    TARGET_VAE_PATH="$MODEL_STAGE_ROOT/vaes/sdxl_vae.safetensors"
    TARGET_DEFAULT_WIDTH=1024
    TARGET_DEFAULT_HEIGHT=1024
    TARGET_DEFAULT_STEPS=10
    TARGET_MAX_STEPS=150
    TARGET_DEFAULT_CFG="6.5"
    TARGET_SAMPLER="dpm++2m"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sdxl-pony)
    TARGET_LABEL="Pony Diffusion V6 XL"
    TARGET_MODE="migrated controlled generation"
    TARGET_STATUS="staged"
    TARGET_CAVEAT="Migrated wc2tb SDXL checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl/pony_diffusion_v6_xl.safetensors"
    TARGET_VAE_PATH="$MODEL_STAGE_ROOT/vaes/sdxl_vae.safetensors"
    TARGET_DEFAULT_WIDTH=1024
    TARGET_DEFAULT_HEIGHT=1024
    TARGET_DEFAULT_STEPS=10
    TARGET_MAX_STEPS=150
    TARGET_DEFAULT_CFG="6.5"
    TARGET_SAMPLER="dpm++2m"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sd15-homofidelis)
    TARGET_LABEL="HomoFidelis v5"
    TARGET_MODE="migrated controlled generation"
    TARGET_STATUS="staged"
    TARGET_CAVEAT="Migrated wc2tb SD1.5 checkpoint; staged/selectable without individual smoke proof. Not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sd15/homofidelis_v5.safetensors"
    TARGET_MAX_WIDTH=2048
    TARGET_MAX_HEIGHT=2048
    TARGET_MAX_STEPS=150
    TARGET_DEFAULT_STEPS=20
    TARGET_DEFAULT_CFG="7"
    TARGET_SAMPLER="euler_a"
    TARGET_REQUIRE_CFG_SCALE="true"
    ;;
  sdxl-turbo)
    TARGET_LABEL="SDXL Turbo"
    TARGET_MODE="proofed controlled generation"
    TARGET_STATUS="proofed"
    TARGET_CAVEAT="Controlled proofed path; not full A1111 parity."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors"
    TARGET_MAX_STEPS=4
    TARGET_DEFAULT_STEPS=4
    TARGET_DEFAULT_CFG="0"
    TARGET_REQUIRE_CFG_SCALE="true"
    TARGET_GUIDANCE="--guidance 0"
    TARGET_PREDICTION="--prediction eps"
    ;;
  flux-fp8)
    TARGET_LABEL="Flux fp8"
    TARGET_MODE="proofed controlled generation"
    TARGET_STATUS="proofed"
    TARGET_CAVEAT="Controlled proofed path; not full A1111 parity. Uses the fp8 runtime-proven Flux file, not the full Flux file."
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/flux/flux1-schnell/flux1-schnell-fp8.safetensors"
    TARGET_VAE_PATH="$MODEL_STAGE_ROOT/flux/shared/ae.safetensors"
    TARGET_CLIP_L_PATH="$MODEL_STAGE_ROOT/flux/shared/clip_l.safetensors"
    TARGET_T5XXL_PATH="$MODEL_STAGE_ROOT/flux/shared/t5xxl_fp16.safetensors"
    TARGET_DEFAULT_CFG="3.5"
    TARGET_MAX_STEPS=8
    TARGET_DEFAULT_STEPS=4
    TARGET_REQUIRE_CFG_SCALE="true"
    TARGET_GUIDANCE="--guidance 3.5"
    TARGET_PREDICTION="--prediction flux_flow"
    TARGET_VAE_FORMAT="--vae-format flux"
    TARGET_SAMPLER="--sampling-method euler"
    ;;
esac

if ! validatePrompt "$ARG_PROMPT"; then
  fail "prompt" "Invalid prompt"
fi
if ! validateNegativePrompt "$ARG_NEG"; then
  fail "negative-prompt" "Invalid negative prompt"
fi
if ! validateSeed "$ARG_SEED"; then
  fail "seed" "Invalid seed"
fi

if [ -z "$ARG_WIDTH" ]; then ARG_WIDTH="$TARGET_DEFAULT_WIDTH"; fi
if [ -z "$ARG_HEIGHT" ]; then ARG_HEIGHT="$TARGET_DEFAULT_HEIGHT"; fi
if [ -z "$ARG_STEPS" ]; then ARG_STEPS="$TARGET_DEFAULT_STEPS"; fi
if [ -z "$ARG_CFG" ]; then ARG_CFG="$TARGET_DEFAULT_CFG"; fi

if ! validateSize "$ARG_WIDTH"; then
  fail "width" "Invalid width"
fi
if ! validateSize "$ARG_HEIGHT"; then
  fail "height" "Invalid height"
fi
if ! validateIntRange "$ARG_STEPS" "$TARGET_MIN_STEPS" "$TARGET_MAX_STEPS" false; then
  fail "steps" "Invalid steps for $ARG_TARGET"
fi
if [ "$ARG_TARGET" = "sdxl-turbo" ] && [ "$(printf '%s' "$ARG_CFG")" != "0" ]; then
  fail "cfg-scale" "SDXL Turbo requires cfg_scale 0"
fi
if [ "$ARG_TARGET" = "flux-fp8" ] && [ "$(printf '%s' "$ARG_CFG")" != "3.5" ]; then
  fail "cfg-scale" "Flux fp8 requires cfg_scale 3.5"
fi
if [ "$TARGET_REQUIRE_CFG_SCALE" = "true" ] && ! validateFloatRange "$ARG_CFG" 0 30 false; then
  fail "cfg-scale" "Invalid cfg_scale"
fi

RUN_DIR="$(make_run_dir controlled-$ARG_TARGET)"
SDCPP_LOGFILE="$RUN_DIR/controlled-generate.log"
export SDCPP_LOGFILE

REPORT="$RUN_DIR/controlled-generate-report.md"
MANIFEST="$RUN_DIR/controlled-manifest.json"
LOCAL_PNG="$RUN_DIR/controlled-$ARG_TARGET.png"
REMOTE_RUN_DIR="$REMOTE_OUTPUT_DIR/$(basename "$RUN_DIR")"
REMOTE_PNG="$REMOTE_RUN_DIR/controlled-$ARG_TARGET.png"
REMOTE_LOG="$REMOTE_RUN_DIR/controlled-$ARG_TARGET.log"
REMOTE_STDOUT_LOG="$RUN_DIR/remote-command.log"
CREATED_AT="$(iso_now)"
START_EPOCH="$(now_epoch)"
FIRST_FAILED_GATE=""
RUN_STATUS="FAIL"
PNG_VALID="false"
RUNTIME_CONTROLLED_PROVEN="false"
REPORT_PROMPT="$ARG_PROMPT"
REPORT_NEGATIVE_PROMPT="$ARG_NEG"
PROMPT_REDACTED="false"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  REPORT_PROMPT="[REDACTED]"
  REPORT_NEGATIVE_PROMPT="[REDACTED]"
  PROMPT_REDACTED="true"
fi

BUILD_DIR=""
SDCLI=""
REMOTE_MODEL_BYTES=""
REMOTE_VAE_BYTES=""
REMOTE_CLIP_BYTES=""
REMOTE_T5XXL_BYTES=""
REMOTE_ELAPSED="n/a"
WALL_ELAPSED="n/a"
HELP_OUTPUT=""
CFG_FLAG=""
NEG_FLAG=""
SEED_RESOLVED=""
SEED_VALUE=""
SEED_CONTROLLED=""
SEED_LABEL=""

controlled_write_artifacts() {
  local status="$1"
  local finished_at elapsed png_bytes_value remote_png_abs
  finished_at="$(iso_now)"
  elapsed="$(elapsed_seconds "$START_EPOCH" "$(now_epoch)")"
  WALL_ELAPSED="$elapsed"
  if [ "$status" = "PASS" ]; then
    PNG_VALID="true"
    RUNTIME_CONTROLLED_PROVEN="true"
  fi
  png_bytes_value="$(png_bytes "$LOCAL_PNG")"
  remote_png_abs=""
  if [ -n "$REMOTE_PNG" ]; then
    remote_png_abs="$(remote_eval_path "$REMOTE_PNG" 2>/dev/null || true)"
  fi

  python3 - \
    "$MANIFEST" \
    "$RUN_DIR" \
    "$status" \
    "$CREATED_AT" \
    "$finished_at" \
    "$elapsed" \
    "$FIRST_FAILED_GATE" \
    "$ARG_TARGET" \
    "$TARGET_LABEL" \
    "$TARGET_MODE" \
    "$TARGET_STATUS" \
    "$TARGET_CAVEAT" \
    "$TARGET_PROOF_DERIVED" \
    "$TARGET_FULL_PARITY" \
    "$TARGET_MODEL_PATH" \
    "$TARGET_VAE_PATH" \
    "$TARGET_CLIP_L_PATH" \
    "$TARGET_T5XXL_PATH" \
    "$REMOTE_MODEL_BYTES" \
    "$REMOTE_VAE_BYTES" \
    "$REMOTE_CLIP_BYTES" \
    "$REMOTE_T5XXL_BYTES" \
    "$BUILD_DIR" \
    "$SDCLI" \
    "$ARG_WIDTH" \
    "$ARG_HEIGHT" \
    "$ARG_STEPS" \
    "$ARG_CFG" \
    "$SEED_LABEL" \
    "$REMOTE_RUN_DIR" \
    "$REMOTE_PNG" \
    "$REMOTE_LOG" \
    "$LOCAL_PNG" \
    "$png_bytes_value" \
    "$PNG_VALID" \
    "$RUNTIME_CONTROLLED_PROVEN" \
    "$REPORT_PROMPT" \
    "$REPORT_NEGATIVE_PROMPT" \
    "$PROMPT_REDACTED" \
    "$TARGET_MAX_WIDTH" \
    "$TARGET_MAX_HEIGHT" \
    "$TARGET_MIN_STEPS" \
    "$TARGET_MAX_STEPS" \
    "$TARGET_DEFAULT_STEPS" \
    "$TARGET_DEFAULT_CFG" \
    <<'PYMANIFEST'
import json
import sys

(manifest_path, run_dir, status, created_at, finished_at, wall_elapsed, first_failed_gate,
target_id, target_label, target_mode, target_status, target_caveat, target_proof_derived,
 target_full_parity, target_model_path, target_vae_path, target_clip_l_path, target_t5xxl_path,
 remote_model_bytes, remote_vae_bytes, remote_clip_bytes, remote_t5xxl_bytes,
 build_dir, sdcli_path, width, height, steps, cfg_scale, seed_label, remote_run_dir,
 remote_png, remote_log, local_png, png_bytes_value, png_valid, runtime_controlled_proven,
 prompt, negative_prompt, prompt_redacted, max_width, max_height, min_steps, max_steps, default_steps, default_cfg) = sys.argv[1:]

obj = {
    "schema": "sdcpp.controlled_generate.v1",
    "run_id": run_dir.rsplit('/', 1)[-1],
    "status": status,
    "created_at": created_at,
    "finished_at": finished_at,
    "wall_elapsed_seconds": float(wall_elapsed) if wall_elapsed else None,
    "first_failed_gate": first_failed_gate or None,
    "controlledTarget": target_id,
    "controlledTargetLabel": target_label,
    "controlledTargetMode": target_mode,
    "controlledTargetStatus": target_status,
    "controlledTargetCaveat": target_caveat,
    "proofDerived": target_proof_derived == "true",
    "fullParityClaim": target_full_parity == "true",
    "controlledOutputImage": local_png or None,
    "controlledManifest": manifest_path,
    "targetModelPath": target_model_path or None,
    "targetVaePath": target_vae_path or None,
    "targetClipLPath": target_clip_l_path or None,
    "targetT5xxlPath": target_t5xxl_path or None,
    "model_bytes": int(remote_model_bytes) if str(remote_model_bytes).isdigit() else None,
    "vae_bytes": int(remote_vae_bytes) if str(remote_vae_bytes).isdigit() else None,
    "clip_l_bytes": int(remote_clip_bytes) if str(remote_clip_bytes).isdigit() else None,
    "t5xxl_bytes": int(remote_t5xxl_bytes) if str(remote_t5xxl_bytes).isdigit() else None,
    "build_dir": build_dir or None,
    "sdcli_path": sdcli_path or None,
    "width": int(width),
    "height": int(height),
    "steps": int(steps),
    "cfg_scale": float(cfg_scale) if cfg_scale else None,
    "seed_label": seed_label or None,
    "max_width": int(max_width),
    "max_height": int(max_height),
    "min_steps": int(min_steps),
    "max_steps": int(max_steps),
    "default_steps": int(default_steps),
    "default_cfg_scale": float(default_cfg) if default_cfg else None,
    "prompt_redacted": prompt_redacted == "true",
    "prompt": prompt,
    "negative_prompt": negative_prompt,
    "remote_run_dir": remote_run_dir or None,
    "remote_png": remote_png or None,
    "remote_log": remote_log or None,
    "local_png": local_png or None,
    "png_bytes": int(png_bytes_value) if str(png_bytes_value).isdigit() else 0,
    "png_valid": png_valid == "true",
    "runtime_controlled_proven": runtime_controlled_proven == "true"
}

with open(manifest_path, 'w') as f:
    json.dump(obj, f, indent=2)
    f.write('\n')
PYMANIFEST

  {
    printf '# Controlled Generation Report\n\n'
    printf 'run_id: %s\n' "$(basename "$RUN_DIR")"
    printf 'created_at: %s\n' "$CREATED_AT"
    printf 'finished_at: %s\n\n' "$finished_at"
    printf '## Target\n\n'
    printf '%s\n' "- target: $ARG_TARGET" "- label: $TARGET_LABEL" "- mode: $TARGET_MODE" "- proof-derived: $TARGET_PROOF_DERIVED" "- caveat: $TARGET_CAVEAT"
    printf '\n## Route\n\n'
    printf '%s\n' "- ssh target: $SSH_TARGET" "- expected host: $REMOTE_HOST_EXPECTED" "- build dir: ${BUILD_DIR:-unknown}" "- sd-cli: ${SDCLI:-unknown}"
    printf '\n## Model details\n\n'
    printf '%s\n' "- model: ${TARGET_MODEL_PATH:-REMOTE_MODEL}" "- vae: ${TARGET_VAE_PATH:-n/a}" "- clip_l: ${TARGET_CLIP_L_PATH:-n/a}" "- t5xxl: ${TARGET_T5XXL_PATH:-n/a}"
    printf '\n## Controls\n\n'
    printf '%s\n' "- size: ${ARG_WIDTH}x${ARG_HEIGHT}" "- steps: $ARG_STEPS" "- cfg/guidance: $ARG_CFG" "- seed: ${SEED_LABEL:-n/a}" "- prompt: $REPORT_PROMPT" "- negative: $REPORT_NEGATIVE_PROMPT"
    printf '\n## Outputs\n\n'
    printf '%s\n' "- remote PNG: ${REMOTE_PNG}" "- local PNG: ${LOCAL_PNG}" "- local PNG bytes: ${png_bytes_value:-0}" "- local PNG valid: ${PNG_VALID}" "- controlled proofed: ${RUNTIME_CONTROLLED_PROVEN}"
    printf '\n## Result\n\n'
    if [ "$status" = "PASS" ]; then
      printf '%s\n' 'Controlled generation passed.'
      printf '%s\n' 'Proof-only support does not mean full Automatic1111 parity.'
    else
      printf '%s\n' "First failed gate: ${FIRST_FAILED_GATE:-unknown}"
      printf '%s\n' 'Controlled generation did not complete.'
    fi
  } > "$REPORT"

  if [ "$status" = "PASS" ]; then
    write_ui_run_card \
      "$RUN_DIR" \
      "controlled-$ARG_TARGET" \
      "PASS" \
      "$(basename "$LOCAL_PNG")" \
      "controlled-manifest.json" \
      "$REPORT_PROMPT" \
      "target=$ARG_TARGET size=${ARG_WIDTH}x${ARG_HEIGHT} steps=$ARG_STEPS cfg=$ARG_CFG seed=$SEED_LABEL" \
      "$CREATED_AT" \
      >/dev/null
    printf 'CONTROLLED_TARGET: %s\n' "$ARG_TARGET"
    printf 'CONTROLLED_OUTPUT_IMAGE: %s\n' "$LOCAL_PNG"
    printf 'CONTROLLED_MANIFEST: %s\n' "$MANIFEST"
    printf 'TARGET_CAVEAT: %s\n' "$TARGET_CAVEAT"
  fi
}

controlled_fail() {
  local gate="$1"
  shift || true
  FIRST_FAILED_GATE="$gate"
  controlled_write_artifacts "FAIL"
  fail "$gate" "$*"
}

log "Starting controlled generation for target $ARG_TARGET in $RUN_DIR"
SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
SEED_FRAG=""
[ "$SEED_CONTROLLED" = "yes" ] && SEED_FRAG="--seed $SEED_VALUE"

SCHED_FRAG=""
[ -n "$ARG_SCHEDULER" ] && SCHED_FRAG="--scheduler $ARG_SCHEDULER"

# Use fast server tunnel for sd15 ONLY when no LoRA tags are requested.
# If LoRAs are present, fall back to CLI mode to correctly load them from the directory.
if [ "$ARG_TARGET" = "sd15" ] && ! printf '%s' "$ARG_PROMPT" | grep -qE '<lora:[^>]+>'; then
  LPORT="$LOCAL_TUNNEL_PORT"
  RPORT="$REMOTE_SERVER_PORT"
  if [ -f "$SDCPP_STATE_DIR/current-ports.env" ]; then
    # shellcheck disable=SC1091
    . "$SDCPP_STATE_DIR/current-ports.env"
    LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"
    RPORT="${REMOTE_SERVER_PORT:-$RPORT}"
  fi
  BASE="http://127.0.0.1:$LPORT"
  BUILD_DIR="server-tunnel:$BASE"
  SDCLI="$HERE/sdcpp-server-generate.sh"
  REMOTE_RUN_DIR=""
  REMOTE_PNG=""
  REMOTE_LOG=""

  log "Using proven server tunnel path for SD1.5 controlled generation: $BASE (remote port $RPORT, api=$ARG_API)"
  if ! lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
    controlled_fail "tunnel-down" "No local tunnel listening on $LPORT. Start it with sdcpp-server-start.sh."
  fi

  SERVER_OUT="$RUN_DIR/server-generate.stdout.log"
  SERVER_ARGS=(--api "$ARG_API" --prompt "$ARG_PROMPT" --width "$ARG_WIDTH" --height "$ARG_HEIGHT" --steps "$ARG_STEPS" --cfg "$ARG_CFG" --sampler "${TARGET_SAMPLER:-euler_a}" --warm-state warm)
  if [ -n "$ARG_NEG" ]; then SERVER_ARGS+=(--negative "$ARG_NEG"); fi
  if [ -n "$ARG_SEED" ]; then SERVER_ARGS+=(--seed "$ARG_SEED"); fi
  if [ -n "$ARG_SCHEDULER" ]; then SERVER_ARGS+=(--scheduler "$ARG_SCHEDULER"); fi
  if [ -n "$ARG_VAE" ]; then SERVER_ARGS+=(--vae "$ARG_VAE"); fi

  if ! "$HERE/sdcpp-server-generate.sh" "${SERVER_ARGS[@]}" > "$SERVER_OUT" 2>&1; then
    FIRST_FAILED_GATE="server-generate"
    cp "$SERVER_OUT" "$RUN_DIR/server-generate-failure.log" 2>/dev/null || true
    controlled_write_artifacts "FAIL"
    tail -80 "$SERVER_OUT" >&2 || true
    fail "server-generate" "SD1.5 server-tunnel generation failed via $BASE. See $SERVER_OUT"
  fi

  SERVER_RUN_DIR="$(awk -F'Run dir: ' '/Run dir:/ {print $2}' "$SERVER_OUT" | tail -n 1 | tr -d '\r')"
  if [ -z "$SERVER_RUN_DIR" ] || [ ! -d "$SERVER_RUN_DIR" ]; then
    controlled_fail "server-run-dir" "Could not identify server-generate run dir from $SERVER_OUT."
  fi

  SERVER_PNG=""
  for cand in openai.png sdapi.png native.png; do
    if [ -s "$SERVER_RUN_DIR/$cand" ]; then
      SERVER_PNG="$SERVER_RUN_DIR/$cand"
      break
    fi
  done
  if [ -z "$SERVER_PNG" ]; then
    controlled_fail "server-png" "No verified server PNG found in $SERVER_RUN_DIR."
  fi

  cp "$SERVER_PNG" "$LOCAL_PNG" || controlled_fail "server-png-copy" "Could not copy $SERVER_PNG to $LOCAL_PNG."
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    strip_png_metadata "$LOCAL_PNG" || controlled_fail "png-redact" "Could not strip PNG metadata from $LOCAL_PNG"
  fi
  verify_png "$LOCAL_PNG" "Controlled SD1.5 server PNG"
  RUN_STATUS="PASS"
  RUNTIME_CONTROLLED_PROVEN="true"
  controlled_write_artifacts "PASS"

  pass_banner "CONTROLLED GENERATE PASS ($ARG_TARGET via server tunnel, seed=$SEED_LABEL).
Target:  $TARGET_LABEL
API:     $ARG_API
Base:    $BASE
Run:     $RUN_DIR
PNG:     $LOCAL_PNG
Source:  $SERVER_RUN_DIR
Report:  $REPORT
Manifest: $MANIFEST"
  exit 0
fi

verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
SDCLI="$BUILD_DIR/bin/sd-cli"
ensure_remote_dirs
REMOTE_STDOUT_CMD=""
Q_PROMPT="$(printf '%q' "$ARG_PROMPT")"
Q_NEG="$(printf '%q' "$ARG_NEG")"
TARGET_HELP_OUTPUT="$(ssh_remote "if [ -x \"$SDCLI\" ]; then \"$SDCLI\" --help 2>&1; fi" 2>&1 || true)"
printf '%s\n' "$TARGET_HELP_OUTPUT" > "$RUN_DIR/sd-cli-help.log"

SCHEDULER_FLAG=""
if [ -n "$ARG_SCHEDULER" ] && printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--scheduler'; then
  SCHEDULER_FLAG="--scheduler $ARG_SCHEDULER"
fi

VAE_FLAG=""
if [ -n "$ARG_VAE" ] && printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--vae'; then
  VAE_FLAG="--vae $ARG_VAE"
fi

LORA_DIR_FLAG=""
BACKEND_FLAG=""
if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--lora-model-dir'; then
  LORA_DIR_FLAG="--lora-model-dir /Volumes/wc2tb/ImageGen/loras"
  if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--lora-apply-mode'; then
    LORA_DIR_FLAG="$LORA_DIR_FLAG --lora-apply-mode immediately"
  fi
  if printf '%s' "$ARG_PROMPT" | grep -qE '<lora:[^>]+>'; then
    if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--backend'; then
      BACKEND_FLAG="--backend cpu"
    fi
  fi
fi

case "$ARG_TARGET" in
  sd15)
    REMOTE_MODEL_BYTES="$(verify_model)"
    if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--cfg-scale'; then
      CFG_FLAG="--cfg-scale $ARG_CFG"
    fi
    REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$REMOTE_MODEL\" -p $Q_PROMPT -n $Q_NEG -W $ARG_WIDTH -H $ARG_HEIGHT --steps $ARG_STEPS ${CFG_FLAG:-} --sampling-method ${TARGET_SAMPLER:-euler_a} $SEED_FRAG ${SCHEDULER_FLAG:-} ${VAE_FLAG:-} ${LORA_DIR_FLAG:-} ${BACKEND_FLAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\""
    ;;
  sdxl-base)
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl/sd_xl_base_1.0.safetensors"
    remote_test "test -s \"$TARGET_MODEL_PATH\"" || controlled_fail "model-present" "SDXL base checkpoint is missing or empty: $TARGET_MODEL_PATH"
    REMOTE_MODEL_BYTES="$(ssh_remote "stat -f %z \"$TARGET_MODEL_PATH\" 2>/dev/null || wc -c < \"$TARGET_MODEL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    case "$REMOTE_MODEL_BYTES" in ''|*[!0-9]*) controlled_fail "model-size" "Could not read a numeric size for $TARGET_MODEL_PATH." ;; esac
    if [ "$REMOTE_MODEL_BYTES" -lt $((1024 * 1024 * 1024)) ]; then
      controlled_fail "model-size" "SDXL base checkpoint is too small (${REMOTE_MODEL_BYTES} bytes; need at least 1073741824)."
    fi
    for flag in '--model' '--prompt' '--output' '--width' '--height' '--steps'; do
      printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- "$flag" || controlled_fail "sd-cli-help" "sd-cli help does not show required flag $flag."
    done
    if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--cfg-scale'; then
      CFG_FLAG="--cfg-scale $ARG_CFG"
    fi
    REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$TARGET_MODEL_PATH\" -p $Q_PROMPT -n $Q_NEG -W $ARG_WIDTH -H $ARG_HEIGHT --steps $ARG_STEPS ${CFG_FLAG:-} $SEED_FRAG ${SCHEDULER_FLAG:-} ${VAE_FLAG:-} ${LORA_DIR_FLAG:-} ${BACKEND_FLAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\""
    ;;
  sdxl-turbo)
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors"
    remote_test "test -s \"$TARGET_MODEL_PATH\"" || controlled_fail "model-present" "SDXL Turbo checkpoint is missing or empty: $TARGET_MODEL_PATH"
    REMOTE_MODEL_BYTES="$(ssh_remote "stat -f %z \"$TARGET_MODEL_PATH\" 2>/dev/null || wc -c < \"$TARGET_MODEL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    case "$REMOTE_MODEL_BYTES" in ''|*[!0-9]*) controlled_fail "model-size" "Could not read a numeric size for $TARGET_MODEL_PATH." ;; esac
    if [ "$REMOTE_MODEL_BYTES" -lt $((1024 * 1024 * 1024)) ]; then
      controlled_fail "model-size" "SDXL Turbo checkpoint is too small (${REMOTE_MODEL_BYTES} bytes; need at least 1073741824)."
    fi
    for flag in '--model' '--prompt' '--output' '--width' '--height' '--steps' '--cfg-scale' '--guidance' '--prediction'; do
      printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- "$flag" || controlled_fail "sd-cli-help" "sd-cli help does not show required flag $flag."
    done
    REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$TARGET_MODEL_PATH\" -p $Q_PROMPT -n $Q_NEG -W $ARG_WIDTH -H $ARG_HEIGHT --steps $ARG_STEPS --cfg-scale 0 --guidance 0 --prediction eps $SEED_FRAG ${SCHEDULER_FLAG:-} ${VAE_FLAG:-} ${LORA_DIR_FLAG:-} ${BACKEND_FLAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\""
    ;;
  flux-fp8)
    TARGET_MODEL_PATH="$MODEL_STAGE_ROOT/flux/flux1-schnell/flux1-schnell-fp8.safetensors"
    TARGET_VAE_PATH="$MODEL_STAGE_ROOT/flux/shared/ae.safetensors"
    TARGET_CLIP_L_PATH="$MODEL_STAGE_ROOT/flux/shared/clip_l.safetensors"
    TARGET_T5XXL_PATH="$MODEL_STAGE_ROOT/flux/shared/t5xxl_fp16.safetensors"
    remote_test "test -s \"$TARGET_MODEL_PATH\"" || controlled_fail "model-present" "Flux model is missing or empty: $TARGET_MODEL_PATH"
    remote_test "test -s \"$TARGET_VAE_PATH\"" || controlled_fail "vae-present" "Flux VAE is missing or empty: $TARGET_VAE_PATH"
    remote_test "test -s \"$TARGET_CLIP_L_PATH\"" || controlled_fail "clip-present" "Flux CLIP-L is missing or empty: $TARGET_CLIP_L_PATH"
    remote_test "test -s \"$TARGET_T5XXL_PATH\"" || controlled_fail "t5-present" "Flux T5XXL is missing or empty: $TARGET_T5XXL_PATH"
    REMOTE_MODEL_BYTES="$(ssh_remote "stat -f %z \"$TARGET_MODEL_PATH\" 2>/dev/null || wc -c < \"$TARGET_MODEL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    REMOTE_VAE_BYTES="$(ssh_remote "stat -f %z \"$TARGET_VAE_PATH\" 2>/dev/null || wc -c < \"$TARGET_VAE_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    REMOTE_CLIP_BYTES="$(ssh_remote "stat -f %z \"$TARGET_CLIP_L_PATH\" 2>/dev/null || wc -c < \"$TARGET_CLIP_L_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    REMOTE_T5XXL_BYTES="$(ssh_remote "stat -f %z \"$TARGET_T5XXL_PATH\" 2>/dev/null || wc -c < \"$TARGET_T5XXL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    for kind in model vae clip_l t5xxl; do
      case "$kind" in
        model) bytes="$REMOTE_MODEL_BYTES" ;;
        vae) bytes="$REMOTE_VAE_BYTES" ;;
        clip_l) bytes="$REMOTE_CLIP_BYTES" ;;
        t5xxl) bytes="$REMOTE_T5XXL_BYTES" ;;
      esac
      case "$bytes" in ''|*[!0-9]*) controlled_fail "size-$kind" "Could not read a numeric size for $kind file." ;; esac
    done
    if [ "$REMOTE_MODEL_BYTES" -lt $((1024 * 1024 * 1024)) ]; then
      controlled_fail "model-size" "Flux model is too small (${REMOTE_MODEL_BYTES} bytes; need at least 1073741824)."
    fi
    if [ "$REMOTE_VAE_BYTES" -lt $((1024 * 1024)) ]; then
      controlled_fail "vae-size" "Flux VAE is too small (${REMOTE_VAE_BYTES} bytes; need at least 1048576)."
    fi
    if [ "$REMOTE_CLIP_BYTES" -lt $((1024 * 1024)) ]; then
      controlled_fail "clip-size" "Flux CLIP-L is too small (${REMOTE_CLIP_BYTES} bytes; need at least 1048576)."
    fi
    if [ "$REMOTE_T5XXL_BYTES" -lt $((1024 * 1024 * 1024)) ]; then
      controlled_fail "t5-size" "Flux T5XXL is too small (${REMOTE_T5XXL_BYTES} bytes; need at least 1073741824)."
    fi
    for flag in '--model' '--clip_l' '--t5xxl' '--vae' '--output' '--width' '--height' '--steps' '--guidance' '--prediction' '--vae-format'; do
      printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- "$flag" || controlled_fail "sd-cli-help" "sd-cli help does not show required flag $flag."
    done
    REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$TARGET_MODEL_PATH\" --clip_l \"$TARGET_CLIP_L_PATH\" --t5xxl \"$TARGET_T5XXL_PATH\" --vae \"${ARG_VAE:-$TARGET_VAE_PATH}\" --vae-format flux -p $Q_PROMPT -n $Q_NEG -W $ARG_WIDTH -H $ARG_HEIGHT --steps $ARG_STEPS --guidance 3.5 --prediction flux_flow --sampling-method euler $SEED_FRAG ${SCHEDULER_FLAG:-} ${LORA_DIR_FLAG:-} ${BACKEND_FLAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\""
    ;;
  *)
    # Generic handler for all staged models (TARGET_STATUS=staged).
    # Adding a new staged model only requires an entry in the first case block above
    # and a matching entry in CONTROLLED_TARGETS in server.js — no changes here.
    if [ "$TARGET_STATUS" != "staged" ] || [ -z "$TARGET_MODEL_PATH" ]; then
      controlled_fail "command" "Unknown or unsupported generation target: $ARG_TARGET"
    fi
    remote_test "test -s \"$TARGET_MODEL_PATH\"" || controlled_fail "model-present" "$TARGET_LABEL checkpoint is missing or empty: $TARGET_MODEL_PATH"
    REMOTE_MODEL_BYTES="$(ssh_remote "stat -f %z \"$TARGET_MODEL_PATH\" 2>/dev/null || wc -c < \"$TARGET_MODEL_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    case "$REMOTE_MODEL_BYTES" in ''|*[!0-9]*) controlled_fail "model-size" "Could not read a numeric size for $TARGET_MODEL_PATH." ;; esac
    # SDXL models need at least 1 GB; SD1.5 models need at least 512 MB.
    case "$ARG_TARGET" in
      sd15-*) _STAGED_MIN_BYTES=$((512 * 1024 * 1024)) ;;
      *)      _STAGED_MIN_BYTES=$((1024 * 1024 * 1024)) ;;
    esac
    if [ "$REMOTE_MODEL_BYTES" -lt "$_STAGED_MIN_BYTES" ]; then
      controlled_fail "model-size" "$TARGET_LABEL checkpoint is too small (${REMOTE_MODEL_BYTES} bytes; need at least ${_STAGED_MIN_BYTES})."
    fi
    if [ -n "$TARGET_VAE_PATH" ]; then
      remote_test "test -s \"$TARGET_VAE_PATH\"" || controlled_fail "vae-present" "$TARGET_LABEL VAE is missing or empty: $TARGET_VAE_PATH"
      REMOTE_VAE_BYTES="$(ssh_remote "stat -f %z \"$TARGET_VAE_PATH\" 2>/dev/null || wc -c < \"$TARGET_VAE_PATH\" 2>/dev/null || printf '0'" 2>&1 | tail -n 1 | tr -d '[:space:]')"
    fi
    for flag in '--model' '--prompt' '--output' '--width' '--height' '--steps'; do
      printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- "$flag" || controlled_fail "sd-cli-help" "sd-cli help does not show required flag $flag."
    done
    if printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--cfg-scale'; then
      CFG_FLAG="--cfg-scale $ARG_CFG"
    fi
    SAMPLER_FRAG=""
    if [ -n "$TARGET_SAMPLER" ] && printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--sampling-method'; then
      SAMPLER_FRAG="--sampling-method $TARGET_SAMPLER"
    fi
    BUILT_VAE_FLAG=""
    if [ -n "$TARGET_VAE_PATH" ] && printf '%s\n' "$TARGET_HELP_OUTPUT" | grep -q -- '--vae'; then
      BUILT_VAE_FLAG="--vae \"$TARGET_VAE_PATH\""
    fi
    REMOTE_STDOUT_CMD="\"$SDCLI\" -m \"$TARGET_MODEL_PATH\" -p $Q_PROMPT -n $Q_NEG -W $ARG_WIDTH -H $ARG_HEIGHT --steps $ARG_STEPS ${CFG_FLAG:-} ${SAMPLER_FRAG:-} $SEED_FRAG ${SCHEDULER_FLAG:-} ${BUILT_VAE_FLAG:-} ${VAE_FLAG:-} ${LORA_DIR_FLAG:-} ${BACKEND_FLAG:-} --diffusion-fa -o \"$REMOTE_PNG\" -v 2>&1 | tee \"$REMOTE_LOG\""
    ;;
esac

if [ -z "$REMOTE_STDOUT_CMD" ]; then
  controlled_fail "command" "Could not build a controlled generation command."
fi

log "Running controlled generation on BigMac"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  ssh_remote "mkdir -p \"$REMOTE_RUN_DIR\" && $REMOTE_STDOUT_CMD" 2>&1 | python3 -c "
import sys, re
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
# sd-cli strips <lora:...> tags before logging; also search for the stripped form.
p_stripped = re.sub(r'<lora:[^>]*>', '', p).rstrip()
tok_re = re.compile(r'(to tokens\s*)\[.*\]')
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if p_stripped and p_stripped != p and p_stripped in line: line = line.replace(p_stripped, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    if 'to tokens' in line or 'bpe_tokenizer' in line:
        line = tok_re.sub(r'\1[REDACTED]', line)
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$REMOTE_STDOUT_LOG" || true
else
  ssh_remote "mkdir -p \"$REMOTE_RUN_DIR\" && $REMOTE_STDOUT_CMD" > "$REMOTE_STDOUT_LOG" 2>&1 || true
fi

REMOTE_ELAPSED="$(extract_remote_elapsed "$REMOTE_LOG")"
[ -n "$REMOTE_ELAPSED" ] || REMOTE_ELAPSED="n/a"

if ! remote_test "test -s \"$REMOTE_PNG\" && file \"$REMOTE_PNG\" | grep -q 'PNG image data'"; then
  controlled_fail "remote-png" "Remote PNG missing or invalid: $REMOTE_PNG"
fi

REMOTE_PNG_ABS="$(remote_eval_path "$REMOTE_PNG")"
scp "$SSH_TARGET:$REMOTE_PNG_ABS" "$LOCAL_PNG" >/dev/null 2>&1 || controlled_fail "scp" "Could not copy remote PNG to $LOCAL_PNG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  strip_png_metadata "$LOCAL_PNG" || controlled_fail "png-redact" "Could not strip PNG metadata from $LOCAL_PNG"
fi
verify_png "$LOCAL_PNG" "Controlled PNG"
RUN_STATUS="PASS"

controlled_write_artifacts "PASS"

pass_banner "CONTROLLED GENERATE PASS ($ARG_TARGET, seed=$SEED_LABEL).
Target:  $TARGET_LABEL
Run:     $RUN_DIR
PNG:     $LOCAL_PNG
Report:  $REPORT
Manifest: $MANIFEST"
exit 0
