# Configuration Reference

## Full YAML

```yaml
name: my-agent

system_prompt: |
  You are a helpful assistant.

model:
  provider: claude-cli           # claude-cli | claude-api | zhipu | openai | smart
  model_id: claude-sonnet-4-6
  permission_mode: bypass        # bypass | auto | default
  # api_key: ${API_KEY}          # for claude-api, openai, zhipu
  # base_url: https://...        # for zhipu/OpenAI-compatible

# OR: Smart Router — classifies each message and picks the right tier model.
# Falls back to the cheap model automatically when monthly budget is exhausted.
# model:
#   provider: smart
#   monthly_budget: 50
#   classifier_model: gpt-4o-mini
#   routing:
#     simple: gpt-4o-mini
#     medium: gpt-4.1-mini
#     hard: gpt-4.1
#     fallback: gpt-4o-mini

providers:
  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4o-mini
      - gpt-4.1-mini
      - gpt-4.1
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      - claude-sonnet-4-6

mcp_defaults: true
# mcp_disable: ["computer-control"]

mcp:
  - name: github
    command: ["github-mcp-server", "stdio"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}
  - name: remote
    url: "https://mcp.example.com/sse"
    oauth: true

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
  enabled: true
  tasks:
    - name: health-check
      cron: "*/30 * * * *"
      prompt: "Check services and alert if down."

dream_mode:
  enabled: true
  time: "3:00"

auto_update:
  enabled: true
  mode: auto
  check_interval: "17 */6 * * *"
```

Environment variables are substituted using `${VAR_NAME}` syntax.

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
