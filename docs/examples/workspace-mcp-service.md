# Example `workspace-mcp.service`

Use this as a `systemd --user` unit for a Google Workspace MCP sidecar.

```ini
# Google Workspace MCP as a systemd --user service.
#
# Install with:
#   pipx install workspace-mcp      # or: uv tool install workspace-mcp
#
# Then copy this file to ~/.config/systemd/user/workspace-mcp.service,
# replace the placeholders, and enable it:
#
#   mkdir -p ~/.config/systemd/user
#   cp workspace-mcp.service ~/.config/systemd/user/
#   systemctl --user daemon-reload
#   systemctl --user enable --now workspace-mcp
#
# On a headless VPS you also want:
#   sudo loginctl enable-linger $USER
#
# PYTHONUNBUFFERED / NO_COLOR / TERM=dumb are required because FastMCP's
# startup banner crashes on a non-TTY stdout without them.

[Unit]
Description=Google Workspace MCP (gmail + drive) for OpenAgent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/home/YOUR_USER/.local/bin/workspace-mcp --transport streamable-http --tools gmail drive
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=NO_COLOR=1
Environment=TERM=dumb
Environment=GOOGLE_OAUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
Environment=GOOGLE_OAUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET

[Install]
WantedBy=default.target
```
