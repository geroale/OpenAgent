# Shell MCP: active-background execution with in-session wake-up

Status: implemented
Date: 2026-04-17
Owner: openagent core

## Problem

OpenAgent's built-in shell MCP (`openagent/mcp/servers/shell/`, Node/TypeScript)
exposes only `shell_exec` (synchronous) and `shell_which`. It cannot:

- run long jobs without blocking the agent turn (builds, installs, deploys)
- feed stdin to a running process (password prompts, REPLs, CLIs that pause)
- surface background-process events back to the agent after the turn ends

The effect is that the model either blocks its whole turn on one shell
call, or forgoes background work entirely. Tools like Claude Code solve
this with a small set of Bash / BashOutput / KillShell primitives plus a
harness-level mechanism that re-enters the model when a background
shell changes state. This design ports that behaviour to OpenAgent, in
a provider-agnostic way, staying inside the current agent process and
session.

## Goals

1. Support long-running commands without blocking a turn: spawn,
   continue, later poll output or kill.
2. Support pre-fed stdin and post-spawn `shell_input` for interactive
   CLIs (no PTY / fullscreen-TUI support in v1).
3. Actively continue the current agent session when a background shell
   produces output or completes — without spawning another agent or
   process.
4. Work identically for every `BaseModel` provider (Claude CLI SDK,
   Agno, future providers).
5. Preserve standard timeout semantics (default 120s, hard cap 30 min)
   and output caps (1 MB per stream).

## Non-goals

- PTY / pseudo-terminal support for curses / readline / fullscreen apps
  (vim, htop, ssh password prompts). Documented as a v2 follow-up.
- Shell persistence across agent process restarts.
- Any changes to the `editor`, `web-search`, `chrome-devtools`,
  `messaging`, `scheduler`, or `computer-control` MCPs.
- A new push / notification channel on the gateway side.

## High-level approach

Replace the Node MCP subprocess with a **true in-process MCP** that
runs inside the agent's Python process. This is different from the
current `scheduler` builtin (which is a Python subprocess launched via
`python -m`) — the shell tool handlers execute in the same event loop
as the agent, so background shells directly signal an `asyncio`
primitive the agent run loop awaits. No cross-process IPC.

Both providers OpenAgent ships with support in-process tool
registration:

- **Claude Agent SDK**: `claude_agent_sdk.create_sdk_mcp_server(name,
  tools=[...])` builds a `McpSdkServerConfig` that runs the tool
  handler in-process and is passed into
  `ClaudeAgentOptions.mcp_servers` alongside stdio MCPs.
- **Agno**: `agno.tools.Toolkit(name="shell", tools=[...])` holds
  Python callables that Agno's `Agent` invokes directly.

The shell tools live as plain async functions in
`openagent/mcp/servers/shell/handlers.py`; each provider adapter wraps
them with its own decorator (SDK `@tool` / Agno `Toolkit`). Same code,
two thin wrappers, one shared `ShellHub` singleton sitting alongside
them in the agent process.

Files:

- `openagent/mcp/servers/shell/handlers.py` — pure-Python tool
  handlers. No provider imports.
- `openagent/mcp/servers/shell/hub.py` — process-wide singleton
  `ShellHub` that owns live background shells and per-session event
  queues.
- `openagent/mcp/servers/shell/shells.py` — `BackgroundShell` class
  that wraps one `asyncio.subprocess.Process` with stdout / stderr
  buffers, timeout task, kill escalation.
- `openagent/mcp/servers/shell/events.py` — `ShellEvent` dataclass.
- `openagent/mcp/servers/shell/adapters.py` — two small adapters:
  `build_sdk_server()` returns the Claude SDK `McpSdkServerConfig`,
  `build_agno_toolkit()` returns the Agno `Toolkit`.
- `openagent/mcp/pool.py` — extend `MCPPool` with an `in_process` spec
  category; `pool.agno_toolkits` now returns subprocess toolkits +
  in-process toolkits; `pool.claude_sdk_servers()` now merges stdio
  configs + SDK-server configs.
- `openagent/core/agent.py` — `_run_inner` loop change that continues
  the current session when the hub reports pending events.

The loop is provider-agnostic because it sits *above* `model.generate`
and reuses the `session_id` contract every provider already honours.
The in-process handlers are also provider-agnostic — each provider
just sees a tool it can call.

## Tool surface

Names and shapes are intentionally aligned with Claude Code's
Bash / BashOutput / KillShell so prompts and model training transfer.

### `shell_exec`

```
shell_exec(
  command: string,
  cwd?: string,
  env?: dict[str, str],
  timeout?: int,              # ms; default 120_000, cap 1_800_000 (30 min)
  run_in_background?: bool,   # default false
  stdin?: string,             # pre-fed stdin for one-shot commands
  description?: string,       # short label for the agent's own trace
)
```

Foreground return:

```json
{ "exit_code": 0, "stdout": "...", "stderr": "...",
  "duration_ms": 2341, "truncated": false }
```

Background return:

```json
{ "shell_id": "sh_3f19c2", "started_at": 1763420123.4 }
```

Errors (timeout, spawn failure) use the standard
`{ exit_code, stdout, stderr, killed, signal }` shape so the model can
parse them uniformly.

### `shell_output`

```
shell_output(
  shell_id: string,
  filter?: string,     # optional regex; applied per line
  since_last?: bool,   # default true — new output since last call
)
```

Returns:

```json
{
  "stdout_delta": "...",
  "stderr_delta": "...",
  "still_running": true,
  "exit_code": null,
  "signal": null,
  "stdout_bytes_total": 12345,
  "stderr_bytes_total": 0,
  "truncated_stdout": false,
  "truncated_stderr": false
}
```

When `still_running` is `false`, `exit_code` and (if applicable)
`signal` are populated.

### `shell_input`

```
shell_input(shell_id: string, text: string, press_enter?: bool)
```

Writes to the child's stdin. `press_enter` appends `\n` when true
(default true). Returns `{ "bytes_written": N }`. Errors if the shell
is not running or stdin was closed.

### `shell_kill`

```
shell_kill(shell_id: string, signal?: "TERM" | "INT" | "KILL")
```

Default `"TERM"`. Hub escalates to `KILL` after a 5 s grace window if
the process is still alive. Returns final `{ killed, exit_code,
signal }`.

### `shell_list`

```
shell_list(session_id?: string)
```

Returns an array of active and recently-completed (within TTL) shells:

```json
[{
  "shell_id": "sh_3f19c2",
  "command": "npm run build",
  "state": "running" | "completed" | "killed" | "timed_out",
  "started_at": 1763420123.4,
  "runtime_ms": 423000,
  "stdout_bytes": 132000,
  "stderr_bytes": 0,
  "exit_code": null,
  "session_id": "user-42"
}]
```

If `session_id` is omitted the MCP returns shells for the current
caller's session (resolved from MCP call context when available,
otherwise all).

### `shell_which`

Unchanged from the current implementation.

## `ShellHub`

One `ShellHub` singleton per Python process. Thread-safe under the
agent's single event loop; no cross-thread access.

### State

```
shells:   dict[shell_id, BackgroundShell]
by_session: dict[session_id, set[shell_id]]
events:   dict[session_id, asyncio.Event]
queues:   dict[session_id, deque[Event]]    # bounded (e.g., 200)
```

`BackgroundShell` holds the `asyncio.subprocess.Process`, the rotating
stdout / stderr buffers, `created_at`, `completed_at`, `exit_code`,
`signal`, `last_read_cursor_stdout`, `last_read_cursor_stderr`, and
the owning `session_id`.

### Writer API (called by `server.py`)

- `register(shell, session_id)`
- `post_event(session_id, event)` — appends to queue, sets
  `events[session_id]`

### Reader API (called by `agent._run_inner`)

- `drain(session_id) -> list[Event]` — returns everything currently in
  the queue and clears it; returns `[]` when empty.
- `has_running(session_id) -> bool`
- `async wait(session_id, timeout) -> list[Event]` — awaits the event
  (with timeout), then drains.

### Events

```python
@dataclass
class ShellEvent:
    shell_id: str
    kind: Literal["completed", "timed_out", "killed"]
    exit_code: int | None
    signal: str | None
    bytes_stdout: int
    bytes_stderr: int
    at: float
```

Only terminal events (`completed`, `timed_out`, `killed`) are posted
to the session queue. `new_output` is *not* an auto-loop trigger —
that would let a chatty `tail -f` spam the agent with reminders. New
output is available any time the model explicitly calls
`shell_output`, which is the intended polling channel for
streaming / long-running processes.

Each terminal event is posted exactly once.

### Buffering and truncation

- Each stream (stdout, stderr) has a cap of 1 MB.
- On overflow, oldest bytes are dropped and a one-time
  `[...truncated: dropped N bytes...]` marker is injected at the drop
  boundary so the model can tell.
- `shell_output` cursors track per-call read positions so `since_last`
  never re-delivers already-seen bytes (even if the buffer rotated).

### Garbage collection

- Terminal shells stay queryable for 10 minutes after completion, then
  are removed from `shells` (the hub logs at debug level so a late
  lookup after GC is diagnosable).
- When `agent.forget_session(session_id)` or `release_session` fires,
  the hub kills every shell still running for that session and drops
  the session entry entirely.
- `agent.shutdown()` drains all sessions: SIGTERM → 5 s grace →
  SIGKILL, then close stdin / stdout / stderr pipes.

## Agent run-loop change

`_run_inner` today calls `model.generate(...)` exactly once. The new
shape:

```python
current_input = message                      # original user message
while True:
    response = await self.model.generate(
        [{"role": "user", "content": current_input}],
        system=system,
        session_id=session_id,
        on_status=_status,
        ...,
    )
    # Fast path: anything waiting?
    events = shell_hub.drain(session_id)
    if not events:
        if not shell_hub.has_running(session_id):
            break
        events = await shell_hub.wait(session_id, timeout=wake_wait_window)
        if not events:
            break
    current_input = format_system_reminder(events)
# response now holds the final turn
```

### `format_system_reminder`

Returns a single string wrapped in `<system-reminder>` tags so every
provider treats it as an instruction, not user content. Lists the
terminal events since the last reminder — the model still has to call
`shell_output` to read the actual bytes. Example:

```
<system-reminder>
Background shell status update since your last message:
- shell_id=sh_3f19c2 (npm run build): completed with exit_code=0 after
  7m12s. 1432 stdout bytes, 0 stderr. Call shell_output to read.
- shell_id=sh_771aa0 (pytest tests/): timed_out after 30m.
  Call shell_output to read partial output.
The user has not sent a new message; continue the task from where you
left off, or summarise and stop if the work is complete.
</system-reminder>
```

The closing instruction is the "don't loop forever" guard-rail — it
gives the model explicit permission to stop when there's nothing left
to do.

### `wake_wait_window`

Configurable in `openagent.yaml`:

```yaml
shell:
  wake_wait_window_seconds: 60     # default; 0 disables post-turn wait
```

Tradeoff: the window is how long `agent.run()` will sit after the model
finished its final turn, just in case a bg shell is about to complete.
At 0, behaviour is passive-only (events are delivered only if the
model's own `shell_output` call surfaces them mid-turn).

### Reach of active wake-up

Active wake-up within a single `agent.run()` call only catches shells
that complete **within the `wake_wait_window`** after the model's
final turn. A 30-minute build started on turn 1 will NOT cause the
same `agent.run()` to still be sitting there 30 minutes later — the
channel would be blocked.

For shells that complete after the window closes, two mechanisms
catch the event:

1. **Next-turn passive reminder (always on)** — the hub retains
   pending terminal events per session. When the next user message
   arrives and `agent.run()` starts again, `_run_inner` drains the hub
   once before the first `model.generate` call and, if anything is
   waiting, prepends it to the user's message as a
   `<system-reminder>`. This is the Claude-Code-style passive
   notification; it covers the common "I asked for a build, came back
   10 min later" flow.
2. **Channel push (future work)** — a background listener task that
   invokes `agent.run()` on the user's behalf when a bg shell
   completes with nothing else scheduled. Explicitly out of scope for
   v1; tracked as an open risk under Open Questions.

### Loop termination guards

- Hard cap of 25 auto-continuation turns per `agent.run()` to stop a
  runaway shell → reminder → model → shell chain. Exceeding the cap
  logs `agent.run.autoloop_cap_hit` and returns the last response.
- The final reminder block always includes "...continue the task from
  where you left off, or summarise and stop if the work is complete"
  so the model has a natural exit.

## Provider compatibility

`_run_inner` lives above `BaseModel.generate`, so the loop is
provider-neutral.

- **Claude CLI SDK** (`openagent/models/claude_cli.py`): already holds
  a persistent `ClaudeSDKClient` subprocess per `session_id` and uses
  the SDK's resume. A second `client.query(session_id=...)` call
  continues the same conversation.
- **Agno** (`openagent/models/agno_provider.py`): `runner.arun(prompt,
  session_id=..., user_id=...)` with the same `session_id` continues
  the same Agno session (Agno stores history internally).
- **Future providers**: the base contract requires
  `generate(session_id=...)` to continue the session; any provider
  that satisfies that contract works unchanged.

Both providers route tool calls through the shared `MCPPool`
(`openagent/mcp/pool.py`), so `shell_exec(run_in_background=true)` and
the rest of the new tool surface are available inside the provider's
internal tool loop without any provider-side change.

## Session wiring

The MCP tool implementation needs the `session_id` to associate a
background shell with the right hub bucket. Claude SDK exposes
`session_id` in tool-call context; Agno likewise threads it through.
When the MCP layer cannot resolve a `session_id`, the shell still
runs but active wake-up is skipped for it (graceful degradation — the
model can still poll `shell_output` manually).

Implementation: wrap the tool handlers in a small adapter that reads
the MCP `RequestContext` (SDK-specific) and, on failure, falls back to
a "no-session" bucket that the agent loop ignores.

## Lifecycle integration

- `agent.forget_session(session_id)` and `agent.release_session(...)`
  call `shell_hub.purge_session(session_id)` which kills every shell
  and drops the session entry.
- `agent.shutdown()` calls `shell_hub.shutdown()` which drains all
  sessions.
- The existing idle-cleanup task in `Agent._run_idle_cleanup` is
  extended to also invoke `shell_hub.purge_session` for sessions the
  agent has released.

## Migration

- Delete `openagent/mcp/servers/shell/src/`, `dist/`, `node_modules/`,
  `package.json`, `package-lock.json`, `tsconfig.json`.
- Add `openagent/mcp/servers/shell/__init__.py`, `handlers.py`,
  `hub.py`, `shells.py`, `events.py`, `adapters.py`.
- Update `BUILTIN_MCP_SPECS["shell"]` in
  `openagent/mcp/builtins.py:155` to a new in-process shape:

  ```python
  "shell": {
      "in_process": True,
      "adapter_module": "openagent.mcp.servers.shell.adapters",
  }
  ```

- Tool names `shell_exec` and `shell_which` are unchanged, so prompts
  and existing model priors still work. New tools are additive.
- Remove any Node/npm references to the shell MCP from `scripts/`,
  `pyproject.toml`, CI, and the PyInstaller specs (`openagent.spec`,
  `cli.spec`).

## Testing

Unit tests (Python, `pytest-asyncio`):

- `ShellHub` — register, drain, wait (with / without events), debounce
  window, terminal event never debounced, GC after TTL,
  `purge_session` kills running shells, overflow truncation.
- Event ordering — concurrent writers from multiple shells in one
  session land in the queue in the order they occurred (modulo
  debounce).

Integration tests (in-process MCP client against
`server.py`):

- `shell_exec` foreground: exit codes, stdout, stderr, env, cwd,
  timeout (graceful kill + `killed=true`).
- `shell_exec` background: returns `shell_id`, `shell_list` shows it,
  `shell_output` returns deltas, `shell_kill` terminates.
- `shell_input` writes to stdin of a `cat` subprocess; `shell_output`
  sees the echo.
- Output truncation: flood stdout past 1 MB, confirm the truncation
  marker is present and `shell_output` reports `truncated_stdout=true`.
- Concurrent background shells — no cross-shell buffer bleed.

End-to-end test of the agent auto-loop:

- Fake `BaseModel` that calls `shell_exec(run_in_background=true)` on
  its first turn and then (on the system-reminder turn) reads
  `shell_output` and produces final text.
- Assertions: a single `agent.run(...)` call triggers 2 `generate`
  calls, the second one's input is a `<system-reminder>` with the
  expected shell id, the final return matches the fake model's second
  output.
- Autoloop cap test: fake model that keeps calling
  `shell_exec(run_in_background=true)` each turn; assert we stop at
  the configured cap and log `agent.run.autoloop_cap_hit`.

## Observability

Add structured events via `elog` at the same points the existing agent
uses:

- `shell.bg.start` (shell_id, command, session_id, cwd)
- `shell.bg.output` (shell_id, stdout_bytes, stderr_bytes)
- `shell.bg.exit` (shell_id, exit_code, signal, runtime_ms)
- `shell.bg.kill` (shell_id, signal, reason)
- `shell.bg.gc` (shell_id, age_ms)
- `agent.run.autoloop_iter` (session_id, iter, events)
- `agent.run.autoloop_cap_hit` (session_id, cap)

## Open questions / risks

- **Session-id resolution in MCP context** — needs verification that
  both Claude SDK and Agno pass `session_id` into the MCP tool call
  context in a way the server can read. If Agno does not, shells
  launched via Agno fall back to the "no-session" bucket (passive
  only) until a follow-up threads the id through. This is the single
  biggest integration risk; first implementation step is to confirm.
- **Channel-push active wake-up** — v1 only delivers active wake-up
  within `wake_wait_window` of the model's final turn. A shell that
  completes 10 minutes later surfaces on the next user message
  (passive reminder). True push-to-channel wake-up requires a
  process-level listener that starts a fresh `agent.run()` and routes
  output back through whatever channel spawned the original message.
  Tracked as a v2 item.
- **Process reaping on macOS + PyInstaller bundles** — existing
  OpenAgent deployments ship as PyInstaller bundles on Mac. Need to
  verify `asyncio.create_subprocess_exec` and `os.killpg` behave the
  same there as in a plain Python install, especially around process
  groups.
- **Prompt drift** — the existing system prompt refers to
  `shell_shell_exec`; the new tool surface adds `shell_shell_output`,
  `shell_shell_input`, `shell_shell_kill`, `shell_shell_list`. Brief
  prompt amendment in `openagent/core/prompts.py` is required so the
  model knows the new primitives exist. Kept minimal — prompt still
  tells the model to prefer dedicated MCPs over shell.
