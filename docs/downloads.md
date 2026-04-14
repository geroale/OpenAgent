# Downloads

OpenAgent offers **four access surfaces**:

1. **Web App** (hosted): a zero-install browser UI at [openagent.uno/app](https://openagent.uno/app/), built from the same React Native codebase as the Desktop App.
2. **Agent Server**: the persistent runtime in `openagent/`, installed on the machine that should actually run the agent, channels, memory, scheduler, and auto-updater.
3. **CLI Client**: a separate terminal client that connects to any running OpenAgent Gateway.
4. **Desktop App**: the Electron UI for chat, MCPs, memory, and configuration.

They are not bundled into one installer. In most setups you install the Agent Server on the host that will actually run OpenAgent, then reach it from the Web App in the browser, the CLI Client in a terminal, or the Desktop App on your workstation.

<div class="brand-section">

## Choose the right install flow

<div class="brand-flow">
  <div class="brand-flow-step">
    <strong>1. Install the Agent Server</strong>
    <p>Required if you want OpenAgent itself to run. This is the only component that talks to models, MCP servers, memory, channels, and the scheduler.</p>
  </div>
  <div class="brand-flow-step">
    <strong>2. Pick a client</strong>
    <p>Open the hosted <a href="https://openagent.uno/app/">Web App</a> for zero-install access, install the CLI Client for terminal workflows, or install the Desktop App for a native window. None of them replaces the server.</p>
  </div>
  <div class="brand-flow-step">
    <strong>3. Connect to the same Gateway</strong>
    <p>Every client connects to a running OpenAgent Gateway over WebSocket, so the runtime stays centralized while the access surface stays flexible.</p>
  </div>
</div>

</div>

## Web App

Nothing to download — the Web App is hosted.

- Open [openagent.uno/app](https://openagent.uno/app/) in any modern browser.
- Point it at a running Agent Server (same settings as the Desktop App).
- It is the exact same React Native codebase that powers the Desktop App, exported for the web via Expo.

Use the Web App when you want the OpenAgent UI on a machine where you cannot (or do not want to) install a native binary — a shared workstation, a tablet, a colleague's laptop.

## Agent Server

Install this if you want to run OpenAgent itself. Distributed as a **single self-contained executable** — no Python required, no folders, no bundled `_internal/` sibling. One file you drop into `$PATH` and run.

### One-line install (macOS / Linux)

```bash
curl -fsSL https://openagent.uno/install.sh | sh
```

The script picks the right asset for your platform, verifies the SHA-256, drops the binary into the first writable location among `~/.local/bin`, `~/bin`, `/usr/local/bin`, clears the macOS quarantine attribute, and prints any `PATH` hint you need. Pass `--prefix DIR` to override the install location.

### Manual download

Grab the archive from the cards below, extract it, move the binary somewhere on `$PATH`, and run:

```bash
tar xzf openagent-<ver>-<platform>-<arch>.tar.gz
chmod +x openagent
./openagent serve ./my-agent
```

- The archive contains **one file** (the `openagent` executable). No `_internal/` folder.
- On first launch the binary extracts bundled Python + Node MCP assets into `$TMPDIR/_MEI_*` (~5-10 s); subsequent launches reuse the cache and start in under a second.
- On first run it creates an agent directory with default config, database, and memory vault.
- The executable self-updates from GitHub Releases automatically.
- All artifacts ship through GitHub Releases — there is no PyPI channel.

Archive filenames follow the pattern `openagent-<version>-<platform>-<arch>.(tar.gz|zip)`.

### Platform notes

| Platform | One-time step for downloaded binaries |
|---|---|
| **macOS**  | The binary is unsigned. On first launch Finder refuses it with "cannot be opened". Either run `xattr -dr com.apple.quarantine ./openagent` (the one-line installer does this automatically) or right-click the file → Open → Open anyway, once. |
| **Linux**  | `chmod +x ./openagent` then run. Any modern distro (glibc ≥ 2.31) works. |
| **Windows** | First launch triggers Microsoft Defender SmartScreen ("Windows protected your PC"). Click **More info** → **Run anyway**, once per install. |

## CLI Client

Install this if you want a terminal UI for an already running OpenAgent server. Also a **single-file executable** — no Python required.

### One-line install

```bash
curl -fsSL https://openagent.uno/install.sh | sh -s -- --cli
```

### Manual download

```bash
tar xzf openagent-cli-<ver>-<platform>-<arch>.tar.gz
chmod +x openagent-cli
./openagent-cli connect localhost:8765 --token mysecret
```

- The CLI is a separate app and does not run the agent server for you.
- It connects to any OpenAgent Gateway over WebSocket.
- Archive filenames follow the pattern `openagent-cli-<version>-<platform>-<arch>.(tar.gz|zip)`.
- Same Gatekeeper / SmartScreen notes as the Agent Server.

## Desktop App

Install this if you want the Electron UI. Installer filenames follow the pattern `openagent-app-<version>-<platform>-<arch>.<ext>`.

- **macOS**: download `openagent-app-<ver>-macos-<arch>.dmg`, open it, and move OpenAgent to Applications. The `arm64` build is for Apple Silicon; the `x64` build is for Intel Macs.
- **Windows**: download `openagent-app-<ver>-windows-x64.exe` and complete the setup flow.
- **Linux**: download `openagent-app-<ver>-linux-x64.AppImage` or `.deb`, then launch the app and connect it to a running Agent Server.

The Desktop App is also independent: it is a client, not the runtime itself. The `latest*.yml` files attached to each release are auto-update metadata for Electron's updater — you do not need to download them manually.

## Latest GitHub Downloads

The cards below scan recent stable GitHub releases and always show the newest available download for each product family. That matters because the latest Agent Server tag may differ from the latest CLI or Desktop App tag.

<ReleaseDownloads />

## Build From Source

```bash
cd app
./setup.sh
./build.sh macos
./build.sh windows
./build.sh linux
```

For the server/CLI executables, see `scripts/build-executable.sh` and the repo-root PyInstaller specs (`openagent.spec`, `cli.spec`).

## Release Workflow

Tagged releases (`v*`) publish three executable families, all on GitHub Releases — no PyPI:

| Family | Archive pattern | Platforms |
|---|---|---|
| Agent Server | `openagent-<ver>-<platform>-<arch>.(tar.gz\|zip)` | macOS, Linux, Windows |
| CLI Client | `openagent-cli-<ver>-<platform>-<arch>.(tar.gz\|zip)` | macOS, Linux, Windows |
| Desktop App | `openagent-app-<ver>-<platform>-<arch>.(dmg\|exe\|AppImage\|deb)` | macOS, Windows, Linux |

Each server/CLI archive also ships a `.sha256` checksum. The Desktop App additionally uploads `latest*.yml` files used by the Electron auto-updater.

The download cards above update automatically when a new stable GitHub release is published for that app family. If a given app is not attached to any recent stable release yet, browse the full release history or build from source.
