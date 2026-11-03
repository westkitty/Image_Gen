#!/usr/bin/env bash
# Install the single per-user MacBook controller for DexDiffusion tunnel recovery.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="local.dexdiffusion.recovery"
SOURCE="$ROOT/scripts/local.dexdiffusion.recovery.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SUPPORT="$HOME/Library/Application Support/DexDiffusion/recovery"

case "${1:-install}" in
  install)
    mkdir -p "$(dirname "$DEST")" "$SUPPORT"
    chmod 700 "$SUPPORT"
    plutil -lint "$SOURCE" >/dev/null
    if [ -e "$DEST" ] && ! cmp -s "$SOURCE" "$DEST"; then
      echo "ERROR: preserving existing $DEST because it differs from project source." >&2
      exit 5
    fi
    if [ ! -e "$DEST" ]; then
      cp "$SOURCE" "$DEST.tmp.$$"
      chmod 600 "$DEST.tmp.$$"
      mv "$DEST.tmp.$$" "$DEST"
    fi
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "RECOVERY_AGENT_ALREADY_LOADED $DOMAIN/$LABEL"
    else
      launchctl bootstrap "$DOMAIN" "$DEST"
      echo "RECOVERY_AGENT_LOADED $DOMAIN/$LABEL"
    fi
    launchctl print "$DOMAIN/$LABEL"
    ;;
  uninstall)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL"
    fi
    if [ -e "$DEST" ]; then
      backup="$DEST.disabled-$(date +%Y%m%d-%H%M%S)"
      mv "$DEST" "$backup"
      echo "RECOVERY_AGENT_DISABLED; plist preserved at $backup"
    else
      echo "RECOVERY_AGENT_NOT_INSTALLED"
    fi
    ;;
  *) echo "usage: $0 {install|uninstall}" >&2; exit 2 ;;
esac
