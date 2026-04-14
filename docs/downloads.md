# Downloads

OpenAgent has four surfaces: the hosted [Web App](https://openagent.uno/app/), the **Agent Server** (the runtime), the **CLI Client**, and the **Desktop App**. The Web App needs no install — the other three are downloaded independently and connect to a running Agent Server.

## Latest builds

<ReleaseDownloads />

## Web App

Open [openagent.uno/app](https://openagent.uno/app/) in any browser and point it at a running Agent Server. Same React Native codebase as the Desktop App — useful when you can't install a native binary.

## Agent Server

Single self-contained executable — no Python required. Pick the install path that matches your platform:

### macOS — `.pkg` installer

Double-click `openagent-<ver>-macos-<arch>.pkg` from the cards below. It's signed + notarized with the ticket stapled, so Finder launches it with **zero warnings**. The installer drops the binary into `/usr/local/bin/openagent`. `arm64` is Apple Silicon, `x64` is Intel.

Or, from a terminal:

```bash
curl -fsSL https://openagent.uno/install.sh | sh
```

The script downloads the `.pkg`, extracts the binary with `pkgutil --expand-full` (no `sudo` needed), and drops it into `~/.local/bin`.

### Linux — `.tar.gz`

```bash
curl -fsSL https://openagent.uno/install.sh | sh
```

Or manually:

```bash
tar xzf openagent-<ver>-linux-x64.tar.gz
chmod +x openagent
./openagent serve ./my-agent
```

Any modern distro (glibc ≥ 2.31) works.

### Windows — `.zip`

Extract the `.zip`, double-click `openagent.exe`. One-time SmartScreen prompt on first launch — click **More info → Run anyway**. (No code-signing cert on Windows yet; that warning is unavoidable until we get one.)

### Runtime behaviour

- First launch extracts bundled runtime assets into `$TMPDIR/_MEI_*` (~5–10 s); later launches reuse the cache and start in under a second.
- The binary self-updates from GitHub Releases (downloads the `.pkg` on macOS, `.tar.gz` / `.zip` elsewhere).

## CLI Client

Single-file terminal client for a running Gateway. Same distribution shape as the server: `.pkg` on macOS, `.tar.gz` on Linux, `.zip` on Windows.

```bash
curl -fsSL https://openagent.uno/install.sh | sh -s -- --cli
```

Manual: download the installer/archive for your platform, then run `openagent-cli connect localhost:8765 --token mysecret`.

## Desktop App

Electron installers per platform:

- **macOS** — `openagent-app-<ver>-macos-<arch>.dmg` (`arm64` for Apple Silicon, `x64` for Intel).
- **Windows** — `openagent-app-<ver>-windows-x64.exe`.
- **Linux** — `openagent-app-<ver>-linux-x64.AppImage` or `.deb`.

The `latest*.yml` files attached to each release are Electron auto-update metadata — you don't download them manually.

## Build from source

```bash
cd app
./setup.sh
./build.sh macos   # or windows, linux
```

For the server/CLI executables see `scripts/build-executable.sh` and the PyInstaller specs (`openagent.spec`, `cli.spec`).
