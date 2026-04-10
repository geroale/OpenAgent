# Desktop App

OpenAgent ships an Electron desktop app that connects to any OpenAgent instance via the WebSocket channel. Built with React Native Web — the same codebase compiles for web, macOS, Windows, Linux, and future iOS/Android.

## Quick Start

```bash
cd app
./setup.sh              # install dependencies (universal + desktop)
./start.sh macos        # start Electron in dev mode
```

## Screens

- **Login** — connect to local (`localhost:8765`) or remote OpenAgent via host/port/token
- **Chat** — ChatGPT-style interface with multi-session support, real-time status updates
- **Vault** *(coming soon)* — Obsidian-style graph view + markdown editor
- **Config** *(coming soon)* — visual editor for openagent.yaml, MCP management

## Building

```bash
./build.sh macos        # → app/desktop/release/*.dmg
./build.sh windows      # → app/desktop/release/*.exe
./build.sh linux        # → app/desktop/release/*.AppImage
./build.sh web          # → app/universal/dist/ (static web)
```

## Auto-Update

The desktop app uses `electron-updater` with GitHub Releases. When a new release is published (via `scripts/release.sh`), the app detects it, downloads in background, and prompts the user to restart.

## Architecture

Following the Mixout-Client monorepo pattern:

```
app/
├── universal/          # Shared React Native + Web codebase
│   ├── app/            #   Expo Router screens (Login, Chat, ...)
│   ├── stores/         #   Zustand state (connection, chat, vault)
│   └── services/       #   WebSocket client, REST API, storage
├── desktop/            # Electron wrapper
│   └── src/            #   main.ts + auto-updater, preload.ts, services/
└── common/             # Shared TypeScript types (WS protocol, API)
```

## Shell Scripts

| Script | Purpose |
|--------|---------|
| `./setup.sh` | Install deps (universal + desktop) |
| `./start.sh web\|macos\|windows\|linux\|ios\|android` | Dev server |
| `./build.sh web\|macos\|windows\|linux\|ios\|android` | Production build |
| `./test.sh` | Lint + type check + unit tests |
