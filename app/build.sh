#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Build ──
# Build production artifacts for a given platform.
#
# Usage:
#   ./build.sh web          Export static web build (universal/dist/)
#   ./build.sh macos        Build Electron .dmg for macOS
#   ./build.sh windows      Build Electron .exe/.nsis for Windows
#   ./build.sh linux        Build Electron .AppImage for Linux
#   ./build.sh ios          Build iOS archive (requires Xcode)
#   ./build.sh android      Build Android APK/AAB

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="${1:-web}"

echo "🏗️  OpenAgent App — Build ($PLATFORM)"
echo ""

build_web() {
    cd "$SCRIPT_DIR/universal"
    npx expo export --platform web
    echo ""
    echo "✅ Web build ready at universal/dist/"
}

build_desktop() {
    local TARGET="$1"   # --mac, --win, --linux

    # 1. Build the web app
    build_web

    # 2. Copy into desktop/ and fix paths for file:// protocol
    rm -rf "$SCRIPT_DIR/desktop/web-build"
    cp -r "$SCRIPT_DIR/universal/dist" "$SCRIPT_DIR/desktop/web-build"

    # Expo generates absolute paths (/favicon.ico, /_expo/...) which
    # don't work with Electron's file:// loading. Make them relative.
    sed -i.bak 's|href="/|href="./|g; s|src="/|src="./|g' "$SCRIPT_DIR/desktop/web-build/index.html"
    rm -f "$SCRIPT_DIR/desktop/web-build/index.html.bak"

    # 3. Package with electron-builder
    cd "$SCRIPT_DIR/desktop"

    # On macOS, set signing & notarization env vars (from keychain if not already set)
    if [[ "$TARGET" == "--mac" ]]; then
        export APPLE_ID="${APPLE_ID:-geroale2000@gmail.com}"
        export APPLE_TEAM_ID="${APPLE_TEAM_ID:-B4KWCQFY8V}"
        if [[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
            APPLE_APP_SPECIFIC_PASSWORD=$(security find-generic-password -a "$APPLE_ID" -s "AC_PASSWORD" -w 2>/dev/null || true)
            if [[ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]]; then
                export APPLE_APP_SPECIFIC_PASSWORD
                echo "🔑 Loaded notarization password from Keychain"
            else
                echo "⚠️  No APPLE_APP_SPECIFIC_PASSWORD set and none found in Keychain."
                echo "   Notarization will fail. Generate one at https://account.apple.com"
                read -rp "Continue without notarization? [y/N] " answer
                if [[ "${answer,,}" != "y" ]]; then
                    echo "Aborted."
                    exit 1
                fi
            fi
        fi
    fi

    echo "📦 Packaging Electron app ($TARGET)..."
    npx electron-builder "$TARGET"
    echo ""
    echo "✅ Desktop build ready at desktop/release/"
}

case "$PLATFORM" in
    web)
        build_web
        ;;
    macos)
        build_desktop "--mac"
        ;;
    windows)
        build_desktop "--win"
        ;;
    linux)
        build_desktop "--linux"
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
        echo "Usage: ./build.sh [web|macos|windows|linux|ios|android]"
        exit 1
        ;;
esac
