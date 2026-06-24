#!/usr/bin/env bash
# sdcpp-batch-generate.sh — generate N images with controlled seeds, verify each,
# and emit a stable batch run folder (manifest JSON/TSV + per-image records +
# UI run card) for later UI wiring. Reuses sdcpp-cli-generate.sh /
# sdcpp-server-generate.sh per image (so all safety/verify/seed logic is shared).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

MODE="cli"               # cli | server
COUNT=3
PRESET="fast"
ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
SEED_EXPLICIT=""         # --seed N (sets the base seed)
SEED_START=42            # --seed-start N
SEED_MODE="increment"    # same | increment | random
API="openai"             # server mode endpoint
KEEP=0
OPEN=0
FORCE_LARGE=0
MAX_COUNT=12
ARG_SCHEDULER=""
ARG_STEPS=""
ARG_WIDTH=""
ARG_HEIGHT=""
ARG_CFG=""
ARG_SAMPLER=""
ARG_VAE=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --mode cli|server          (default cli)
  --count N                  number of images (default 3, hard cap $MAX_COUNT)
  --preset NAME              smoke|thumbnail|fast|balanced|quality|quality_plus (default fast)
  --prompt "..."             prompt
  --negative "..."           negative
  --seed N                   base seed (overrides --seed-start)
  --seed-start N             starting seed (default 42)
  --seed-mode same|increment|random   (default increment)
  --api openai|sdapi|native  (server mode; default openai)
  --scheduler NAME           forward scheduler to child generators (discrete, karras, etc.)
  --steps N                  steps
  --width N                  width
  --height N                 height
  --cfg N                    cfg scale
  --sampler NAME             sampler
  --vae PATH                 vae path
  --keep-server-running      (server mode) leave server up after
  --open                     open the first image when done
  --force-large-batch        allow count > $MAX_COUNT
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:?}"; shift 2 ;;
    --count) COUNT="${2:?}"; shift 2 ;;
    --preset) PRESET="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --seed) SEED_EXPLICIT="${2:?}"; shift 2 ;;
    --seed-start) SEED_START="${2:?}"; shift 2 ;;
    --seed-mode) SEED_MODE="${2:?}"; shift 2 ;;
    --api) API="${2:?}"; shift 2 ;;
    --scheduler) ARG_SCHEDULER="${2:?}"; shift 2 ;;
    --steps) ARG_STEPS="${2:?}"; shift 2 ;;
    --width) ARG_WIDTH="${2:?}"; shift 2 ;;
    --height) ARG_HEIGHT="${2:?}"; shift 2 ;;
    --cfg|--cfg-scale) ARG_CFG="${2:?}"; shift 2 ;;
    --sampler) ARG_SAMPLER="${2:?}"; shift 2 ;;
    --vae) ARG_VAE="${2:?}"; shift 2 ;;
    --keep-server-running) KEEP=1; shift ;;
    --open) OPEN=1; shift ;;
    --force-large-batch) FORCE_LARGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

case "$MODE" in cli|server) : ;; *) fail "args" "--mode must be cli|server" ;; esac
case "$SEED_MODE" in same|increment|random) : ;; *) fail "args" "--seed-mode must be same|increment|random" ;; esac
case "$API" in openai|sdapi|native) : ;; *) fail "args" "--api must be openai|sdapi|native" ;; esac
case "$COUNT" in ''|*[!0-9]*) fail "args" "--count must be a positive integer" ;; esac
[ "$COUNT" -ge 1 ] || fail "args" "--count must be >= 1"
if [ "$COUNT" -gt "$MAX_COUNT" ] && [ "$FORCE_LARGE" -ne 1 ]; then
  fail "batch-cap" "--count $COUNT exceeds cap $MAX_COUNT; pass --force-large-batch to override."
fi

# base seed: --seed overrides --seed-start
BASE_SEED="$SEED_START"
[ -n "$SEED_EXPLICIT" ] && BASE_SEED="$SEED_EXPLICIT"
case "$BASE_SEED" in ''|*[!0-9-]*) fail "args" "seed must be an integer (got '$BASE_SEED')" ;; esac

# Deterministic-server warning: openai is indirect; sdapi/native pass seed directly.
if [ "$MODE" = "server" ] && [ "$SEED_MODE" != "random" ] && [ "$API" = "openai" ]; then
  log "NOTE: deterministic server batch via OpenAI uses the <sd_cpp_extra_args> seed path; SDAPI/native pass seed more directly. Proceeding."
fi

# ----- run folder ------------------------------------------------------------
RUN_DIR="$(make_run_dir batch)"
mkdir -p "$RUN_DIR/images" "$RUN_DIR/records" "$RUN_DIR/logs" "$RUN_DIR/responses" "$RUN_DIR/cells"
SDCPP_LOGFILE="$RUN_DIR/logs/batch.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/batch-report.md"
MANIFEST_JSON="$RUN_DIR/batch-manifest.json"
MANIFEST_TSV="$RUN_DIR/batch-manifest.tsv"
NDJSON="$RUN_DIR/.images.ndjson"
RUN_ID="$(basename "$RUN_DIR")"

REPORT_PROMPT="$ARG_PROMPT"
REPORT_NEGATIVE_PROMPT="$ARG_NEG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  REPORT_PROMPT="[REDACTED]"
  REPORT_NEGATIVE_PROMPT="[REDACTED]"
fi
CREATED_AT="$(iso_now)"
START_EPOCH="$(now_epoch)"
: > "$NDJSON"

# resolve preset values once for the manifest header
apply_preset "$PRESET" >/dev/null
B_W="$PRESET_W"; B_H="$PRESET_H"; B_STEPS="$PRESET_STEPS"; B_CFG="$PRESET_CFG"; B_SAMPLER="$PRESET_SAMPLER"

log "=== Batch: mode=$MODE count=$COUNT preset=$PRESET seed-mode=$SEED_MODE base=$BASE_SEED api=$API ==="
log "=== verify ==="
"$HERE/sdcpp-verify.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "verify" "verify failed; see $SDCPP_LOGFILE"

printf 'index\tseed\tstatus\tmode\tapi\tpreset\twidth\theight\tsteps\tcfg_scale\tsampler\telapsed_seconds\tpng_bytes\tsha256\tpng_path\trecord_md\n' > "$MANIFEST_TSV"

SERVER_STARTED=0
cleanup() {
  if [ "$SERVER_STARTED" -eq 1 ] && [ "$KEEP" -ne 1 ]; then
    "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1 || log "WARN: server stop non-zero"
    SERVER_STARTED=0
  fi
}
trap 'cleanup' EXIT INT TERM

if [ "$MODE" = "server" ]; then
  log "=== starting warm server once ==="
  "$HERE/sdcpp-server-start.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "server-start" "server start failed; see $SDCPP_LOGFILE"
  SERVER_STARTED=1
fi

# server-mode primary png name per api
api_png() { case "$1" in openai) echo openai.png;; sdapi) echo sdapi.png;; native) echo native.png;; esac; }

SUCCEEDED=0
FIRST_PNG=""
i=1
while [ "$i" -le "$COUNT" ]; do
  idx="$(printf '%03d' "$i")"
  case "$SEED_MODE" in
    same)      seed="$BASE_SEED" ;;
    increment) seed="$((BASE_SEED + i - 1))" ;;
    random)    seed="$(gen_random_seed)" ;;
  esac
  cell="$RUN_DIR/cells/image-$idx"
  mkdir -p "$cell"
  log "--- image $idx seed=$seed ---"

  extra_args=()
  [ -n "$ARG_SCHEDULER" ] && extra_args+=("--scheduler" "$ARG_SCHEDULER")
  [ -n "$ARG_STEPS" ]     && extra_args+=("--steps"     "$ARG_STEPS")
  [ -n "$ARG_WIDTH" ]     && extra_args+=("--width"     "$ARG_WIDTH")
  [ -n "$ARG_HEIGHT" ]    && extra_args+=("--height"    "$ARG_HEIGHT")
  [ -n "$ARG_CFG" ]       && extra_args+=("--cfg"       "$ARG_CFG")
  [ -n "$ARG_SAMPLER" ]   && extra_args+=("--sampler"   "$ARG_SAMPLER")
  [ -n "$ARG_VAE" ]       && extra_args+=("--vae"       "$ARG_VAE")

  if [ "$MODE" = "cli" ]; then
    SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-cli-generate.sh" \
      --preset "$PRESET" --seed "$seed" --prompt "$ARG_PROMPT" --negative "$ARG_NEG" \
      "${extra_args[@]}" \
      >"$cell/stdout.log" 2>&1 || true
    src_png="$(ls "$cell"/*.png 2>/dev/null | head -1 || true)"
    api_field="null"
  else
    SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-server-generate.sh" \
      --preset "$PRESET" --api "$API" --seed "$seed" --warm-state warm \
      --prompt "$ARG_PROMPT" --negative "$ARG_NEG" \
      "${extra_args[@]}" \
      >"$cell/stdout.log" 2>&1 || true
    src_png="$cell/$(api_png "$API")"
    api_field="\"$API\""
  fi

  # harvest metrics row (canonical metrics_header order)
  m="$cell/metrics.tsv"
  status="FAIL"; elapsed="n/a"; remote_el="n/a"; bytes="0"; sum=""; mline=""
  if [ -f "$m" ] && [ "$(wc -l < "$m" | tr -d ' ')" -ge 2 ]; then
    mline="$(tail -1 "$m")"
    elapsed="$(printf '%s' "$mline" | cut -f19)"
    remote_el="$(printf '%s' "$mline" | cut -f20)"
    status="$(printf '%s' "$mline" | cut -f29)"
  fi

  dest_png="$RUN_DIR/images/image-$idx.png"
  record_md="$RUN_DIR/records/image-$idx.md"
  png_rel="images/image-$idx.png"
  record_rel="records/image-$idx.md"

  if [ -n "$src_png" ] && [ -f "$src_png" ] && verify_png "$src_png" "batch image $idx" >/dev/null 2>&1; then
    cp "$src_png" "$dest_png"
    bytes="$(png_bytes "$dest_png")"
    sum="$(local_sha256 "$dest_png")"
    status="PASS"
    SUCCEEDED=$((SUCCEEDED + 1))
    [ -z "$FIRST_PNG" ] && FIRST_PNG="$dest_png"
  else
    status="FAIL"
    png_rel=""
    log "image $idx FAILED (see cells/image-$idx/stdout.log)"
  fi
  # copy any response json/log for traceability
  cp "$cell"/*.json "$RUN_DIR/responses/" 2>/dev/null || true
  cp "$cell/stdout.log" "$RUN_DIR/logs/image-$idx.log" 2>/dev/null || true

  file_out="$([ -n "$png_rel" ] && file "$dest_png" | sed 's|^[^:]*: ||' || echo '')"

  # per-image record markdown (schema sdcpp.image.v1)
  {
    echo "---"
    echo "schema: sdcpp.image.v1"
    echo "run_id: \"$RUN_ID\""
    echo "index: $i"
    echo "status: \"$status\""
    echo "mode: \"$MODE\""
    echo "api: $([ "$MODE" = server ] && echo "\"$API\"" || echo null)"
    echo "preset: \"$PRESET\""
    echo "seed: $seed"
    echo "width: $B_W"
    echo "height: $B_H"
    echo "steps: $B_STEPS"
    echo "cfg_scale: $B_CFG"
    echo "sampler: \"$B_SAMPLER\""
    echo "png_path: \"$png_rel\""
    echo "bytes: ${bytes:-0}"
    echo "sha256: \"$sum\""
    echo "elapsed_seconds: \"$elapsed\""
    echo "created_at: \"$(iso_now)\""
    echo "---"
    echo
    echo "# Image $idx"
    echo
    if [ -n "$png_rel" ]; then echo "![image $idx](../$png_rel)"; else echo "(no image — FAILED)"; fi
    echo
    echo "- Status: $status"
    echo "- Seed: $seed"
    echo "- Prompt: $REPORT_PROMPT"
    echo "- Negative: $REPORT_NEGATIVE_PROMPT"
    echo "- Settings: ${B_W}x${B_H} steps=$B_STEPS cfg=$B_CFG sampler=$B_SAMPLER"
    echo "- Mode: $MODE${API:+ / api=$API}"
    echo "- Verification: ${file_out:-n/a}"
    echo "- Bytes: ${bytes:-0}  sha256: ${sum:-n/a}"
    echo "- Paths: png=\`$png_rel\` record=\`$record_rel\`"
  } > "$record_md"

  # manifest rows
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$i" "$seed" "$status" "$MODE" "$([ "$MODE" = server ] && echo "$API" || echo "-")" "$PRESET" \
    "$B_W" "$B_H" "$B_STEPS" "$B_CFG" "$B_SAMPLER" "$elapsed" "${bytes:-0}" "$sum" "$png_rel" "$record_rel" \
    >> "$MANIFEST_TSV"

  jq -nc \
    --argjson index "$i" --argjson seed "$seed" --arg status "$status" --arg mode "$MODE" \
    --argjson api "$([ "$MODE" = server ] && printf '"%s"' "$API" || echo null)" \
    --arg preset "$PRESET" --argjson w "$B_W" --argjson h "$B_H" --argjson st "$B_STEPS" \
    --argjson cfg "$B_CFG" --arg sm "$B_SAMPLER" --arg png "$png_rel" --arg rec "$record_rel" \
    --arg fout "$file_out" --argjson bytes "${bytes:-0}" --arg sum "$sum" --arg el "$elapsed" \
    '{index:$index, seed:$seed, status:$status, mode:$mode, api:$api, preset:$preset,
      width:$w, height:$h, steps:$st, cfg_scale:$cfg, sampler:$sm,
      png_path:(if $png=="" then null else $png end), record_md:$rec,
      file_output:$fout, bytes:$bytes, sha256:$sum, elapsed_seconds:$el}' >> "$NDJSON"

  i=$((i + 1))
done

# stop server unless keeping
KEEP_NOTE="not_applicable"
if [ "$MODE" = "server" ]; then
  if [ "$KEEP" -eq 1 ]; then
    KEEP_NOTE="server_left_running"
    trap - EXIT INT TERM
  else
    cleanup; trap - EXIT INT TERM
    KEEP_NOTE="stopped"
  fi
fi

END_EPOCH="$(now_epoch)"
TOTAL_ELAPSED="$(elapsed_seconds "$START_EPOCH" "$END_EPOCH")"
STATUS="PASS"; FIRST_FAILED="null"
if [ "$SUCCEEDED" -lt "$COUNT" ]; then STATUS="PARTIAL"; FIRST_FAILED="\"image-generation\""; fi
[ "$SUCCEEDED" -eq 0 ] && STATUS="FAIL"
PRIMARY_REL="$([ -n "$FIRST_PNG" ] && echo "images/$(basename "$FIRST_PNG")" || echo "")"

# ----- batch-manifest.json ---------------------------------------------------
jq -n \
  --arg schema "sdcpp.run.v1" --arg run_id "$RUN_ID" --arg status "$STATUS" --arg run_type "batch" \
  --arg mode "$MODE" --arg preset "$PRESET" --arg prompt "$REPORT_PROMPT" --arg neg "$REPORT_NEGATIVE_PROMPT" \
  --argjson w "$B_W" --argjson h "$B_H" --argjson st "$B_STEPS" --argjson cfg "$B_CFG" --arg sm "$B_SAMPLER" \
  --arg seed_mode "$SEED_MODE" --argjson seed_start "$BASE_SEED" \
  --argjson count_req "$COUNT" --argjson count_ok "$SUCCEEDED" \
  --arg created "$CREATED_AT" --arg completed "$(iso_now)" --arg elapsed "$TOTAL_ELAPSED" \
  --argjson server_used "$([ "$MODE" = server ] && echo true || echo false)" \
  --arg cleanup "$KEEP_NOTE" --argjson first_failed "$FIRST_FAILED" \
  --arg api "$([ "$MODE" = server ] && echo "$API" || echo "")" \
  --slurpfile images "$NDJSON" \
  '{schema:$schema, run_id:$run_id, status:$status, run_type:$run_type, mode:$mode,
    api:(if $api=="" then null else $api end), preset:$preset, prompt:$prompt, negative_prompt:$neg,
    width:$w, height:$h, steps:$st, cfg_scale:$cfg, sampler:$sm,
    seed_mode:$seed_mode, seed_start:$seed_start,
    count_requested:$count_req, count_succeeded:$count_ok,
    created_at:$created, completed_at:$completed, elapsed_seconds:$elapsed,
    server_used:$server_used, cleanup_state:$cleanup, first_failed_gate:$first_failed,
    images:$images}' > "$MANIFEST_JSON"

# ----- batch-report.md -------------------------------------------------------
{
  echo "---"
  echo "schema: sdcpp.run.v1"
  echo "run_id: \"$RUN_ID\""
  echo "run_type: \"batch\""
  echo "status: \"$STATUS\""
  echo "created_at: \"$CREATED_AT\""
  echo "mode: \"$MODE\""
  echo "preset: \"$PRESET\""
  echo "prompt: \"$(yaml_escape "$REPORT_PROMPT")\""
  echo "negative_prompt: \"$(yaml_escape "$REPORT_NEGATIVE_PROMPT")\""
  echo "count: $COUNT"
  echo "verified_png_count: $SUCCEEDED"
  echo "seed_mode: \"$SEED_MODE\""
  echo "seed_start: $BASE_SEED"
  echo "manifest_json: \"batch-manifest.json\""
  echo "manifest_tsv: \"batch-manifest.tsv\""
  echo "primary_image: \"$PRIMARY_REL\""
  echo "cleanup_state: \"$KEEP_NOTE\""
  echo "first_failed_gate: $([ "$FIRST_FAILED" = null ] && echo null || echo "$FIRST_FAILED")"
  echo "---"
  echo
  echo "# SDCPP Batch Report"
  echo
  echo "## Status"
  echo "$STATUS ($SUCCEEDED/$COUNT verified)"
  echo
  echo "## Settings"
  echo "- mode: $MODE$([ "$MODE" = server ] && echo " (api=$API)")"
  echo "- preset: $PRESET (${B_W}x${B_H} steps=$B_STEPS cfg=$B_CFG sampler=$B_SAMPLER)"
  echo "- seed-mode: $SEED_MODE, base seed: $BASE_SEED"
  echo "- prompt: $REPORT_PROMPT"
  echo "- negative: $REPORT_NEGATIVE_PROMPT"
  echo "- elapsed: ${TOTAL_ELAPSED}s"
  echo "- cleanup: $KEEP_NOTE"
  echo
  echo "## Images"
  echo "| index | seed | status | bytes | png |"
  echo "|-------|------|--------|-------|-----|"
  awk -F'\t' 'NR>1 {printf "| %s | %s | %s | %s | %s |\n",$1,$2,$3,$13,$15}' "$MANIFEST_TSV"
  echo
  if [ "$SUCCEEDED" -lt "$COUNT" ]; then
    echo "## Failures"
    awk -F'\t' 'NR>1 && $3!="PASS" {printf "- image %s (seed %s): see logs/image-%03d.log\n",$1,$2,$1}' "$MANIFEST_TSV"
    echo
  fi
  echo "## Outputs"
  echo "- images/  · records/  · responses/  · logs/"
  echo "- batch-manifest.json · batch-manifest.tsv · ui-run-card.md"
  echo
  echo "## Next action"
  echo "- View grid from \`images/\`; parse \`batch-manifest.json\`."
  [ "$KEEP_NOTE" = "server_left_running" ] && echo "- SERVER LEFT RUNNING — stop with: bin/sdcpp-server-stop.sh"
} > "$REPORT"

# ----- ui-run-card.md --------------------------------------------------------
write_ui_run_card "$RUN_DIR" "batch" "$STATUS" "$PRIMARY_REL" "batch-manifest.json" \
  "$REPORT_PROMPT" \
  "mode=$MODE preset=$PRESET count=$SUCCEEDED/$COUNT seed-mode=$SEED_MODE base=$BASE_SEED elapsed=${TOTAL_ELAPSED}s" \
  "$CREATED_AT" >/dev/null

rm -f "$NDJSON" 2>/dev/null || true

# ----- final --------------------------------------------------------------
if [ -n "$PRIMARY_REL" ] && [ "$OPEN" -eq 1 ] && command -v open >/dev/null 2>&1; then
  open "$RUN_DIR/$PRIMARY_REL" || true
fi

if [ "$STATUS" = "PASS" ]; then
  pass_banner "BATCH PASS ($SUCCEEDED/$COUNT verified).
Run dir:  $RUN_DIR
Manifest: $MANIFEST_JSON
Report:   $REPORT
UI card:  $RUN_DIR/ui-run-card.md
Cleanup:  $KEEP_NOTE"
  exit 0
fi
printf '\n==== BATCH %s ====\n%s/%s verified. Report: %s\n' "$STATUS" "$SUCCEEDED" "$COUNT" "$REPORT" >&2
[ "$STATUS" = "FAIL" ] && exit 1
exit 0
