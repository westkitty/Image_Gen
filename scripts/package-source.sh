#!/usr/bin/env bash
# package-source.sh — clean source archive using git archive.
# Excludes .git/, node_modules/, runs/, logs/, state/, proof blobs, and runtime junk.
# Output: /tmp/Image_Gen_source_<YYYYMMDD-HHMMSS>.zip
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/Image_Gen_source_${TIMESTAMP}.zip"

echo "Packaging git HEAD to $OUT …"
git archive --format=zip --output "$OUT" HEAD

echo ""
echo "Contents (first 60 entries):"
unzip -l "$OUT" | head -65

echo ""
echo "Checking for forbidden paths …"
FORBIDDEN="$(unzip -l "$OUT" | grep -E '(^|[/ ])(\.git|node_modules|runs|logs|state|\.playwright-mcp|Potential UI|\.DS_Store|\.proof-env)([/ ]|$)' | head -5 || true)"
if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: forbidden paths found in archive:" >&2
  echo "$FORBIDDEN" >&2
  exit 1
fi
echo "clean package ok (no forbidden paths)"

echo ""
CHECKSUM="$(shasum -a 256 "$OUT" | awk '{print $1}')"
SIZE="$(ls -lh "$OUT" | awk '{print $5}')"
echo "SHA256: $CHECKSUM"
echo "Size:   $SIZE"
echo "Output: $OUT"
