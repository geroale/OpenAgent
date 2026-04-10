# Channels

All channels support text, images, files, voice, and video. Live status updates show what the agent is doing ("⏳ Thinking..." → "🔧 Using shell_exec..." → response).

All channels share the same command vocabulary: `/new`, `/stop`, `/status`, `/queue`, `/help`, `/usage`.

## Telegram

```yaml
channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
    allowed_users: ["123456789", "987654321"]
```

Features: inline stop button, voice transcription (faster-whisper local or OpenAI Whisper API), markdown rendering via HTML parse mode.

## Discord

```yaml
channels:
  discord:
    token: ${DISCORD_BOT_TOKEN}
    allowed_users:
      - "123456789012345678"
    # allowed_guilds: []         # [] = any server
    # listen_channels: []        # [] = mention required
    # dm_only: false             # true = DMs only
```

`allowed_users` is **mandatory** — the channel refuses to start without it. Unauthorized messages are silently ignored. Supports native slash commands and an inline stop button.

## WhatsApp (Green API)

```yaml
channels:
  whatsapp:
    green_api_id: ${GREEN_API_ID}
    green_api_token: ${GREEN_API_TOKEN}
    allowed_users:
      - "391234567890"
```

No message editing and no inline buttons — users cancel with `/stop` text command.

## WebSocket (Desktop/Web App)

```yaml
channels:
  websocket:
    port: 8765
    token: ${OPENAGENT_WS_TOKEN}
```

JSON over WebSocket with shared-token auth. Used by the OpenAgent desktop app. For remote connections, use an SSH tunnel:

```bash
ssh -L 8765:localhost:8765 user@vps
```

REST endpoint: `GET /api/health` — agent name, version, connected clients.

## Running Multiple Channels

```bash
openagent serve                  # all configured channels
openagent serve -ch telegram     # specific channel only
```

## Media Support

The agent can send files by including markers in responses:
```
[IMAGE:/path/to/chart.png]
[FILE:/path/to/report.pdf]
[VOICE:/path/to/memo.ogg]
```

## Voice Transcription

Voice messages are transcribed automatically. Two backends (tried in order):

1. **faster-whisper** (local, free, no API key) — install with `pip install openagent-framework[voice]`
2. **OpenAI Whisper API** (cloud fallback) — requires `OPENAI_API_KEY` in environment
