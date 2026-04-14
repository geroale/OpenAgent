# Setup & Deployment

## VPS Quick Setup

### Standalone Executable (recommended)

```bash
# Download the latest release for your platform
curl -LO https://github.com/geroale/OpenAgent/releases/latest/download/openagent-linux-x64.tar.gz
tar xzf openagent-linux-x64.tar.gz

# Start with an agent directory
./openagent/openagent serve ./my-agent

# Register as OS service
./openagent/openagent -d ./my-agent setup
```

### pip install

```bash
pip install 'openagent-framework[all]'
openagent setup --full
```

## Doctor & Setup

```bash
openagent doctor                 # environment report
openagent setup                  # register as OS service
openagent setup --full           # everything
openagent install                # alias for setup --full
```

With an agent directory:
```bash
openagent -d ./my-agent doctor
openagent -d ./my-agent setup
```

## OS Service

OpenAgent registers as a platform-native service. When using agent directories, each agent gets a unique service name derived from the directory name.

### Default (single agent)

- **Linux** — systemd user unit (`~/.config/systemd/user/openagent.service`)
- **macOS** — launchd plist (`~/Library/LaunchAgents/com.openagent.serve.plist`)
- **Windows** — Task Scheduler entry with restart loop

### Per-agent (multi-agent)

- **Linux** — `openagent-<dirname>.service`
- **macOS** — `com.openagent.<dirname>.plist`
- **Windows** — `OpenAgent-<dirname>` task

```bash
# Linux (default agent)
systemctl --user status openagent
journalctl --user -u openagent -f

# Linux (named agent)
systemctl --user status openagent-my-agent
journalctl --user -u openagent-my-agent -f

# macOS
launchctl list com.openagent.serve       # default
launchctl list com.openagent.my-agent    # named

# Uninstall (any platform)
openagent uninstall
openagent -d ./my-agent uninstall       # specific agent
```

## Auto-Update

```yaml
auto_update:
  enabled: true
  mode: auto                    # auto | notify | manual
  check_interval: "17 */6 * * *"
```

- `auto` — upgrade + exit 75 (OS service restarts with new code)
- `notify` — upgrade + notify, no restart
- `manual` — upgrade only

The update mechanism adapts to the installation type:
- **Standalone executable**: downloads the latest release from GitHub, verifies checksum, and swaps the binary in place
- **pip install**: runs `pip install --upgrade openagent-framework`

Manual: `openagent update`

## Data Paths

### With agent directory (recommended)

When using `openagent serve ./my-agent`, all data lives inside the agent directory:

```
my-agent/
├── openagent.yaml    # configuration
├── openagent.db      # SQLite database
├── memories/         # memory vault
└── logs/             # log files
```

### Without agent directory (legacy)

OpenAgent stores files in platform-standard directories:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/OpenAgent/` |
| Linux | `~/.config/openagent/` (config), `~/.local/share/openagent/` (data) |
| Windows | `%APPDATA%\OpenAgent\` |

Override with `-c /path/to/openagent.yaml` or set paths in config.

## Testing

The repository ships with an end-to-end test suite that exercises the full gateway, agent, MCP, and model stack against real API keys. Each test lives in its own module under `scripts/tests/`:

```bash
# Full suite (reads API keys from ~/my-agent/openagent.yaml)
bash scripts/test_openagent.sh

# Include the Claude Agent SDK path (spawns the `claude` binary)
bash scripts/test_openagent.sh --include-claude

# Run a specific category only
bash scripts/test_openagent.sh --only files,rest,channels

# List all registered tests (category/name) and exit
bash scripts/test_openagent.sh --list
```

Categories:

| Category | What it covers |
|---|---|
| `imports`, `catalog` | Module compile + catalog/pricing helpers |
| `channels`, `formatting` | Pure-unit string utilities (attachment markers, split, Telegram/WhatsApp rendering) |
| `pool`, `mcp` | MCP pool lifecycle + per-server tool round-trips |
| `agno`, `router`, `budget` | Live LLM calls + SmartRouter tier classification + budget-aware fallback + `usage_log` rows |
| `gateway`, `sessions` | HTTP server boot + WebSocket message round-trip + session isolation |
| `upload`, `voice`, `files` | File/audio upload + voice transcription path + full agent-reads-uploaded-file pipeline through filesystem MCP + `[IMAGE:/…]` response markers → WS `attachments` field |
| `config`, `logs`, `usage`, `models`, `pricing`, `providers`, `vault_rest` | REST surface |
| `cron`, `dream`, `updater` | Scheduler roundtrip, dream-mode prompt, updater smoke |
| `bridges` | Telegram/Discord/WhatsApp module imports + `BaseBridge` contract |
| `claude_cli` | Claude Agent SDK one-shot + MCP tool invocation (needs `--include-claude`) |

The suite builds a throwaway agent dir under `/tmp/openagent-test-<uuid>/` so it never touches your real `my-agent` config or database.

### Migrating to agent directory

```bash
openagent migrate --to ./my-agent
```

This copies your existing config, database, and memories from platform-standard paths to the new agent directory.
