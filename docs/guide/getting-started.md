# Getting Started

## Installation

```bash
pip install openagent-framework[all]
```

Individual extras:
```bash
pip install openagent-framework          # core + CLI
pip install openagent-framework[telegram] # + Telegram
pip install openagent-framework[discord]  # + Discord
pip install openagent-framework[whatsapp] # + WhatsApp
pip install openagent-framework[websocket] # + WebSocket channel
pip install openagent-framework[voice]    # + local voice transcription (faster-whisper)
pip install openagent-framework[all]      # everything
```

## First Config

Create `openagent.yaml` in your working directory (or in `~/.config/openagent/` on Linux, `~/Library/Application Support/OpenAgent/` on macOS, `%APPDATA%\OpenAgent\` on Windows):

```yaml
name: my-agent

model:
  provider: claude-cli
  model_id: claude-sonnet-4-6
  permission_mode: bypass

channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
```

## First Run

```bash
openagent serve
```

The agent will:
1. Load config from `openagent.yaml`
2. Connect all configured MCPs (8 defaults + your custom ones)
3. Start configured channels (Telegram, Discord, WebSocket, etc.)
4. Start the scheduler (if enabled)
5. Start auxiliary services (Syncthing, etc.)

Send a message to your Telegram bot — it will respond.
