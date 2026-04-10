# Setup & Deployment

## VPS Quick Setup

```bash
pip install 'openagent-framework[all]'
openagent setup --full
```

This installs as OS service + Syncthing + runs doctor checks.

## Doctor & Setup

```bash
openagent doctor                 # environment report
openagent setup                  # register as OS service
openagent setup --with-syncthing # + Syncthing install
openagent setup --full           # everything
openagent install                # alias for setup --full
```

## OS Service

OpenAgent registers as a platform-native service:

- **Linux** — systemd user unit (`~/.config/systemd/user/openagent.service`)
- **macOS** — launchd plist (`~/Library/LaunchAgents/com.openagent.serve.plist`)
- **Windows** — Task Scheduler entry with restart loop

```bash
# Linux
systemctl --user status openagent
journalctl --user -u openagent -f

# macOS
launchctl list com.openagent.serve

# Uninstall (any platform)
openagent uninstall
```

## Auto-Update

```yaml
auto_update:
  enabled: true
  mode: auto                    # auto | notify | manual
  check_interval: "17 */6 * * *"
```

- `auto` — pip upgrade + exit 75 (OS service restarts with new code)
- `notify` — pip upgrade + notify, no restart
- `manual` — pip upgrade only

Manual: `openagent update`

## Data Paths

OpenAgent stores files in platform-standard directories:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/OpenAgent/` |
| Linux | `~/.config/openagent/` (config), `~/.local/share/openagent/` (data) |
| Windows | `%APPDATA%\OpenAgent\` |

Override with `-c /path/to/openagent.yaml` or set paths in config.
