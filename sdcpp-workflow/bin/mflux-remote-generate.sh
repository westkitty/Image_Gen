#!/usr/bin/env bash
# mflux-remote-generate.sh — the Big Mac half of mflux-controlled-generate.sh.
# Sent over ssh as `bash -c "<this file>" name ARGS...`; never installed remotely.
#
#   $1 prompt, base64 (shell-safe alphabet; never interpolated raw)
#   $2 steps  $3 seed (>= 0)  $4 width  $5 height
#   $6 cache root (HF_HOME/XDG)  $7 mflux-generate-flux2 binary
#      ($6/$7 may be relative; they are resolved against Big Mac's $HOME)
#   $8 optional model dir (default: Big Mac internal 4-bit Klein path)
#
# Contract:
#   stdout = PNG bytes only; every log line goes to stderr.
#   stderr carries machine-readable markers:
#     MFLUX_REMOTE_TMP: <dir>
#     MFLUX_REMOTE_FAIL: <generator-exit|output-missing|output-empty|output-invalid> <detail>
#     MFLUX_REMOTE_PNG_SHA256: <sha>
#     MFLUX_REMOTE_EXIT: <status>        (always last; emitted by the EXIT trap)
#   The EXIT status must be reported in-band because Big Mac's Tailscale SSH
#   (/usr/bin/login -f ... zsh -c) always returns ssh exit-status 0.
#   The private mktemp dir is removed by the EXIT trap, i.e. only after the PNG
#   has been fully written to stdout (or on any failure/hangup).
set -uo pipefail

model_dir="${8:-$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit}"
case "$6" in /*) cache_root="$6" ;; *) cache_root="$HOME/$6" ;; esac
case "$7" in /*) mflux_bin="$7" ;; *) mflux_bin="$HOME/$7" ;; esac
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dexdiffusion-mflux.XXXXXXXX")" || { echo "MFLUX_REMOTE_FAIL: output-missing mktemp failed" >&2; echo "MFLUX_REMOTE_EXIT: 20" >&2; exit 20; }
finish() {
  local rc=$?
  rm -rf -- "$tmp"
  echo "MFLUX_REMOTE_EXIT: $rc" >&2
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
echo "MFLUX_REMOTE_TMP: $tmp" >&2

mkdir -p "$cache_root/huggingface" "$cache_root/xdg"
export HF_HOME="$cache_root/huggingface" XDG_CACHE_HOME="$cache_root/xdg" TOKENIZERS_PARALLELISM=false HF_HUB_OFFLINE=1
prompt="$(printf %s "$1" | base64 --decode)" || { echo "MFLUX_REMOTE_FAIL: generator-exit prompt decode failed" >&2; exit 21; }

"$mflux_bin" --model "$model_dir" --base-model flux2-klein-4b \
  --prompt "$prompt" --steps "$2" --seed "$3" --width "$4" --height "$5" --output "$tmp/out.png" >&2
gen_rc=$?
if [ "$gen_rc" -ne 0 ]; then
  echo "MFLUX_REMOTE_FAIL: generator-exit mflux exited $gen_rc" >&2
  exit 10
fi
if [ ! -e "$tmp/out.png" ]; then
  echo "MFLUX_REMOTE_FAIL: output-missing generator exited 0 but wrote no file" >&2
  exit 11
fi
if [ ! -s "$tmp/out.png" ]; then
  echo "MFLUX_REMOTE_FAIL: output-empty output file is 0 bytes" >&2
  exit 12
fi
if ! file "$tmp/out.png" | grep -q "PNG image data"; then
  echo "MFLUX_REMOTE_FAIL: output-invalid output is not PNG image data" >&2
  exit 13
fi
echo "MFLUX_REMOTE_PNG_SHA256: $(shasum -a 256 "$tmp/out.png" | cut -d' ' -f1)" >&2
cat "$tmp/out.png" || exit 14
exit 0
