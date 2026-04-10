#!/usr/bin/env bash
set -euo pipefail

# ── OpenAgent App — Setup ──
# Install dependencies across all workspaces.
#
# Usage:
#   ./setup.sh              Install everything (universal + desktop)
#   ./setup.sh universal    Install only universal/
#   ./setup.sh desktop      Install only desktop/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-all}"

echo "🔧 OpenAgent App — Setup"
echo ""

install_universal() {
    echo "📦 Installing universal/ dependencies..."
    cd "$SCRIPT_DIR/universal"
    npm install
    echo "✅ universal/ ready"
    echo ""
}

install_desktop() {
    echo "📦 Installing desktop/ dependencies..."
    cd "$SCRIPT_DIR/desktop"
    npm install
    echo "✅ desktop/ ready"
    echo ""
}

case "$TARGET" in
    all)
        install_universal
        install_desktop
        ;;
    universal)
        install_universal
        ;;
    desktop)
        install_desktop
        ;;
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: ./setup.sh [all|universal|desktop]"
        exit 1
        ;;
esac

echo "🎉 Setup complete"
