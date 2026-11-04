#!/usr/bin/env bash
# Install the MacBook agent that shares ~/images_made with the Big Mac backend.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="local.dexdiffusion.imageservice"
SOURCE="$ROOT/scripts/$LABEL.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-install}" in
  install)
    plutil -lint "$SOURCE" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    cp "$SOURCE" "$DEST.tmp.$$"
    chmod 600 "$DEST.tmp.$$"
    mv "$DEST.tmp.$$" "$DEST"
    launchctl bootstrap "$DOMAIN" "$DEST"
    echo "IMAGE_SERVICE_LOADED $DOMAIN/$LABEL"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$DEST"
    echo "IMAGE_SERVICE_REMOVED"
    ;;
  *) echo "usage: $0 {install|uninstall}" >&2; exit 2 ;;
esac
