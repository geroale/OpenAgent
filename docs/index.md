---
layout: home

hero:
  name: OpenAgent
  text: Persistent agents for any model
  tagline: Run OpenAgent with Claude, GLM, Ollama, LM Studio, vLLM, or any OpenAI-compatible provider, then install the Agent Server, CLI Client, and Desktop App as separate downloads.
  image:
    src: /brand/openagent-logo.png
    alt: OpenAgent
  actions:
    - theme: brand
      text: Download Agent, CLI & App
      link: /downloads
    - theme: alt
      text: Compare the 3 Apps
      link: /guide/apps
    - theme: alt
      text: Read the Docs
      link: /guide/

features:
  - title: Model-agnostic by design
    details: Claude CLI/API, Z.ai GLM, Ollama, LM Studio, vLLM, and any OpenAI-compatible endpoint keep the same memory, MCP tools, and operating surface.
  - title: Persistent memory
    details: Keep context, notes, and follow-up state alive beyond a single chat window. OpenAgent is built for long-running agent behavior, not one-off prompts.
  - title: MCP tool runtime
    details: Filesystem, editor, browser, web, messaging, memory, and scheduler tooling stay attached to the agent no matter which model you run.
  - title: Channels and scheduling
    details: Expose the same agent through Telegram, Discord, WhatsApp, desktop, and CLI with recurring tasks, stop controls, and status updates.
  - title: Obsidian-native memory
    details: Notes stay as plain markdown with wikilinks and frontmatter, so the vault is inspectable, portable, and easy to open in Obsidian.
  - title: Three independent apps
    details: Install the Agent Server where the runtime should live, then add the CLI Client or Desktop App separately from GitHub Releases.
---

<div class="brand-section">

## Start with the right download

OpenAgent is one system, but you install each surface independently. Most setups run the Agent Server on the host where the agent should live, then add either the CLI Client or the Desktop App from a separate download.

<div class="brand-grid">
  <div class="brand-card">
    <h3>Agent Server</h3>
    <p>The persistent runtime in <code>openagent/</code>. This is the actual agent process with models, MCP tools, memory, channels, scheduler, and install or auto-update behavior.</p>
    <p><a href="/OpenAgent/downloads#agent-server">Download the server</a></p>
  </div>
  <div class="brand-card">
    <h3>CLI Client</h3>
    <p>A separate terminal client for connecting to any running OpenAgent Gateway. Use it when you want fast operational access without the desktop UI.</p>
    <p><a href="/OpenAgent/downloads#cli-client">Download the CLI</a></p>
  </div>
  <div class="brand-card">
    <h3>Desktop App</h3>
    <p>The Electron control surface for chat, memory, MCP configuration, model setup, and graph exploration. It connects to a running Agent Server and is downloaded independently.</p>
    <p><a href="/OpenAgent/downloads#desktop-app">Download the desktop app</a></p>
  </div>
</div>

<div class="brand-inline-links">
  <a href="/OpenAgent/downloads">Open all downloads</a>
  <a href="/OpenAgent/guide/apps">Compare the 3 apps</a>
  <a href="/OpenAgent/guide/getting-started">Install the Agent Server</a>
  <a href="https://github.com/geroale/OpenAgent/releases">Browse GitHub releases</a>
</div>

</div>

<div class="brand-section">

## How teams typically use it

<div class="brand-flow">
  <div class="brand-flow-step">
    <strong>1. Run the Agent Server</strong>
    <p>Install <code>openagent-framework</code> on the machine that should keep memory, channels, models, and schedules alive.</p>
  </div>
  <div class="brand-flow-step">
    <strong>2. Pick your client</strong>
    <p>Use the CLI Client for terminal-first operations, the Desktop App for visual control, or both.</p>
  </div>
  <div class="brand-flow-step">
    <strong>3. Change models without changing the system</strong>
    <p>Swap Claude, GLM, Ollama, LM Studio, vLLM, or any OpenAI-compatible endpoint while keeping the same tools, memory, and channels.</p>
  </div>
</div>

<div class="brand-inline-links">
  <a href="/OpenAgent/downloads">Go to downloads</a>
  <a href="/OpenAgent/guide/">Read the documentation</a>
</div>

</div>
