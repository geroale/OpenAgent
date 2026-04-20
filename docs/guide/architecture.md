# Architecture

This document describes how OpenAgent is designed and how data flows through
the system. Diagrams use [Mermaid](https://mermaid.js.org/) — a plain-text
diagram format that renders automatically on GitHub, in most Markdown
viewers, and in VS Code, while staying easy for both humans and AI
assistants to read and edit.

## 1. Component overview

The runtime is a single `AgentServer` process that owns the agent, the
gateway, the MCP pool, the scheduler, and any channel bridges. All clients
(desktop app, CLI, Telegram/Discord/WhatsApp bridges) talk to the same
gateway.

```mermaid
flowchart TB
    subgraph Clients
        Desktop["Desktop app<br/>(Electron + React Native Web)"]
        CLI["CLI client<br/>(openagent-cli)"]
        Bridges["Bridges<br/>(Telegram / Discord / WhatsApp)"]
    end

    subgraph Server["AgentServer process (openagent serve)"]
        Gateway["Gateway<br/>aiohttp WebSocket + REST"]
        SessionMgr["SessionManager<br/>per-client FIFO queue"]
        Agent["Agent<br/>core/agent.py"]
        Router["SmartRouter<br/>session → framework"]
        Agno["AgnoProvider"]
        ClaudeCLI["ClaudeCLI<br/>(Claude Agent SDK subprocess)"]
        Pool["MCPPool<br/>subprocess + HTTP MCPs"]
        Scheduler["Scheduler<br/>cron / dream mode / auto-update"]
    end

    subgraph Persistence
        DB[("MemoryDB<br/>SQLite: tasks, usage,<br/>mcps, models, providers,<br/>session_bindings")]
        Vault[("Memory vault<br/>Obsidian-style markdown")]
        YAML[["openagent.yaml"]]
    end

    subgraph External["External MCPs & LLMs"]
        BuiltinMCP["Built-in MCP servers<br/>shell, editor, web-search,<br/>computer-control, messaging,<br/>vault, scheduler, mcp-manager"]
        LLMs["LLM APIs<br/>Anthropic, OpenAI, Z.ai,<br/>Ollama, vLLM, LM Studio"]
    end

    Desktop -->|WS + REST| Gateway
    CLI -->|WS| Gateway
    Bridges -->|WS| Gateway

    Gateway --> SessionMgr --> Agent
    Agent --> Router
    Router --> Agno
    Router --> ClaudeCLI
    Agno --> Pool
    ClaudeCLI --> Pool
    Pool --> BuiltinMCP
    Agno --> LLMs
    ClaudeCLI --> LLMs

    Scheduler --> Agent
    Agent --> DB
    Agent --> Vault
    Server --> YAML
```

## 2. Message flow (chat request)

What happens when a user sends a message over the WebSocket gateway.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (desktop/CLI/bridge)
    participant G as Gateway
    participant S as SessionManager
    participant A as Agent
    participant R as SmartRouter
    participant M as Model provider<br/>(Agno or Claude CLI)
    participant P as MCPPool
    participant DB as MemoryDB

    C->>G: {type: message, text, session_id}
    G->>S: enqueue(message)
    S-->>C: {type: queued, position}
    S->>A: agent.run(text, session_id, on_status)
    A->>DB: load history + session_binding
    A->>R: generate(messages, system, tools)
    R->>M: dispatch (bind if new session)
    loop tool-use turns
        M->>P: tool call (shell, editor, …)
        P-->>M: tool result
        M-->>A: on_status("Using shell…")
        A-->>S: status event
        S-->>C: {type: status, text}
    end
    M-->>A: final response + usage
    A->>DB: write usage_log + sdk_session
    A-->>S: {text, model, attachments}
    S-->>C: {type: response, …}
```

## 3. Startup & shutdown lifecycle

`AgentServer.start()` brings components up in a fixed order so the gateway
never accepts traffic before the agent and MCP pool are ready. Shutdown
runs the reverse.

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
    Stopping --> BridgesDown: stop bridges (10s timeout)
    BridgesDown --> GatewayDown: stop gateway
    GatewayDown --> SchedulerDown: stop scheduler
    SchedulerDown --> AgentDown: stop agent (close MCP subprocesses)
    AgentDown --> [*]
```

## 4. Configuration & persistence

Config is layered: CLI flags → `openagent.yaml` → SQLite runtime DB. The DB
wins for anything a user can toggle at runtime (MCPs, models, providers,
tasks, session bindings). The memory vault is separate — it is long-term
knowledge exposed through the `vault` MCP, not a DB table.

```mermaid
flowchart LR
    Flags["CLI flags<br/>--config, --agent-dir"] --> Loader
    YAML["openagent.yaml<br/>(env var substitution)"] --> Loader
    Loader["core/config.py"] --> AgentCfg["Agent config<br/>(in memory)"]

    AgentCfg --> Gateway
    AgentCfg --> Agent
    AgentCfg --> Scheduler

    subgraph Runtime["Runtime overrides (SQLite)"]
        MCPs[("mcps")]
        Models[("models")]
        Providers[("providers")]
        Tasks[("scheduled_tasks")]
        Bindings[("session_bindings")]
        Usage[("usage_log")]
    end

    Agent <--> Runtime
    Scheduler <--> Tasks

    subgraph Vault["Memory vault"]
        MD["Markdown notes<br/>+ wikilinks"]
    end

    Agent -. reads/writes via vault MCP .-> MD
```

## 5. Extensibility model

OpenAgent has no traditional plugin system. Extensibility comes from three
mechanisms, all configuration-only:

- **MCP servers** — add a `command:` or `url:` entry under `mcp:` in
  `openagent.yaml` (or via the `mcp-manager` MCP at runtime) to expose new
  tools. No Python code changes needed.
- **Scheduled tasks** — cron entries that invoke `agent.run(prompt)` on a
  schedule; dream mode is the built-in nightly maintenance task.
- **Channel bridges** — each bridge (Telegram, Discord, WhatsApp) is a
  WebSocket client of the same gateway, so adding a new channel means
  writing a bridge, not modifying the core.

## Editing these diagrams

Each diagram is a fenced ` ```mermaid ` block. To preview locally, open this
file in VS Code with the Mermaid preview extension, or push to GitHub and
view the rendered Markdown. AI assistants can edit the diagrams as plain
text using `Edit` on this file.
