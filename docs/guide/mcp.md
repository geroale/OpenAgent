# MCP Tools

All MCP tools are available to every model — model-agnostic by design. OpenAgent includes **8 default MCPs** that load automatically.

## Default MCPs

| Name | What it does | Requires |
|---|---|---|
| `vault` | Read/write Obsidian-compatible markdown notes | Node.js |
| `filesystem` | Read, write, list, search files | Node.js |
| `editor` | Find-replace, grep, glob | Node.js |
| `web-search` | Web search + page fetch, no API key | Node.js + Playwright |
| `shell` | Cross-platform shell execution | Node.js |
| `computer-control` | Screenshot, mouse, keyboard (macOS/Linux/Windows) | Node.js |
| `chrome-devtools` | Browser automation, DOM, performance | Node.js + Chrome |
| `messaging` | Send messages via Telegram/Discord/WhatsApp | Channel tokens |
| `scheduler` | Manage cron tasks from within conversations | Python |

## Disabling Defaults

```yaml
mcp_defaults: false                    # disable all
mcp_disable: ["computer-control"]      # disable specific ones
```

## Adding Your Own MCPs

User MCPs are merged on top of defaults. Same name = override.

```yaml
mcp:
  # Any stdio MCP
  - name: github
    command: ["github-mcp-server", "stdio"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}

  # npx-based MCPs
  - name: sentry
    command: ["npx", "-y", "@sentry/mcp-server@latest"]
    env:
      SENTRY_ACCESS_TOKEN: ${SENTRY_TOKEN}

  # Remote MCP (SSE or HTTP)
  - name: remote-tool
    url: "http://localhost:8080/sse"

  # Remote MCP with OAuth
  - name: service
    url: "https://mcp.example.com/sse"
    oauth: true
```

## Claude CLI Notes

When using `claude-cli` as the model provider, OpenAgent passes all MCPs to Claude CLI via `--mcp-config`. Known constraints:

- Requires Claude CLI 2.1.96+
- Commands must use absolute paths (handled automatically)
- The Claude CLI has a 5-second MCP startup deadline — OpenAgent uses a persistent client to avoid this bottleneck
