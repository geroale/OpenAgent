#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Start ──
# Launch the dev server for a given platform.
#
# Usage:
#   ./start.sh              Start web dev server (default)
#   ./start.sh web          Same — Expo web on localhost:8081
#   ./start.sh desktop      Start Electron (loads web dev server)
#   ./start.sh ios          Start iOS simulator (React Native)
#   ./start.sh android      Start Android emulator (React Native)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="${1:-web}"

echo "🚀 OpenAgent App — Start ($PLATFORM)"
echo ""

case "$PLATFORM" in
    web)
        cd "$SCRIPT_DIR/universal"
        npx expo start --web
        ;;
    desktop)
        # Start web dev server in background, then launch Electron
        cd "$SCRIPT_DIR/universal"
        npx expo start --web &
        WEB_PID=$!
        echo "⏳ Waiting for web dev server..."
        sleep 5

        cd "$SCRIPT_DIR/desktop"
        npm run dev

        # Cleanup web server on exit
        kill $WEB_PID 2>/dev/null || true
        ;;
    ios)
        cd "$SCRIPT_DIR/universal"
        npx expo start --ios
        ;;
    android)
        cd "$SCRIPT_DIR/universal"
        npx expo start --android
        ;;
    *)
        echo "❌ Unknown platform: $PLATFORM"
        echo "Usage: ./start.sh [web|desktop|ios|android]"
        exit 1
        ;;
esac
