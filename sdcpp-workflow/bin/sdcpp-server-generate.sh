#!/usr/bin/env bash
# sdcpp-server-generate.sh — generate via the running sd-server through the tunnel.
# PASS = at least one requested API returns a decoded, verified PNG on MacBook.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
ARG_API="openai"   # openai|sdapi|both|native
ARG_PRESET=""
ARG_WARM="unknown"  # warm-state label for metrics (benchmark/warm scripts set this)
ARG_SEED=""
EX_STEPS=""; EX_W=""; EX_H=""; EX_CFG=""; EX_SAMPLER=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --preset NAME      smoke|thumbnail|fast|balanced|quality|quality_plus
  --prompt "..."     positive prompt
  --negative "..."   negative prompt
  --steps N          sample steps (overrides preset/config)
  --width N          width (overrides preset/config)
  --height N         height (overrides preset/config)
  --cfg N            cfg scale (overrides preset/config)
  --sampler NAME     sampler (overrides preset/config)
  --api MODE         openai | sdapi | both | native   (default openai)
  --seed N|random|fixed   control seed (default: not forced; SDAPI default is random)
  --warm-state LABEL metrics label: cold|warm|unknown (default unknown)
  -h, --help
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
    --api) ARG_API="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --warm-state) ARG_WARM="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

case "$ARG_API" in openai|sdapi|both|native) : ;; *) fail "args" "--api must be openai|sdapi|both|native" ;; esac

# Resolve dimensions/steps: config defaults -> preset -> explicit flags.
ARG_STEPS="$STEPS"; ARG_W="$WIDTH"; ARG_H="$HEIGHT"; ARG_CFG="$CFG_SCALE"; ARG_SAMPLER="$SAMPLER"
PRESET_LABEL="config"
if [ -n "$ARG_PRESET" ]; then
  apply_preset "$ARG_PRESET"
  ARG_STEPS="$PRESET_STEPS"; ARG_W="$PRESET_W"; ARG_H="$PRESET_H"; ARG_CFG="$PRESET_CFG"; ARG_SAMPLER="$PRESET_SAMPLER"
  PRESET_LABEL="$PRESET_NAME"
fi
[ -n "$EX_STEPS" ] && ARG_STEPS="$EX_STEPS"
[ -n "$EX_W" ] && ARG_W="$EX_W"
[ -n "$EX_H" ] && ARG_H="$EX_H"
[ -n "$EX_CFG" ] && ARG_CFG="$EX_CFG"
[ -n "$EX_SAMPLER" ] && ARG_SAMPLER="$EX_SAMPLER"

# Resolve seed (controlled only when --seed given).
SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
if [ "$SEED_CONTROLLED" = "yes" ]; then SEED_FIELD="$SEED_VALUE"; else SEED_FIELD="uncontrolled"; SEED_LABEL="uncontrolled"; fi
CREATED_AT="$(iso_now)"

require_local_tool jq
require_local_tool curl

# Determine the live local tunnel + remote ports (prefer recorded session).
LPORT="$LOCAL_TUNNEL_PORT"
RPORT="$REMOTE_SERVER_PORT"
if [ -f "$SDCPP_STATE_DIR/current-ports.env" ]; then
  # shellcheck disable=SC1091
  . "$SDCPP_STATE_DIR/current-ports.env"
  LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"
  RPORT="${REMOTE_SERVER_PORT:-$RPORT}"
fi
BASE="http://127.0.0.1:$LPORT"

log "=== Checking tunnel on local port $LPORT ==="
if ! lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "tunnel-down" "No local tunnel listening on $LPORT. Start it with sdcpp-server-start.sh (or check sdcpp-server-status.sh)."
fi

RUN_DIR="$(make_run_dir server-gen)"
SDCPP_LOGFILE="$RUN_DIR/server-gen.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/server-generate-report.md"
SIZE="${ARG_W}x${ARG_H}"

REPORT_PROMPT="$ARG_PROMPT"
REPORT_NEGATIVE_PROMPT="$ARG_NEG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  REPORT_PROMPT="[REDACTED]"
  REPORT_NEGATIVE_PROMPT="[REDACTED]"
fi

{
  echo "# SDCPP Server Generate Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- API mode: $ARG_API"
  echo "- Preset: $PRESET_LABEL"
  echo "- Warm state: $ARG_WARM"
  echo "- Endpoint base: $BASE"
  echo "- Prompt: $REPORT_PROMPT"
  echo "- Size: $SIZE steps=$ARG_STEPS cfg=$ARG_CFG sampler=$ARG_SAMPLER seed=$SEED_LABEL"
  echo
} > "$REPORT"

# metrics file (header once; one row appended per API attempt)
metrics_header > "$RUN_DIR/metrics.tsv"

emit_server_metric() {
  # emit_server_metric <mode> <png> <elapsed> <decode> <status>
  local mode="$1" png="$2" el="$3" dec="$4" st="$5" bytes sum
  bytes="$(png_bytes "$png")"
  sum="$([ -f "$png" ] && local_sha256 "$png" || echo '')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$REMOTE_HOST_EXPECTED" "$SSH_TARGET" "7f0e728" \
    "n/a" "$(sanitize_tsv "$REMOTE_MODEL")" "$mode" "$PRESET_LABEL" \
    "$(sanitize_tsv "$REPORT_PROMPT")" "$(sanitize_tsv "$REPORT_NEGATIVE_PROMPT")" "$ARG_W" "$ARG_H" "$ARG_STEPS" "$ARG_CFG" "$ARG_SAMPLER" \
    "$SEED_FIELD" "n/a" "n/a" "$el" "n/a" "$dec" \
    "$(sanitize_tsv "$png")" "$bytes" "$sum" "$ARG_WARM" "$RPORT" "$LPORT" "tunnel" "$st" \
    >> "$RUN_DIR/metrics.tsv"
}

VERIFIED=0

decode_and_verify() {
  # decode_and_verify <b64-file> <png-file> <label>
  local b64="$1" png="$2" label="$3"
  if [ ! -s "$b64" ]; then
    log "$label: empty base64 payload"; return 1
  fi
  portable_base64_decode "$b64" "$png"
  verify_png "$png" "$label"
}

gen_openai() {
  log "=== OpenAI /v1/images/generations ==="
  local resp="$RUN_DIR/openai-response.json"
  local b64="$RUN_DIR/openai.b64" png="$RUN_DIR/openai.png"
  local payload t0 t1 elapsed d0 d1 dsec extra full_prompt
  # The OpenAI handler only reads prompt/size/n/output_format; steps/cfg/sampler
  # otherwise fall back to SERVER DEFAULTS. sd.cpp supports a prompt-embedded
  # <sd_cpp_extra_args>{gen_params json}</sd_cpp_extra_args> escape hatch, so we
  # embed the resolved preset values to make presets actually take effect.
  if [ "$SEED_CONTROLLED" = "yes" ]; then
    extra="$(jq -nc --argjson st "$ARG_STEPS" --argjson cfg "$ARG_CFG" --arg sm "$ARG_SAMPLER" --argjson sd "$SEED_VALUE" \
      '{seed:$sd, sample_params:{sample_steps:$st, sample_method:$sm, guidance:{txt_cfg:$cfg}}}')"
  else
    extra="$(jq -nc --argjson st "$ARG_STEPS" --argjson cfg "$ARG_CFG" --arg sm "$ARG_SAMPLER" \
      '{sample_params:{sample_steps:$st, sample_method:$sm, guidance:{txt_cfg:$cfg}}}')"
  fi
  full_prompt="$ARG_PROMPT <sd_cpp_extra_args>$extra</sd_cpp_extra_args>"
  payload="$(jq -n --arg p "$full_prompt" --arg s "$SIZE" \
    '{prompt:$p, n:1, size:$s, output_format:"png"}')"
  t0="$(now_epoch)"
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    curl -s "$BASE/v1/images/generations" -H 'Content-Type: application/json' -d "$payload" | python3 -c "
import sys
p = sys.argv[1] if len(sys.argv) > 1 else ''
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    sys.stdout.write(line)
" "$ARG_PROMPT" > "$resp" \
      || { log "openai curl failed"; emit_server_metric "server-openai" "$png" "n/a" "n/a" "FAIL"; return 1; }
  else
    curl -s "$BASE/v1/images/generations" -H 'Content-Type: application/json' -d "$payload" -o "$resp" \
      || { log "openai curl failed"; emit_server_metric "server-openai" "$png" "n/a" "n/a" "FAIL"; return 1; }
  fi
  t1="$(now_epoch)"; elapsed="$(elapsed_seconds "$t0" "$t1")"
  if ! jq -e '.data[0].b64_json' "$resp" >/dev/null 2>&1; then
    log "openai: no .data[0].b64_json in response"; head -c 400 "$resp" >&2; echo >&2
    emit_server_metric "server-openai" "$png" "$elapsed" "n/a" "FAIL"; return 1
  fi
  jq -r '.data[0].b64_json' "$resp" > "$b64"
  d0="$(now_epoch)"
  decode_and_verify "$b64" "$png" "OpenAI PNG" || { emit_server_metric "server-openai" "$png" "$elapsed" "n/a" "FAIL"; return 1; }
  d1="$(now_epoch)"; dsec="$(elapsed_seconds "$d0" "$d1")"
  {
    echo "## OpenAI"
    echo "- response: $resp"
    echo "- png: $png"
    echo "- request_seconds: $elapsed   decode_seconds: $dsec"
    echo '```'; file "$png"; ls -lh "$png"; echo '```'
  } >> "$REPORT"
  emit_server_metric "server-openai" "$png" "$elapsed" "$dsec" "PASS"
  return 0
}

gen_sdapi() {
  log "=== SDAPI /sdapi/v1/txt2img ==="
  local resp="$RUN_DIR/sdapi-response.json"
  local b64="$RUN_DIR/sdapi.b64" png="$RUN_DIR/sdapi.png"
  local payload t0 t1 elapsed d0 d1 dsec seedarg
  seedarg="-1"; [ "$SEED_CONTROLLED" = "yes" ] && seedarg="$SEED_VALUE"
  payload="$(jq -n --arg p "$ARG_PROMPT" --arg n "$ARG_NEG" \
    --argjson w "$ARG_W" --argjson h "$ARG_H" --argjson st "$ARG_STEPS" --argjson cfg "$ARG_CFG" --arg sm "$ARG_SAMPLER" --argjson sd "$seedarg" \
    '{prompt:$p, negative_prompt:$n, width:$w, height:$h, steps:$st, cfg_scale:$cfg, sampler_name:$sm, scheduler:"discrete", batch_size:1, seed:$sd}')"
  t0="$(now_epoch)"
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    curl -s "$BASE/sdapi/v1/txt2img" -H 'Content-Type: application/json' -d "$payload" | python3 -c "
import sys
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$resp" \
      || { log "sdapi curl failed"; emit_server_metric "server-sdapi" "$png" "n/a" "n/a" "FAIL"; return 1; }
  else
    curl -s "$BASE/sdapi/v1/txt2img" -H 'Content-Type: application/json' -d "$payload" -o "$resp" \
      || { log "sdapi curl failed"; emit_server_metric "server-sdapi" "$png" "n/a" "n/a" "FAIL"; return 1; }
  fi
  t1="$(now_epoch)"; elapsed="$(elapsed_seconds "$t0" "$t1")"
  if ! jq -e '.images[0]' "$resp" >/dev/null 2>&1; then
    log "sdapi: no .images[0] in response"; head -c 400 "$resp" >&2; echo >&2
    emit_server_metric "server-sdapi" "$png" "$elapsed" "n/a" "FAIL"; return 1
  fi
  jq -r '.images[0]' "$resp" > "$b64"
  d0="$(now_epoch)"
  decode_and_verify "$b64" "$png" "SDAPI PNG" || { emit_server_metric "server-sdapi" "$png" "$elapsed" "n/a" "FAIL"; return 1; }
  d1="$(now_epoch)"; dsec="$(elapsed_seconds "$d0" "$d1")"
  {
    echo "## SDAPI"
    echo "- response: $resp"
    echo "- png: $png"
    echo "- request_seconds: $elapsed   decode_seconds: $dsec"
    echo '```'; file "$png"; ls -lh "$png"; echo '```'
  } >> "$REPORT"
  emit_server_metric "server-sdapi" "$png" "$elapsed" "$dsec" "PASS"
  return 0
}

gen_native() {
  log "=== Native async /sdcpp/v1/img_gen (bounded 60s) ==="
  local submit="$RUN_DIR/native-submit.txt" sjson="$RUN_DIR/native-submit.json"
  local jresp="$RUN_DIR/native-job.json"
  local b64="$RUN_DIR/native.b64" png="$RUN_DIR/native.png"
  local payload
  local nseed; nseed="42"; [ "$SEED_CONTROLLED" = "yes" ] && nseed="$SEED_VALUE"
  payload="$(jq -n --arg p "$ARG_PROMPT" --arg n "$ARG_NEG" \
    --argjson w "$ARG_W" --argjson h "$ARG_H" --argjson st "$ARG_STEPS" --argjson cfg "$ARG_CFG" --arg sm "$ARG_SAMPLER" --argjson sd "$nseed" \
    '{prompt:$p, negative_prompt:$n, width:$w, height:$h, seed:$sd, batch_count:1,
      sample_params:{scheduler:"discrete", sample_method:$sm, sample_steps:$st, guidance:{txt_cfg:$cfg}},
      output_format:"png"}')"
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    curl -s -i "$BASE/sdcpp/v1/img_gen" -H 'Content-Type: application/json' -d "$payload" | python3 -c "
import sys
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$submit" \
      || { log "native submit curl failed"; return 1; }
  else
    curl -s -i "$BASE/sdcpp/v1/img_gen" -H 'Content-Type: application/json' -d "$payload" -o "$submit" \
      || { log "native submit curl failed"; return 1; }
  fi
  sed -n '/^{/,$p' "$submit" > "$sjson"
  local job; job="$(jq -r '.id // empty' "$sjson" 2>/dev/null)"
  if [ -z "$job" ]; then log "native: no job id"; head -c 400 "$sjson" >&2; echo >&2; return 1; fi
  log "native job id: $job"
  local i status=""
  for i in $(seq 1 30); do
    if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
      curl -s "$BASE/sdcpp/v1/jobs/$job" | python3 -c "
import sys
p = sys.argv[1] if len(sys.argv) > 1 else ''
n = sys.argv[2] if len(sys.argv) > 2 else ''
for line in sys.stdin:
    if p and p in line: line = line.replace(p, '[REDACTED]')
    if n and n in line: line = line.replace(n, '[REDACTED]')
    sys.stdout.write(line)
" "$ARG_PROMPT" "$ARG_NEG" > "$jresp" || true
    else
      curl -s "$BASE/sdcpp/v1/jobs/$job" -o "$jresp" || true
    fi
    status="$(jq -r '.status // empty' "$jresp" 2>/dev/null || true)"
    log "native poll $i: status=$status"
    [ "$status" = "completed" ] && break
    [ "$status" = "failed" ] && { log "native job failed: $(jq -c '.error' "$jresp" 2>/dev/null)"; return 1; }
    sleep 2
  done
  [ "$status" = "completed" ] || { log "native job not completed within bound"; return 1; }
  if ! jq -e '.result.images[0].b64_json' "$jresp" >/dev/null 2>&1; then
    log "native: no result image b64"; return 1
  fi
  jq -r '.result.images[0].b64_json' "$jresp" > "$b64"
  decode_and_verify "$b64" "$png" "Native PNG" || { emit_server_metric "server-native" "$png" "n/a" "n/a" "FAIL"; return 1; }
  {
    echo "## Native async"
    echo "- job: $job"
    echo "- response: $jresp"
    echo "- png: $png"
    echo '```'; file "$png"; ls -lh "$png"; echo '```'
  } >> "$REPORT"
  emit_server_metric "server-native" "$png" "n/a" "n/a" "PASS"
  return 0
}

run_one() {
  case "$1" in
    openai) gen_openai && VERIFIED=$((VERIFIED+1)) || log "OpenAI path did not produce a verified PNG." ;;
    sdapi)  gen_sdapi  && VERIFIED=$((VERIFIED+1)) || log "SDAPI path did not produce a verified PNG." ;;
    native) gen_native && VERIFIED=$((VERIFIED+1)) || log "Native path did not produce a verified PNG." ;;
  esac
}

case "$ARG_API" in
  openai) run_one openai ;;
  sdapi)  run_one sdapi ;;
  both)   run_one openai; run_one sdapi ;;
  native) run_one native ;;
esac

{
  echo
  echo "## Result"
  echo "- verified PNGs: $VERIFIED"
} >> "$REPORT"

if [ "$VERIFIED" -ge 1 ]; then
  # primary image = first produced PNG among openai/sdapi/native
  PRIMARY_REL=""
  for cand in openai.png sdapi.png native.png; do
    [ -f "$RUN_DIR/$cand" ] && { PRIMARY_REL="$cand"; break; }
  done
  write_ui_run_card "$RUN_DIR" "server-$ARG_API" "PASS" "$PRIMARY_REL" "metrics.tsv" \
    "$REPORT_PROMPT" \
    "preset=$PRESET_LABEL api=$ARG_API size=${SIZE} steps=$ARG_STEPS cfg=$ARG_CFG sampler=$ARG_SAMPLER seed=$SEED_LABEL warm=$ARG_WARM" \
    "$CREATED_AT" >/dev/null
  pass_banner "SERVER GENERATE PASS ($VERIFIED verified PNG(s), seed=$SEED_LABEL).
Run dir: $RUN_DIR
Report:  $REPORT
UI card: $RUN_DIR/ui-run-card.md"
  exit 0
fi
fail "server-generate" "No requested server API produced a verified PNG. See $REPORT and $SDCPP_LOGFILE."
