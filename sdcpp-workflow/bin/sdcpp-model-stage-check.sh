#!/usr/bin/env bash
# sdcpp-model-stage-check.sh — validate SDXL Turbo / Flux staging on BigMac.
# Does not download, move, or import models. Writes local state/model-stage-cache.json.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

EXTERNAL_ROOT="/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models"
IMAGE_GEN_ROOT="/Volumes/wc1tb/Ai/Image_Gen"
CACHE="$SDCPP_STATE_DIR/model-stage-cache.json"
TMP_TSV="$(mktemp /tmp/sdcpp_model_stage_XXXXXX.tsv)"
cleanup_tmp() { rm -f "$TMP_TSV"; }
trap cleanup_tmp EXIT

write_fail_cache() {
  local reason="$1"
  python3 - "$CACHE" "$EXTERNAL_ROOT" "$reason" <<'PYFAIL'
import sys, json, datetime
out, root, reason = sys.argv[1:]
obj = {
    "checked_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    "route_ok": False,
    "external_root": root,
    "wc1tb_mounted": False,
    "free_space": "",
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

ssh -o ConnectTimeout=20 "$SSH_TARGET" 'ROOT="/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models"
IMGROOT="/Volumes/wc1tb/Ai/Image_Gen"
printf "ROUTE_OK\ttrue\n"
if [ -d /Volumes/wc1tb ]; then printf "WC1TB_MOUNTED\ttrue\n"; else printf "WC1TB_MOUNTED\tfalse\n"; fi
df -h /Volumes/wc1tb 2>/dev/null | tail -1 | awk "{print \"FREE_SPACE\t\" \$0}"
if [ -d "$ROOT" ]; then printf "ROOT_EXISTS\ttrue\n"; else printf "ROOT_EXISTS\tfalse\n"; fi
if mkdir -p "$IMGROOT" 2>/dev/null; then
  PROBE="$IMGROOT/.sdcpp-model-stage-write-test-$$"
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
    size=$(wc -c < "$f" 2>/dev/null || printf "0")
    base=$(basename "$f")
    case "$f/$base" in
      *sd_xl_turbo_1.0_fp16.safetensors*|*sd_xl_turbo_1.0.safetensors*|*sdxl*turbo*.safetensors*|*sdxl*turbo*.gguf*) printf "CAND\tSDXL_TURBO\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$f/$base" in
      *checkpoints/sdxl/*|*sd_xl_base*.safetensors*|*sdxl_base*.safetensors*) printf "CAND\tSDXL\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$base" in
      flux1-schnell.safetensors|flux1-schnell*.gguf|flux1-schnell*Q*.gguf|flux1-schnell*fp8*.safetensors) printf "CAND\tFLUX_MODEL\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$base" in
      ae.safetensors|ae*.safetensors|ae*.gguf) printf "CAND\tFLUX_VAE\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$base" in
      clip_l.safetensors|clip_l*.safetensors|clip_l*.gguf) printf "CAND\tFLUX_CLIP_L\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$base" in
      t5xxl_fp16.safetensors|t5xxl_fp8*.safetensors|t5xxl*.gguf|t5-v1_1-xxl*.gguf) printf "CAND\tFLUX_T5XXL\t%s\t%s\n" "$f" "$size" ;;
    esac
    case "$base" in
      *flux*.gguf|flux1-schnell*.gguf) printf "CAND\tFLUX_GGUF\t%s\t%s\n" "$f" "$size" ;;
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

python3 - "$TMP_TSV" "$CACHE" "$EXTERNAL_ROOT" <<'PYCACHE'
import sys, json, datetime
tsv, out, root = sys.argv[1:]

obj = {
    "checked_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    "route_ok": False,
    "external_root": root,
    "wc1tb_mounted": False,
    "free_space": "",
    "write_test": "unknown",
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

with open(tsv) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line or line == "__SDCPP_MODEL_STAGE_DONE__":
            continue
        parts = line.split("\t")
        if parts[0] == "ROUTE_OK":
            obj["route_ok"] = parts[1] == "true"
        elif parts[0] == "WC1TB_MOUNTED":
            obj["wc1tb_mounted"] = parts[1] == "true"
        elif parts[0] == "FREE_SPACE":
            obj["free_space"] = parts[1] if len(parts) > 1 else ""
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
                obj[arr].append({"path": parts[2], "size_bytes": int(parts[3]) if parts[3].isdigit() else 0})

preferred = root + "/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors"
for cand in obj["sdxl_turbo_candidates"]:
    if cand["path"] == preferred:
        obj["sdxl_turbo_recommended_candidate"] = cand["path"]
        break
if not obj["sdxl_turbo_recommended_candidate"] and obj["sdxl_turbo_candidates"]:
    obj["sdxl_turbo_recommended_candidate"] = obj["sdxl_turbo_candidates"][0]["path"]

flux_complete = bool(obj["flux_model_candidates"] and obj["flux_vae_candidates"] and obj["flux_clip_l_candidates"] and obj["flux_t5xxl_candidates"])
if obj["sdxl_turbo_recommended_candidate"]:
    obj["recommended_next_step"] = "SDXL Turbo is staged; probe BigMac sd-cli flags and run bounded 512x512, 1-4 step smoke before enabling support."
elif flux_complete:
    obj["recommended_next_step"] = "Flux component set is staged; inspect sd-cli Flux flags and run bounded smoke before enabling support."
elif obj.get("root_exists"):
    obj["recommended_next_step"] = "Model root exists but required SDXL Turbo or Flux files are missing; stage files on wc1tb and rerun this check."
else:
    obj["recommended_next_step"] = "Create /Volumes/wc1tb/Ai/Image_Gen/sdcpp-models and stage SDXL Turbo or Flux files there."

with open(out, "w") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")
PYCACHE

set +e
python3 - "$CACHE" <<'PYSTATUS'
import sys, json
d=json.load(open(sys.argv[1]))
if not d.get("route_ok") or not d.get("wc1tb_mounted") or not d.get("root_exists"):
    sys.exit(2)
if d.get("sdxl_turbo_recommended_candidate") or (d.get("flux_model_candidates") and d.get("flux_vae_candidates") and d.get("flux_clip_l_candidates") and d.get("flux_t5xxl_candidates")):
    sys.exit(0)
sys.exit(1)
PYSTATUS
STATUS=$?
set -e

case "$STATUS" in
  0)
    pass_banner "Model stage check complete.
Cache: $CACHE
At least one SDXL Turbo or Flux minimum staging path is present. Runtime smoke proof is still required."
    ;;
  1)
    printf '\n==== PARTIAL ====\nModel root is usable, but required SDXL Turbo / Flux files are missing.\nCache: %s\n' "$CACHE"
    exit 0
    ;;
  *)
    fail "external-root" "wc1tb or model root is unusable. Cache: $CACHE"
    ;;
esac
