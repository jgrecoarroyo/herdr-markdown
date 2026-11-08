#!/bin/sh
# macOS only. Builds ~/Applications/Markdown Router.app from main.swift (needs Xcode's command line tools).
set -e
here=$(cd "$(dirname "$0")" && pwd)
app="$HOME/Applications/Markdown Router.app"
rm -rf "$app"; mkdir -p "$app/Contents/MacOS"
swiftc -O -o "$app/Contents/MacOS/MarkdownRouter" "$here/main.swift"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.github.jgrecoarroyo.markdown-router</string>
  <key>CFBundleName</key><string>Markdown Router</string>
  <key>CFBundleExecutable</key><string>MarkdownRouter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSBackgroundOnly</key><true/>
  <key>LSUIElement</key><true/>
  <key>CFBundleDocumentTypes</key><array><dict>
    <key>CFBundleTypeName</key><string>Markdown</string>
    <key>CFBundleTypeRole</key><string>Viewer</string>
    <key>LSHandlerRank</key><string>Alternate</string>
    <key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string></array>
  </dict></array>
</dict></plist>
PLIST
codesign -s - --force "$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
echo "built $app"
