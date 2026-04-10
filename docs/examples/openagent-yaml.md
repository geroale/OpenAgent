# Example `openagent.yaml`

This is the full production-style example configuration currently shipped with the repository.

```yaml
# OpenAgent example configuration — full production-style setup.
#
# This is a sanitized version of the config powering the mixout-agent
# deployment on an OVH VPS. It ships ~11 user MCPs (GitHub, Firebase,
# Google Play, App Store Connect, ClickUp, Sentry, SSH, Google Workspace,
# Google Analytics, etc.), scheduled tasks, dream mode, and auto-update —
# all driven by a single YAML file.
#
# Data paths: by default OpenAgent stores config, DB, memories, and logs
# in the platform-standard directory:
#   - macOS:   ~/Library/Application Support/OpenAgent/
#   - Linux:   ~/.config/openagent/ (config), ~/.local/share/openagent/ (data)
#   - Windows: %APPDATA%\OpenAgent\
#
# You can override all paths via this YAML. If running under systemd,
# pass -c /path/to/openagent.yaml explicitly.
#
# Any value in the form ${VAR_NAME} is substituted from environment
# variables at load time. Tokens can also be inlined for single-machine
# setups — pick whichever suits your threat model.

name: my-agent

# Keep this short. Identity + pointer to the memory vault is enough —
# OpenAgent prepends a framework-level system prompt that already covers
# how to use the vault (mcpvault tools, wikilinks, frontmatter), MCP-vs-
# shell preference, acting autonomously, and concise output style. Put
# project-specific details (package names, app IDs, host names, procedures)
# INSIDE the memory vault as .md notes — the agent will find them with
# `search_notes`.
system_prompt: |
  You are My Agent, the persistent AI assistant for My Project.

  Your memory vault is at ~/.openagent/memories/. All project identity,
  credentials, infrastructure, procedures and contacts are documented
  there as notes. Search the vault first before answering any factual
  question about the project.

  Git author: My Agent <myagent@example.com> (no Co-Authored-By line).

model:
  provider: claude-cli            # use Claude Pro/Max membership instead of API
  model_id: claude-sonnet-4-6
  permission_mode: bypass         # auto-approve tool calls (agent deployments)

memory:
  db_path: ~/.openagent/openagent.db
  vault_path: ~/.openagent/memories

mcp_defaults: true                # load the 8 bundled defaults (vault, filesystem,
                                  # editor, web-search, shell, computer-control,
                                  # chrome-devtools, messaging, scheduler)

mcp:
  # ── Source control & code ─────────────────────────────────────────────
  - name: github
    command: [github-mcp-server, stdio]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}

  - name: sentry
    command: [npx, -y, "@sentry/mcp-server@latest"]
    env:
      SENTRY_ACCESS_TOKEN: ${SENTRY_TOKEN}
      SENTRY_HOST: sentry.io

  # ── Mobile / app stores ───────────────────────────────────────────────
  - name: google-play
    command:
      - npx
      - -y
      - "@blocktopus/mcp-google-play"
      - --api-key
      - /path/to/google-play-service-account.json

  - name: appstore-connect
    command: [npx, -y, "appstore-connect-mcp-server"]
    env:
      APP_STORE_CONNECT_KEY_ID: YOUR_KEY_ID
      APP_STORE_CONNECT_ISSUER_ID: YOUR_ISSUER_ID
      APP_STORE_CONNECT_P8_PATH: /path/to/AuthKey.p8

  # ── Firebase (official) — auth, crashlytics, remoteconfig, firestore ──
  - name: firebase
    command:
      - firebase
      - mcp
      - --dir
      - ~/.openagent/firebase-config
      - --only
      - auth,crashlytics,remoteconfig,firestore

  # ── Google Workspace (Gmail, Drive) — separate HTTP server ──
  - name: google-workspace
    url: http://localhost:8000/mcp

  # ── Google Analytics 4 ────────────────────────────────────────────────
  - name: google-analytics
    command: [analytics-mcp]
    env:
      GOOGLE_APPLICATION_CREDENTIALS: /path/to/analytics-sa.json
      GOOGLE_PROJECT_ID: YOUR_GCP_PROJECT_ID

  # ── Task tracking ─────────────────────────────────────────────────────
  - name: clickup
    command: [npx, -y, "@cavort-it-systems/clickup-mcp"]
    env:
      CLICKUP_API_KEY: ${CLICKUP_API_KEY}
      CLICKUP_API_TOKEN: ${CLICKUP_API_KEY}
      CLICKUP_TEAM_ID: YOUR_CLICKUP_TEAM_ID

  # ── SSH MCP for driving remote servers from the agent ─────────────────
  - name: ssh-remote
    command: [npx, -y, "@idletoaster/ssh-mcp-server"]

channels:
  # Telegram bot — the most common deployment. Voice transcription via
  # faster-whisper (local, free) or OpenAI Whisper API (cloud fallback).
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
    allowed_users:
      - "YOUR_TELEGRAM_USER_ID"
      - "ANOTHER_TELEGRAM_USER_ID"

  # Discord bot — same commands as Telegram (/new /stop /status /queue
  # /help /usage), plus native slash commands and an inline stop button.
  # allowed_users is MANDATORY — the channel refuses to start without it.
  # discord:
  #   token: ${DISCORD_BOT_TOKEN}
  #   allowed_users:
  #     - "YOUR_DISCORD_USER_ID"
  #   allowed_guilds: []             # [] = any server
  #   listen_channels: []            # [] = mention required
  #   dm_only: false                 # true = DMs only

  # WebSocket — for the OpenAgent desktop/web app. JSON over WS with
  # shared-token auth. Connect via SSH tunnel or expose directly.
  websocket:
    port: 8765
    token: ${OPENAGENT_WS_TOKEN}
    # allowed_origins:
    #   - "http://localhost:3000"
    #   - "file://"

  # WhatsApp via Green API (no message editing, no inline buttons).
  # whatsapp:
  #   green_api_id: ${GREEN_API_ID}
  #   green_api_token: ${GREEN_API_TOKEN}
  #   allowed_users:
  #     - "391234567890"


scheduler:
  enabled: true
  tasks:
    - name: health-check
      cron: "*/30 * * * *"
      prompt: |
        Run health checks on all services. If any is down, send a
        Telegram alert via the telegram_send_message tool.

    - name: git-sync
      cron: "*/15 * * * *"
      prompt: |
        Run git pull in all project repos. Report only errors.

    - name: daily-costs-report
      cron: "0 9 * * *"
      prompt: |
        Update the costs spreadsheet and send a summary via Telegram.

# Nightly maintenance: consolidates duplicate memory files, cross-links
# notes with wikilinks, runs a system health check, writes a dream log.
dream_mode:
  enabled: true
  time: "3:00"

# Auto-update: pip upgrade from PyPI on schedule. mode=auto exits with
# code 75 so the OS service restarts with the new version.
auto_update:
  enabled: true
  mode: auto
  check_interval: "17 */6 * * *"
```
