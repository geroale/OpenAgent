# MCP Tools

All MCP tools are available to every model — model-agnostic by design. OpenAgent includes **9 default MCPs** that load automatically, and the LLM can enumerate them at runtime via the built-in `list_mcp_servers` tool.

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

Tool names are namespaced `<server>_<tool>` (Agno convention) so `filesystem_read_text_file`, `vault_write_note`, etc. — no collisions between servers, and the LLM can pick tools just by name.

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

## How the Pool Works

At startup, OpenAgent builds a single `MCPPool` that connects every configured server once. Both model backends read from the same pool:

- **Agno providers** (OpenAI, Anthropic API, Z.ai GLM, any OpenAI-compatible endpoint) get the live `MCPTools` toolkits and register them on the Agno `Agent` directly — tool routing, call loops, and retries are Agno's native implementation.
- **Claude CLI** receives the stdio/URL spec dicts and hands them to the Claude Agent SDK's `ClaudeSDKClient(mcp_servers=...)` parameter, which manages its own subprocess lifecycle.

Sharing the pool means you don't pay N times for the same MCP when running SmartRouter across multiple tiers, and there's no in-process tool registry for OpenAgent to keep in sync — the providers own it.

Per-call timeout defaults to 30 seconds (npx-launched servers like `@modelcontextprotocol/server-filesystem` routinely take 5–15 s on their first tool call).

## Claude CLI Notes

When using `claude-cli` as the model provider, OpenAgent passes the same pool to the Claude Agent SDK via `mcp_servers`. Known constraints:

- Requires Claude CLI 2.1.96+ and the `claude-agent-sdk` Python package
- Commands must use absolute paths (handled automatically)
- The Claude binary is occasionally unreliable when many MCPs register at once; OpenAgent sets `--strict-mcp-config` so failures surface immediately instead of silently dropping servers
