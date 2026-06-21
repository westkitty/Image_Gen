#!/usr/bin/env bash
# sdcpp-summarize-benchmarks.sh — summarize a benchmark TSV into Markdown +
# printed ranking + a data-driven recommendation. Pure shell/awk (no Python).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

TSV="${1:-}"
if [ -z "$TSV" ]; then
  TSV="$(ls -t "$SDCPP_RUNS_DIR"/*-benchmark*/benchmark-results.tsv 2>/dev/null | head -1 || true)"
fi
[ -n "$TSV" ] && [ -f "$TSV" ] || fail "input" "No benchmark TSV found. Pass a path, or run sdcpp-benchmark.sh first."

OUT="$(dirname "$TSV")/benchmark-summary.md"

# Columns: 1 run_id 2 ts 3 mode 4 preset 5 w 6 h 7 steps 8 cfg 9 sampler 10 repeat
#          11 status 12 elapsed 13 png_bytes 14 png_path 15 report 16 notes

# avg elapsed for a mode+preset (numeric PASS only)
avg() { awk -F'\t' -v m="$1" -v p="$2" 'NR>1 && $3==m && $4==p && $11=="PASS" && $12+0==$12 {s+=$12;n++} END{if(n)printf "%.2f",s/n; else printf "n/a"}' "$TSV"; }
avgbytes() { awk -F'\t' -v m="$1" -v p="$2" 'NR>1 && $3==m && $4==p && $11=="PASS" && $13+0==$13 {s+=$13;n++} END{if(n)printf "%d",s/n; else printf "0"}' "$TSV"; }

PASS_N="$(awk -F'\t' 'NR>1 && $11=="PASS"{c++} END{print c+0}' "$TSV")"
FAIL_N="$(awk -F'\t' 'NR>1 && $11!="PASS"{c++} END{print c+0}' "$TSV")"

# overall fastest PASS cell
FASTEST_LINE="$(awk -F'\t' 'NR>1 && $11=="PASS" && $12+0==$12 {print $12"\t"$3"\t"$4}' "$TSV" | sort -n | head -1)"
FASTEST_MODE="$(printf '%s' "$FASTEST_LINE" | cut -f2)"
FASTEST_PRESET="$(printf '%s' "$FASTEST_LINE" | cut -f3)"
FASTEST_SECS="$(printf '%s' "$FASTEST_LINE" | cut -f1)"

# fastest CLI / fastest server preset
FAST_CLI="$(awk -F'\t' 'NR>1 && $3=="cli" && $11=="PASS" && $12+0==$12 {print $12"\t"$4}' "$TSV" | sort -n | head -1)"
FAST_SRV="$(awk -F'\t' 'NR>1 && $3 ~ /^server-/ && $11=="PASS" && $12+0==$12 {print $12"\t"$4}' "$TSV" | sort -n | head -1)"

# key averages for recommendation
CLI_FAST="$(avg cli fast)"
SRV_FAST="$(avg server-openai fast)"
SRV_SMOKE="$(avg server-openai smoke)"
SRV_BAL="$(avg server-openai balanced)"
SRV_QUAL="$(avg server-openai quality)"
CLI_SMOKE_PASS="$(awk -F'\t' 'NR>1 && $3=="cli" && $4=="smoke" && $11=="PASS"{c++} END{print c+0}' "$TSV")"
CLI_FAST_PASS="$(awk -F'\t' 'NR>1 && $3=="cli" && $4=="fast" && $11=="PASS"{c++} END{print c+0}' "$TSV")"

# ----- recommendation logic (data-driven; see docs/optimization.md) ----------
REC=""
num() { case "$1" in ''|n/a) return 1;; *) [ "$1" = "$(printf '%s' "$1" | awk '{print $1+0}')" ] || awk -v x="$1" 'BEGIN{exit !(x+0==x)}';; esac; }

# fast vs smoke sanity for CLI
if [ "$CLI_SMOKE_PASS" -ge 1 ] && [ "$CLI_FAST_PASS" -eq 0 ] && awk -F'\t' 'NR>1 && $3=="cli" && $4=="fast"{seen=1} END{exit !seen}' "$TSV"; then
  REC="CLI smoke passes but CLI fast failed -> recommend SMOKE only for CLI and investigate the fast failure (see benchmark.log)."
fi

# server-warm vs CLI for the same preset (fast)
SERVER_MUCH_FASTER=0
if [ "$SRV_FAST" != "n/a" ] && [ "$CLI_FAST" != "n/a" ]; then
  if awk -v s="$SRV_FAST" -v c="$CLI_FAST" 'BEGIN{exit !(s>0 && c >= 1.5*s)}'; then SERVER_MUCH_FASTER=1; fi
fi

# balanced within 2x fast?
BAL_WITHIN_2X=0
if [ "$SRV_BAL" != "n/a" ] && [ "$SRV_FAST" != "n/a" ]; then
  if awk -v b="$SRV_BAL" -v f="$SRV_FAST" 'BEGIN{exit !(f>0 && b < 2*f)}'; then BAL_WITHIN_2X=1; fi
fi

if [ -z "$REC" ]; then
  REC="Default day-to-day: FAST preset"
  [ "$BAL_WITHIN_2X" -eq 1 ] && REC="$REC (BALANCED is < 2x fast and looks better — use it when quality matters)"
  REC="$REC. Use QUALITY deliberately (much slower)."
fi

MULTI_REC="For multiple images in a session, use SERVER (warm) mode"
[ "$SERVER_MUCH_FASTER" -eq 1 ] && MULTI_REC="$MULTI_REC — warm server requests are >=1.5x faster than repeated CLI here"
MULTI_REC="$MULTI_REC. For one-off generation, CLI is simplest (no server lifecycle)."

# ----- write summary ----------------------------------------------------------
{
  echo "# Benchmark Summary"
  echo
  echo "- Source TSV: $TSV"
  echo "- Generated: $(date)"
  echo "- Cells: PASS=$PASS_N FAIL=$FAIL_N"
  echo
  echo "## Fastest verified"
  echo "- Overall: ${FASTEST_MODE:-n/a} / ${FASTEST_PRESET:-n/a} @ ${FASTEST_SECS:-n/a}s"
  echo "- Fastest CLI preset: $(printf '%s' "$FAST_CLI" | cut -f2) @ $(printf '%s' "$FAST_CLI" | cut -f1)s"
  echo "- Fastest server preset: $(printf '%s' "$FAST_SRV" | cut -f2) @ $(printf '%s' "$FAST_SRV" | cut -f1)s"
  echo
  echo "## Average elapsed seconds (PASS only)"
  echo "| preset | cli | server-openai | server-openai avg png_bytes |"
  echo "|--------|-----|---------------|------------------------------|"
  for p in smoke thumbnail fast balanced quality quality_plus; do
    a="$(avg cli "$p")"; b="$(avg server-openai "$p")"; bb="$(avgbytes server-openai "$p")"
    if [ "$a" != "n/a" ] || [ "$b" != "n/a" ]; then
      echo "| $p | $a | $b | $bb |"
    fi
  done
  echo
  echo "## All PASS cells ranked by speed"
  echo "| elapsed_s | mode | preset | png_bytes |"
  echo "|-----------|------|--------|-----------|"
  awk -F'\t' 'NR>1 && $11=="PASS" && $12+0==$12 {print $12"\t"$3"\t"$4"\t"$13}' "$TSV" | sort -n | \
    awk -F'\t' '{printf "| %s | %s | %s | %s |\n",$1,$2,$3,$4}'
  echo
  if [ "$FAIL_N" -gt 0 ]; then
    echo "## Failures"
    awk -F'\t' 'NR>1 && $11!="PASS" {printf "- %s / %s (repeat %s): %s — %s\n",$3,$4,$10,$11,$16}' "$TSV"
    echo
  fi
  echo "## Recommendation"
  echo "- $REC"
  echo "- $MULTI_REC"
  echo
  echo "_Note: speed + PNG size + completion are measured here. Final visual quality needs human review._"
} > "$OUT"

echo "==== Benchmark Summary ===="
echo "Source: $TSV"
echo "Fastest: ${FASTEST_MODE:-n/a}/${FASTEST_PRESET:-n/a} @ ${FASTEST_SECS:-n/a}s   (PASS=$PASS_N FAIL=$FAIL_N)"
echo "avg cli fast=${CLI_FAST}s  server-openai fast=${SRV_FAST}s  smoke=${SRV_SMOKE}s  balanced=${SRV_BAL}s  quality=${SRV_QUAL}s"
echo "Recommendation: $REC"
echo "Multi-image:    $MULTI_REC"
echo "Summary written: $OUT"
exit 0
