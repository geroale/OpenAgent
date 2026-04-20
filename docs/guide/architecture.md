# Architecture

This page is a tour of how OpenAgent is put together — the long-lived
components, how a message moves through them, and where state lives.
Diagrams use [Mermaid](https://mermaid.js.org/): plain text, renders
automatically on GitHub and in most Markdown viewers, easy for humans and
AI assistants to edit.

The Gateway — the WebSocket + REST surface that clients connect to — is
covered in its own [Gateway](./gateway.md) page and is drawn here only as
the transport boundary.

## 1. Component map

Everything below runs inside a single `AgentServer` process started by
`openagent serve`. The server owns the lifecycle of the agent, MCP pool,
scheduler, and any bridges; nothing runs as a separate daemon.

```mermaid
flowchart LR
    Clients["Clients<br/>desktop · CLI · bridges"]
    GW["Gateway<br/>WS + REST"]

    subgraph Core["AgentServer"]
        direction TB
        Agent["Agent"]
        Router["SmartRouter"]
        Pool["MCPPool"]
        Sched["Scheduler"]
    end

    LLMs["LLMs<br/>Agno providers · Claude CLI"]
    MCPs["MCP servers<br/>built-ins + custom"]
    State["State<br/>SQLite · vault · YAML"]

    Clients --> GW --> Agent
    Sched --> Agent
    Agent --> Router --> Pool
    Router --> LLMs
    Pool --> MCPs
    Agent <--> State
```

Each box expands into its own section below. The later diagrams zoom in
on what SmartRouter does (§3), how the MCP pool is built (§4), how the
vault is accessed (§5), how the scheduler drives tasks and Dream Mode
(§6), and where state lives (§8). The Gateway itself has its own
[dedicated page](./gateway.md).

## 2. Message flow

A chat turn arrives at the Gateway, gets queued per client, and lands in
`Agent.run()`. The agent hands generation to SmartRouter, which either
delegates to Agno (which runs its own tool loop against the pool) or to
Claude CLI (which spawns a subprocess with the same MCP pool wired in).

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as Agent
    participant R as SmartRouter
    participant AG as AgnoProvider
    participant CC as ClaudeCLIRegistry
    participant P as MCPPool
    participant DB as MemoryDB
    participant V as Vault (MCP)

    C->>A: message (via Gateway, queued FIFO)
    A->>DB: load history + session_binding
    A->>R: generate(messages, system, tools)

    alt session bound OR classifier picks Agno
        R->>AG: dispatch(runtime_id)
        loop tool-use loop (Agno-managed)
            AG->>P: call tool (filesystem / shell / web-search / …)
            P-->>AG: tool result
            AG-->>A: on_status("Using shell…")
        end
        AG-->>R: final text + usage
    else session bound OR classifier picks claude-cli
        R->>CC: dispatch(runtime_id)
        CC->>CC: resume or create SDK session
        loop tool-use loop (SDK-managed)
            CC->>P: call tool via mcp_servers config
            P-->>CC: tool result
            CC-->>A: on_status(tool name)
        end
        CC-->>R: final text + usage
    end

    R->>DB: bind session on first dispatch
    R-->>A: response
    opt agent decides to remember
        A->>V: write_note("<topic>.md")
    end
    A->>DB: append usage_log
    A-->>C: response + attachments
```

## 3. SmartRouter: one router, two backends

OpenAgent is model-agnostic because `SmartRouter` is the only thing the
agent talks to. It owns three responsibilities on every turn:

1. **Read the enabled catalog.** Rows in the `models` table marked
   `enabled=1`, joined with `providers`, produce the set of `runtime_id`s
   the router may dispatch to. Zero enabled models → fail-fast error, no
   silent fallback.
2. **Pick a model.** If the session is already bound, reuse that binding.
   Otherwise a cheap classifier LLM picks the single best `runtime_id`
   from the enabled catalog based on the turn's content.
3. **Bind the session.** First dispatch writes `session_bindings` so
   every follow-up turn in that session stays on the same side (Agno's
   `SqliteDb` history vs. Claude CLI's session store — mixing them would
   split the conversation). Bindings persist across restarts via
   `session_bindings` and `sdk_sessions`.

```mermaid
flowchart LR
    Msg[Incoming turn] --> HasBind{session_binding<br/>exists?}
    HasBind -- yes --> ReuseRT[Reuse bound runtime_id]
    HasBind -- no --> Classifier[Cheap classifier LLM]
    Classifier --> PickRT[Pick runtime_id from<br/>enabled models table]
    PickRT --> Bind[(write session_binding)]
    Bind --> ReuseRT
    ReuseRT --> Tier{Which side?}
    Tier -- agno/* --> Agno[AgnoProvider]
    Tier -- claude-cli/* --> CC[ClaudeCLIRegistry]
    Agno --> Pool[(MCPPool — shared)]
    CC --> Pool
```

### Agno side

`AgnoProvider` wraps Agno's `Agent`, which runs the tool-calling loop
internally. It consumes the pool's pre-built `MCPTools` toolkits — so
OpenAgent doesn't reimplement tool dispatch, retries, or JSON-schema
plumbing. Per-session history is stored in Agno's `SqliteDb`.

### Claude CLI side

`ClaudeCLIRegistry` manages one or more claude-cli models (e.g.
`claude-cli/claude-sonnet-4-6`). On first dispatch for a session it spawns
`claude-agent-sdk` as a subprocess, passing the pool's stdio/URL specs to
`ClaudeSDKClient(mcp_servers=…)` and `--strict-mcp-config` so MCP load
failures surface immediately. Session IDs are mapped in `sdk_sessions` so
subsequent turns resume the same conversation.

### Hot reload

Edit a model or provider via the manager MCPs, REST, or the UI — the
gateway checks `updated_at` before the next turn and rebuilds the routing
table in place. Bound sessions keep their binding; new sessions can land
on the new entry.

## 4. MCP Pool: built-ins + customs, shared by both backends

`MCPPool` is the single source of truth for tools available to the agent.
Both model sides (Agno and Claude CLI) read from the same pool, so we
don't pay N times to spin up the same subprocess when the router
dispatches between tiers.

```mermaid
flowchart LR
    Seed["BUILTIN_MCP_SPECS<br/>auto-seeded on boot"] --> DB[(mcps table)]
    Manager["mcp-manager MCP<br/>/api/mcps · UI"] --> DB

    DB --> Pool["MCPPool.connect()"]
    Pool --> Stdio["stdio subprocess"]
    Pool --> Http["HTTP / SSE client"]

    Stdio --> Tools["Tools available to agent"]
    Http --> Tools
    Tools --> Agno[AgnoProvider]
    Tools --> CCLI[ClaudeCLIRegistry]

    DB -. updated_at bump .-> Pool
```

**Built-ins vs custom.** Built-in rows (`kind='default'` or `'builtin'`)
are auto-seeded on every boot from `BUILTIN_MCP_SPECS` — missing rows are
reinstated, existing ones (even disabled) are left untouched. Built-ins
cannot be removed, only disabled. Custom rows (`kind='custom'`) are full
CRUD via `mcp-manager`, `POST /api/mcps`, or the MCPs UI tab.

**Tool naming.** Tools are namespaced `<server>_<tool>`
(`filesystem_read_text_file`, `vault_write_note`,
`scheduler_create_scheduled_task`) so servers never collide.

See [MCP Tools](./mcp.md) for the built-in matrix and custom-MCP recipes.

## 5. Memory vault: markdown, not a database

Long-term memory is a plain **Obsidian-compatible markdown vault** — one
`.md` file per note, YAML frontmatter, `[[wikilinks]]`, tags. The agent
never talks to it directly; every read and write goes through the
`vault` MCP, which is just another server in the pool.

```mermaid
flowchart LR
    Agent --> VaultMCP["vault MCP<br/>list_notes · read_note<br/>write_note · search_notes<br/>get_backlinks · graph"]
    VaultMCP <--> Files[("memories/*.md<br/>frontmatter + wikilinks")]
    Files <--> Obsidian[["Obsidian.app<br/>(optional, same folder)"]]
    Files <--> REST["/api/vault/*<br/>(read-only surface<br/>for desktop app)"]
```

The same folder opens untouched in Obsidian — graph view, backlinks,
plugins all work. The REST endpoints under `/api/vault/*` give the
desktop app a read surface (notes list, graph, full-text search) without
going through the MCP round-trip. See [Memory & Vault](./memory.md) for
note conventions.

Only scheduled-task and bookkeeping state lives in the SQLite DB — the
vault is the knowledge store.

## 6. Scheduler and Dream Mode

The Scheduler is a 30-second tick loop that reads `scheduled_tasks` from
SQLite and invokes `agent.run(prompt)` for each task whose cron is due.
Because tasks call the regular agent entry point, they get the same
model router, MCP pool, and vault access as any user turn — a task is
just a prompt on a schedule.

```mermaid
flowchart LR
    subgraph Loop["Scheduler.tick() — every ~30s"]
        Tick["read scheduled_tasks"] --> Due{"any due?<br/>(cron match)"}
        Due -- yes --> Run["agent.run(prompt)"]
        Due -- no --> Sleep[sleep]
        Run --> WriteBack["update last_run,<br/>append usage_log"]
    end

    Mgr["scheduler MCP<br/>/api/scheduled-tasks<br/>Tasks tab"] -. CRUD .-> DB[("scheduled_tasks")]
    DB --> Tick

    Dream["Dream Mode entry<br/>(built-in task,<br/>default 03:00)"] --> Run
```

**Dream Mode** is a specific built-in scheduled task that runs nightly
maintenance: consolidates duplicate memory files, cross-links notes with
wikilinks, runs a health check, writes a dream log back to the vault. It
has no dedicated daemon — it's literally a `scheduled_tasks` row with a
fixed prompt and a nightly cron, invoked through the same tick loop.

```yaml
dream_mode:
  enabled: true
  time: "3:00"   # local time
```

**Auto-update** piggybacks on the same tick (default every 6 hours):
check GitHub releases → download → on next restart the launcher picks
the new binary. See [Scheduler & Dream Mode](./scheduler.md) for CLI
management (`openagent task add / list / enable / disable`).

## 7. Startup and shutdown

`AgentServer.start()` brings components up in a fixed order so the
Gateway never accepts traffic before the agent and MCP pool are ready;
shutdown runs the reverse with bounded timeouts.

```mermaid
stateDiagram-v2
    [*] --> LoadConfig: openagent serve
    LoadConfig --> AgentInit: load_config(openagent.yaml)
    AgentInit --> MCPConnect: Agent.initialize()
    MCPConnect --> DBConnect: MCPPool.connect()
    DBConnect --> WireModels: MemoryDB.connect()
    WireModels --> GatewayUp: wire_model_runtime()
    GatewayUp --> SchedulerUp: Gateway.start()
    SchedulerUp --> BridgesUp: Scheduler.start()
    BridgesUp --> Running: Bridge.start() (TG/Discord/WA)

    Running --> Stopping: SIGTERM / Ctrl-C
    Stopping --> BridgesDown: stop bridges (10s)
    BridgesDown --> GatewayDown: stop gateway
    GatewayDown --> SchedulerDown: stop scheduler
    SchedulerDown --> AgentDown: close MCP subprocesses
    AgentDown --> [*]
```

## 8. State layout

Config is layered: CLI flags → `openagent.yaml` → SQLite runtime
overrides. Anything a user can toggle at runtime (MCPs, models,
providers, tasks, session bindings, usage) lives in the DB; the YAML is
for bootstrap, channel credentials, and things that rarely change.

```mermaid
flowchart LR
    Flags["CLI flags<br/>--config · --agent-dir"] --> Loader
    YAML["openagent.yaml<br/>env var substitution"] --> Loader
    Loader["core/config.py"] --> Cfg["in-memory config"]

    Cfg --> Agent
    Cfg --> Sched[Scheduler]

    subgraph Runtime["openagent.db (SQLite)"]
        T1[(mcps)]
        T2[(models)]
        T3[(providers)]
        T4[(scheduled_tasks)]
        T5[(session_bindings)]
        T6[(sdk_sessions)]
        T7[(usage_log)]
    end

    Agent <--> Runtime
    Sched <--> T4

    subgraph Vault["memories/"]
        MD["*.md notes<br/>frontmatter + wikilinks"]
    end

    Agent -. via vault MCP .-> MD
```

## 9. Extensibility at a glance

Three mechanisms, all configuration-driven — no plugin framework:

- **MCP servers** add tools (`mcp-manager`, `POST /api/mcps`, or the
  MCPs UI tab). No code changes.
- **Scheduled tasks** put `agent.run(prompt)` on a cron (`scheduler`
  MCP, `/api/scheduled-tasks`, or `openagent task add`).
- **Channels / bridges** are WebSocket clients of the Gateway
  (`BaseBridge` subclass, ~150 lines) — adding a new platform never
  touches the core.

## Editing these diagrams

Every diagram is a fenced ` ```mermaid ` block. Preview locally with the
VS Code Mermaid extension, or push to GitHub and view the rendered
Markdown. AI assistants can edit any block directly with an `Edit` on
this file.
