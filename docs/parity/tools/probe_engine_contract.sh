#!/usr/bin/env bash
# Read-only drift probe for docs/parity/ENGINE_CONTRACT.json (infrastructure A/E).
# Compares the live Big Mac sd-cli/sd-server sha256 and the sd-cli --help flag list with the pin.
# Output-based: the verdict comes from PROBE_* marker lines, never from the ssh exit status.
# Usage: docs/parity/tools/probe_engine_contract.sh      exit 0 = no drift, 1 = drift, 2 = probe failed
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
contract="${1:-$here/../ENGINE_CONTRACT.json}"
out="$(ssh -o BatchMode=yes -o ConnectTimeout=15 westcat 'cd ~/stable-diffusion.cpp \
  && echo "PROBE_REV=$(git rev-parse --short HEAD)" \
  && echo "PROBE_SHA sd-cli $(shasum -a 256 build/bin/sd-cli | cut -c1-64)" \
  && echo "PROBE_SHA sd-server $(shasum -a 256 build/bin/sd-server | cut -c1-64)" \
  && echo "PROBE_FLAGS $(./build/bin/sd-cli --help 2>&1 | grep -oE -- "--[a-z0-9-]+" | sort -u | tr "\n" " ")" \
  && echo PROBE_DONE' 2>/dev/null || true)"
if ! grep -q '^PROBE_DONE' <<<"$out"; then echo "PROBE FAILED: no result from Big Mac (unreachable is never evidence)"; exit 2; fi
PROBE_OUT="$out" python3 - "$contract" <<'PY' || exit 1
import json, os, sys
c = json.load(open(sys.argv[1])); eng = {e["id"]: e for e in c["engines"]}
live = {}; flags = set()
for line in os.environ["PROBE_OUT"].splitlines():
    if line.startswith("PROBE_REV="): live["rev"] = line.split("=", 1)[1]
    elif line.startswith("PROBE_SHA "): _, k, v = line.split(); live[k] = v
    elif line.startswith("PROBE_FLAGS "): flags = set(line.split()[1:])
drift = []
if live.get("rev") != eng["sd-cli"]["rev"]: drift.append(f"rev {live.get('rev')} != {eng['sd-cli']['rev']}")
for k in ("sd-cli", "sd-server"):
    if live.get(k) != eng[k]["sha256"]: drift.append(f"{k} sha256 {live.get(k)} != pinned {eng[k]['sha256']}")
missing = sorted(set(eng["sd-cli"]["flags"]) - flags)
if missing: drift.append("pinned flags missing live: " + " ".join(missing))
print("DRIFT: " + "; ".join(drift) if drift else f"NO DRIFT: sd-cli {live['rev']} sha256 {live['sd-cli'][:12]}… and {len(eng['sd-cli']['flags'])} pinned flags all present")
sys.exit(1 if drift else 0)
PY
