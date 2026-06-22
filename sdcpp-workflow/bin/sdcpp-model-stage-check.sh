#!/usr/bin/env bash
# sdcpp-model-stage-check.sh — validate SDXL Turbo / Flux staging on BigMac.
# Does not download, move, or import models. Writes local state/model-stage-cache.json.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

MODEL_VOLUME="wc2tb"
MODEL_VOLUME_PATH="/Volumes/wc2tb"
EXTERNAL_ROOT="/Volumes/wc2tb/ImageGen"
CACHE="$SDCPP_STATE_DIR/model-stage-cache.json"
SMOKE_CACHE="$SDCPP_STATE_DIR/sdxl-smoke-cache.json"
SDXL_TURBO_SMOKE_CACHE="$SDCPP_STATE_DIR/sdxl-turbo-smoke-cache.json"
FLUX_SMOKE_CACHE="$SDCPP_STATE_DIR/flux-smoke-cache.json"
TMP_TSV="$(mktemp /tmp/sdcpp_model_stage_XXXXXX.tsv)"
cleanup_tmp() { rm -f "$TMP_TSV"; }
trap cleanup_tmp EXIT

write_fail_cache() {
  local reason="$1"
  python3 - "$CACHE" "$MODEL_VOLUME" "$MODEL_VOLUME_PATH" "$EXTERNAL_ROOT" "$reason" <<'PYFAIL'
import sys, json, datetime
out, model_volume, model_volume_path, root, reason = sys.argv[1:]
obj = {
    "checked_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    "route_ok": False,
    "model_volume": model_volume,
    "model_volume_path": model_volume_path,
    "model_volume_mounted": False,
    "model_volume_free_space": "",
    "external_root": root,
    "root_exists": False,
    "write_test": "not-run",
    "sdxl_turbo_candidates": [],
    "sdxl_turbo_recommended_candidate": None,
    "sdxl_candidates": [],
    "flux_model_candidates": [],
    "flux_vae_candidates": [],
    "flux_clip_l_candidates": [],
    "flux_t5xxl_candidates": [],
    "flux_gguf_candidates": [],
    "stable_diffusion_cpp_help_summary": {},
    "metal_support_observed": False,
    "runtime_smoke_proven": False,
    "sdxl_smoke_proven": False,
    "sdxl_turbo_smoke_proven": False,
    "flux_smoke_proven": False,
    "recommended_next_step": reason,
}
with open(out, "w") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")
PYFAIL
}

ROUTE_OUT="$(ssh -o ConnectTimeout=15 "$SSH_TARGET" 'whoami && hostname && pwd && sw_vers; printf "%s\n" "__SDCPP_ROUTE_DONE__"' 2>/dev/null || true)"
if ! printf '%s\n' "$ROUTE_OUT" | grep -q '__SDCPP_ROUTE_DONE__'; then
  write_fail_cache "BigMac route failed; verify ssh westcat before model staging."
  fail "route" "ssh $SSH_TARGET did not return the route sentinel."
fi

ROUTE_USER="$(printf '%s\n' "$ROUTE_OUT" | sed -n '1p')"
ROUTE_HOST="$(printf '%s\n' "$ROUTE_OUT" | sed -n '2p')"
if [ "$ROUTE_USER" != "bigmac" ] || [ "$ROUTE_HOST" != "bigmac" ]; then
  write_fail_cache "Route identity mismatch; expected first lines bigmac / bigmac."
  fail "route-identity" "Expected bigmac/bigmac, got ${ROUTE_USER}/${ROUTE_HOST}."
fi

ssh -o ConnectTimeout=20 "$SSH_TARGET" 'ROOT="/Volumes/wc2tb/ImageGen"
VOL="/Volumes/wc2tb"
printf "ROUTE_OK\ttrue\n"
printf "MODEL_VOLUME\twc2tb\n"
printf "MODEL_VOLUME_PATH\t%s\n" "$VOL"
if [ -d "$VOL" ]; then
  printf "MODEL_VOLUME_MOUNTED\ttrue\n"
  df -h "$VOL" 2>/dev/null | tail -1 | awk "{print \"MODEL_VOLUME_FREE_SPACE\t\" \$0}"
else
  printf "MODEL_VOLUME_MOUNTED\tfalse\n"
  printf "MODEL_VOLUME_FREE_SPACE\t\n"
fi
if [ -d "$ROOT" ]; then printf "ROOT_EXISTS\ttrue\n"; else printf "ROOT_EXISTS\tfalse\n"; fi
if mkdir -p "$ROOT" 2>/dev/null; then
  PROBE="$ROOT/.sdcpp-model-stage-write-test-$$"
  if printf "probe\n" > "$PROBE" 2>/dev/null && test -s "$PROBE" && rm -f "$PROBE" 2>/dev/null; then
    printf "WRITE_TEST\tpass\n"
  else
    printf "WRITE_TEST\tfail\n"
  fi
else
  printf "WRITE_TEST\tfail\n"
fi
if [ -d "$ROOT" ]; then
  find "$ROOT" -maxdepth 5 -type f \( -name "*.safetensors" -o -name "*.gguf" -o -name "*.ckpt" \) 2>/dev/null | while IFS= read -r f; do
    size=$(stat -f%z "$f" 2>/dev/null || wc -c < "$f" 2>/dev/null || printf "0")
    size=$(printf '%s' "$size" | tr -d '[:space:]')
    [ -n "$size" ] || size=0
    base=$(basename "$f")
    case "$base" in
      sd_xl_turbo_1.0_fp16.safetensors|sd_xl_turbo_1.0.safetensors|*sdxl*turbo*.safetensors|*sdxl*turbo*.gguf)
        printf "CAND\tSDXL_TURBO\t%s\t%s\n" "$f" "$size"
        ;;
      flux1-schnell.safetensors|flux1-schnell*.gguf|flux1-schnell*Q*.gguf|flux1-schnell*fp8*.safetensors)
        printf "CAND\tFLUX_MODEL\t%s\t%s\n" "$f" "$size"
        ;;
      ae.safetensors|ae*.safetensors|ae*.gguf)
        printf "CAND\tFLUX_VAE\t%s\t%s\n" "$f" "$size"
        ;;
      clip_l.safetensors|clip_l*.safetensors|clip_l*.gguf)
        printf "CAND\tFLUX_CLIP_L\t%s\t%s\n" "$f" "$size"
        ;;
      t5xxl_fp16.safetensors|t5xxl_fp8*.safetensors|t5xxl*.gguf|t5-v1_1-xxl*.gguf)
        printf "CAND\tFLUX_T5XXL\t%s\t%s\n" "$f" "$size"
        ;;
      *flux*.gguf|flux1-schnell*.gguf)
        printf "CAND\tFLUX_GGUF\t%s\t%s\n" "$f" "$size"
        ;;
      *sd_xl_base*.safetensors|*sdxl*base*.safetensors|sd_xl_refiner*.safetensors|sdxl_refiner*.safetensors|*sdxl-base*.safetensors|*sdxl-refiner*.safetensors)
        printf "CAND\tSDXL\t%s\t%s\n" "$f" "$size"
        ;;
    esac
  done
fi
SD_BIN=""
if [ -f "$HOME/sdcpp-staging/build_dir.txt" ]; then
  BD=$(cat "$HOME/sdcpp-staging/build_dir.txt" 2>/dev/null || true)
  if [ -x "$BD/bin/sd-cli" ]; then SD_BIN="$BD/bin/sd-cli"; fi
fi
if [ -z "$SD_BIN" ] && command -v sd-cli >/dev/null 2>&1; then SD_BIN=$(command -v sd-cli); fi
if [ -z "$SD_BIN" ] && command -v sd >/dev/null 2>&1; then SD_BIN=$(command -v sd); fi
if [ -n "$SD_BIN" ]; then
  printf "SD_BIN\t%s\n" "$SD_BIN"
  HELP=$("$SD_BIN" --help 2>&1 | head -220 || true)
  printf "%s\n" "$HELP" | grep -Eiq "metal|MTL" && printf "HELP\tmetal\ttrue\n" || printf "HELP\tmetal\tfalse\n"
  printf "%s\n" "$HELP" | grep -Eiq "flux|t5|clip_l|vae|--vae|--clip|--t5" && printf "HELP\tflux\ttrue\n" || printf "HELP\tflux\tfalse\n"
  printf "%s\n" "$HELP" | grep -Eiq "safetensors" && printf "HELP\tsafetensors\ttrue\n" || printf "HELP\tsafetensors\tfalse\n"
  printf "%s\n" "$HELP" | grep -Eiq "gguf" && printf "HELP\tgguf\ttrue\n" || printf "HELP\tgguf\tfalse\n"
else
  printf "SD_BIN\tmissing\n"
  printf "HELP\tmetal\tfalse\nHELP\tflux\tfalse\nHELP\tsafetensors\tfalse\nHELP\tgguf\tfalse\n"
fi
printf "__SDCPP_MODEL_STAGE_DONE__\n"' > "$TMP_TSV" 2>/dev/null || true

if ! grep -q '__SDCPP_MODEL_STAGE_DONE__' "$TMP_TSV"; then
  write_fail_cache "Remote model-stage probe did not return sentinel."
  fail "model-stage-ssh" "Remote model-stage probe did not complete."
fi

python3 - "$TMP_TSV" "$CACHE" "$MODEL_VOLUME" "$MODEL_VOLUME_PATH" "$EXTERNAL_ROOT" "$SMOKE_CACHE" "$SDXL_TURBO_SMOKE_CACHE" "$FLUX_SMOKE_CACHE" <<'PYCACHE'
import sys, json, datetime, os
from pathlib import Path

tsv, out, model_volume, model_volume_path, root, smoke_cache_path, turbo_smoke_cache_path, flux_smoke_cache_path = sys.argv[1:]

obj = {
    "checked_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    "route_ok": False,
    "model_volume": model_volume,
    "model_volume_path": model_volume_path,
    "model_volume_mounted": False,
    "model_volume_free_space": "",
    "external_root": root,
    "root_exists": False,
    "write_test": "unknown",
    "invalid_candidates": [],
    "invalid_candidate_count": 0,
    "sdxl_turbo_candidates": [],
    "sdxl_turbo_recommended_candidate": None,
    "sdxl_candidates": [],
    "flux_model_candidates": [],
    "flux_vae_candidates": [],
    "flux_clip_l_candidates": [],
    "flux_t5xxl_candidates": [],
    "flux_gguf_candidates": [],
    "stable_diffusion_cpp_help_summary": {},
    "metal_support_observed": False,
    "runtime_smoke_proven": False,
    "sdxl_smoke_proven": False,
    "sdxl_turbo_smoke_proven": False,
    "flux_smoke_proven": False,
    "sdxl_turbo_staged_state": "missing",
    "sdxl_staged_state": "missing",
    "flux_staged_state": "missing",
    "recommended_next_step": "",
}

kind_map = {
    "SDXL_TURBO": "sdxl_turbo_candidates",
    "SDXL": "sdxl_candidates",
    "FLUX_MODEL": "flux_model_candidates",
    "FLUX_VAE": "flux_vae_candidates",
    "FLUX_CLIP_L": "flux_clip_l_candidates",
    "FLUX_T5XXL": "flux_t5xxl_candidates",
    "FLUX_GGUF": "flux_gguf_candidates",
}

MIN_BYTES = {
    "SDXL_TURBO": 1 << 30,
    "SDXL": 1 << 30,
    "FLUX_MODEL": 1 << 30,
    "FLUX_VAE": 1 << 20,
    "FLUX_CLIP_L": 1 << 20,
    "FLUX_T5XXL": 1 << 20,
    "FLUX_GGUF": 1 << 30,
}

def validate_candidate(kind, path, size):
    lower = path.lower()
    if size <= 0:
        return False, "zero-byte or placeholder file"
    if kind == "SDXL_TURBO":
        if "fp16" not in lower:
            return False, "Turbo placeholder or quantized variant; require sd_xl_turbo_1.0_fp16.safetensors"
    if kind == "SDXL" and "lora" in lower:
        return False, "LoRA file, not an SDXL checkpoint"
    threshold = MIN_BYTES.get(kind, 1)
    if size < threshold:
        return False, f"below minimum size threshold for {kind} ({threshold} bytes)"
    return True, ""

def local_size(path_text, fallback_text="0"):
    try:
        return Path(path_text).stat().st_size
    except OSError:
        size_digits = ''.join(ch for ch in fallback_text if ch.isdigit())
        return int(size_digits) if size_digits else 0

with open(tsv) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line or line == "__SDCPP_MODEL_STAGE_DONE__":
            continue
        parts = line.split("\t")
        if parts[0] == "ROUTE_OK":
            obj["route_ok"] = parts[1] == "true"
        elif parts[0] == "MODEL_VOLUME":
            obj["model_volume"] = parts[1]
        elif parts[0] == "MODEL_VOLUME_PATH":
            obj["model_volume_path"] = parts[1]
        elif parts[0] == "MODEL_VOLUME_MOUNTED":
            obj["model_volume_mounted"] = parts[1] == "true"
        elif parts[0] == "MODEL_VOLUME_FREE_SPACE":
            obj["model_volume_free_space"] = parts[1] if len(parts) > 1 else ""
        elif parts[0] == "ROOT_EXISTS":
            obj["root_exists"] = parts[1] == "true"
        elif parts[0] == "WRITE_TEST":
            obj["write_test"] = parts[1] if len(parts) > 1 else "unknown"
        elif parts[0] == "SD_BIN":
            obj["stable_diffusion_cpp_help_summary"]["binary"] = parts[1] if len(parts) > 1 else ""
        elif parts[0] == "HELP" and len(parts) >= 3:
            obj["stable_diffusion_cpp_help_summary"][parts[1]] = (parts[2] == "true")
            if parts[1] == "metal":
                obj["metal_support_observed"] = parts[2] == "true"
        elif parts[0] == "CAND" and len(parts) >= 4:
            arr = kind_map.get(parts[1])
            if arr:
                size = local_size(parts[2], parts[3])
                valid, invalid_reason = validate_candidate(parts[1], parts[2], size)
                candidate = {"path": parts[2], "size_bytes": size}
                if valid:
                    obj[arr].append(candidate)
                else:
                    obj["invalid_candidates"].append({
                        "kind": parts[1],
                        "path": parts[2],
                        "size_bytes": size,
                        "reason": invalid_reason,
                    })

preferred = root + "/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors"
for cand in obj["sdxl_turbo_candidates"]:
    if cand["path"] == preferred:
        obj["sdxl_turbo_recommended_candidate"] = cand["path"]
        break
if not obj["sdxl_turbo_recommended_candidate"] and obj["sdxl_turbo_candidates"]:
    obj["sdxl_turbo_recommended_candidate"] = obj["sdxl_turbo_candidates"][0]["path"]

obj["invalid_candidate_count"] = len(obj["invalid_candidates"])

root_exists = bool(obj["root_exists"])
sdxl_valid = bool(obj["sdxl_candidates"])
turbo_valid = bool(obj["sdxl_turbo_candidates"])
flux_model_valid = bool(obj["flux_model_candidates"])
flux_vae_valid = bool(obj["flux_vae_candidates"])
flux_clip_valid = bool(obj["flux_clip_l_candidates"])
flux_t5_valid = bool(obj["flux_t5xxl_candidates"])
flux_gguf_valid = bool(obj["flux_gguf_candidates"])

if turbo_valid:
    obj["sdxl_turbo_staged_state"] = "true"
elif any(item["kind"] == "SDXL_TURBO" for item in obj["invalid_candidates"]):
    obj["sdxl_turbo_staged_state"] = "false"

if sdxl_valid:
    obj["sdxl_staged_state"] = "true"
elif any(item["kind"] == "SDXL" for item in obj["invalid_candidates"]):
    obj["sdxl_staged_state"] = "false"

if flux_model_valid and flux_vae_valid and (flux_clip_valid and flux_t5_valid or flux_gguf_valid):
    obj["flux_staged_state"] = "true"
elif flux_model_valid and flux_vae_valid:
    obj["flux_staged_state"] = "partial"
elif flux_model_valid or flux_vae_valid or flux_clip_valid or flux_t5_valid or flux_gguf_valid:
    obj["flux_staged_state"] = "partial"

if obj["sdxl_staged_state"] == "true":
    obj["recommended_next_step"] = "SDXL base is staged; BigMac Metal smoke proof is still required before enabling support."
elif obj["sdxl_turbo_staged_state"] == "true":
    obj["recommended_next_step"] = "SDXL Turbo is staged; probe BigMac sd-cli flags and run bounded 512x512, 1-4 step smoke before enabling support."
elif obj["flux_staged_state"] == "true":
    obj["recommended_next_step"] = "Flux component set is staged; inspect sd-cli Flux flags and run bounded smoke before enabling support."
elif obj["flux_staged_state"] == "partial":
    obj["recommended_next_step"] = "Flux model and VAE are staged, but CLIP-L/T5XXL are missing unless the BigMac CLI proves an embedded path."
elif root_exists:
    obj["recommended_next_step"] = "Model root exists but required SDXL Turbo, SDXL base, or Flux files are missing; stage files on wc2tb and rerun this check."
else:
    obj["recommended_next_step"] = "Create /Volumes/wc2tb/ImageGen and stage SDXL Turbo or Flux files there."

def merge_smoke(cache_path, key):
    smoke = Path(cache_path)
    if not smoke.exists():
        return False
    try:
        smoke_obj = json.loads(smoke.read_text())
    except Exception:
        return False
    proven = bool(smoke_obj.get("runtime_smoke_proven") or smoke_obj.get("png_valid"))
    if proven:
        obj[key] = True
        obj["runtime_smoke_proven"] = True
    return proven

merge_smoke(smoke_cache_path, "sdxl_smoke_proven")
merge_smoke(turbo_smoke_cache_path, "sdxl_turbo_smoke_proven")
merge_smoke(flux_smoke_cache_path, "flux_smoke_proven")
if obj["sdxl_smoke_proven"] and obj["sdxl_staged_state"] == "true":
    obj["recommended_next_step"] = "SDXL base smoke proof passed."
elif obj["sdxl_turbo_smoke_proven"] and obj["sdxl_turbo_staged_state"] == "true":
    obj["recommended_next_step"] = "SDXL Turbo smoke proof passed."
elif obj["flux_smoke_proven"] and obj["flux_staged_state"] == "true":
    obj["recommended_next_step"] = "Flux smoke proof passed."

with open(out, "w") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")
PYCACHE

set +e
python3 - "$CACHE" <<'PYSTATUS'
import sys, json
d=json.load(open(sys.argv[1]))
if not d.get("route_ok"):
    sys.exit(2)
if d.get("runtime_smoke_proven") and (d.get("sdxl_staged_state") == "true" or d.get("sdxl_turbo_staged_state") == "true" or d.get("flux_staged_state") == "true"):
    sys.exit(0)
sys.exit(1)
PYSTATUS
STATUS=$?
set -e

case "$STATUS" in
  0)
    pass_banner "Model stage check complete.
Cache: $CACHE
Runtime smoke proof recorded."
    ;;
  1)
    PARTIAL_REASON="$(python3 - "$CACHE" <<'PYPARTIAL'
import sys, json
d=json.load(open(sys.argv[1]))
if not d.get("model_volume_mounted"):
    print("Model volume /Volumes/wc2tb is not mounted or not readable on BigMac.")
elif not d.get("root_exists"):
    print("Model root /Volumes/wc2tb/ImageGen is missing on BigMac.")
elif d.get("write_test") != "pass":
    print("Model root exists, but write test failed on BigMac.")
elif d.get("sdxl_staged_state") == "true":
    print("SDXL base is staged, but runtime smoke proof is still missing.")
elif d.get("sdxl_turbo_staged_state") == "true":
    print("SDXL Turbo is staged, but runtime smoke proof is still missing.")
elif d.get("flux_staged_state") in {"true", "partial"}:
    print("Flux files are staged, but runtime smoke proof or missing encoder components still block support.")
else:
    print("Model root is usable, but required SDXL Turbo / Flux files are missing.")
PYPARTIAL
)"
    printf '\n==== PARTIAL ====\n%s\nCache: %s\n' "$PARTIAL_REASON" "$CACHE"
    exit 0
    ;;
  *)
    fail "external-root" "Model stage cache could not be evaluated. Cache: $CACHE"
    ;;
esac
