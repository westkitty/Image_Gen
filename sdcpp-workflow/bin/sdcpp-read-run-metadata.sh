#!/usr/bin/env bash
# sdcpp-read-run-metadata.sh — print JSON metadata for a local run directory.
# Usage: sdcpp-read-run-metadata.sh --run-id <id>
# PASS = JSON metadata printed to stdout.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

RUN_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="${2:?}"; shift 2 ;;
    -h|--help) printf 'Usage: %s --run-id <id>\n' "$(basename "$0")"; exit 0 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done

[ -n "$RUN_ID" ] || fail "args" "--run-id is required"

# Validate run ID: only safe characters
case "$RUN_ID" in
  *[!a-zA-Z0-9_-]*) fail "args" "Invalid run-id characters" ;;
esac

RUN_DIR="$SDCPP_RUNS_DIR/$RUN_ID"
[ -d "$RUN_DIR" ] || fail "run-not-found" "Run directory not found: $RUN_DIR"

log "Reading metadata for run: $RUN_ID"

python3 - "$RUN_DIR" "$RUN_ID" <<'PYSCRIPT'
import sys, json, os, struct, datetime

run_dir = sys.argv[1]
run_id  = sys.argv[2]

def read_yaml_frontmatter(path):
    """Parse simple key: value YAML frontmatter from a markdown file."""
    meta = {}
    if not os.path.exists(path):
        return meta
    with open(path) as f:
        content = f.read()
    import re
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not m:
        return meta
    for line in m.group(1).splitlines():
        idx = line.find(':')
        if idx < 0:
            continue
        k = line[:idx].strip()
        v = line[idx+1:].strip().strip('"\'')
        meta[k] = v
    return meta

def read_png_text_chunks(path):
    """Read tEXt and iTXt metadata chunks from a PNG file using stdlib only."""
    chunks = {}
    if not os.path.exists(path):
        return chunks
    try:
        with open(path, 'rb') as f:
            sig = f.read(8)
            if sig != b'\x89PNG\r\n\x1a\n':
                return chunks
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                length, chunk_type = struct.unpack('>I4s', hdr)
                data = f.read(length)
                f.read(4)  # CRC
                if chunk_type == b'tEXt':
                    nul = data.find(b'\x00')
                    if nul >= 0:
                        key = data[:nul].decode('latin-1', errors='replace')
                        val = data[nul+1:].decode('latin-1', errors='replace')
                        chunks[key] = val
                elif chunk_type == b'iTXt':
                    nul = data.find(b'\x00')
                    if nul >= 0:
                        key = data[:nul].decode('latin-1', errors='replace')
                        # skip compression flag (2 bytes) + lang tag + translated key
                        rest = data[nul+1:]
                        nul2 = rest.find(b'\x00\x00')
                        if nul2 >= 0:
                            val = rest[nul2+2:].decode('utf-8', errors='replace')
                            chunks[key] = val
                elif chunk_type == b'IEND':
                    break
    except Exception:
        pass
    return chunks

def collect_run_files(run_dir):
    files = []
    for dirpath, _, filenames in os.walk(run_dir):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, run_dir)
            files.append(rel)
    return sorted(files)

files = collect_run_files(run_dir)
images = [f for f in files if f.lower().endswith('.png')]

run_card = read_yaml_frontmatter(os.path.join(run_dir, 'ui-run-card.md'))

manifest = None
for candidate in ['batch-manifest.json', 'xyz-manifest.json']:
    p = os.path.join(run_dir, candidate)
    if os.path.exists(p):
        try:
            with open(p) as f:
                manifest = json.load(f)
            break
        except Exception:
            pass

run_meta_json = os.path.join(run_dir, 'run-metadata.json')
run_meta = None
if os.path.exists(run_meta_json):
    try:
        with open(run_meta_json) as f:
            run_meta = json.load(f)
    except Exception:
        pass

# Read PNG text chunks from primary image (if available)
png_info = {}
primary = run_card.get('primary_image') or (images[0] if images else None)
if primary:
    png_path = os.path.join(run_dir, primary)
    png_info = read_png_text_chunks(png_path)

metrics_tsv = os.path.join(run_dir, 'metrics.tsv')
metrics_rows = []
if os.path.exists(metrics_tsv):
    with open(metrics_tsv) as f:
        lines = f.read().splitlines()
    if len(lines) >= 2:
        header = lines[0].split('\t')
        for row_line in lines[1:]:
            row = row_line.split('\t')
            if len(row) == len(header):
                metrics_rows.append(dict(zip(header, row)))

result = {
    'run_id':      run_id,
    'run_dir':     run_dir,
    'run_card':    run_card,
    'manifest':    manifest,
    'run_meta':    run_meta,
    'png_info':    png_info,
    'metrics':     metrics_rows,
    'files':       files,
    'images':      images,
    'retrieved_at': datetime.datetime.utcnow().isoformat() + 'Z',
}
print(json.dumps(result, indent=2))
PYSCRIPT

echo ""
printf '==== PASS ====\nMetadata for run: %s\n' "$RUN_ID"
