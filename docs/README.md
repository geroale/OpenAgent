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

Configure MCP servers once — they're automatically available to all models and channels.

### Configuration

```yaml
mcp:
  # Local server (stdio transport)
  - name: filesystem
    command: ["npx", "-y", "@anthropic/mcp-filesystem"]
    args: ["/Users/me/data"]

  # Another local server
  - name: database
    command: ["python", "-m", "mcp_server_sqlite"]
    args: ["--db", "mydata.db"]

  # Remote server (SSE transport)
  - name: web-search
    url: "http://localhost:8080/sse"

  # With environment variables
  - name: github
    command: ["npx", "-y", "@anthropic/mcp-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

### Programmatic Usage

```python
from openagent.mcp import MCPTools, MCPRegistry

# Single server
mcp = MCPTools(name="fs", command=["npx", "-y", "@anthropic/mcp-filesystem"], args=["/data"])

# Multiple servers via registry
registry = MCPRegistry()
registry.add(MCPTools(name="fs", command=["npx", "-y", "@anthropic/mcp-filesystem"], args=["/data"]))
registry.add(MCPTools(name="search", url="http://localhost:8080/sse"))

# Pass to agent
agent = Agent(model=model, mcp_registry=registry)
# OR
agent = Agent(model=model, mcp_tools=[mcp1, mcp2])
```

### List Available Tools

```bash
openagent mcp list
```

---

## Memory

All memory is stored in a SQLite database. No files, no scattered storage.

### Configuration

```yaml
memory:
  db_path: "./openagent.db"     # default: openagent.db
  auto_extract: true             # auto-extract facts from conversations (default: true)
```

### How It Works

- **Session history**: every message is stored immediately in the DB. When a session resumes, the last N messages are loaded as context.
- **Long-term memory**: after each conversation turn, the model extracts key facts about the user (preferences, context, etc.) and stores them in a `memories` table.
- **Deduplication**: before storing a new memory, it checks for overlap with existing ones to avoid duplicates.

### Programmatic Usage

```python
from openagent.memory import MemoryDB

# Pass DB path or MemoryDB instance
agent = Agent(model=model, memory="my_app.db")
# OR
db = MemoryDB("my_app.db")
agent = Agent(model=model, memory=db)

# Resume a session
response = await agent.run("Continue our conversation", session_id="session-123")
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

mcp:
  - name: filesystem
    command: ["npx", "-y", "@anthropic/mcp-filesystem"]
    args: ["/Users/me/projects"]
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

## CLI Reference

```bash
openagent chat                         # Interactive chat
openagent chat -m zhipu                # Chat with Z.ai GLM
openagent chat --model-id glm-4-flash  # Override model ID
openagent chat -s session-123          # Resume session
openagent serve                        # Start all configured channels
openagent serve -ch telegram           # Start specific channel
openagent mcp list                     # List MCP tools
openagent --config my.yaml chat        # Use custom config file
openagent -v chat                      # Verbose/debug mode
```
