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

    # 2. Copy into desktop/
    # The static server in desktop/src/main.ts serves web-build over HTTP,
    # so the absolute `/_expo/...` paths Expo emits work as-is.
    rm -rf "$SCRIPT_DIR/desktop/web-build"
    cp -r "$SCRIPT_DIR/universal/dist" "$SCRIPT_DIR/desktop/web-build"

    # 3. Package with electron-builder
    cd "$SCRIPT_DIR/desktop"

    local BUILDER_FLAGS=()

    if [[ "$TARGET" == "--mac" ]]; then
        export APPLE_ID="${APPLE_ID:-geroale2000@gmail.com}"
        export APPLE_TEAM_ID="${APPLE_TEAM_ID:-B4KWCQFY8V}"

        # Notarization: use creds if present or discoverable; otherwise skip.
        # Release builds run in CI with secrets; local builds stay unsigned.
        if [[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
            APPLE_APP_SPECIFIC_PASSWORD=$(security find-generic-password \
                -a "$APPLE_ID" -s "AC_PASSWORD" -w 2>/dev/null || true)
            [[ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]] && export APPLE_APP_SPECIFIC_PASSWORD
        fi

        local HAS_SIGN_IDENTITY=0
        if [[ -n "${CSC_LINK:-}" ]] || \
           security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
            HAS_SIGN_IDENTITY=1
        fi

        if [[ "${SKIP_SIGN:-0}" == "1" || "$HAS_SIGN_IDENTITY" == "0" ]]; then
            echo "🔓 No code-signing identity available — building unsigned (local dev build)"
            BUILDER_FLAGS+=(-c.mac.identity=null -c.mac.notarize=false)
        elif [[ "${SKIP_NOTARIZE:-0}" == "1" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
            echo "📝 Signing without notarization (SKIP_NOTARIZE=1 or no Apple password)"
            BUILDER_FLAGS+=(-c.mac.notarize=false)
        else
            echo "🔑 Signing + notarizing with Apple credentials"
        fi
    fi

    echo "📦 Packaging Electron app ($TARGET)..."
    # Compile + bundle ESM-only deps (@noble/ed25519, cbor2) into a CJS
    # bundle so Electron's require() loader can read them at startup.
    npx tsc
    node ./scripts/bundle-main.js
    # ${arr[@]+"${arr[@]}"} expands to nothing when empty (bash 3.2-safe under `set -u`)
    npx electron-builder "$TARGET" ${BUILDER_FLAGS[@]+"${BUILDER_FLAGS[@]}"}
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
