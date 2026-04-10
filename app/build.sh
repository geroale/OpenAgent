#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Build ──
# Build production artifacts for a given platform.
#
# Usage:
#   ./build.sh web          Export static web build (universal/web-build/)
#   ./build.sh desktop      Build Electron app (desktop/release/)
#   ./build.sh ios          Build iOS archive (requires Xcode)
#   ./build.sh android      Build Android APK/AAB

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="${1:-web}"

echo "🏗️  OpenAgent App — Build ($PLATFORM)"
echo ""

case "$PLATFORM" in
    web)
        cd "$SCRIPT_DIR/universal"
        npx expo export --platform web
        echo ""
        echo "✅ Web build ready at universal/dist/"
        ;;
    desktop)
        # First build the web app, then package with Electron
        cd "$SCRIPT_DIR/universal"
        echo "📦 Building web app..."
        npx expo export --platform web
        echo ""

        # Copy web build into desktop/
        rm -rf "$SCRIPT_DIR/desktop/web-build"
        cp -r dist "$SCRIPT_DIR/desktop/web-build"

        cd "$SCRIPT_DIR/desktop"
        echo "📦 Packaging Electron app..."
        npm run build
        echo ""
        echo "✅ Desktop build ready at desktop/release/"
        ;;
    ios)
        cd "$SCRIPT_DIR/universal"
        npx expo build:ios
        ;;
    android)
        cd "$SCRIPT_DIR/universal"
        npx expo build:android
        ;;
    *)
        echo "❌ Unknown platform: $PLATFORM"
        echo "Usage: ./build.sh [web|desktop|ios|android]"
        exit 1
        ;;
esac
