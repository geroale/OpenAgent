# Memory & Vault

OpenAgent's long-term memory is a plain **Obsidian-compatible markdown vault**. The agent reads and writes `.md` files directly via the mcpvault MCP — no custom index, no full-text engine, no proprietary format.

## Configuration

```yaml
memory:
  db_path: "~/.openagent/openagent.db"   # SQLite — scheduled tasks only
  vault_path: "~/.openagent/memories"    # Obsidian markdown vault
```

## How It Works

- The agent writes notes as `.md` files inside `vault_path/`
- MCPVault exposes `list_notes`, `read_note`, `write_note`, `search_notes`, `get_backlinks`, etc.
- Open the same folder in Obsidian desktop for graph view, backlinks, and plugin support
- Enable Syncthing to sync the vault between VPS and laptop (see [Services](services.md))

## Note Format

```markdown
---
title: Deploy Wardrobe Service
type: reference
tags: [k8s, wardrobe, ovh]
created: 2026-04-07
---

# Deploy Wardrobe Service

rsync + docker build + k3s import...
See also: [[server-architecture]]
```

`[[wikilinks]]`, tags and YAML frontmatter are standard Obsidian conventions.

## System Prompt

OpenAgent injects a framework-level system prompt that covers:

- How to use the vault (mcpvault tools, wikilinks, tags)
- Prefer MCP tools over shell scripts
- Act autonomously under `permission_mode: bypass`
- Be concise

Your `system_prompt` in `openagent.yaml` should stay short — just identity and a pointer to the vault. Everything else belongs as `.md` notes.
