#!/bin/bash
# Regenerates build/icon.icns from the master PNG. macOS only (uses sips +
# iconutil). electron-builder picks up build/icon.icns automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/generate-icon.js

ICONSET=build/icon.iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"; do
  set -- $spec
  sips -z "$1" "$1" build/icon-1024.png --out "$ICONSET/$2" >/dev/null
done

iconutil -c icns "$ICONSET" -o build/icon.icns
rm -rf "$ICONSET"
echo "wrote build/icon.icns"
