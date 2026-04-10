---
layout: home

hero:
  name: OpenAgent
  text: Persistent AI agents with memory, MCP tools, and multi-channel reach
  tagline: Run one agent across desktop, CLI, Telegram, Discord, WhatsApp, and scheduled jobs with an Obsidian-compatible memory vault.
  image:
    src: /brand/openagent-logo.png
    alt: OpenAgent
  actions:
    - theme: brand
      text: Download Desktop
      link: /downloads
    - theme: alt
      text: Read Documentation
      link: /guide/
    - theme: alt
      text: View GitHub
      link: https://github.com/geroale/OpenAgent

features:
  - title: Persistent by default
    details: Keep context, memory, and schedules alive beyond a single chat window. OpenAgent is built for long-running agent behavior, not one-off prompts.
  - title: Model-agnostic tooling
    details: Claude CLI/API, Z.ai GLM, Ollama, LM Studio, vLLM, and any OpenAI-compatible endpoint all get the same MCP tool surface.
  - title: Multi-channel delivery
    details: Expose the same agent through Telegram, Discord, WhatsApp, desktop, and CLI with consistent commands, stop controls, and status updates.
  - title: Obsidian-native memory
    details: Notes stay as plain markdown with wikilinks and frontmatter, so the vault is inspectable, portable, and easy to open in Obsidian.
  - title: Operations-ready runtime
    details: Native service setup, cron scheduler, dream mode maintenance, and auto-update support make the agent suitable for always-on deployments.
  - title: Desktop control surface
    details: Use the Electron app for chat, memory browsing, graph exploration, model configuration, MCP management, and release-based distribution.
---

<div class="brand-section">

## What OpenAgent is for

OpenAgent turns an LLM into a system you can actually keep running. It combines model execution, tool access, message channels, scheduling, and long-term memory behind one framework so the same agent can answer, act, remember, and follow up over time.

<div class="brand-grid">
  <div class="brand-card">
    <h3>One agent, many surfaces</h3>
    <p>Use the desktop app locally, connect through the CLI, or expose the same runtime through chat channels without rebuilding the stack for each surface.</p>
  </div>
  <div class="brand-card">
    <h3>Built around MCP</h3>
    <p>Filesystem, editor, shell, web search, browser, scheduler, memory, and messaging tools are part of the default operating model.</p>
  </div>
  <div class="brand-card">
    <h3>Memory that stays yours</h3>
    <p>The vault is plain markdown with standard conventions. No proprietary store, no hidden format, no lock-in for notes or backlinks.</p>
  </div>
</div>

<div class="brand-inline-links">
  <a href="/OpenAgent/downloads">Latest desktop builds</a>
  <a href="/OpenAgent/guide/">Guides and configuration</a>
  <a href="https://github.com/geroale/OpenAgent/releases">GitHub releases</a>
</div>

</div>

<div class="brand-section">

## Architecture at a glance

- **Gateway** exposes WebSocket and REST on one port for desktop, CLI, and bridge clients.
- **Models** stay swappable while the tool surface remains consistent.
- **MCP layer** provides the working capabilities: filesystem, editor, web, browser, messaging, scheduler, and memory.
- **Channels** connect the runtime to Telegram, Discord, WhatsApp, and the desktop app.
- **Vault + scheduler** give the agent continuity between conversations and across time.

</div>
