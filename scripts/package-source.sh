#!/usr/bin/env bash
# package-source.sh — clean source archive using git archive.
# Excludes .git/, node_modules/, runs/, logs/, state/, proof blobs, and runtime junk.
# Output: /tmp/Image_Gen_source_<YYYYMMDD-HHMMSS>.zip unless --output is provided.
set -euo pipefail

ALLOW_DIRTY=0
OUT=""

usage() {
  cat <<'EOF'
Usage: scripts/package-source.sh [--allow-dirty] [--output /path/file.zip]

Packages git HEAD with git archive. By default, refuses a dirty working tree so
uncommitted changes are not silently omitted.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --output) OUT="${2:?--output requires a path}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "ERROR: not inside a git repository" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [ -z "$OUT" ]; then
  OUT="/tmp/Image_Gen_source_${TIMESTAMP}.zip"
fi

DIRTY="$(git status --short)"
if [ -n "$DIRTY" ]; then
  echo "WARNING: packaging HEAD only; uncommitted changes are not included." >&2
  if [ "$ALLOW_DIRTY" != "1" ]; then
    echo "ERROR: working tree is dirty. Commit/stash changes or pass --allow-dirty." >&2
    git status --short >&2
    exit 1
  fi
fi

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
