#!/usr/bin/env bash
# Build and install the native Image_Gen macOS wrapper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/macos/Image_Gen/ImageGenApp.swift"
APP="/Applications/Image_Gen.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
BIN="$MACOS/Image_Gen"
PLIST="$CONTENTS/Info.plist"
ICONSET="$RESOURCES/AppIcon.iconset"
ICON="$RESOURCES/AppIcon.icns"
GIT_HEAD="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"

if [ ! -f "$SRC" ]; then
  echo "ERROR: missing Swift source: $SRC" >&2
  exit 1
fi

command -v swiftc >/dev/null 2>&1 || {
  echo "ERROR: swiftc not found. Install Xcode command line tools." >&2
  exit 1
}

mkdir -p "$MACOS" "$RESOURCES"
rm -rf "$CONTENTS/_CodeSignature" "$ICONSET"

swiftc \
  -O \
  -framework Cocoa \
  -framework WebKit \
  "$SRC" \
  -o "$BIN"

chmod 755 "$BIN"

mkdir -p "$ICONSET"
python3 - "$ICONSET" <<'PY'
import os
import struct
import sys
import zlib

out = sys.argv[1]
sizes = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

def inside_round_rect(x, y, w, h, r):
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    cx = r if x < r else (w - r - 1 if x >= w - r else x)
    cy = r if y < r else (h - r - 1 if y >= h - r else y)
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r

def blend(dst, src):
    sr, sg, sb, sa = src
    if sa >= 255:
        return src
    dr, dg, db, da = dst
    a = sa / 255.0
    return (
        int(sr * a + dr * (1 - a)),
        int(sg * a + dg * (1 - a)),
        int(sb * a + db * (1 - a)),
        max(da, sa),
    )

def rect(px, size, x0, y0, x1, y1, color):
    x0 = max(0, int(x0)); y0 = max(0, int(y0))
    x1 = min(size, int(x1)); y1 = min(size, int(y1))
    for y in range(y0, y1):
        row = px[y]
        for x in range(x0, x1):
            row[x] = blend(row[x], color)

def write_png(path, size):
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    r = int(size * 0.22)
    for y in range(size):
        for x in range(size):
            if inside_round_rect(x, y, size, size, r):
                t = (x + y) / max(1, 2 * size - 2)
                px[y][x] = (
                    int(5 + 18 * t),
                    int(19 + 32 * t),
                    int(31 + 40 * t),
                    255,
                )

    pad = size * 0.16
    rect(px, size, pad, pad, size - pad, pad + size * 0.09, (56, 189, 248, 235))
    rect(px, size, pad, size - pad - size * 0.09, size - pad, size - pad, (101, 214, 110, 235))
    rect(px, size, pad, pad, pad + size * 0.09, size - pad, (56, 189, 248, 210))
    rect(px, size, size - pad - size * 0.09, pad, size - pad, size - pad, (101, 214, 110, 210))

    # Stylized "I" and "G" built from rectangles so the icon generator has no font dependency.
    white = (232, 240, 247, 245)
    accent = (101, 214, 110, 245)
    stroke = max(2, size * 0.055)
    rect(px, size, size * 0.28, size * 0.31, size * 0.44, size * 0.31 + stroke, white)
    rect(px, size, size * 0.335, size * 0.31, size * 0.335 + stroke, size * 0.69, white)
    rect(px, size, size * 0.28, size * 0.69 - stroke, size * 0.44, size * 0.69, white)
    rect(px, size, size * 0.54, size * 0.31, size * 0.76, size * 0.31 + stroke, white)
    rect(px, size, size * 0.54, size * 0.31, size * 0.54 + stroke, size * 0.69, white)
    rect(px, size, size * 0.54, size * 0.69 - stroke, size * 0.76, size * 0.69, white)
    rect(px, size, size * 0.76 - stroke, size * 0.50, size * 0.76, size * 0.69, white)
    rect(px, size, size * 0.66, size * 0.50, size * 0.76, size * 0.50 + stroke, accent)

    raw = b"".join(b"\x00" + bytes(c for pixel in row for c in pixel) for row in px)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(data)

for name, size in sizes.items():
    write_png(os.path.join(out, name), size)
PY

iconutil -c icns "$ICONSET" -o "$ICON"
rm -rf "$ICONSET"

cat > "$PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Image_Gen</string>
  <key>CFBundleIdentifier</key>
  <string>local.image-gen.wrapper</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Image_Gen</string>
  <key>CFBundleDisplayName</key>
  <string>Image_Gen</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$CONTENTS/PkgInfo"
touch "$APP"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP" >/dev/null
fi

# Ensure the app is wired into the macOS Dock
if ! defaults read com.apple.dock persistent-apps | grep -q "Image_Gen.app"; then
  echo "Wiring Image_Gen.app into the macOS Dock..."
  defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$APP/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict><key>tile-type</key><string>file-tile</string></dict>"
  killall Dock
else
  echo "Image_Gen.app is already wired into the Dock. Refreshing Dock..."
  killall Dock
fi

echo "Installed $APP"
echo "Binary: $BIN"
echo "Icon: $ICON"
echo "Source: $ROOT (HEAD $GIT_HEAD)"
