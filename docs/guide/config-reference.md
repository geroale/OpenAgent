# Configuration Reference

## Full YAML

LLM providers (API keys, base URLs), the per-provider model catalog,
the MCP server list, and scheduled tasks all live in SQLite, not in
this file. Manage them via the `mcp-manager` / `model-manager` /
`scheduler` built-in MCPs, the REST endpoints (`/api/providers`,
`/api/mcps`, `/api/models`, `/api/scheduled-tasks`), or the desktop/CLI
UI. yaml stays the source of truth for identity, channels, memory
paths, dream mode, and auto-update.

```yaml
name: my-agent

system_prompt: |
  You are a helpful assistant.

# LLM provider credentials (API keys, base URLs), the per-provider
# model catalog, MCP servers, and scheduled tasks all live in SQLite.
# Add/manage them via the ``model-manager`` / ``mcp-manager`` /
# ``scheduler`` MCPs, the matching REST endpoints, the
# ``openagent provider`` CLI, or the Settings screens in the desktop
# app.

memory:
  db_path: "~/.openagent/openagent.db"
  vault_path: "~/.openagent/memories"

channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
    allowed_users: ["123456789"]
  discord:
    token: ${DISCORD_BOT_TOKEN}
    allowed_users: ["123456789012345678"]
    # allowed_guilds: []
    # listen_channels: []
    # dm_only: false
  whatsapp:
    green_api_id: ${GREEN_API_ID}
    green_api_token: ${GREEN_API_TOKEN}
    allowed_users: ["391234567890"]
  websocket:
    port: 8765
    token: ${OPENAGENT_WS_TOKEN}

services:
    enabled: true
    vault_path: ~/.openagent/memories
    folder_id: openagent-memories

dream_mode:
  enabled: true
  time: "3:00"

auto_update:
  enabled: true
  mode: auto
  check_interval: "17 */6 * * *"

service:
  # Linux only: optional raw systemd [Service] overrides for the generated
  # user unit. Omit this block entirely to leave OpenAgent uncapped.
  systemd:
    MemoryHigh: 2500M
    MemoryMax: 3500M
    MemorySwapMax: 1G
```

Environment variables are substituted using `${VAR_NAME}` syntax.

The Claude Agent SDK is always invoked with `permission_mode =
"bypassPermissions"` so scheduled and background turns never stall on
an approval prompt. Long tool calls (gradle, Electron builds, Maestro
suites) run to completion — the only per-turn ceiling is
`BRIDGE_RESPONSE_TIMEOUT` (65 min).

## CLI Reference

```bash
# Serve
openagent serve                        # full agent + channels + scheduler
openagent serve ./my-agent             # serve from agent directory
openagent serve -ch telegram           # single channel

# Multi-agent
openagent -d ./my-agent serve          # equivalent to serve ./my-agent
openagent list                         # list running agents
openagent migrate --to ./my-agent      # copy data to agent directory

# Doctor & setup
openagent doctor
openagent install                      # alias for setup --full
openagent uninstall
openagent status

# Services
openagent services status|start|stop

# Tasks
openagent task add -n "name" -c "cron" -p "prompt"
openagent task list|remove|enable|disable <id>

# Updates
openagent update

# MCP
openagent mcp list

# Providers
openagent provider list
openagent provider add <name> --key=<api-key>
openagent provider remove <name>
openagent provider test <name>

# Global options
openagent -c custom.yaml serve        # custom config
openagent -d ./my-agent serve         # agent directory
openagent -v serve                    # verbose logging
```

### Agent Directory (`--agent-dir` / `-d`)

When set, all data (config, database, memories, logs) is resolved relative to the specified directory instead of platform-standard locations. This enables running multiple independent agents:

```bash
openagent serve ./agent-a             # shorthand
openagent -d ./agent-a serve          # equivalent long form
openagent -d ./agent-a task list      # tasks for agent-a
openagent -d ./agent-a status         # service status for agent-a
```

The directory is created automatically with default config if it doesn't exist.
