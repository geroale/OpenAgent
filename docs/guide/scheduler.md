# Scheduler & Dream Mode

## Scheduler

Cron tasks stored in SQLite — survive reboots. Runs as part of `openagent serve`
whenever a database is attached. Changes take effect within ~30 seconds
(the scheduler's next tick) without needing a restart.

Manage tasks via:

- the **Tasks** tab in the desktop / universal app (reads and writes
  `/api/scheduled-tasks` on the gateway);
- the `scheduler` MCP server (from inside an agent chat — `create_scheduled_task`,
  `update_scheduled_task`, etc.);
- the `openagent task` CLI commands below.

### CLI Management

```bash
openagent task add --name "test" --cron "* * * * *" --prompt "say hello"
openagent task list
openagent task remove <id>
openagent task enable <id>
openagent task disable <id>
```

## Dream Mode

Nightly maintenance task. Consolidates duplicate memory files, cross-links notes with wikilinks, runs a health check, writes a dream log.

```yaml
dream_mode:
  enabled: true
  time: "3:00"       # local time
```
