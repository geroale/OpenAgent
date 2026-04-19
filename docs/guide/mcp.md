# MCP Tools

All MCP tools are available to every model — model-agnostic by design. OpenAgent ships **11 built-in MCPs** and the LLM can enumerate them at runtime via the built-in `list_mcp_servers` tool.

## Built-in MCPs

| Name | What it does | Requires |
|---|---|---|
| `vault` | Read/write Obsidian-compatible markdown notes | Node.js |
| `filesystem` | Read, write, list, search files | Node.js |
| `editor` | Find-replace, grep, glob | Node.js |
| `web-search` | Web search + page fetch, no API key | Node.js + Playwright |
| `shell` | Cross-platform shell execution | Node.js |
| `computer-control` | Screenshot, mouse, keyboard (macOS/Linux/Windows) | native binary |
| `chrome-devtools` | Browser automation, DOM, performance | Node.js + Chrome |
| `messaging` | Send messages via Telegram/Discord/WhatsApp | Channel tokens |
| `scheduler` | Manage cron tasks from within conversations | Python |
| `mcp-manager` | Let the agent add/remove/toggle MCP servers at runtime | Python |
| `model-manager` | Let the agent manage its LLM catalog at runtime | Python |

Tool names are namespaced `<server>_<tool>` (Agno convention), so `filesystem_read_text_file`, `vault_write_note`, `scheduler_create_scheduled_task`, etc. — no collisions between servers.

## Source of truth: the `mcps` table

Since v0.9.0 the MCP list lives in the `mcps` SQLite table, not in yaml. Three equivalent ways to edit it:

- **From the agent itself** — ask the LLM to call one of the `mcp-manager` tools (`list_mcps`, `add_custom_mcp`, `update_mcp`, `enable_mcp`, `disable_mcp`, `remove_mcp`). Changes take effect on the next message via the gateway's hot-reload loop.
- **REST**: `GET/POST/PUT/DELETE /api/mcps[/...]`, plus `POST /api/mcps/{name}/enable` and `/disable`.
- **UI**: the MCPs screen in the desktop app or the `/mcps` slash command in the CLI — both hit the same REST endpoints.

The `mcps` SQLite table is the sole source of truth. Every boot, `ensure_builtin_mcps` backfills any `BUILTIN_MCP_SPECS` entry whose row is missing (forward compat + safety net against manual DB tampering); existing rows — including disabled ones — are left untouched.

## Built-in vs custom

- **Built-ins** (`kind='default'` or `kind='builtin'` in the `mcps` row): defined in `openagent.mcp.builtins.BUILTIN_MCP_SPECS`. They are **auto-seeded** on every boot — if a row is missing (manual DB tampering, new builtin shipped in a later release), it gets reinstated with `enabled=1`. Built-ins **cannot be removed**; only disabled via `disable_mcp` / `/api/mcps/{name}/disable`. `add_builtin_mcp` is not exposed because there is nothing to add — the row already exists.
- **Custom MCPs** (`kind='custom'`): anything the user adds via `add_custom_mcp`, `POST /api/mcps`, or the "Custom" tab in the app. Fully CRUD: add, update, toggle, remove.

## Adding a custom MCP

```text
> use mcp-manager to add a custom MCP called github with command
> "github-mcp-server stdio" and env GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_TOKEN
```

Or via REST:

```bash
curl -X POST http://localhost:8765/api/mcps -H 'Content-Type: application/json' -d '{
  "name": "github",
  "command": ["github-mcp-server", "stdio"],
  "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_…"},
  "enabled": true
}'
```

Remote MCPs use `url` instead of `command`:

```bash
curl -X POST http://localhost:8765/api/mcps -H 'Content-Type: application/json' -d '{
  "name": "service",
  "url": "https://mcp.example.com/sse",
  "oauth": true
}'
```

## How the Pool Works

At startup, OpenAgent builds a single `MCPPool` that connects every enabled row in the `mcps` table. Both model backends read from the same pool:

- **Agno providers** (OpenAI, Anthropic API, Z.ai GLM, any OpenAI-compatible endpoint) get the live `MCPTools` toolkits and register them on the Agno `Agent` directly — tool routing, call loops, and retries are Agno's native implementation.
- **Claude CLI** receives the stdio/URL spec dicts and hands them to the Claude Agent SDK's `ClaudeSDKClient(mcp_servers=...)` parameter, which manages its own subprocess lifecycle.

Sharing the pool means we don't pay N times for the same MCP when the smart router dispatches between tiers, and there's no in-process tool registry for OpenAgent to keep in sync — the providers own it.

When the `mcps` table changes (manager MCP writes a row, REST endpoint flips `enabled`), the gateway sees the bumped `updated_at` on the next incoming message and rebuilds the pool atomically: new subprocesses come up first, existing Agno providers' toolkit list is swapped in place, old subprocesses are torn down last. In-flight turns see no gap.

## Claude CLI Notes

When a session routes to `claude-cli`, OpenAgent passes the same pool via `mcp_servers`. Known constraints:

- Requires Claude CLI 2.1.96+ and the `claude-agent-sdk` Python package
- Commands must use absolute paths (handled automatically)
- The Claude binary is occasionally unreliable when many MCPs register at once; OpenAgent sets `--strict-mcp-config` so failures surface immediately instead of silently dropping servers
