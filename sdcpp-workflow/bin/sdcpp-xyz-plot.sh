#!/usr/bin/env bash
# sdcpp-xyz-plot.sh — X/Y parameter sweep via the running sd-server.
# Generates one image per (x,y) cell. Max 16 cells total.
# PASS = at least 1 cell produced a verified PNG.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

ARG_PROMPT="$PROMPT"
ARG_NEG="${NEGATIVE_PROMPT:-}"
ARG_PRESET=""
ARG_API="openai"
ARG_SEED=""
EX_STEPS=""; EX_W=""; EX_H=""; EX_CFG=""; EX_SAMPLER=""
X_TYPE=""; X_VALUES=""
Y_TYPE=""; Y_VALUES=""

ALLOWED_AXIS_TYPES="steps cfg sampler seed width height"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --x-type TYPE        Axis type: steps|cfg|sampler|seed|width|height
  --x-values V1,V2,…  Comma-separated axis values (max 8 per axis)
  --y-type TYPE        (optional) second axis type
  --y-values V1,V2,…  (optional) second axis values
  --prompt "…"         Base positive prompt
  --negative "…"       Base negative prompt
  --preset NAME        Base preset (smoke|thumbnail|fast|balanced|quality|quality_plus)
  --steps N            Base steps (if not swept)
  --width N            Base width
  --height N           Base height
  --cfg N              Base CFG scale
  --sampler NAME       Base sampler
  --api MODE           openai|sdapi (default: openai)
  --seed N|random|fixed  Base seed
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --x-type)    X_TYPE="${2:?}";    shift 2 ;;
    --x-values)  X_VALUES="${2:?}";  shift 2 ;;
    --y-type)    Y_TYPE="${2:?}";    shift 2 ;;
    --y-values)  Y_VALUES="${2:?}";  shift 2 ;;
    --prompt)    ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative)  ARG_NEG="${2:?}";   shift 2 ;;
    --preset)    ARG_PRESET="${2:?}"; shift 2 ;;
    --steps)     EX_STEPS="${2:?}";  shift 2 ;;
    --width)     EX_W="${2:?}";      shift 2 ;;
    --height)    EX_H="${2:?}";      shift 2 ;;
    --cfg|--cfg-scale) EX_CFG="${2:?}"; shift 2 ;;
    --sampler)   EX_SAMPLER="${2:?}"; shift 2 ;;
    --api)       ARG_API="${2:?}";   shift 2 ;;
    --seed)      ARG_SEED="${2:?}";  shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$X_TYPE" ]   || fail "args" "--x-type is required"
[ -n "$X_VALUES" ] || fail "args" "--x-values is required"

# Validate axis types
for at in "$X_TYPE" ${Y_TYPE:+"$Y_TYPE"}; do
  case " $ALLOWED_AXIS_TYPES " in
    *" $at "*) : ;;
    *) fail "args" "Invalid axis type '$at'. Allowed: $ALLOWED_AXIS_TYPES" ;;
  esac
done
if [ -n "$Y_TYPE" ] && [ -z "$Y_VALUES" ]; then
  fail "args" "--y-type requires --y-values"
fi
if [ -n "$Y_VALUES" ] && [ -z "$Y_TYPE" ]; then
  fail "args" "--y-values requires --y-type"
fi
case "$ARG_API" in openai|sdapi) : ;; *) fail "args" "--api must be openai or sdapi for xyz-plot" ;; esac

# Resolve base dimensions from preset then explicit flags
ARG_STEPS="$STEPS"; ARG_W="$WIDTH"; ARG_H="$HEIGHT"; ARG_CFG="$CFG_SCALE"; ARG_SAMPLER="$SAMPLER"
if [ -n "$ARG_PRESET" ]; then
  apply_preset "$ARG_PRESET"
  ARG_STEPS="$PRESET_STEPS"; ARG_W="$PRESET_W"; ARG_H="$PRESET_H"
  ARG_CFG="$PRESET_CFG"; ARG_SAMPLER="$PRESET_SAMPLER"
fi
[ -n "$EX_STEPS" ] && ARG_STEPS="$EX_STEPS"
[ -n "$EX_W" ]     && ARG_W="$EX_W"
[ -n "$EX_H" ]     && ARG_H="$EX_H"
[ -n "$EX_CFG" ]   && ARG_CFG="$EX_CFG"
[ -n "$EX_SAMPLER" ] && ARG_SAMPLER="$EX_SAMPLER"

require_local_tool jq
require_local_tool curl

LPORT="$LOCAL_TUNNEL_PORT"
if [ -f "$SDCPP_STATE_DIR/current-ports.env" ]; then
  . "$SDCPP_STATE_DIR/current-ports.env"
  LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"
fi
BASE="http://127.0.0.1:$LPORT"

if ! lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "tunnel-down" "No local tunnel on port $LPORT. Run sdcpp-server-start.sh first."
fi

# Split comma-separated values into positional — bash 3.2 compatible
split_csv() {
  local IFS=','
  set -- $1
  printf '%s\n' "$@"
}

x_count=0
while IFS= read -r _v; do x_count=$((x_count+1)); done <<EOF
$(split_csv "$X_VALUES")
EOF

y_count=1
if [ -n "$Y_VALUES" ]; then
  y_count=0
  while IFS= read -r _v; do y_count=$((y_count+1)); done <<EOF
$(split_csv "$Y_VALUES")
EOF
fi

total_cells=$((x_count * y_count))
if [ "$total_cells" -gt 16 ]; then
  fail "cell-limit" "Total cells ($total_cells) exceeds limit of 16. Use fewer axis values."
fi
if [ "$total_cells" -lt 1 ]; then
  fail "args" "No cells to generate."
fi

log "XYZ plot: x=$X_TYPE ($x_count), y=${Y_TYPE:-none} ($y_count) = $total_cells cell(s)"

CREATED_AT="$(iso_now)"
RUN_DIR="$(make_run_dir xyz)"
SDCPP_LOGFILE="$RUN_DIR/xyz.log"; export SDCPP_LOGFILE
MANIFEST_FILE="$RUN_DIR/xyz-manifest.json"
CELLS_DIR="$RUN_DIR/cells"
mkdir -p "$CELLS_DIR"

REPORT_PROMPT="$ARG_PROMPT"
REPORT_NEG="$ARG_NEG"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  REPORT_PROMPT="[REDACTED]"
  REPORT_NEG="[REDACTED]"
fi

log "Run dir: $RUN_DIR"

# ---- single-cell generator ---------------------------------------------------
# Generates one image given the final resolved parameters for this cell.
# Writes PNG to $1 (output path). Returns 0=success, 1=fail.
gen_cell_openai() {
  local out_png="$1" steps="$2" w="$3" h="$4" cfg="$5" sampler="$6" seed_val="$7" seed_ctrl="$8"
  local extra full_prompt payload resp b64 tmpb64 tmpresp
  tmpb64="$(mktemp /tmp/sdcpp_xyz_b64_XXXXXX)"
  tmpresp="$(mktemp /tmp/sdcpp_xyz_resp_XXXXXX.json)"
  if [ "$seed_ctrl" = "yes" ]; then
    extra="$(jq -nc --argjson st "$steps" --argjson cfg "$cfg" --arg sm "$sampler" --argjson sd "$seed_val" \
      '{seed:$sd,sample_params:{sample_steps:$st,sample_method:$sm,guidance:{txt_cfg:$cfg}}}')"
  else
    extra="$(jq -nc --argjson st "$steps" --argjson cfg "$cfg" --arg sm "$sampler" \
      '{sample_params:{sample_steps:$st,sample_method:$sm,guidance:{txt_cfg:$cfg}}}')"
  fi
  full_prompt="$ARG_PROMPT <sd_cpp_extra_args>$extra</sd_cpp_extra_args>"
  payload="$(jq -n --arg p "$full_prompt" --arg s "${w}x${h}" '{prompt:$p,n:1,size:$s,output_format:"png"}')"
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    curl -s "$BASE/v1/images/generations" -H 'Content-Type: application/json' -d "$payload" \
      | python3 -c "import sys; p=sys.argv[1]; [sys.stdout.write(l.replace(p,'[REDACTED]')) for l in sys.stdin]" "$ARG_PROMPT" \
      > "$tmpresp" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  else
    curl -s "$BASE/v1/images/generations" -H 'Content-Type: application/json' -d "$payload" \
      -o "$tmpresp" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  fi
  if ! jq -e '.data[0].b64_json' "$tmpresp" >/dev/null 2>&1; then
    rm -f "$tmpb64" "$tmpresp"; return 1
  fi
  jq -r '.data[0].b64_json' "$tmpresp" > "$tmpb64"
  portable_base64_decode "$tmpb64" "$out_png" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  rm -f "$tmpb64" "$tmpresp"
  verify_png "$out_png" "cell" 2>/dev/null || return 1
  return 0
}

gen_cell_sdapi() {
  local out_png="$1" steps="$2" w="$3" h="$4" cfg="$5" sampler="$6" seed_val="$7" seed_ctrl="$8"
  local payload resp tmpb64 tmpresp seedarg
  tmpb64="$(mktemp /tmp/sdcpp_xyz_b64_XXXXXX)"
  tmpresp="$(mktemp /tmp/sdcpp_xyz_resp_XXXXXX.json)"
  seedarg="-1"; [ "$seed_ctrl" = "yes" ] && seedarg="$seed_val"
  payload="$(jq -n --arg p "$ARG_PROMPT" --arg n "$ARG_NEG" \
    --argjson w "$w" --argjson h "$h" --argjson st "$steps" --argjson cfg "$cfg" \
    --arg sm "$sampler" --argjson sd "$seedarg" \
    '{prompt:$p,negative_prompt:$n,width:$w,height:$h,steps:$st,cfg_scale:$cfg,sampler_name:$sm,scheduler:"discrete",batch_size:1,seed:$sd}')"
  if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
    curl -s "$BASE/sdapi/v1/txt2img" -H 'Content-Type: application/json' -d "$payload" \
      | python3 -c "
import sys; p,n=sys.argv[1],sys.argv[2]
for l in sys.stdin:
  if p: l=l.replace(p,'[REDACTED]')
  if n: l=l.replace(n,'[REDACTED]')
  sys.stdout.write(l)" "$ARG_PROMPT" "$ARG_NEG" \
      > "$tmpresp" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  else
    curl -s "$BASE/sdapi/v1/txt2img" -H 'Content-Type: application/json' -d "$payload" \
      -o "$tmpresp" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  fi
  if ! jq -e '.images[0]' "$tmpresp" >/dev/null 2>&1; then
    rm -f "$tmpb64" "$tmpresp"; return 1
  fi
  jq -r '.images[0]' "$tmpresp" > "$tmpb64"
  portable_base64_decode "$tmpb64" "$out_png" 2>/dev/null || { rm -f "$tmpb64" "$tmpresp"; return 1; }
  rm -f "$tmpb64" "$tmpresp"
  verify_png "$out_png" "cell" 2>/dev/null || return 1
  return 0
}

# ---- resolve a single axis value into an override for a named parameter ------
apply_axis_override() {
  local axis_type="$1" axis_val="$2"
  case "$axis_type" in
    steps)   CELL_STEPS="$axis_val" ;;
    cfg)     CELL_CFG="$axis_val" ;;
    sampler) CELL_SAMPLER="$axis_val" ;;
    seed)    CELL_SEED="$axis_val" ;;
    width)   CELL_W="$axis_val" ;;
    height)  CELL_H="$axis_val" ;;
  esac
}

# ---- main grid loop ----------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
CELL_INDEX=0
X_INDEX=0      # independent x-iteration counter; not affected by y-loop increments
MANIFEST_CELLS="[]"

while IFS= read -r xval; do
  [ -z "$xval" ] && continue
  X_INDEX=$((X_INDEX+1))

  if [ -n "$Y_VALUES" ]; then
    ROW=0
    while IFS= read -r yval; do
      [ -z "$yval" ] && continue
      ROW=$((ROW+1))
      CELL_INDEX=$((CELL_INDEX+1))
      CELL_LABEL="r${ROW}c${X_INDEX}"

      CELL_STEPS="$ARG_STEPS"; CELL_W="$ARG_W"; CELL_H="$ARG_H"
      CELL_CFG="$ARG_CFG"; CELL_SAMPLER="$ARG_SAMPLER"
      CELL_SEED="$ARG_SEED"

      apply_axis_override "$X_TYPE" "$xval"
      apply_axis_override "$Y_TYPE" "$yval"

      CELL_SEED_RESOLVED="$(resolve_seed "$CELL_SEED")"
      CELL_SEED_VAL="$(printf '%s' "$CELL_SEED_RESOLVED" | cut -f1)"
      CELL_SEED_CTRL="$(printf '%s' "$CELL_SEED_RESOLVED" | cut -f2)"

      CELL_PNG="$CELLS_DIR/${CELL_LABEL}.png"
      log "Cell $CELL_LABEL: $X_TYPE=$xval $Y_TYPE=$yval steps=$CELL_STEPS w=$CELL_W h=$CELL_H cfg=$CELL_CFG sampler=$CELL_SAMPLER"

      CELL_STATUS="FAIL"
      if gen_cell_${ARG_API} "$CELL_PNG" "$CELL_STEPS" "$CELL_W" "$CELL_H" "$CELL_CFG" "$CELL_SAMPLER" "$CELL_SEED_VAL" "$CELL_SEED_CTRL" 2>>"$SDCPP_LOGFILE"; then
        CELL_STATUS="PASS"
        PASS_COUNT=$((PASS_COUNT+1))
        log "  -> PASS: $CELL_PNG"
      else
        FAIL_COUNT=$((FAIL_COUNT+1))
        log "  -> FAIL"
      fi

      CELL_REL="cells/${CELL_LABEL}.png"
      CELL_JSON="$(jq -nc \
        --arg lbl "$CELL_LABEL" --arg xv "$xval" --arg yv "$yval" \
        --arg xt "$X_TYPE" --arg yt "$Y_TYPE" \
        --arg st "$CELL_STEPS" --arg w "$CELL_W" --arg h "$CELL_H" \
        --arg cfg "$CELL_CFG" --arg sm "$CELL_SAMPLER" \
        --arg seed "$CELL_SEED_VAL" --arg sc "$CELL_SEED_CTRL" \
        --arg png "$CELL_REL" --arg status "$CELL_STATUS" \
        '{label:$lbl,x_type:$xt,x_value:$xv,y_type:$yt,y_value:$yv,steps:$st,width:$w,height:$h,cfg_scale:$cfg,sampler:$sm,seed:$seed,seed_controlled:$sc,image:$png,status:$status}')"
      MANIFEST_CELLS="$(printf '%s' "$MANIFEST_CELLS" | jq --argjson c "$CELL_JSON" '. + [$c]')"
    done <<EOF
$(split_csv "$Y_VALUES")
EOF
  else
    CELL_INDEX=$((CELL_INDEX+1))
    CELL_LABEL="c${X_INDEX}"

    CELL_STEPS="$ARG_STEPS"; CELL_W="$ARG_W"; CELL_H="$ARG_H"
    CELL_CFG="$ARG_CFG"; CELL_SAMPLER="$ARG_SAMPLER"
    CELL_SEED="$ARG_SEED"
    apply_axis_override "$X_TYPE" "$xval"

    CELL_SEED_RESOLVED="$(resolve_seed "$CELL_SEED")"
    CELL_SEED_VAL="$(printf '%s' "$CELL_SEED_RESOLVED" | cut -f1)"
    CELL_SEED_CTRL="$(printf '%s' "$CELL_SEED_RESOLVED" | cut -f2)"

    CELL_PNG="$CELLS_DIR/${CELL_LABEL}.png"
    log "Cell $CELL_LABEL: $X_TYPE=$xval steps=$CELL_STEPS w=$CELL_W h=$CELL_H cfg=$CELL_CFG sampler=$CELL_SAMPLER"

    CELL_STATUS="FAIL"
    if gen_cell_${ARG_API} "$CELL_PNG" "$CELL_STEPS" "$CELL_W" "$CELL_H" "$CELL_CFG" "$CELL_SAMPLER" "$CELL_SEED_VAL" "$CELL_SEED_CTRL" 2>>"$SDCPP_LOGFILE"; then
      CELL_STATUS="PASS"
      PASS_COUNT=$((PASS_COUNT+1))
      log "  -> PASS: $CELL_PNG"
    else
      FAIL_COUNT=$((FAIL_COUNT+1))
      log "  -> FAIL"
    fi

    CELL_REL="cells/${CELL_LABEL}.png"
    CELL_JSON="$(jq -nc \
      --arg lbl "$CELL_LABEL" --arg xv "$xval" \
      --arg xt "$X_TYPE" \
      --arg st "$CELL_STEPS" --arg w "$CELL_W" --arg h "$CELL_H" \
      --arg cfg "$CELL_CFG" --arg sm "$CELL_SAMPLER" \
      --arg seed "$CELL_SEED_VAL" --arg sc "$CELL_SEED_CTRL" \
      --arg png "$CELL_REL" --arg status "$CELL_STATUS" \
      '{label:$lbl,x_type:$xt,x_value:$xv,y_type:null,y_value:null,steps:$st,width:$w,height:$h,cfg_scale:$cfg,sampler:$sm,seed:$seed,seed_controlled:$sc,image:$png,status:$status}')"
    MANIFEST_CELLS="$(printf '%s' "$MANIFEST_CELLS" | jq --argjson c "$CELL_JSON" '. + [$c]')"
  fi
done <<EOF
$(split_csv "$X_VALUES")
EOF

# ---- write manifest ----------------------------------------------------------
jq -n \
  --arg schema "sdcpp.xyz.v1" \
  --arg run_id "$(basename "$RUN_DIR")" \
  --arg created_at "$CREATED_AT" \
  --arg x_type "$X_TYPE" --arg x_values "$X_VALUES" \
  --arg y_type "$Y_TYPE" --arg y_values "$Y_VALUES" \
  --arg api "$ARG_API" \
  --arg prompt "$REPORT_PROMPT" --arg negative "$REPORT_NEG" \
  --argjson pass_count "$PASS_COUNT" --argjson fail_count "$FAIL_COUNT" \
  --argjson cells "$MANIFEST_CELLS" \
  '{schema:$schema,run_id:$run_id,created_at:$created_at,x_type:$x_type,x_values:$x_values,y_type:$y_type,y_values:$y_values,api:$api,prompt:$prompt,negative_prompt:$negative,pass_count:$pass_count,fail_count:$fail_count,cells:$cells}' \
  > "$MANIFEST_FILE"

# Primary image = first passing cell
PRIMARY_REL=""
for cell_entry in $(jq -r '.cells[] | select(.status=="PASS") | .image' "$MANIFEST_FILE" 2>/dev/null); do
  PRIMARY_REL="$cell_entry"
  break
done

write_ui_run_card "$RUN_DIR" "xyz-plot" \
  "$([ "$PASS_COUNT" -ge 1 ] && echo PASS || echo FAIL)" \
  "$PRIMARY_REL" "" \
  "$REPORT_PROMPT" \
  "x=$X_TYPE y=${Y_TYPE:-none} cells=$total_cells pass=$PASS_COUNT api=$ARG_API" \
  "$CREATED_AT" >/dev/null

if [ "$PASS_COUNT" -ge 1 ]; then
  pass_banner "XYZ plot: $PASS_COUNT/$total_cells cells passed.
Run dir: $RUN_DIR
Manifest: $MANIFEST_FILE"
  exit 0
fi
fail "xyz-generate" "All $total_cells cell(s) failed. See $SDCPP_LOGFILE"
