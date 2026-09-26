#!/usr/bin/env bash
# Build and install the DexDiffusion macOS launcher app and pin it in the Dock.
#
#   scripts/install-macos-app.sh
#
# Result: /Applications/DexDiffusion.app (bundle id local.image-gen.wrapper,
# kept from the original Image_Gen wrapper for continuity). Clicking it runs
# bin/dexdiffusion start (reuses a healthy console or starts one detached),
# then shows the local UI http://127.0.0.1:31337/dexdiffusion/ in a window.
#
# Icon: built from the DexDiffusion "Dexter" artwork
#   operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg
# masked to its circular badge -> Contents/Resources/DexDiffusion.icns.
#
# Dock: exactly one DexDiffusion tile. A legacy Image_Gen tile is rewritten in
# place (same position); otherwise one tile is appended. Other Dock items are
# never touched, and the previous Dock prefs are backed up first.
# Legacy launchers (Image_Gen.app / Image_Gen Launcher.app in /Applications or
# ~/Applications) are moved, not deleted, to the retired-launchers archive.
# Safe to re-run; this is also the repair procedure. See DEXDIFFUSION.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/Image_Gen/ImageGenApp.swift"
ICON_SRC="$ROOT/operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg"
APP="/Applications/DexDiffusion.app"
BUNDLE_ID="local.image-gen.wrapper"
EXE_NAME="DexDiffusion"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
PLIST="$CONTENTS/Info.plist"
ICON="$RESOURCES/DexDiffusion.icns"
SUPPORT="$HOME/Library/Application Support/DexDiffusion"
RETIRED="$SUPPORT/retired-launchers"
GIT_HEAD="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
STAMP="$(date +%Y%m%d-%H%M%S)"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

[ -f "$SRC" ] || { echo "ERROR: missing Swift source: $SRC" >&2; exit 1; }
[ -f "$ICON_SRC" ] || { echo "ERROR: missing icon source: $ICON_SRC" >&2; exit 1; }
command -v swiftc >/dev/null 2>&1 || { echo "ERROR: swiftc not found. Install Xcode command line tools." >&2; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "ERROR: python3 Pillow (PIL) is required to build the icon." >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/dexdiffusion-app.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT

# ---- build into a staging bundle, then swap into place -----------------------
STAGE="$WORK/DexDiffusion.app"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"
swiftc -O -framework Cocoa -framework WebKit "$SRC" -o "$STAGE/Contents/MacOS/$EXE_NAME"
chmod 755 "$STAGE/Contents/MacOS/$EXE_NAME"

ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
python3 - "$ICON_SRC" "$ICONSET" <<'PY'
import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w, h = im.size
side = min(w, h)
im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
# The artwork is a blue circular badge on black; keep the badge, clear the corners.
scale = 4
mask = Image.new("L", (side * scale, side * scale), 0)
inset = int(side * 0.012) * scale
ImageDraw.Draw(mask).ellipse((inset, inset, side * scale - inset, side * scale - inset), fill=255)
im.putalpha(mask.resize((side, side), Image.LANCZOS))
master = im.resize((1024, 1024), Image.LANCZOS)
for name, px in {"icon_16x16": 16, "icon_16x16@2x": 32, "icon_32x32": 32, "icon_32x32@2x": 64,
                 "icon_128x128": 128, "icon_128x128@2x": 256, "icon_256x256": 256,
                 "icon_256x256@2x": 512, "icon_512x512": 512, "icon_512x512@2x": 1024}.items():
    master.resize((px, px), Image.LANCZOS).save(f"{out}/{name}.png")
PY
iconutil -c icns "$ICONSET" -o "$STAGE/Contents/Resources/DexDiffusion.icns"

cat > "$STAGE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>$EXE_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>DexDiffusion</string>
  <key>CFBundleDisplayName</key>
  <string>DexDiffusion</string>
  <key>CFBundleIconFile</key>
  <string>DexDiffusion</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>DexDiffusionProjectRoot</key>
  <string>$ROOT</string>
  <key>DexDiffusionSourceHead</key>
  <string>$GIT_HEAD</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST
plutil -lint "$STAGE/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$STAGE/Contents/PkgInfo"
codesign --force --deep --sign - "$STAGE" >/dev/null 2>&1 || echo "WARN: ad-hoc codesign failed (app still runs locally)"

mkdir -p "$RETIRED"
if [ -e "$APP" ]; then
  mv "$APP" "$RETIRED/DexDiffusion-previous-$STAMP.app"
fi
# Archived bundles share the bundle id; keep Launch Services pointed only at $APP.
for b in "$RETIRED"/*.app; do
  [ -e "$b" ] && [ -x "$LSREGISTER" ] && "$LSREGISTER" -u "$b" >/dev/null 2>&1 || true
done
mv "$STAGE" "$APP"
touch "$APP"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true

# ---- retire legacy launchers (moved, never deleted) --------------------------
for old in "/Applications/Image_Gen.app" "/Applications/Image_Gen Launcher.app" \
           "$HOME/Applications/Image_Gen.app" "$HOME/Applications/Image_Gen Launcher.app" \
           "/Applications/Image Gen Operator Console.app" "$HOME/Applications/Image Gen Operator Console.app"; do
  [ -e "$old" ] || continue
  id="$(plutil -extract CFBundleIdentifier raw "$old/Contents/Info.plist" 2>/dev/null || true)"
  script="$(osadecompile "$old/Contents/Resources/Scripts/main.scpt" 2>/dev/null || true)"
  if [ "$id" = "$BUNDLE_ID" ] || [ "$id" = "com.westcat.imagegen.operatorconsole" ] \
     || printf '%s' "$script" | grep -q "image-gen-launcher\|Image_Gen/operator-console"; then
    case "$old" in "$HOME"/*) where="home-Applications" ;; *) where="system-Applications" ;; esac
    dest="$RETIRED/$(basename "$old" .app)-$where-$STAMP.app"
    mv "$old" "$dest"
    [ -x "$LSREGISTER" ] && "$LSREGISTER" -u "$dest" >/dev/null 2>&1 || true
    echo "Retired legacy launcher: $old -> $dest"
  else
    echo "Left unrecognised bundle alone: $old"
  fi
done

# ---- Dock: exactly one DexDiffusion tile, edited in place --------------------
DOCK_BACKUP="$SUPPORT/dock-backup-$STAMP.plist"
defaults export com.apple.dock "$DOCK_BACKUP"
cp "$DOCK_BACKUP" "$WORK/dock.plist"
DOCK_RESULT="$(python3 - "$WORK/dock.plist" "$APP" <<'PY'
import plistlib, sys, urllib.parse
path, app = sys.argv[1], sys.argv[2]
want = "file://" + urllib.parse.quote(app) + "/"
legacy = {"file://" + urllib.parse.quote(p) + "/" for p in (
    "/Applications/Image_Gen.app", "/Applications/Image_Gen Launcher.app",
    "/Users/andrew/Applications/Image_Gen.app", "/Users/andrew/Applications/Image_Gen Launcher.app",
    "/Applications/Image Gen Operator Console.app", "/Users/andrew/Applications/Image Gen Operator Console.app")}
with open(path, "rb") as f:
    d = plistlib.load(f)
apps = d.get("persistent-apps", [])
def url(t):
    return ((t.get("tile-data") or {}).get("file-data") or {}).get("_CFURLString")
out, placed, changed = [], False, False
for t in apps:
    u = url(t)
    if u == want or u in legacy:
        if placed:
            changed = True          # drop duplicate / extra legacy tile
            continue
        td0 = t.get("tile-data") or {}
        stale_book = b"DexDiffusion.app" not in (td0.get("book") or b"DexDiffusion.app")
        if u != want or td0.get("file-label") != "DexDiffusion" or stale_book:
            td = t.setdefault("tile-data", {})
            # The cached bookmark/mod-dates point at the old bundle (and its old
            # icon); drop them so the Dock re-resolves the tile from the URL.
            for k in ("book", "file-mod-date", "parent-mod-date"):
                td.pop(k, None)
            td["file-data"] = {"_CFURLString": want, "_CFURLStringType": 15}
            td["file-label"] = "DexDiffusion"
            td["bundle-identifier"] = "local.image-gen.wrapper"
            changed = True
        placed = True
    out.append(t)
if not placed:
    out.append({"tile-type": "file-tile", "tile-data": {"file-data": {"_CFURLString": want, "_CFURLStringType": 15},
                "file-label": "DexDiffusion", "bundle-identifier": "local.image-gen.wrapper"}})
    changed = True
d["persistent-apps"] = out
with open(path, "wb") as f:
    plistlib.dump(d, f)
print("changed" if changed else "unchanged")
PY
)"
if [ "$DOCK_RESULT" = "changed" ]; then
  defaults import com.apple.dock "$WORK/dock.plist"
  echo "Dock updated (backup: $DOCK_BACKUP)"
else
  echo "Dock already correct (backup: $DOCK_BACKUP)"
fi
# Narrow refresh of the current user's Dock so the new tile/icon are drawn.
killall Dock 2>/dev/null || true

echo "Installed $APP"
echo "  bundle id:  $BUNDLE_ID"
echo "  executable: $APP/Contents/MacOS/$EXE_NAME"
echo "  icon:       $APP/Contents/Resources/DexDiffusion.icns (from $ICON_SRC)"
echo "  source:     $ROOT (HEAD $GIT_HEAD)"
echo "Verify with: bin/dexdiffusion status"
