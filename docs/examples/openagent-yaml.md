# Example `openagent.yaml`

This is the sanitized production-style example shipped with the repository. LLM providers (API keys, base URLs), the per-provider model catalog, MCP servers, and scheduled tasks all live in SQLite, not in this file — manage them via the `mcp-manager` / `model-manager` / `scheduler` built-in MCPs, the `/api/providers`, `/api/mcps`, `/api/models`, and `/api/scheduled-tasks` REST endpoints, or the desktop/CLI UI.

::: tip Multi-Agent Mode
When using agent directories (`openagent serve ./my-agent`), this file lives at `./my-agent/openagent.yaml` alongside the database, memories, and logs. The `memory.db_path` and `memory.vault_path` fields are optional — they default to the agent directory. Each agent directory is fully self-contained.
:::

```yaml
# OpenAgent example configuration.
#
# LLM providers (API keys, base URLs), the per-provider model catalog,
# MCP servers, and scheduled tasks all live in SQLite, not in this
# file. Manage them via:
#
#   - the ``mcp-manager``, ``model-manager``, and ``scheduler`` built-in
#     MCPs (the agent itself can call their tools to add/remove/toggle
#     entries);
#   - the REST API — ``/api/providers/*``, ``/api/mcps/*``,
#     ``/api/models/*``, and ``/api/scheduled-tasks/*``;
#   - the desktop app's Settings screens and the CLI's ``/mcps`` /
#     ``/models`` / ``/tasks`` / ``openagent provider`` commands.
#
# This yaml is the source of truth for ``name``, ``system_prompt``,
# ``channels``, ``memory`` paths, ``dream_mode``, and ``auto_update``.
#
# Any value in the form ${VAR_NAME} is substituted from environment
# variables at load time.

name: my-agent

system_prompt: |
  You are My Agent, the persistent AI assistant for My Project.

  Your memory vault is at ~/.openagent/memories/. All project identity,
  credentials, infrastructure, procedures and contacts are documented
  there as notes. Search the vault first before answering any factual
  question about the project.

  Git author: My Agent <myagent@example.com> (no Co-Authored-By line).

memory:
  db_path: ~/.openagent/openagent.db
  vault_path: ~/.openagent/memories

channels:
  telegram:
    token: ${TELEGRAM_BOT_TOKEN}
    allowed_users:
      - "YOUR_TELEGRAM_USER_ID"
  websocket:
    port: 8765
    token: ${OPENAGENT_WS_TOKEN}

dream_mode:
  enabled: true
  time: "3:00"

auto_update:
  enabled: true
  mode: auto
  check_interval: "17 */6 * * *"
```
