# Architecture

## Gateway

The Gateway is OpenAgent's single public interface — a WebSocket + REST server on one port (default 8765). All clients connect through it.

When running multiple agents, each gets its own Gateway on a separate port. If the preferred port is busy, the next available port is auto-allocated (scans +1 through +99). The actual port is written to `<agent_dir>/.port` for discovery.

```
 ┌────────────────────────────────────────────────────────┐
 │  Agent Directory (./my-agent)                          │
 │  ┌─────────────────────────┐                           │
 │  │   OpenAgent Core        │  openagent.yaml           │
 │  │   Agent + MCPs          │  openagent.db             │
 │  └──────────┬──────────────┘  memories/                │
 │             │                  logs/                    │
 │  ┌──────────▼──────────────┐  .port                    │
 │  │      Gateway            │                           │
 │  │   WS + REST (aiohttp)   │                           │
 │  │   Port auto-allocated   │                           │
 │  └──────────┬──────────────┘                           │
 └─────────────┼──────────────────────────────────────────┘
               │
  ┌────────────┼────────────────┐
  │            │                 │
┌─▼──────┐ ┌──▼─────────┐ ┌────▼───┐
│Bridges │ │ Desktop App│ │  CLI   │
│TG/DC/WA│ │ (Electron) │ │(term.) │
└────────┘ └────────────┘ └────────┘
```

### WebSocket Protocol

See `openagent/gateway/protocol.py` for the full spec.

### REST API

```
# Health + identity
GET    /api/health                → agent status
GET    /api/agent-info            → agent name, dir, port, version

# Config
GET    /api/config                → read full config
PUT    /api/config                → replace full config
PATCH  /api/config/{section}      → update one section

# Vault (Obsidian-compatible markdown notes)
GET    /api/vault/notes           → list notes
GET    /api/vault/notes/{path}    → read note content + frontmatter + links
PUT    /api/vault/notes/{path}    → write/update note
DELETE /api/vault/notes/{path}    → delete note
GET    /api/vault/graph           → {nodes, edges} wikilink graph
GET    /api/vault/search?q=…      → full-text search

# Usage / pricing
GET    /api/usage                 → monthly spend summary
GET    /api/usage/daily           → day-by-day breakdown
GET    /api/usage/pricing         → price-per-million table

# Models & providers
GET    /api/models                → list provider configs (masked keys)
POST   /api/models                → add a provider
PUT    /api/models/{name}         → update a provider
DELETE /api/models/{name}         → remove a provider
GET    /api/models/active         → current active model config
PUT    /api/models/active         → set active model
POST   /api/models/{name}/test    → send a smoke test prompt
GET    /api/models/catalog        → configured models with pricing
GET    /api/models/providers      → provider catalog
GET    /api/providers             → list configured providers
POST   /api/providers/test        → validate a provider config

# File uploads
POST   /api/upload                → save uploaded file, returns {path, filename, transcription?}

# Logs
GET    /api/logs                  → recent events
DELETE /api/logs                  → clear

# Lifecycle
POST   /api/update                → check for update, install, restart
POST   /api/restart               → restart agent
```

All routes are exposed on the same port as the WebSocket endpoint (`/ws`). Test coverage for each lives under `scripts/tests/` — run `bash scripts/test_openagent.sh` to validate the full surface.

## Bridges

Thin adapters: Telegram/Discord/WhatsApp SDK ↔ Gateway WS protocol. ~130-195 lines each.

### Writing a Custom Bridge

```python
from openagent.bridges.base import BaseBridge

class MyBridge(BaseBridge):
    name = "my-platform"

    async def _run(self):
        response = await self.send_message(text, session_id)
        # Send response.get("text") back to user
```

## CLI Client

Separate package (`openagent-cli`). Connects to any Gateway via WS.

```bash
pip install openagent-cli
openagent-cli connect localhost:8765 --token mysecret
```
