# Getting Started

OpenAgent has three installable pieces plus a hosted Web App. You only need the **Agent Server** — the CLI and Desktop App are optional clients.

<ReleaseDownloads />

## Agent Server

The runtime. Install this on the machine where your agent should live.

**macOS** — double-click the `.pkg`. **Linux / Windows** — extract the archive. Or from a terminal:

```bash
curl -fsSL https://openagent.uno/install.sh | sh
```

Start it from any folder:

```bash
openagent serve ./my-agent
```

The folder becomes your agent — config, memory, and database live inside `./my-agent/`.

## CLI Client

A terminal client for talking to a running server. Download the archive above for your platform, extract it, then:

```bash
openagent-cli connect localhost:8765 --token mysecret
```

## Desktop App

A native chat window. Download the installer for your platform:

- **macOS** — `.dmg`
- **Windows** — `.exe`
- **Linux** — `.AppImage` or `.deb`

Launch it and point it at your Agent Server's address. Prefer no install? Use the hosted [Web App](https://openagent.uno/app/).

## Next steps

- [Configure your agent](./config-reference.md)
- [Pick a model](./models.md)
- [Add MCP tools](./mcp.md)
- [Connect a channel](./channels.md)
