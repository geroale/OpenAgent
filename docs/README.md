# OpenAgent

Simplified LLM agent framework with MCP tools, persistent memory, and multi-channel support.

## Quick Start

```bash
pip install -e .                    # core + CLI
pip install -e ".[all]"             # includes Telegram, Discord, WhatsApp
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Start chatting:

```bash
openagent chat
```

---

## Models

OpenAgent supports multiple LLM providers. Set the provider in `openagent.yaml` or via code.

### Claude API (Anthropic SDK)

```yaml
model:
  provider: claude-api
  model_id: claude-sonnet-4-6     # or claude-opus-4-6, claude-haiku-4-5-20251001
  api_key: ${ANTHROPIC_API_KEY}
```

```python
from openagent.models import ClaudeAPI
model = ClaudeAPI(model="claude-sonnet-4-6", api_key="sk-ant-...")
```

### Claude CLI (Claude Code SDK)

Uses the `claude` CLI tool installed on your machine. Must be authenticated first (`claude login`).

```yaml
model:
  provider: claude-cli
  model_id: claude-sonnet-4-6     # optional, uses CLI default if omitted
```

```python
from openagent.models import ClaudeCLI
model = ClaudeCLI(model="claude-sonnet-4-6")
```

### Z.ai GLM (OpenAI-compatible)

```yaml
model:
  provider: zhipu
  model_id: glm-4                 # or glm-4-flash, glm-3-turbo
  api_key: ${ZHIPU_API_KEY}
  base_url: https://open.bigmodel.cn/api/paas/v4   # default
```

```python
from openagent.models import ZhipuGLM
model = ZhipuGLM(model="glm-4", api_key="your-key")
```

### Adding Custom / Local Models

Any OpenAI-compatible endpoint works with `ZhipuGLM` by changing `base_url`:

```python
# Ollama
model = ZhipuGLM(model="llama3", base_url="http://localhost:11434/v1", api_key="ollama")

# vLLM
model = ZhipuGLM(model="mistral", base_url="http://localhost:8000/v1", api_key="unused")
```

Or subclass `BaseModel` for full control:

```python
from openagent.models.base import BaseModel, ModelResponse

class MyModel(BaseModel):
    async def generate(self, messages, system=None, tools=None):
        # Your implementation
        return ModelResponse(content="Hello!")
```

---

## MCP (Model Context Protocol)

MCP servers are automatically available to all models and channels. OpenAgent includes **6 default MCPs** that are always loaded — your custom MCPs are merged on top.

### Default MCPs (always loaded)

These are injected automatically. No configuration needed.

| Name | Source | Tools | Requires |
|---|---|---|---|
| `filesystem` | [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) (official) | Read, write, list, search files | Node.js |
| `editor` | Custom (bundled) | `edit` (surgical find-replace), `grep` (regex search with context), `glob` (pattern file matching) | Node.js |
| `web-search` | [web-search-mcp](https://github.com/mrkrsl/web-search-mcp) (bundled) | `full-web-search`, `get-web-search-summaries`, `get-single-web-page-content` — no API key needed | Node.js + Playwright |
| `shell` | Custom (bundled) | `shell_exec`, `shell_which` — cross-platform shell execution | Node.js |
| `computer-use` | Custom (bundled) | `computer` — screenshot, mouse & keyboard control | Node.js |
| `chrome-devtools` | [chrome-devtools-mcp](https://www.npmjs.com/package/chrome-devtools-mcp) (official) | Browser automation, performance analysis, DOM inspection (29 tools) | Node.js + Chrome |

### Optional Built-in MCPs

These ship with OpenAgent but are **not loaded by default** (they require credentials):

| Name | Tools | Requires |
|---|---|---|
| `messaging` | `telegram_send_message`, `telegram_send_file`, `discord_send_message`, `discord_send_file`, `whatsapp_send_message`, `whatsapp_send_file` | Channel tokens (env vars) |

Enable messaging MCP:
```yaml
mcp:
  - builtin: messaging
    env:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
```

All defaults are cross-platform (macOS, Linux, Windows). If a prerequisite is missing, that MCP is skipped with a warning.

### Disabling Defaults

```yaml
# Disable all defaults
mcp_defaults: false

# Disable specific ones
mcp_disable: ["computer-use", "web-search"]
```

```python
# Programmatic
registry = MCPRegistry.from_config(mcp_config=[], include_defaults=False)
registry = MCPRegistry.from_config(mcp_config=[], disable=["computer-use"])
```

### Adding Your Own MCPs

User MCPs are merged on top of defaults. If you define one with the same name as a default, yours replaces it.

```yaml
mcp:
  # Add a custom MCP
  - name: database
    command: ["python", "-m", "mcp_server_sqlite"]
    args: ["--db", "mydata.db"]

  # Remote MCP server
  - name: web-search
    url: "http://localhost:8080/sse"

  # Override the default filesystem root
  - name: filesystem
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"]
    args: ["/Users/me/projects"]

  # With environment variables
  - name: github
    command: ["npx", "-y", "@anthropic/mcp-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

### Programmatic Usage

```python
from openagent.mcp import MCPTools, MCPRegistry

# With defaults (filesystem, fetch, shell, computer-use) + custom
registry = MCPRegistry.from_config(mcp_config=[
    {"name": "search", "url": "http://localhost:8080/sse"},
])

# Without defaults
registry = MCPRegistry.from_config(mcp_config=[...], include_defaults=False)

# Manual
registry = MCPRegistry()
registry.add(MCPTools(name="fs", command=["npx", "-y", "@modelcontextprotocol/server-filesystem"], args=["/data"]))

# Pass to agent
agent = Agent(model=model, mcp_registry=registry)
```

### List Available Tools

```bash
openagent mcp list
```

---

## Memory

OpenAgent has a **dual memory system**:

1. **SQL memories** (quick facts) — user preferences, short facts stored in SQLite rows
2. **Knowledge base** (detailed docs) — Obsidian-compatible `.md` files indexed by FTS5

### Configuration

```yaml
memory:
  db_path: "./openagent.db"       # SQLite database for sessions, messages, facts
  knowledge_dir: "./memories"     # Directory for .md knowledge files
  auto_extract: true              # auto-extract facts + knowledge from conversations
```

### How It Works

- **Session history**: every message stored immediately in SQLite
- **Quick-access facts**: short user preferences extracted automatically → SQLite `memories` table
- **Knowledge base**: detailed procedures, architecture notes, references → `.md` files in `memories/` directory
- **Hybrid search**: FTS5 full-text search across all knowledge files + SQL queries for facts
- **Deduplication**: checks for overlap before storing new memories
- **Obsidian-compatible**: `.md` files with YAML frontmatter, `[[wikilinks]]`, and tags — open the `memories/` folder in Obsidian for graph view and visual browsing

### Memory File Format

```markdown
---
topic: deploy
tags: [k8s, wardrobe, ovh]
links: [mixout-server-architecture, ovh-vps-setup]
created: 2026-04-07T12:00:00
updated: 2026-04-07T12:00:00
---
# Deploy Wardrobe Service
To deploy the wardrobe service to OVH k3s...
```

### Programmatic Usage

```python
from openagent.memory import MemoryDB, KnowledgeBase

agent = Agent(model=model, memory="my_app.db", knowledge_dir="./memories")

# Search knowledge base
results = await agent._memory.search_knowledge("how to deploy wardrobe")

# Add knowledge manually
await agent._memory.remember_knowledge(
    title="Deploy Procedure",
    content="rsync + docker build + k3s import...",
    topic="deploy",
    tags=["k8s", "ovh"],
)
```

### Disable Memory

```python
agent = Agent(model=model)  # no memory parameter = no persistence
```

---

## Channels

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Get the bot token

```yaml
channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
```

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
openagent serve --channel telegram
```

```python
from openagent.channels.telegram import TelegramChannel

channel = TelegramChannel(agent=agent, token="YOUR_BOT_TOKEN")
await channel.start()
```

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create an application, add a bot, copy the token
3. Enable "Message Content Intent" in Bot settings
4. Invite the bot to your server with `bot` + `applications.commands` scopes

```yaml
channels:
  discord:
    token: ${DISCORD_BOT_TOKEN}
```

```bash
export DISCORD_BOT_TOKEN=MTI...
openagent serve --channel discord
```

```python
from openagent.channels.discord import DiscordChannel

channel = DiscordChannel(agent=agent, token="YOUR_BOT_TOKEN")
await channel.start()
```

The bot responds to DMs and mentions.

### WhatsApp (Green API)

No WhatsApp Business account needed. Uses [Green API](https://green-api.com) free tier.

1. Sign up at https://green-api.com
2. Create an instance and scan the QR code with your phone
3. Copy the Instance ID and API Token

```yaml
channels:
  whatsapp:
    green_api_id: ${GREEN_API_ID}
    green_api_token: ${GREEN_API_TOKEN}
```

```bash
export GREEN_API_ID=1101...
export GREEN_API_TOKEN=abc123...
openagent serve --channel whatsapp
```

```python
from openagent.channels.whatsapp import WhatsAppChannel

channel = WhatsAppChannel(agent=agent, instance_id="ID", api_token="TOKEN")
await channel.start()
```

### Running Multiple Channels

```bash
# All configured channels
openagent serve

# Specific channels
openagent serve --channel telegram --channel discord
```

---

## YAML Config Reference

Full `openagent.yaml` example:

```yaml
name: my-assistant

system_prompt: |
  You are a helpful assistant specialized in coding.

model:
  provider: claude-api           # claude-api | claude-cli | zhipu
  model_id: claude-sonnet-4-6
  api_key: ${ANTHROPIC_API_KEY}
  # base_url: https://...        # only for zhipu/OpenAI-compatible

# mcp_defaults: true               # set false to disable all default MCPs
# mcp_disable: ["computer-use"]    # disable specific default MCPs

mcp:                                # user MCPs (merged on top of defaults)
  - name: web-search
    url: "http://localhost:8080/sse"

memory:
  db_path: "./openagent.db"
  auto_extract: true

channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
  discord:
    token: ${DISCORD_BOT_TOKEN}
  whatsapp:
    green_api_id: ${GREEN_API_ID}
    green_api_token: ${GREEN_API_TOKEN}
```

Environment variables are substituted using `${VAR_NAME}` syntax.

---

## Programmatic Usage

Use OpenAgent as a library in your own Python project:

```python
import asyncio
from openagent import Agent
from openagent.models import ClaudeAPI
from openagent.mcp import MCPTools
from openagent.memory import MemoryDB

async def main():
    agent = Agent(
        name="my-bot",
        model=ClaudeAPI(api_key="sk-ant-...", model="claude-sonnet-4-6"),
        system_prompt="You are a helpful coding assistant.",
        mcp_tools=[
            MCPTools(command=["npx", "-y", "@anthropic/mcp-filesystem"], args=["/data"]),
        ],
        memory=MemoryDB("my_app.db"),
    )

    async with agent:
        response = await agent.run("What files are in /data?", user_id="user-1")
        print(response)

asyncio.run(main())
```

### Streaming

```python
async with agent:
    async for chunk in agent.stream_run("Tell me a story"):
        print(chunk, end="", flush=True)
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for Claude API |
| `ZHIPU_API_KEY` | API key for Z.ai GLM |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `GREEN_API_ID` | Green API instance ID (WhatsApp) |
| `GREEN_API_TOKEN` | Green API token (WhatsApp) |

---

## Scheduler

Cron-based task scheduler. Tasks are stored in SQLite and survive process restarts and reboots.

### Configuration

```yaml
scheduler:
  enabled: true
  tasks:
    - name: daily-report
      cron: "0 9 * * *"
      prompt: "Generate and send the daily status report"
    - name: health-check
      cron: "*/30 * * * *"
      prompt: "Check all services and report any issues"
```

### CLI Management

```bash
openagent task add --name "daily-report" --cron "0 9 * * *" --prompt "Generate report"
openagent task list
openagent task remove <id>
openagent task enable <id>
openagent task disable <id>
```

The scheduler runs automatically as part of `openagent serve`.

---

## Media Support

All channels (Telegram, Discord, WhatsApp) support sending and receiving:
- Images (jpg, png, gif, webp)
- Files/documents (any type)
- Voice messages (ogg, mp3, wav)
- Videos (mp4, mov)

The agent can send files by including markers in its response:
```
Here's the chart you requested:
[IMAGE:/path/to/chart.png]

And the full report:
[FILE:/path/to/report.pdf]
```

---

## Auto-Start (System Service)

Install OpenAgent as a system service that starts on boot:

```bash
openagent install     # Register as system service
openagent uninstall   # Remove system service
openagent status      # Check if service is running
```

Cross-platform:
- **macOS**: launchd (~/Library/LaunchAgents/)
- **Linux**: systemd user unit (~/.config/systemd/user/)
- **Windows**: Task Scheduler

The service runs `openagent serve` with all configured channels and the scheduler.

---

## CLI Reference

```bash
openagent chat                         # Interactive chat
openagent chat -m zhipu                # Chat with Z.ai GLM
openagent chat --model-id glm-4-flash  # Override model ID
openagent chat -s session-123          # Resume session
openagent serve                        # Start all channels + scheduler
openagent serve -ch telegram           # Start specific channel
openagent task add -n "name" -c "cron" -p "prompt"  # Add scheduled task
openagent task list                    # List tasks
openagent task remove <id>             # Remove task
openagent mcp list                     # List MCP tools
openagent install                      # Install as system service
openagent uninstall                    # Remove system service
openagent status                       # Check service status
openagent --config my.yaml chat        # Use custom config file
openagent -v chat                      # Verbose/debug mode
```
