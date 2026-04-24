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

## Manager Review

Weekly self-review task — the agent audits its own work as a project manager would.
Complements Dream Mode (nightly hygiene) with a forward-looking pass: reviews
`pending-automation` / `followup` notes and either schedules them or archives them,
scans for recurring work that should be automated, audits existing scheduled tasks
and workflows, and writes a receipt under `manager-reviews/review-YYYY-MM-DD.md`.

Enabled by default on Monday 9am local time. Set `enabled: false` to opt out.

```yaml
manager_review:
  enabled: true
  cron: "0 9 * * MON"   # standard 5-field cron
```
