# Services

Auxiliary services run alongside the agent and share its lifecycle. Each service is a plug-in.

## Syncthing (built-in)

Keeps the memory vault in sync with your laptop at the filesystem level. The agent writes `.md` files on the VPS, Syncthing pushes changes within seconds, and Obsidian on your Mac picks them up.

```yaml
services:
  syncthing:
    enabled: true
    vault_path: ~/.openagent/memories
    folder_id: openagent-memories
    folder_label: OpenAgent Memories
    gui_bind: 127.0.0.1:8384
```

Install with `openagent setup --with-syncthing` (or `openagent setup --full`).

### Pairing a Second Machine

1. Install Syncthing on the other machine
2. Forward GUI over SSH: `ssh -L 8385:127.0.0.1:8384 ubuntu@YOUR_VPS`
3. Add Remote Device in VPS GUI → paste Mac's device ID
4. Accept in Mac GUI
5. Share the `openagent-memories` folder
6. Accept folder share and choose local path
7. Open that folder in Obsidian

### Manual Control

```bash
openagent services status
openagent services start
openagent services stop
```
