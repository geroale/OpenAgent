# Configuration Reference

## Full YAML

Since v0.9.0 the **MCP list** and the **per-provider model catalog** live
in SQLite, not in this file. They are managed via the `mcp-manager` /
`model-manager` built-in MCPs, the REST endpoints (`/api/mcps`,
`/api/models/db`), or the desktop/CLI UI. yaml stays the source of
truth for identity, API keys, channels, memory paths, dream mode, and
auto-update.

```yaml
name: my-agent

system_prompt: |
  You are a helpful assistant.

# The active runtime is always the SmartRouter. Each session is routed
# to either the Agno stack or the Claude CLI registry based on a
# classifier + persistent session-side binding.
model:
  permission_mode: bypass        # bypass | auto | default
  monthly_budget: 50             # USD; 0 disables budget guardrails
  classifier_model: openai:gpt-4o-mini
  # Optional explicit routing. Leave empty to auto-derive from the
  # enabled models in the DB (sorted by output cost per million).
  # routing:
  #   simple: openai:gpt-4o-mini
  #   medium: openai:gpt-4.1-mini
  #   hard: claude-cli/claude-sonnet-4-6
  #   fallback: openai:gpt-4o-mini

# API keys + base URLs for LLM providers. The per-provider model list
# is NOT here — it lives in the ``models`` DB table.
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  google:
    api_key: ${GOOGLE_API_KEY}

# MCPs used to live in a yaml ``mcp:`` list. Since v0.9.0 they live in
# the ``mcps`` SQLite table. On upgrade, any pre-existing yaml entries
# are imported once into the DB and then ignored; use the MCPs screen,
# the ``/mcps`` slash command, or ``mcp-manager`` from inside the agent
# to add/remove/toggle servers at runtime.

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

scheduler:
  enabled: true       # global on/off switch for the scheduler loop
  # tasks: [...]      # DEPRECATED — tasks now live in SQLite. Manage them
                      # from the app's Tasks tab, the scheduler MCP, or the
                      # `openagent task` CLI. Legacy entries listed here are
                      # seeded into the DB once at startup with a warning.

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

For `claude-cli` sessions, you can optionally tune how long idle claude
subprocess clients are kept alive before the idle-cleanup task tears
them down:

```yaml
model:
  idle_ttl_seconds: 86400   # default: 24h
```

Legacy `model.provider` values (`claude-cli`, `anthropic`, `zhipu`, …)
are still accepted and translated into a SmartRouter whose tiers all
point at the single specified model. For most deployments, the cleaner
setup is to leave `model.provider` unset and register the models you
want in the DB via the model-manager MCP or the Models UI.

> Per-turn `idle_timeout_seconds` and `hard_timeout_seconds` knobs are still
> accepted for backwards compatibility but are no longer honoured — the only
> per-turn ceiling is `BRIDGE_RESPONSE_TIMEOUT` (65 min). Legitimately long
> tool calls (gradle, Electron builds, Maestro suites) now run to completion
> as long as they keep making progress.

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
