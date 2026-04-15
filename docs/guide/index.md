# Documentation

OpenAgent is a persistent AI agent framework. You run an **Agent Server** on a machine you control, then talk to it from the **Web App**, **Desktop App**, or **CLI** — all pointing at the same agent, sharing the same memory and tools.

It's model-agnostic: Claude, GLM, Ollama, LM Studio, vLLM, or any OpenAI-compatible provider. Swap the model without losing memory or tool state. Run multiple independent agents side-by-side, each in its own folder.

## Start here

- [Getting Started](./getting-started.md) — download, install, first run
- [Open the Web App](https://openagent.uno/app/) — no install required
- [Configuration reference](./config-reference.md)

## Core concepts

- [Models](./models.md) — pick a provider
- [MCP tools](./mcp.md) — filesystem, editor, browser, web search, and more
- [Channels](./channels.md) — Telegram, Discord, WhatsApp, WebSocket
- [Memory & vault](./memory.md) — the markdown-based Obsidian vault
- [Scheduler & Dream Mode](./scheduler.md) — recurring tasks and background work

## Clients & operations

- [Desktop App](./desktop-app.md)
- [Architecture](./services.md)
- [Deployment](./deployment.md)
- [Examples](/examples/)
