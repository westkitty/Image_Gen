#!/usr/bin/env bash
# mflux-controlled-edit.sh - FLUX.2 Klein 4B reference editing (mflux-generate-flux2-edit) on Big Mac.
# Same transport, privacy, cancel-by-run-id and canonical-publication contract as mflux-controlled-generate.sh;
# the reference image streams over ssh stdin and is checksum-verified remotely.
# This script is always launched on the MacBook. Every Big Mac operation
# goes through the configured SSH target (westcat) from sdcpp.env.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

# Wall-clock stamps (seconds, ms resolution) for the timing record; no prompt data.
now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
T_START="$(now)"

# Reuse one authenticated SSH connection for the preflight and the generate call (and for
# back-to-back runs within 120 s): ~1.0 s -> ~0.3 s per extra ssh. Same host, same keys, same
# Tailscale SSH auth; only a private 0700 control socket is added. DEX_SSH_MUX=0 disables it.
if [ "${DEX_SSH_MUX:-1}" != "0" ]; then
  MUX_DIR="$HOME/.ssh/dexdiffusion-cm"
  if mkdir -p "$MUX_DIR" 2>/dev/null && chmod 700 "$MUX_DIR" 2>/dev/null; then
    SDCPP_SSH_EXTRA_OPTS="-o ControlMaster=auto -o ControlPath=$MUX_DIR/%C -o ControlPersist=120"
    export SDCPP_SSH_EXTRA_OPTS
  fi
fi

ARG_TARGET="flux2-klein-4b"
ARG_INIT=""
ARG_PROMPT=""
ARG_WIDTH="1024"
ARG_HEIGHT="1024"
ARG_STEPS="4"
ARG_SEED=""
ARG_SAVE_PROMPTS="false"

usage() {
  cat <<'USAGE'
Usage: mflux-controlled-edit.sh [options]
  --target flux2-klein-4b
  --init-img PATH   reference image (a PNG inside the canonical image root)
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
    --init-img) ARG_INIT="${2:?}"; shift 2 ;;
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
[ -n "$ARG_INIT" ] || fail "init-img" "--init-img is required."
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

# The reference must be a regular PNG inside the canonical image root: no traversal, no symlink escapes.
REF_PATH="$(python3 - "$ARG_INIT" "$DEX_IMAGES_ROOT" <<'PYREF'
import os, sys
p, root = os.path.realpath(sys.argv[1]), os.path.realpath(sys.argv[2])
if not (p.startswith(root + os.sep) and p.lower().endswith('.png') and os.path.isfile(p)):
    sys.exit(1)
print(p)
PYREF
)" || fail "init-img" "Reference image must be an existing PNG inside $DEX_IMAGES_ROOT."
REF_BYTES="$(wc -c < "$REF_PATH" | tr -d '[:space:]')"
[ "$REF_BYTES" -gt 0 ] && [ "$REF_BYTES" -le 41943040 ] || fail "init-img" "Reference image must be 1 byte to 40 MB."
REF_SHA="$(shasum -a 256 "$REF_PATH" | cut -d' ' -f1)"
RUN_DIR="$(make_run_dir controlled-$ARG_TARGET-edit)"
SDCPP_LOGFILE="$RUN_DIR/mflux-controlled-edit.log"
export SDCPP_LOGFILE

MANIFEST="$RUN_DIR/controlled-manifest.json"
REPORT="$RUN_DIR/controlled-generate-report.md"
RUN_ID="$(basename "$RUN_DIR")"
echo "SDCPP_RUN_ID: $RUN_ID"   # announced early so a cancel can scope the remote stop to this run
# Runtime paths are relative to Big Mac's $HOME (resolved remotely). Everything
# on the generation hot path is on Big Mac's INTERNAL SSD: the external USB
# volume (wc2tb) stalled MFLUX imports for 10+ minutes under concurrent disk
# load (incident 2026-09-25). The internal venv is a pinned, package-identical
# copy of /Volumes/wc2tb/dex-imagegen/mflux-venv (kept as a fallback).
REMOTE_VENV_REL="Library/Caches/DexDiffusion/mflux/venv"
REMOTE_MFLUX_REL="$REMOTE_VENV_REL/bin/mflux-generate-flux2-edit"
REMOTE_VENV="\$HOME/$REMOTE_VENV_REL"
REMOTE_MFLUX="\$HOME/$REMOTE_MFLUX_REL"
# Proven configuration (2026-09-25): 4-bit MFLUX checkpoint
# mlx-community/flux2-klein-4b-4bit staged on Big Mac INTERNAL storage.
# The full-precision model read from wc2tb hit Metal GPU watchdog timeouts.
REMOTE_MODEL_DIR='$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit'
REMOTE_CACHE_REL="Library/Caches/DexDiffusion/mflux/cache"
REMOTE_STDOUT_LOG="$RUN_DIR/remote-command.log"
CREATED_AT="$(iso_now)"
START_EPOCH="$(date +%s)"

# Image bytes only ever land in the canonical root: streamed into an
# .incoming file there, validated, then linked to a never-overwritten name.
mkdir -p "$DEX_IMAGES_ROOT"
INCOMING="$DEX_IMAGES_ROOT/.incoming-$RUN_ID.png"
RAW_STDERR="$(mktemp "${TMPDIR:-/tmp}/dexdiffusion-mflux-stderr.XXXXXXXX")"
trap 'rm -f -- "$INCOMING" "$RAW_STDERR"' EXIT

log "=== Pre-flight verification ==="
# One round trip checks hostname + runtime + model (was three ssh calls). Failure gates are unchanged.
PREFLIGHT_OUT="$(ssh_remote "printf 'HOST=%s\\n' \"\$(hostname)\"; if test -x \"$REMOTE_MFLUX\"; then echo RUNTIME=1; else echo RUNTIME=0; fi; if test -s $REMOTE_MODEL_DIR/transformer/model.safetensors.index.json && test -s $REMOTE_MODEL_DIR/text_encoder/model.safetensors.index.json && test -s $REMOTE_MODEL_DIR/vae/model.safetensors.index.json; then echo MODEL=1; else echo MODEL=0; fi" 2>/dev/null)" \
  || fail "route" "ssh $SSH_TARGET failed (host unreachable? Tailscale down? See TROUBLESHOOTING.md)."
PREFLIGHT_HOST="$(printf '%s\n' "$PREFLIGHT_OUT" | sed -n 's/^HOST=//p' | head -1)"
[ -n "$PREFLIGHT_HOST" ] || fail "route" "ssh $SSH_TARGET returned no preflight data (host unreachable? Tailscale down? See TROUBLESHOOTING.md)."
[ "$PREFLIGHT_HOST" = "${REMOTE_HOST_EXPECTED:?}" ] \
  || fail "route-hostname" "Remote hostname is '$PREFLIGHT_HOST', expected '$REMOTE_HOST_EXPECTED'. Refusing to continue."
log "Route OK: ssh $SSH_TARGET -> hostname=$PREFLIGHT_HOST"
printf '%s\n' "$PREFLIGHT_OUT" | grep -q '^RUNTIME=1$' || fail "mflux-runtime" "MFLUX runtime missing on Big Mac: $REMOTE_VENV"
printf '%s\n' "$PREFLIGHT_OUT" | grep -q '^MODEL=1$' || fail "mflux-model" "4-bit FLUX.2 Klein model missing on Big Mac: $REMOTE_MODEL_DIR"
T_PREFLIGHT="$(now)"

SEED_RESOLVED="$(resolve_seed "$ARG_SEED")"
SEED_VALUE="$(printf '%s' "$SEED_RESOLVED" | cut -f1)"
SEED_CONTROLLED="$(printf '%s' "$SEED_RESOLVED" | cut -f2)"
SEED_LABEL="$(printf '%s' "$SEED_RESOLVED" | cut -f3)"
if [ "$SEED_CONTROLLED" != "yes" ]; then
  SEED_VALUE="$(date +%s)"
  SEED_LABEL="$SEED_VALUE"
fi
# The UI's "-1" means random (SDCPP convention). MLX's mx.random.key() only
# accepts non-negative seeds; forwarding -1 crashed MFLUX before any image was
# written (incident 2026-09-25, run 20260925-224619). Resolve to a recorded
# random seed so the run stays reproducible.
case "$SEED_VALUE" in
  -*) SEED_VALUE="$(gen_random_seed)"; SEED_LABEL="$SEED_VALUE(random)" ;;
esac
is_uint "$SEED_VALUE" && [ "${#SEED_VALUE}" -le 10 ] && [ "$SEED_VALUE" -le 4294967295 ] \
  || fail "seed" "Seed must be an integer 0-4294967295 or -1 for random."

PROMPT_B64="$(python3 -c 'import base64,sys; print(base64.b64encode(sys.argv[1].encode("utf-8")).decode("ascii"))' "$ARG_PROMPT")"

# Remote side lives in mflux-remote-generate.sh (sent via bash -c; stdout is the
# PNG, stderr carries markers incl. MFLUX_REMOTE_EXIT, since Tailscale SSH on
# Big Mac always reports exit-status 0).
REMOTE_SCRIPT="$(cat "$HERE/mflux-remote-edit.sh")"

log "=== Generating FLUX.2 Klein 4B on BigMac (MFLUX, ephemeral remote image) ==="
T_SSH_START="$(now)"
set +e
# shellcheck disable=SC2086
ssh -o ConnectTimeout=15 ${SDCPP_SSH_EXTRA_OPTS:-} "$SSH_TARGET" "bash -c $(printf '%q' "$REMOTE_SCRIPT") dexdiffusion-mflux-$RUN_ID $PROMPT_B64 $ARG_STEPS $SEED_VALUE $ARG_WIDTH $ARG_HEIGHT $(printf '%q' "$REMOTE_CACHE_REL") $(printf '%q' "$REMOTE_MFLUX_REL") $REF_SHA" \
  < "$REF_PATH" > "$INCOMING" 2> "$RAW_STDERR"
SSH_RC=$?   # transport-level only (255 = ssh failed); remote status is in-band
set -e
T_SSH_END="$(now)"
if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  python3 "$HERE/redact_stream.py" "$ARG_PROMPT" "" < "$RAW_STDERR" > "$REMOTE_STDOUT_LOG"
else
  cat "$RAW_STDERR" > "$REMOTE_STDOUT_LOG"
fi
rm -f -- "$RAW_STDERR"

REMOTE_TMP="$(sed -n 's/^MFLUX_REMOTE_TMP: //p' "$REMOTE_STDOUT_LOG" | head -1)"
REMOTE_SHA="$(sed -n 's/^MFLUX_REMOTE_PNG_SHA256: //p' "$REMOTE_STDOUT_LOG" | head -1)"
REMOTE_CLEANUP="$(sed -n 's/^MFLUX_REMOTE_CLEANUP: //p' "$REMOTE_STDOUT_LOG" | tail -1)"
REMOTE_EXIT="$(sed -n 's/^MFLUX_REMOTE_EXIT: //p' "$REMOTE_STDOUT_LOG" | tail -1)"
REMOTE_FAIL="$(sed -n 's/^MFLUX_REMOTE_FAIL: //p' "$REMOTE_STDOUT_LOG" | head -1)"
# Last error-looking line from the (already prompt-redacted) remote log, for the message.
REMOTE_ERR="$(grep -E '^[A-Za-z_.]*(Error|Exception)|RuntimeError|\[METAL\]' "$REMOTE_STDOUT_LOG" | tail -1 | cut -c1-240 || true)"
if [ -n "$REMOTE_TMP" ]; then
  case "$REMOTE_TMP" in
    */dexdiffusion-mflux.*) ;;
    *) fail "cleanup-failed" "Unexpected remote temp path: $REMOTE_TMP" ;;
  esac
fi
LOG_HINT="see $REMOTE_STDOUT_LOG"
if [ -z "$REMOTE_EXIT" ]; then
  fail "transfer-failed" "Remote script did not report completion (ssh transport exit $SSH_RC); $LOG_HINT"
fi
if [ "$REMOTE_EXIT" != "0" ]; then
  gate="$(printf '%s' "$REMOTE_FAIL" | awk '{print $1}')"
  case "$gate" in generator-exit|output-missing|output-empty|output-invalid|cleanup-failed) ;; *) gate="generator-exit" ;; esac
  fail "$gate" "${REMOTE_FAIL:-remote exit $REMOTE_EXIT}${REMOTE_ERR:+ — $REMOTE_ERR}; $LOG_HINT"
fi
if [ "$REMOTE_CLEANUP" != "OK" ]; then
  fail "cleanup-failed" "Remote cleanup unverified (marker: ${REMOTE_CLEANUP:-missing}); $LOG_HINT"
fi
[ -n "$REMOTE_SHA" ] || fail "output-invalid" "Remote reported success but no PNG checksum; $LOG_HINT"
[ -s "$INCOMING" ] || fail "transfer-failed" "No PNG bytes arrived over ssh; $LOG_HINT"
log "=== Finalizing canonical image ==="
LOCAL_SHA="$(shasum -a 256 "$INCOMING" | cut -d' ' -f1)"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || fail "sha-mismatch" "Streamed PNG checksum mismatch (remote $REMOTE_SHA, local $LOCAL_SHA)."

if [ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ]; then
  strip_png_metadata "$INCOMING" || fail "png-redact" "Could not strip PNG metadata."
fi
verify_png "$INCOMING" "MFLUX FLUX.2 Klein PNG"
T_VALIDATED="$(now)"

# Publish through the same validated transaction as the server and SDCPP.
CANONICAL_RECORD="$(DEX_IMAGES_ROOT_OVERRIDE="$DEX_IMAGES_ROOT" node "$DEX_CANONICALIZE_JS" \
  --source "$INCOMING" --run-dir "$RUN_DIR" --run-file "controlled-$ARG_TARGET-edit.png" --seed "$SEED_VALUE")" \
  || fail "canonicalization-failed" "Validated canonical publication failed"
LOCAL_PNG="$(printf '%s\n' "$CANONICAL_RECORD" | python3 -c 'import json,sys; line=next(x for x in sys.stdin if x.startswith("CANONICAL_RECORD: ")); print(json.loads(line.split(": ",1)[1])["image_path"])')" \
  || fail "canonicalization-failed" "No canonical publication receipt"
IMAGE_ID="$(basename "$LOCAL_PNG")"
T_CANON="$(now)"
IMAGE_URL="/api/images/$IMAGE_ID"
REMOTE_PNG="ephemeral:$REMOTE_TMP (deleted, verified absent)"

FINISHED_AT="$(iso_now)"
END_EPOCH="$(date +%s)"
ELAPSED="$((END_EPOCH - START_EPOCH))"
PNG_BYTES="$(wc -c < "$LOCAL_PNG" | tr -d '[:space:]')"
REPORT_PROMPT="$ARG_PROMPT"
[ "${SDCPP_REDACT_PROMPTS:-0}" = "1" ] && REPORT_PROMPT="[REDACTED]"

# Stage timings (seconds). Remote stamps come from the remote script's own clock and are only
# ever differenced against each other; local stamps against the MacBook clock. No prompt data.
rt() { sed -n "s/^MFLUX_REMOTE_T: $1 //p" "$REMOTE_STDOUT_LOG" | head -1; }
RT_START="$(rt script-start)"; RT_GEN0="$(rt generate-start)"; RT_GEN1="$(rt generate-end)"; RT_STR1="$(rt stream-end)"
T_END="$(now)"
TIMINGS_JSON="$(python3 - "$T_START" "$T_PREFLIGHT" "$T_SSH_START" "$T_SSH_END" "$T_VALIDATED" "$T_CANON" "$T_END" \
  "${RT_START:-}" "${RT_GEN0:-}" "${RT_GEN1:-}" "${RT_STR1:-}" <<'PY'
import json, sys
(t0, tpre, ssh0, ssh1, tval, tcan, tend, r_start, r_gen0, r_gen1, r_str1) = sys.argv[1:]
f = lambda x: float(x) if x else None
d = lambda a, b: round(f(b) - f(a), 2) if f(a) is not None and f(b) is not None else None
t = {
  "preflight_s": d(t0, tpre),
  "ssh_total_s": d(ssh0, ssh1),
  "remote_startup_s": d(r_start, r_gen0),
  "remote_generate_s": d(r_gen0, r_gen1),
  "remote_check_stream_cleanup_s": d(r_gen1, r_str1),
  "local_validate_s": d(ssh1, tval),
  "canonicalize_s": d(tval, tcan),
  "wall_s": d(t0, tend),
}
rem = d(r_start, r_str1)
t["ssh_connect_and_teardown_s"] = round(t["ssh_total_s"] - rem, 2) if rem is not None else None
print(json.dumps(t))
PY
)" || TIMINGS_JSON='{}'
log "MFLUX_TIMING: $TIMINGS_JSON"
export DEX_TIMINGS_JSON="$TIMINGS_JSON"

python3 - "$MANIFEST" "$RUN_DIR" "$CREATED_AT" "$FINISHED_AT" "$ELAPSED" \
  "$LOCAL_PNG" "$REMOTE_PNG" "$PNG_BYTES" "$ARG_WIDTH" "$ARG_HEIGHT" \
  "$ARG_STEPS" "$SEED_LABEL" "$REPORT_PROMPT" "$(basename "$REF_PATH")" <<'PY'
import json, os, sys
(manifest, run_dir, created, finished, elapsed, local_png, remote_png, png_bytes,
 width, height, steps, seed, prompt, source_image) = sys.argv[1:]
obj = {
    "schema": "dexdiffusion.mflux.controlled_edit.v1",
    "operation": "ref-edit",
    "source_image": source_image,
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
    "runtime_controlled_proven": True,
    "timings": json.loads(os.environ.get("DEX_TIMINGS_JSON") or "{}")
}
with open(manifest, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")
PY

cat > "$REPORT" <<'REPORT_HEAD'
# Controlled Reference Edit Report
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
