#!/usr/bin/env bash
# sdcpp-discover-assets.sh — discover model/LoRA/VAE assets on BigMac and cache locally.
# PASS = remote listing completed and assets-cache.json written.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

ASSETS_CACHE="$SDCPP_STATE_DIR/assets-cache.json"
DISCOVER_TMP="$(mktemp /tmp/sdcpp_discover_XXXXXX.tsv)"
cleanup_tmp() { rm -f "$DISCOVER_TMP"; }
trap cleanup_tmp EXIT

log "Starting remote asset discovery via $SSH_TARGET"

: "${MODEL_STAGE_ROOT:=/Volumes/wc2tb/ImageGen}"

# Single-quoted heredoc: STAGE_ROOT is passed via env prefix.
ssh -o ConnectTimeout=20 "$SSH_TARGET" "STAGE_ROOT='$MODEL_STAGE_ROOT' bash -s" <<'REMOTE' > "$DISCOVER_TMP" 2>/dev/null || true
STAGING="$HOME/sdcpp-staging"
list_asset_dir() {
  local type="$1" dir="$2"
  if [ -d "$dir" ]; then
    find "$dir" -maxdepth 1 \( -name "*.safetensors" -o -name "*.ckpt" -o -name "*.pt" -o -name "*.bin" \) 2>/dev/null | while IFS= read -r f; do
      size=$(wc -c < "$f" 2>/dev/null || printf '0')
      printf '%s\t%s\t%s\t%s\n' "$type" "$(basename "$f")" "$size" "$f"
    done
  fi
}
list_asset_dir "checkpoint"   "$STAGING/models"
list_asset_dir "checkpoint"   "$STAGE_ROOT/checkpoints"
list_asset_dir "checkpoint"   "$STAGE_ROOT/checkpoints/sdxl"
list_asset_dir "checkpoint"   "$STAGE_ROOT/checkpoints/sd15"
list_asset_dir "vae"          "$STAGE_ROOT/vaes"
list_asset_dir "lora"         "$STAGE_ROOT/loras"
list_asset_dir "embedding"    "$STAGING/embeddings"
list_asset_dir "hypernetwork" "$STAGING/hypernetworks"
printf '__DISCOVERY_DONE__\n'
REMOTE

if ! grep -q '__DISCOVERY_DONE__' "$DISCOVER_TMP"; then
  fail "ssh-discovery" "Remote discovery did not complete (sentinel missing). Check SSH to $SSH_TARGET."
fi

log "Remote listing received. Parsing into $ASSETS_CACHE"

python3 - "$DISCOVER_TMP" "$SDCPP_CONFIG_DIR/sdcpp.env" "$SDCPP_STATE_DIR/current-ports.env" "$ASSETS_CACHE" <<'PYSCRIPT'
import sys, json, os, time, re, datetime

tsv_file   = sys.argv[1]
env_file   = sys.argv[2]
ports_file = sys.argv[3]
out_file   = sys.argv[4]

def read_env(path):
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        out[k.strip()] = v.strip().strip("'\"")
    return out

cfg = {**read_env(env_file), **read_env(ports_file)}
active_model_path = cfg.get('REMOTE_MODEL', '')
active_model_name = os.path.basename(active_model_path)

checkpoints = []
vaes        = []
loras       = []
embeddings  = []
hypernetworks = []

def safe_id(name):
    return re.sub(r'[^a-z0-9_-]', '_', name.lower())

with open(tsv_file) as f:
    for line in f:
        line = line.rstrip('\n')
        if line == '__DISCOVERY_DONE__' or not line:
            continue
        parts = line.split('\t')
        if len(parts) < 4:
            continue
        kind, name, size_str, full_path = parts[0], parts[1], parts[2], parts[3]
        try:
            size = int(size_str.strip())
        except ValueError:
            size = 0
        entry = {
            'id':         safe_id(name),
            'filename':   name,
            'name':       name,
            'size_bytes': size,
            'kind':       kind,
            'status':     'available',
            'full_path':  full_path,
        }
        if kind == 'checkpoint':
            entry['active'] = (name == active_model_name)
            checkpoints.append(entry)
        elif kind == 'vae':
            vaes.append(entry)
        elif kind == 'lora':
            loras.append(entry)
        elif kind == 'embedding':
            embeddings.append(entry)
        elif kind == 'hypernetwork':
            hypernetworks.append(entry)

# Ensure at least the configured model appears
if not checkpoints:
    fallback = active_model_name or 'v1-5-pruned-emaonly.safetensors'
    checkpoints.append({
        'id':         'sd15',
        'filename':   fallback,
        'name':       'SD 1.5 — configured remote model',
        'size_bytes': 0,
        'kind':       'checkpoint',
        'status':     'available',
        'active':     True,
        'full_path':  active_model_path or f"/Users/bigmac/sdcpp-staging/models/{fallback}",
    })
elif not any(c.get('active') for c in checkpoints):
    checkpoints[0]['active'] = True

cache = {
    'discovered_at':     time.time(),
    'discovered_at_iso': datetime.datetime.utcnow().isoformat() + 'Z',
    'checkpoints':       checkpoints,
    'vaes':              vaes,
    'loras':             loras,
    'embeddings':        embeddings,
    'hypernetworks':     hypernetworks,
}
with open(out_file, 'w') as f:
    json.dump(cache, f, indent=2)
print(
    f"Discovered: {len(checkpoints)} checkpoint(s), {len(vaes)} VAE(s), "
    f"{len(loras)} LoRA(s), {len(embeddings)} embedding(s), "
    f"{len(hypernetworks)} hypernetwork(s)"
)
PYSCRIPT

pass_banner "Asset discovery complete.
Cache: $ASSETS_CACHE"
