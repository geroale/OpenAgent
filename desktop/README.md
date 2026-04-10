# OpenAgent Desktop

Electron desktop app for connecting to an OpenAgent instance.

> **Status**: Coming soon. This directory is reserved for the Electron app source.

## Architecture

The desktop app connects to a running OpenAgent server (local or remote) and provides:

- Chat interface with the agent
- Memory vault browser (Obsidian-compatible markdown)
- MCP tool status dashboard
- Scheduled task management

The Python framework (`openagent/`) and the Electron app (`desktop/`) are independent — the framework runs as a service, the desktop app is a client.
