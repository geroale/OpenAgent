# Downloads

OpenAgent ships as **three independent downloads**:

1. **Agent Server**: the persistent runtime in `openagent/`, installed on the machine that should actually run the agent, channels, memory, scheduler, and auto-updater.
2. **CLI Client**: a separate terminal client that connects to any running OpenAgent Gateway.
3. **Desktop App**: the Electron UI for chat, MCPs, memory, and configuration.

They are not bundled into one installer. In most setups you install the Agent Server on the host that will actually run OpenAgent, then add the CLI Client or the Desktop App on your workstation.

<div class="brand-section">

## Choose the right install flow

<div class="brand-flow">
  <div class="brand-flow-step">
    <strong>1. Install the Agent Server</strong>
    <p>Required if you want OpenAgent itself to run. This is the only component that talks to models, MCP servers, memory, channels, and the scheduler.</p>
  </div>
  <div class="brand-flow-step">
    <strong>2. Add a client</strong>
    <p>Install the CLI Client for terminal workflows, the Desktop App for visual control, or both. Neither one replaces the server.</p>
  </div>
  <div class="brand-flow-step">
    <strong>3. Connect to the same Gateway</strong>
    <p>Both clients connect to a running OpenAgent Gateway over WebSocket, so the runtime stays centralized while the access surface stays flexible.</p>
  </div>
</div>

</div>

## Agent Server

Install this if you want to run OpenAgent itself.

```bash
pip install openagent-framework[all]
openagent serve
```

- GitHub Releases attach the Agent Server Python package as release assets.
- The Agent Server owns installation, service setup, and auto-update behavior.
- This is the component that talks to models, MCP servers, memory, channels, and scheduled jobs.

## CLI Client

Install this if you want a terminal UI for an already running OpenAgent server.

```bash
pip install openagent-cli
openagent-cli connect localhost:8765 --token mysecret
```

- The CLI is a separate app and does not run the agent server for you.
- It connects to any OpenAgent Gateway over WebSocket.
- Tagged releases attach CLI package artifacts alongside the other release assets.

## Desktop App

Install this if you want the Electron UI.

- **macOS**: download the `.dmg`, open it, and move OpenAgent to Applications.
- **Windows**: download the `.exe` installer and complete the setup flow.
- **Linux**: download the `.AppImage` or `.deb`, then launch the app and connect it to a running Agent Server.

The Desktop App is also independent: it is a client, not the runtime itself.

## Latest GitHub Downloads

The cards below scan recent stable GitHub releases and always show the newest available download for each product family. That matters because the latest Agent Server tag may differ from the latest CLI tag, and desktop installers can land on a different release than the Python packages.

<ReleaseDownloads />

## Build From Source

```bash
cd app
./setup.sh
./build.sh macos
./build.sh windows
./build.sh linux
```

## Release Workflow

- Tagged releases publish three artifact families:
  - Agent Server Python package
  - CLI Client Python package
  - Desktop App installers and update metadata
- The download cards above update automatically when a new stable GitHub release is published for that app family.
- If a given app is not attached to any recent stable release yet, browse the full release history or build from source.
