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

if [ ! -f "$SRC" ]; then
  echo "ERROR: missing Swift source: $SRC" >&2
  exit 1
fi

command -v swiftc >/dev/null 2>&1 || {
  echo "ERROR: swiftc not found. Install Xcode command line tools." >&2
  exit 1
}

mkdir -p "$MACOS" "$RESOURCES"

swiftc \
  -O \
  -framework Cocoa \
  -framework WebKit \
  "$SRC" \
  -o "$BIN"

chmod 755 "$BIN"

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

echo "Installed $APP"
echo "Binary: $BIN"
