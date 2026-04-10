# Scheduler & Dream Mode

## Scheduler

Cron tasks stored in SQLite — survive reboots. Runs as part of `openagent serve`.

```yaml
scheduler:
  enabled: true
  tasks:
    - name: health-check
      cron: "*/30 * * * *"
      prompt: "Check services. If any is down, alert via telegram_send_message."
    - name: daily-report
      cron: "0 9 * * *"
      prompt: "Generate and send the daily report."
```

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
