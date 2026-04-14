#!/bin/sh
# OpenAgent one-liner installer for macOS / Linux.
#
# Usage:
#   curl -fsSL https://openagent.uno/install.sh | sh
#   curl -fsSL https://openagent.uno/install.sh | sh -s -- --cli
#   curl -fsSL https://openagent.uno/install.sh | sh -s -- --prefix /opt/bin
#
# Downloads the latest server (or CLI with --cli) release from GitHub,
# verifies the SHA256, drops the binary into $PREFIX (default: the first
# writable path among ~/.local/bin, ~/bin, /usr/local/bin), marks it
# executable, and — on macOS — clears the com.apple.quarantine attribute
# so Gatekeeper doesn't refuse the first launch.
#
# The installer is intentionally POSIX ``sh`` with no bashisms so it runs
# on minimal systems (BusyBox, fresh macOS shells, etc.).

set -eu

REPO="geroale/OpenAgent"
PRODUCT="server"   # "server" | "cli"
PREFIX=""

while [ $# -gt 0 ]; do
    case "$1" in
        --cli)         PRODUCT="cli"; shift ;;
        --server)      PRODUCT="server"; shift ;;
        --prefix)      PREFIX="$2"; shift 2 ;;
        --prefix=*)    PREFIX="${1#*=}"; shift ;;
        -h|--help)
            cat <<EOF
OpenAgent installer

Flags:
  --cli          Install the CLI client (default: the server)
  --server       Install the server (default)
  --prefix DIR   Install into DIR (default: first writable of ~/.local/bin,
                 ~/bin, /usr/local/bin)
EOF
            exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

if [ "$PRODUCT" = "server" ]; then
    APP="openagent"
else
    APP="openagent-cli"
fi

# ── Platform detection ───────────────────────────────────────────────

UNAME_S=$(uname -s)
UNAME_M=$(uname -m)

case "$UNAME_S" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)
        echo "Unsupported OS: $UNAME_S. Download manually from https://github.com/$REPO/releases" >&2
        exit 1 ;;
esac

case "$UNAME_M" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        echo "Unsupported arch: $UNAME_M" >&2
        exit 1 ;;
esac

# ── Pick the install prefix ──────────────────────────────────────────

if [ -z "$PREFIX" ]; then
    for candidate in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
        if [ -d "$candidate" ] && [ -w "$candidate" ]; then
            PREFIX="$candidate"
            break
        fi
    done
    # If none exist, create ~/.local/bin — most distros already include it
    # on $PATH, and it's a non-root location.
    if [ -z "$PREFIX" ]; then
        PREFIX="$HOME/.local/bin"
        mkdir -p "$PREFIX"
    fi
fi

# ── Resolve the latest release asset ─────────────────────────────────

ASSET="${APP}-*-${OS}-${ARCH}.tar.gz"
API="https://api.github.com/repos/${REPO}/releases/latest"

echo "→ Resolving latest release for $APP ($OS/$ARCH)..."
TAG=$(curl -fsSL "$API" | grep '"tag_name"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
if [ -z "$TAG" ]; then
    echo "Could not resolve a latest release tag." >&2
    exit 1
fi
VERSION="${TAG#v}"

ARCHIVE="${APP}-${VERSION}-${OS}-${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE}"
SHA_URL="${URL}.sha256"

# ── Download + verify ────────────────────────────────────────────────

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloading $ARCHIVE..."
curl -fsSL "$URL" -o "$TMP/$ARCHIVE"

if curl -fsSLI "$SHA_URL" >/dev/null 2>&1; then
    echo "→ Verifying SHA-256..."
    curl -fsSL "$SHA_URL" -o "$TMP/${ARCHIVE}.sha256"
    EXPECTED=$(awk '{print $1}' "$TMP/${ARCHIVE}.sha256")
    if command -v shasum >/dev/null 2>&1; then
        ACTUAL=$(shasum -a 256 "$TMP/$ARCHIVE" | awk '{print $1}')
    else
        ACTUAL=$(sha256sum "$TMP/$ARCHIVE" | awk '{print $1}')
    fi
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "Checksum mismatch." >&2
        echo "  expected: $EXPECTED" >&2
        echo "  actual:   $ACTUAL"   >&2
        exit 1
    fi
fi

# ── Extract + install ────────────────────────────────────────────────

tar xzf "$TMP/$ARCHIVE" -C "$TMP"
BINARY="$TMP/$APP"
if [ ! -x "$BINARY" ] && [ -f "$BINARY" ]; then
    chmod +x "$BINARY"
fi
if [ ! -x "$BINARY" ]; then
    echo "Archive did not contain the expected binary ($APP)." >&2
    exit 1
fi

DEST="$PREFIX/$APP"
echo "→ Installing to $DEST"
mv "$BINARY" "$DEST"
chmod +x "$DEST"

# On macOS, browser downloads are quarantined. When we installed via a
# terminal pipe that attribute doesn't apply — but clear it anyway in
# case the user hit this path after a manual download.
if [ "$OS" = "macos" ] && command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
fi

# ── PATH hint ────────────────────────────────────────────────────────

echo
echo "✓ Installed $APP $VERSION to $DEST"
case ":$PATH:" in
    *":$PREFIX:"*) ;;
    *)
        echo
        echo "⚠  $PREFIX is not on your PATH. Add this to your shell profile:"
        echo "     export PATH=\"$PREFIX:\$PATH\""
        ;;
esac
echo
if [ "$PRODUCT" = "server" ]; then
    echo "Run: $APP serve ./my-agent"
else
    echo "Run: $APP connect localhost:8765"
fi
