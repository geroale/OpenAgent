# Apps & Distribution

OpenAgent is not a single installer. It is a **model-agnostic agent system** with four access surfaces: one hosted Web App plus three independent apps that are released together but installed separately.

Most setups look like this:

1. Install the **Agent Server** on the machine that should keep the agent running.
2. Open the hosted **Web App**, install the **CLI Client**, or install the **Desktop App** on the machine where you want to control that agent.
3. Point every client at the same OpenAgent Gateway.

## 1. Agent Server

This is the actual OpenAgent runtime in `openagent/`.

- Runs the model provider, MCP tools, memory, channels, scheduler, and auto-update flow
- Installs as `openagent-framework`
- Lives on the machine where the agent should run continuously

Typical install:

```bash
pip install openagent-framework[all]
openagent serve
```

## 2. CLI Client

This is the terminal client for talking to a running OpenAgent server.

- Installs as `openagent-cli`
- Connects to any OpenAgent Gateway over WebSocket
- Useful for ops, remote access, and low-friction local usage

Typical install:

```bash
pip install openagent-cli
openagent-cli connect localhost:8765 --token mysecret
```

## 3. Desktop App

This is the Electron app for chat, memory browsing, graph exploration, MCP configuration, and settings.

- Distributed as platform-specific binaries on GitHub Releases
- Connects to a running Agent Server
- Does not replace the server install

## 4. Web App

This is the browser build of the same React Native app that powers the Desktop App.

- Hosted at [openagent.uno/app](https://openagent.uno/app/) — no install required
- Built from `app/universal/` via `expo export --platform web` and deployed by the `Deploy Docs` GitHub Actions workflow alongside the documentation site
- Connects to a running Agent Server exactly like the Desktop App
- Useful when you want the OpenAgent UI on a device where installing a native binary is inconvenient (shared workstations, tablets, quick demos)

## Distribution Model

- Tagged GitHub releases are the shared download point for the three installable apps.
- The Agent Server and CLI Client are attached as Python package artifacts.
- The Desktop App is attached as macOS, Windows, and Linux installers.
- The Agent Server also supports install and auto-update flows after installation.
- The Web App is published continuously to GitHub Pages from the `main` branch, so `openagent.uno/app` always reflects the latest source.
- The [Downloads](../downloads.md) page resolves the newest available GitHub asset for each installable app separately, so one missing artifact family does not hide the others.

## Model-Agnostic Behavior

OpenAgent keeps the same operating surface across providers:

- Same MCP tools
- Same memory behavior
- Same channels and scheduler
- Same clients

Changing the model should not change how the system is operated.
