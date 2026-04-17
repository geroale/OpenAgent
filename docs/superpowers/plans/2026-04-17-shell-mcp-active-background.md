# Shell MCP: active-background execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node-based shell MCP with a true in-process Python implementation that supports background shells, stdin, kill/list/output tools, and actively wakes the current agent session when a background shell completes.

**Architecture:** A `ShellHub` singleton lives in the agent process and owns `BackgroundShell` subprocesses + per-session event queues. The shell "MCP" exists only as provider adapters — `create_sdk_mcp_server` for Claude SDK and `agno.tools.Toolkit` for Agno — both wrapping the same shared async handlers. The agent's `_run_inner` loop drains the hub between turns and re-invokes the provider with a `<system-reminder>` when a shell completes. No IPC, no subprocess MCP.

**Tech Stack:** Python 3.11+, asyncio, `claude_agent_sdk` (`create_sdk_mcp_server`, `@tool`), `agno.tools.Toolkit`, custom `@test` framework in `scripts/tests/`.

**Spec:** [docs/superpowers/specs/2026-04-17-shell-mcp-active-background-design.md](../specs/2026-04-17-shell-mcp-active-background-design.md).

---

## File structure

**Create:**

- `openagent/mcp/servers/shell/__init__.py` — package marker.
- `openagent/mcp/servers/shell/events.py` — `ShellEvent` dataclass + `ShellEventKind` Literal.
- `openagent/mcp/servers/shell/hub.py` — `ShellHub` singleton with state, event queues, GC, purge, shutdown.
- `openagent/mcp/servers/shell/shells.py` — `BackgroundShell` wrapping one `asyncio.subprocess.Process` (buffers, stdin, kill, timeout).
- `openagent/mcp/servers/shell/handlers.py` — six pure-Python tool handlers: `shell_exec`, `shell_output`, `shell_input`, `shell_kill`, `shell_list`, `shell_which`.
- `openagent/mcp/servers/shell/adapters.py` — `build_sdk_server()` + `build_agno_toolkit()`.
- `scripts/tests/test_shell.py` — all shell MCP tests (category `shell`).

**Modify:**

- `openagent/mcp/builtins.py:149-202` — switch `shell` entry to in-process spec; update `resolve_builtin_entry` to recognise `in_process`.
- `openagent/mcp/pool.py:230-485` — extend `_ServerSpec` and `MCPPool` to handle in-process specs; merge into `agno_toolkits` and `claude_sdk_servers()`.
- `openagent/core/agent.py:398-466` — `_run_inner` auto-continuation loop.
- `openagent/core/agent.py:229-256` — `forget_session` / `release_session` calls `shell_hub.purge_session`.
- `openagent/core/agent.py:293-317` — `shutdown` calls `shell_hub.shutdown`.
- `openagent/core/agent.py:280-291` — idle cleanup calls `shell_hub.purge_session` for released ids.
- `openagent/core/config.py` — add `shell.wake_wait_window_seconds` (default 60) and `shell.autoloop_cap` (default 25).
- `openagent/core/prompts.py` — one short paragraph describing the new tools.
- `scripts/test_openagent.py:_TEST_MODULES` — register `"test_shell"`.

**Delete:**

- `openagent/mcp/servers/shell/src/` (entire directory).
- `openagent/mcp/servers/shell/dist/` (entire directory, if committed).
- `openagent/mcp/servers/shell/node_modules/` (entire directory).
- `openagent/mcp/servers/shell/package.json`, `package-lock.json`, `tsconfig.json`.
- Node references from `pyproject.toml` `[tool.setuptools.package-data]` (currently includes `mcp/servers/**/*.ts` and `mcp/servers/**/*.json`).
- Shell-MCP Node build steps from `scripts/install.sh`, `scripts/setup.sh`, and `openagent.spec` / `cli.spec` if present.

---

## Preflight check

- [ ] **Step 1: Confirm working tree is clean and on `main`.**

```bash
cd /Users/alessandrogerelli/OpenAgent
git status
git log --oneline -3
```

Expected: no uncommitted changes; `main` at `ddde271` (spec clarification commit) or later.

- [ ] **Step 2: Confirm the test framework runs green today.**

```bash
cd /Users/alessandrogerelli/OpenAgent
bash scripts/test_openagent.sh --only imports,setup,catalog,formatting
```

Expected: all tests pass. This is our baseline.

---

## Task 1: `events.py` + test harness registration

**Files:**
- Create: `openagent/mcp/servers/shell/__init__.py`
- Create: `openagent/mcp/servers/shell/events.py`
- Create: `scripts/tests/test_shell.py`
- Modify: `scripts/test_openagent.py` (add `"test_shell"` to `_TEST_MODULES`)

- [ ] **Step 1: Remove the Node shell MCP sources (will be replaced).**

```bash
cd /Users/alessandrogerelli/OpenAgent
rm -rf openagent/mcp/servers/shell/src openagent/mcp/servers/shell/dist openagent/mcp/servers/shell/node_modules
rm -f openagent/mcp/servers/shell/package.json openagent/mcp/servers/shell/package-lock.json openagent/mcp/servers/shell/tsconfig.json
```

- [ ] **Step 2: Create the shell package marker.**

Write `openagent/mcp/servers/shell/__init__.py`:

```python
"""In-process shell MCP for OpenAgent.

Exposes shell_exec / shell_output / shell_input / shell_kill / shell_list /
shell_which tools. Replaces the Node-based subprocess MCP (pre-0.7) with
a true in-process implementation that shares a ShellHub singleton with
the agent run loop, allowing terminal background-shell events to wake
the current session via _run_inner's auto-continuation loop.
"""
```

- [ ] **Step 3: Write the failing test for `ShellEvent`.**

Append to `scripts/tests/test_shell.py` (create the file if it does not exist):

```python
"""Shell MCP — unit + integration tests for the in-process shell tools."""
from __future__ import annotations

from ._framework import TestContext, test


@test("shell", "ShellEvent is a frozen dataclass with expected fields")
async def t_shell_event_shape(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.events import ShellEvent

    e = ShellEvent(
        shell_id="sh_abc",
        kind="completed",
        exit_code=0,
        signal=None,
        bytes_stdout=42,
        bytes_stderr=0,
        at=123.0,
    )
    assert e.shell_id == "sh_abc"
    assert e.kind == "completed"
    assert e.exit_code == 0
    assert e.signal is None
    assert e.bytes_stdout == 42
    assert e.bytes_stderr == 0
    assert e.at == 123.0
    # Frozen → setattr raises.
    try:
        e.shell_id = "sh_xyz"  # type: ignore[misc]
    except Exception:
        pass
    else:
        raise AssertionError("ShellEvent should be frozen")
```

- [ ] **Step 4: Register `test_shell` in the test driver.**

Edit `scripts/test_openagent.py`: find `_TEST_MODULES` and add `"test_shell"` in the "Misc standalone" section (after `"test_bridges"`):

```python
    "test_cron",
    "test_dream",
    "test_updater",
    "test_bridges",
    "test_shell",
    # 7. Optional Claude CLI path (needs --include-claude)
```

- [ ] **Step 5: Run the test; expect it to fail.**

```bash
cd /Users/alessandrogerelli/OpenAgent
bash scripts/test_openagent.sh --only shell
```

Expected: `FAIL` — `ModuleNotFoundError: openagent.mcp.servers.shell.events`.

- [ ] **Step 6: Implement `ShellEvent`.**

Write `openagent/mcp/servers/shell/events.py`:

```python
"""Event types posted by ShellHub when a background shell reaches a
terminal state. Only terminal events are posted — ``new_output`` does
NOT trigger the agent auto-loop, to avoid chatty processes like
``tail -f`` spamming the session with reminders (see spec § Events).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ShellEventKind = Literal["completed", "timed_out", "killed"]


@dataclass(frozen=True)
class ShellEvent:
    shell_id: str
    kind: ShellEventKind
    exit_code: int | None
    signal: str | None
    bytes_stdout: int
    bytes_stderr: int
    at: float
```

- [ ] **Step 7: Run the test; expect it to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: `ok shell/ShellEvent is a frozen dataclass with expected fields`.

- [ ] **Step 8: Commit.**

```bash
cd /Users/alessandrogerelli/OpenAgent
git add openagent/mcp/servers/shell/ scripts/tests/test_shell.py scripts/test_openagent.py
git commit -m "$(cat <<'EOF'
feat(shell): package scaffolding + ShellEvent dataclass

Remove Node shell MCP sources (src/, dist/, node_modules/, package.json,
package-lock.json, tsconfig.json). Add Python package marker and
ShellEvent (frozen dataclass with terminal kinds only). Register
test_shell in the driver so future shell tests are picked up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ShellHub` — core state (register / get / list / purge)

**Files:**
- Create: `openagent/mcp/servers/shell/hub.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "ShellHub: register and get a shell by id")
async def t_hub_register_get(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_1", session_id="s1", command="echo hi")
    got = hub.get("sh_1")
    assert got is not None, "get should return the registered record"
    assert got.command == "echo hi"
    assert got.session_id == "s1"


@test("shell", "ShellHub: list_for_session filters by session")
async def t_hub_list_for_session(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_1", session_id="s1", command="a")
    hub.register(shell_id="sh_2", session_id="s2", command="b")
    hub.register(shell_id="sh_3", session_id="s1", command="c")

    ids_s1 = {r.shell_id for r in hub.list_for_session("s1")}
    ids_s2 = {r.shell_id for r in hub.list_for_session("s2")}
    ids_all = {r.shell_id for r in hub.list_for_session(None)}

    assert ids_s1 == {"sh_1", "sh_3"}, f"expected s1 shells, got {ids_s1}"
    assert ids_s2 == {"sh_2"}
    assert ids_all == {"sh_1", "sh_2", "sh_3"}


@test("shell", "ShellHub: has_running only true while not completed")
async def t_hub_has_running(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_1", session_id="s1", command="x")
    assert hub.has_running("s1") is True
    hub.mark_completed("sh_1", exit_code=0, signal=None)
    assert hub.has_running("s1") is False


@test("shell", "ShellHub: purge_session removes entries and reports killed ids")
async def t_hub_purge_session(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_1", session_id="s1", command="a")
    hub.register(shell_id="sh_2", session_id="s1", command="b")
    hub.register(shell_id="sh_3", session_id="s2", command="c")

    purged = await hub.purge_session("s1")
    assert sorted(purged) == ["sh_1", "sh_2"], f"unexpected: {purged}"
    assert hub.get("sh_1") is None
    assert hub.get("sh_2") is None
    assert hub.get("sh_3") is not None
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: four failures — `ModuleNotFoundError: openagent.mcp.servers.shell.hub`.

- [ ] **Step 3: Implement `ShellHub` core state.**

Write `openagent/mcp/servers/shell/hub.py`:

```python
"""Process-wide singleton that tracks background shells and the
per-session event queues the agent loop awaits.

Owned by the agent process. Tool handlers write; agent._run_inner
reads. Thread-safety: single event loop, no cross-thread access.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from openagent.mcp.servers.shell.events import ShellEvent, ShellEventKind

if TYPE_CHECKING:
    from openagent.mcp.servers.shell.shells import BackgroundShell

logger = logging.getLogger(__name__)

# Queue cap per session — chatty or broken session can't exhaust memory.
_MAX_QUEUED_EVENTS = 200


@dataclass
class ShellRecord:
    shell_id: str
    session_id: str | None
    command: str
    created_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    exit_code: int | None = None
    signal: str | None = None
    # The BackgroundShell is attached after spawn (None while tests use
    # register() directly without spawning a real subprocess).
    shell: "BackgroundShell | None" = None

    @property
    def is_completed(self) -> bool:
        return self.completed_at is not None


class ShellHub:
    """Singleton (per agent process) for background-shell bookkeeping."""

    def __init__(self) -> None:
        self._shells: dict[str, ShellRecord] = {}
        self._by_session: dict[str, set[str]] = {}
        self._events: dict[str, asyncio.Event] = {}
        self._queues: dict[str, deque[ShellEvent]] = {}

    # ── Registration ────────────────────────────────────────────────

    def register(
        self,
        *,
        shell_id: str,
        session_id: str | None,
        command: str,
        shell: "BackgroundShell | None" = None,
    ) -> ShellRecord:
        record = ShellRecord(
            shell_id=shell_id,
            session_id=session_id,
            command=command,
            shell=shell,
        )
        self._shells[shell_id] = record
        if session_id is not None:
            self._by_session.setdefault(session_id, set()).add(shell_id)
        return record

    def get(self, shell_id: str) -> ShellRecord | None:
        return self._shells.get(shell_id)

    def list_for_session(self, session_id: str | None) -> list[ShellRecord]:
        if session_id is None:
            return list(self._shells.values())
        ids = self._by_session.get(session_id, set())
        return [self._shells[i] for i in ids if i in self._shells]

    def has_running(self, session_id: str | None) -> bool:
        for rec in self.list_for_session(session_id):
            if not rec.is_completed:
                return True
        return False

    def mark_completed(
        self,
        shell_id: str,
        *,
        exit_code: int | None,
        signal: str | None,
    ) -> None:
        rec = self._shells.get(shell_id)
        if rec is None:
            return
        rec.completed_at = time.time()
        rec.exit_code = exit_code
        rec.signal = signal

    # ── Purge ───────────────────────────────────────────────────────

    async def purge_session(self, session_id: str) -> list[str]:
        """Kill every shell for ``session_id`` and drop the session.

        Returns the list of shell_ids that were purged (for logging).
        Kills *live* shells via ``BackgroundShell.kill`` with SIGKILL
        so shutdown is bounded.
        """
        ids = list(self._by_session.pop(session_id, set()))
        killed: list[str] = []
        for sid in ids:
            rec = self._shells.pop(sid, None)
            if rec is None:
                continue
            killed.append(sid)
            if rec.shell is not None and not rec.is_completed:
                try:
                    await rec.shell.kill(signal_name="KILL", grace_seconds=0)
                except Exception as e:  # noqa: BLE001 — best-effort
                    logger.debug("purge_session kill failed for %s: %s", sid, e)
        self._events.pop(session_id, None)
        self._queues.pop(session_id, None)
        return killed
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 5 passes (event + four hub tests).

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/hub.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): ShellHub core state (register / get / list / purge)

Process-wide singleton that tracks every registered background shell by
id, indexes by session_id, and supports purge_session for session
lifecycle cleanup. Event-queue and async-wait APIs land in the next
task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `ShellHub` — event queue and `wait`

**Files:**
- Modify: `openagent/mcp/servers/shell/hub.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "ShellHub: post_event + drain returns events in FIFO order")
async def t_hub_post_drain(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub
    from openagent.mcp.servers.shell.events import ShellEvent

    hub = ShellHub()
    e1 = ShellEvent("sh_1", "completed", 0, None, 10, 0, 1.0)
    e2 = ShellEvent("sh_2", "killed", None, "TERM", 3, 5, 2.0)
    hub.post_event("s1", e1)
    hub.post_event("s1", e2)
    drained = hub.drain("s1")
    assert [e.shell_id for e in drained] == ["sh_1", "sh_2"]
    # Queue is empty after drain.
    assert hub.drain("s1") == []


@test("shell", "ShellHub: drain on unknown session returns []")
async def t_hub_drain_unknown(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    assert hub.drain("nope") == []


@test("shell", "ShellHub: wait resolves when an event is posted")
async def t_hub_wait_wakes_up(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell.hub import ShellHub
    from openagent.mcp.servers.shell.events import ShellEvent

    hub = ShellHub()
    e = ShellEvent("sh_9", "completed", 0, None, 1, 0, 9.0)

    async def delayed_post() -> None:
        await asyncio.sleep(0.05)
        hub.post_event("s1", e)

    task = asyncio.create_task(delayed_post())
    try:
        events = await hub.wait("s1", timeout=1.0)
    finally:
        await task
    assert len(events) == 1
    assert events[0].shell_id == "sh_9"


@test("shell", "ShellHub: wait returns [] on timeout")
async def t_hub_wait_timeout(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    events = await hub.wait("s1", timeout=0.05)
    assert events == []


@test("shell", "ShellHub: queue cap drops oldest and keeps newest")
async def t_hub_queue_cap(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub
    from openagent.mcp.servers.shell.events import ShellEvent

    hub = ShellHub()
    # Post more than the cap (200) — confirm the newest 200 survive.
    for i in range(250):
        hub.post_event("s1", ShellEvent(f"sh_{i}", "completed", 0, None, 1, 0, float(i)))
    drained = hub.drain("s1")
    assert len(drained) == 200
    # The oldest 50 (sh_0 … sh_49) were dropped.
    assert drained[0].shell_id == "sh_50"
    assert drained[-1].shell_id == "sh_249"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: five failures — `AttributeError: 'ShellHub' object has no attribute 'post_event'` (and similar).

- [ ] **Step 3: Implement event queue API.**

In `openagent/mcp/servers/shell/hub.py`, add these methods inside `ShellHub`:

```python
    # ── Event queue ─────────────────────────────────────────────────

    def post_event(self, session_id: str | None, event: ShellEvent) -> None:
        """Push a terminal event into ``session_id``'s queue and wake any
        waiter. No-op when ``session_id`` is None — we only do active
        wake-up for shells that have a session."""
        if session_id is None:
            return
        q = self._queues.setdefault(session_id, deque(maxlen=_MAX_QUEUED_EVENTS))
        q.append(event)
        ev = self._events.setdefault(session_id, asyncio.Event())
        ev.set()

    def drain(self, session_id: str | None) -> list[ShellEvent]:
        """Return every queued event for ``session_id`` and clear the queue."""
        if session_id is None:
            return []
        q = self._queues.get(session_id)
        if not q:
            return []
        out = list(q)
        q.clear()
        ev = self._events.get(session_id)
        if ev is not None:
            ev.clear()
        return out

    async def wait(self, session_id: str | None, timeout: float) -> list[ShellEvent]:
        """Await up to ``timeout`` seconds for any event on ``session_id``.

        Returns the drained events (possibly empty on timeout). Safe to
        call when no shells are registered — returns [] immediately
        after the timeout.
        """
        if session_id is None or timeout <= 0:
            return self.drain(session_id)
        # Fast path — already something queued.
        if self._queues.get(session_id):
            return self.drain(session_id)
        ev = self._events.setdefault(session_id, asyncio.Event())
        try:
            await asyncio.wait_for(ev.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return []
        return self.drain(session_id)
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 10 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/hub.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): ShellHub event queue + async wait

post_event / drain / wait(timeout) — the primitives the agent run
loop uses to continue a session when a background shell reaches a
terminal state. Queue is bounded (200 events per session) so a broken
writer can't exhaust memory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `ShellHub` — GC of completed shells + `shutdown`

**Files:**
- Modify: `openagent/mcp/servers/shell/hub.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "ShellHub: gc removes completed shells older than TTL")
async def t_hub_gc(ctx: TestContext) -> None:
    import time
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_old", session_id="s1", command="a")
    hub.register(shell_id="sh_new", session_id="s1", command="b")
    hub.register(shell_id="sh_live", session_id="s1", command="c")

    # Old completed 15 min ago; new completed 1 s ago; live still running.
    hub.mark_completed("sh_old", exit_code=0, signal=None)
    hub.mark_completed("sh_new", exit_code=0, signal=None)
    hub._shells["sh_old"].completed_at = time.time() - 15 * 60

    removed = hub.gc(ttl_seconds=10 * 60)
    assert removed == ["sh_old"], f"unexpected gc: {removed}"
    assert hub.get("sh_old") is None
    assert hub.get("sh_new") is not None
    assert hub.get("sh_live") is not None


@test("shell", "ShellHub: shutdown purges every session and clears state")
async def t_hub_shutdown(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.hub import ShellHub

    hub = ShellHub()
    hub.register(shell_id="sh_1", session_id="s1", command="a")
    hub.register(shell_id="sh_2", session_id="s2", command="b")
    await hub.shutdown()
    assert hub.get("sh_1") is None
    assert hub.get("sh_2") is None
    assert hub.list_for_session(None) == []
    assert hub.drain("s1") == []
    assert hub.drain("s2") == []
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — `AttributeError: 'ShellHub' object has no attribute 'gc'`.

- [ ] **Step 3: Implement `gc` and `shutdown`.**

In `openagent/mcp/servers/shell/hub.py`, add these methods inside `ShellHub`:

```python
    # ── GC / shutdown ───────────────────────────────────────────────

    def gc(self, ttl_seconds: float = 600.0) -> list[str]:
        """Drop completed shells older than ``ttl_seconds``.

        Live shells are never touched. Returns the shell_ids removed
        (for debug logging). Called by the agent's idle cleanup loop.
        """
        now = time.time()
        victims: list[str] = []
        for sid, rec in list(self._shells.items()):
            if not rec.is_completed:
                continue
            if rec.completed_at is None:
                continue
            if (now - rec.completed_at) < ttl_seconds:
                continue
            victims.append(sid)
            del self._shells[sid]
            if rec.session_id and rec.session_id in self._by_session:
                self._by_session[rec.session_id].discard(sid)
                if not self._by_session[rec.session_id]:
                    del self._by_session[rec.session_id]
        return victims

    async def shutdown(self) -> None:
        """Purge every session and clear all queues / events.

        Called from ``Agent.shutdown`` so the process can exit without
        leaking background subprocesses.
        """
        for session_id in list(self._by_session.keys()):
            await self.purge_session(session_id)
        # Drop shells that were never associated with a session.
        for sid, rec in list(self._shells.items()):
            if rec.shell is not None and not rec.is_completed:
                try:
                    await rec.shell.kill(signal_name="KILL", grace_seconds=0)
                except Exception as e:  # noqa: BLE001
                    logger.debug("shutdown kill failed for %s: %s", sid, e)
            del self._shells[sid]
        self._events.clear()
        self._queues.clear()
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 12 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/hub.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): ShellHub gc + shutdown

gc(ttl_seconds) drops completed shells older than the TTL so they
don't accumulate forever; shutdown purges every session so the agent
can exit without leaking subprocesses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `BackgroundShell` — spawn, output capture, exit

**Files:**
- Create: `openagent/mcp/servers/shell/shells.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
async def _run_bg_to_completion(bg, *, max_wait: float = 2.5) -> None:
    """Helper: busy-wait for ``bg`` to exit, then finalise. 50 x 50ms polls."""
    import asyncio
    for _ in range(int(max_wait / 0.05)):
        if not bg.is_running:
            break
        await asyncio.sleep(0.05)
    await bg.finalise()


@test("shell", "BackgroundShell: spawn echo and capture stdout + exit_code")
async def t_bg_spawn_echo(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_echo",
        command="echo hello-from-shell",
        cwd=None,
        env=None,
    )
    await bg.start()
    await _run_bg_to_completion(bg)
    assert not bg.is_running, "echo should have completed within 2.5s"
    stdout, _ = bg.read(since_stdout=0, since_stderr=0)
    assert "hello-from-shell" in stdout
    assert bg.exit_code == 0


@test("shell", "BackgroundShell: non-zero exit is captured")
async def t_bg_nonzero_exit(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_exit",
        command="exit 7",
        cwd=None,
        env=None,
    )
    await bg.start()
    await _run_bg_to_completion(bg)
    assert not bg.is_running
    assert bg.exit_code == 7


@test("shell", "BackgroundShell: stderr is captured separately")
async def t_bg_stderr(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_err",
        command="echo to-err 1>&2",
        cwd=None,
        env=None,
    )
    await bg.start()
    await _run_bg_to_completion(bg)
    stdout, stderr = bg.read(since_stdout=0, since_stderr=0)
    assert stdout == "", f"expected no stdout, got: {stdout!r}"
    assert "to-err" in stderr


@test("shell", "BackgroundShell: read cursors advance (since_last semantics)")
async def t_bg_read_cursor(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_cursor",
        command="printf 'ABC'",
        cwd=None,
        env=None,
    )
    await bg.start()
    await _run_bg_to_completion(bg)
    s1, _ = bg.read(since_stdout=0, since_stderr=0)
    assert s1 == "ABC"
    s2, _ = bg.read(since_stdout=len(s1.encode()), since_stderr=0)
    assert s2 == "", f"expected empty after full read, got: {s2!r}"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: four failures — `ModuleNotFoundError: openagent.mcp.servers.shell.shells`.

- [ ] **Step 3: Implement `BackgroundShell` (spawn + output).**

Write `openagent/mcp/servers/shell/shells.py`:

```python
"""One running background shell: subprocess + output buffers +
lifecycle control (timeout, kill, stdin). State lives here; the
ShellHub holds references for lookup but delegates every real operation
to this class.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal as signal_module
import time
from typing import Literal

logger = logging.getLogger(__name__)

# Per-stream output cap (spec § Buffering and truncation).
MAX_STREAM_BYTES = 1_000_000

# Grace between SIGTERM and SIGKILL during kill.
DEFAULT_KILL_GRACE = 5.0


SignalName = Literal["TERM", "INT", "KILL"]


def _pick_shell() -> tuple[str, str]:
    """Return (shell_path, '-c' flag). Same logic as the old TS MCP."""
    import platform as _platform
    sysname = _platform.system().lower()
    if sysname == "windows":
        return (os.environ.get("COMSPEC", "cmd.exe"), "/c")
    if sysname == "darwin":
        return (os.environ.get("SHELL", "/bin/zsh"), "-c")
    return (os.environ.get("SHELL", "/bin/bash"), "-c")


class BackgroundShell:
    """One spawned subprocess, tracked by its ``shell_id``.

    Buffers are simple ``bytearray`` with a cap; once full, oldest bytes
    are dropped and a truncation marker is inserted at the drop boundary
    (see ``_append``). Cursors are raw byte offsets into the *original*
    output stream (not the buffer), so ``read(since=N)`` is stable even
    after truncation — old bytes past the cursor are simply gone and
    are skipped.
    """

    def __init__(
        self,
        *,
        shell_id: str,
        command: str,
        cwd: str | None,
        env: dict[str, str] | None,
    ) -> None:
        self.shell_id = shell_id
        self.command = command
        self.cwd = cwd
        self.env = env
        self._proc: asyncio.subprocess.Process | None = None
        self._stdout_buf = bytearray()
        self._stderr_buf = bytearray()
        self._stdout_total = 0  # total bytes ever written (including dropped)
        self._stderr_total = 0
        self._stdout_dropped = 0
        self._stderr_dropped = 0
        self._stdout_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._started_at: float | None = None
        self._completed_at: float | None = None
        self._exit_code: int | None = None
        self._signal: str | None = None

    # ── Spawn ───────────────────────────────────────────────────────

    async def start(self) -> None:
        shell, flag = _pick_shell()
        proc_env = os.environ.copy()
        if self.env:
            proc_env.update(self.env)
        self._proc = await asyncio.create_subprocess_exec(
            shell, flag, self.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.cwd,
            env=proc_env,
            start_new_session=True,  # own process group → killpg on kill
        )
        self._started_at = time.time()
        self._stdout_task = asyncio.create_task(self._drain(self._proc.stdout, is_stderr=False))
        self._stderr_task = asyncio.create_task(self._drain(self._proc.stderr, is_stderr=True))

    # ── Output accounting ───────────────────────────────────────────

    async def _drain(self, stream: asyncio.StreamReader | None, *, is_stderr: bool) -> None:
        if stream is None:
            return
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                return
            self._append(chunk, is_stderr=is_stderr)

    def _append(self, chunk: bytes, *, is_stderr: bool) -> None:
        buf = self._stderr_buf if is_stderr else self._stdout_buf
        buf.extend(chunk)
        if is_stderr:
            self._stderr_total += len(chunk)
        else:
            self._stdout_total += len(chunk)
        # Truncate from the front if past cap.
        if len(buf) > MAX_STREAM_BYTES:
            dropped = len(buf) - MAX_STREAM_BYTES
            del buf[:dropped]
            if is_stderr:
                self._stderr_dropped += dropped
            else:
                self._stdout_dropped += dropped

    # ── Public read API ─────────────────────────────────────────────

    def read(
        self, *, since_stdout: int, since_stderr: int
    ) -> tuple[str, str]:
        """Return (stdout_delta, stderr_delta) starting from the given
        byte cursors on the *original* stream (not the buffer). Bytes
        that have been dropped due to truncation are simply skipped.
        """
        return (
            self._slice(self._stdout_buf, since_stdout, self._stdout_total, self._stdout_dropped),
            self._slice(self._stderr_buf, since_stderr, self._stderr_total, self._stderr_dropped),
        )

    @staticmethod
    def _slice(
        buf: bytearray, since: int, total: int, dropped: int,
    ) -> str:
        """Return the buffer slice starting at stream-offset ``since``.

        Stream math: the buffer holds bytes [dropped, total). A caller
        asking for ``since < dropped`` only gets what's still present
        (i.e. starting from ``dropped``). A caller asking for
        ``since >= total`` gets an empty string.
        """
        if since >= total:
            return ""
        start = max(0, since - dropped)
        return bytes(buf[start:]).decode("utf-8", errors="replace")

    # ── State accessors ─────────────────────────────────────────────

    @property
    def is_running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    @property
    def exit_code(self) -> int | None:
        return self._exit_code if not self.is_running else None

    @property
    def signal(self) -> str | None:
        return self._signal

    @property
    def stdout_bytes_total(self) -> int:
        return self._stdout_total

    @property
    def stderr_bytes_total(self) -> int:
        return self._stderr_total

    @property
    def started_at(self) -> float | None:
        return self._started_at

    @property
    def completed_at(self) -> float | None:
        return self._completed_at

    @property
    def stdout_dropped(self) -> int:
        return self._stdout_dropped

    @property
    def stderr_dropped(self) -> int:
        return self._stderr_dropped

    # Triggered by handlers once the process has exited — drains
    # remaining buffered output and finalises exit_code / signal.
    async def finalise(self) -> None:
        if self._proc is None:
            return
        rc = await self._proc.wait()
        if self._stdout_task:
            try:
                await self._stdout_task
            except Exception as e:  # noqa: BLE001
                logger.debug("stdout drain error for %s: %s", self.shell_id, e)
        if self._stderr_task:
            try:
                await self._stderr_task
            except Exception as e:  # noqa: BLE001
                logger.debug("stderr drain error for %s: %s", self.shell_id, e)
        # Signal naming: negative returncodes = killed by signal on
        # POSIX. Translate back to a name.
        if rc is not None and rc < 0:
            sig = -rc
            try:
                self._signal = signal_module.Signals(sig).name.replace("SIG", "")
            except ValueError:
                self._signal = str(sig)
            self._exit_code = None
        else:
            self._exit_code = rc
        self._completed_at = time.time()

    # Placeholder — next task implements these.
    async def write_stdin(self, text: str, *, press_enter: bool = True) -> int:
        raise NotImplementedError

    async def kill(self, *, signal_name: SignalName = "TERM", grace_seconds: float = DEFAULT_KILL_GRACE) -> None:
        raise NotImplementedError
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 16 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/shells.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): BackgroundShell spawn + output capture

Wraps one asyncio.subprocess.Process with capped stdout/stderr
buffers, stream-offset cursors (stable across truncation),
finalisation that turns negative returncodes into signal names, and a
new process-group for clean kill later. Stdin / kill arrive in the
next two tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `BackgroundShell` — `write_stdin`

**Files:**
- Modify: `openagent/mcp/servers/shell/shells.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "BackgroundShell: write_stdin feeds a line to a running cat")
async def t_bg_stdin_cat(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_cat",
        command="cat",
        cwd=None,
        env=None,
    )
    await bg.start()
    try:
        n = await bg.write_stdin("hello\nworld\n", press_enter=False)
        assert n == len("hello\nworld\n")
        # Close stdin so cat exits.
        assert bg._proc is not None
        bg._proc.stdin.close()  # type: ignore[union-attr]
        await bg._proc.wait()
        await bg.finalise()
    finally:
        if bg.is_running:
            await bg.kill(signal_name="KILL", grace_seconds=0)  # defensive
    stdout, _ = bg.read(since_stdout=0, since_stderr=0)
    assert "hello" in stdout and "world" in stdout


@test("shell", "BackgroundShell: write_stdin with press_enter appends a newline")
async def t_bg_stdin_press_enter(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_cat2",
        command="cat",
        cwd=None,
        env=None,
    )
    await bg.start()
    try:
        n = await bg.write_stdin("ping", press_enter=True)
        assert n == len("ping\n")
        assert bg._proc is not None
        bg._proc.stdin.close()  # type: ignore[union-attr]
        await bg._proc.wait()
        await bg.finalise()
    finally:
        if bg.is_running:
            await bg.kill(signal_name="KILL", grace_seconds=0)
    stdout, _ = bg.read(since_stdout=0, since_stderr=0)
    assert stdout.rstrip("\n") == "ping"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — `NotImplementedError`.

- [ ] **Step 3: Implement `write_stdin`.**

In `openagent/mcp/servers/shell/shells.py`, replace the `write_stdin` placeholder:

```python
    async def write_stdin(self, text: str, *, press_enter: bool = True) -> int:
        if self._proc is None or self._proc.stdin is None:
            raise RuntimeError(f"shell {self.shell_id} has no stdin (not started?)")
        if self._proc.returncode is not None:
            raise RuntimeError(f"shell {self.shell_id} has exited")
        payload = text + "\n" if press_enter and not text.endswith("\n") else text
        data = payload.encode("utf-8")
        self._proc.stdin.write(data)
        await self._proc.stdin.drain()
        return len(data)
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 18 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/shells.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): BackgroundShell.write_stdin

Pipe-based stdin write for interactive CLIs — same idea as Claude
Code's shell_input. ``press_enter`` appends a newline when the caller
hasn't already. Raises when the shell isn't running so bad model
sequencing surfaces as a clean tool error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `BackgroundShell` — `kill` with SIGTERM→SIGKILL escalation

**Files:**
- Modify: `openagent/mcp/servers/shell/shells.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "BackgroundShell: kill TERM stops a sleep")
async def t_bg_kill_term(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(
        shell_id="sh_sleep",
        command="sleep 30",
        cwd=None,
        env=None,
    )
    await bg.start()
    await asyncio.sleep(0.1)  # let it actually start
    await bg.kill(signal_name="TERM", grace_seconds=2.0)
    await bg.finalise()
    assert not bg.is_running
    # POSIX SIGTERM — signal captured, exit_code is None.
    assert bg.signal in ("TERM", "15"), f"unexpected signal: {bg.signal}"


@test("shell", "BackgroundShell: kill escalates to KILL if TERM ignored")
async def t_bg_kill_escalate(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell.shells import BackgroundShell

    # Trap TERM so only KILL works.
    bg = BackgroundShell(
        shell_id="sh_trap",
        command="trap '' TERM; sleep 30",
        cwd=None,
        env=None,
    )
    await bg.start()
    await asyncio.sleep(0.2)  # make sure trap is installed
    await bg.kill(signal_name="TERM", grace_seconds=0.5)
    await bg.finalise()
    assert not bg.is_running
    assert bg.signal in ("KILL", "9"), f"expected KILL, got {bg.signal}"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — `NotImplementedError`.

- [ ] **Step 3: Implement `kill`.**

In `openagent/mcp/servers/shell/shells.py`, replace the `kill` placeholder:

```python
    async def kill(
        self,
        *,
        signal_name: SignalName = "TERM",
        grace_seconds: float = DEFAULT_KILL_GRACE,
    ) -> None:
        """Kill the subprocess with ``signal_name``; if it's still alive
        after ``grace_seconds``, escalate to SIGKILL. No-op if already
        exited.

        Uses ``os.killpg`` since the subprocess was started with
        ``start_new_session=True`` — child processes of the shell get
        the signal too (important for ``npm run build`` style commands
        that spawn their own children).
        """
        if self._proc is None or self._proc.returncode is not None:
            return
        pgid = os.getpgid(self._proc.pid)
        sig_map = {
            "TERM": signal_module.SIGTERM,
            "INT": signal_module.SIGINT,
            "KILL": signal_module.SIGKILL,
        }
        first = sig_map.get(signal_name, signal_module.SIGTERM)
        try:
            os.killpg(pgid, first)
        except ProcessLookupError:
            return
        if first == signal_module.SIGKILL or grace_seconds <= 0:
            return
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=grace_seconds)
            return
        except asyncio.TimeoutError:
            pass
        try:
            os.killpg(pgid, signal_module.SIGKILL)
        except ProcessLookupError:
            return
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 20 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/shells.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): BackgroundShell.kill with TERM→KILL escalation

os.killpg on the session's process group so a shell that spawned
children (common for builds) goes down with its whole tree. After
grace_seconds, escalate to SIGKILL. Matches Claude Code's KillShell
semantics and the spec's kill contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `BackgroundShell` — `run_with_timeout` helper (foreground path)

**Files:**
- Modify: `openagent/mcp/servers/shell/shells.py`
- Modify: `scripts/tests/test_shell.py`

**Why this task:** The `shell_exec` foreground handler needs a "start, wait up to timeout, return" helper that sits on top of `start` / `finalise` / `kill`. Keeps the handler layer thin.

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "BackgroundShell.run_with_timeout: fast command returns normally")
async def t_bg_run_with_timeout_ok(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(shell_id="sh_ok", command="echo abc", cwd=None, env=None)
    result = await bg.run_with_timeout(timeout_seconds=2.0)
    assert result.timed_out is False
    assert result.exit_code == 0
    assert "abc" in result.stdout


@test("shell", "BackgroundShell.run_with_timeout: slow command is killed")
async def t_bg_run_with_timeout_kill(ctx: TestContext) -> None:
    import time
    from openagent.mcp.servers.shell.shells import BackgroundShell

    bg = BackgroundShell(shell_id="sh_slow", command="sleep 30", cwd=None, env=None)
    t0 = time.time()
    result = await bg.run_with_timeout(timeout_seconds=0.3)
    elapsed = time.time() - t0
    assert result.timed_out is True
    assert elapsed < 5.0, f"kill took too long: {elapsed}"
    assert result.signal in ("TERM", "KILL", "15", "9")
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: `AttributeError: ... has no attribute 'run_with_timeout'`.

- [ ] **Step 3: Implement `run_with_timeout`.**

In `openagent/mcp/servers/shell/shells.py`, add a result dataclass at the top of the file (after the constants), then the helper at the bottom of `BackgroundShell`:

```python
from dataclasses import dataclass as _dc


@_dc
class ForegroundResult:
    exit_code: int | None
    signal: str | None
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool
    stdout_dropped: int
    stderr_dropped: int
```

```python
    # ── Foreground helper ───────────────────────────────────────────

    async def run_with_timeout(
        self, *, timeout_seconds: float, stdin_data: str | None = None,
    ) -> "ForegroundResult":
        await self.start()
        timed_out = False
        try:
            if stdin_data:
                await self.write_stdin(stdin_data, press_enter=False)
                # Close stdin so commands that read-until-EOF can exit.
                if self._proc is not None and self._proc.stdin is not None:
                    self._proc.stdin.close()
            assert self._proc is not None
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=timeout_seconds)
            except asyncio.TimeoutError:
                timed_out = True
                await self.kill(signal_name="TERM", grace_seconds=DEFAULT_KILL_GRACE)
        finally:
            await self.finalise()
        stdout, stderr = self.read(since_stdout=0, since_stderr=0)
        started = self._started_at or 0.0
        completed = self._completed_at or started
        return ForegroundResult(
            exit_code=self._exit_code,
            signal=self._signal,
            stdout=stdout,
            stderr=stderr,
            duration_ms=int((completed - started) * 1000),
            timed_out=timed_out,
            stdout_dropped=self._stdout_dropped,
            stderr_dropped=self._stderr_dropped,
        )
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 22 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/shells.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): BackgroundShell.run_with_timeout for foreground path

Keeps handlers thin: start → wait(timeout) → kill-on-timeout →
finalise → package everything into a ForegroundResult. Timeout kills
via TERM with the usual escalation grace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `handlers.py` — `shell_exec` foreground + `shell_which`

**Files:**
- Create: `openagent/mcp/servers/shell/handlers.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "handlers.shell_exec: foreground success")
async def t_handlers_exec_fg_ok(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    out = await handlers.shell_exec(
        command="echo one-two-three",
        cwd=None, env=None, timeout=5000,
        run_in_background=False, stdin=None, description=None,
        session_id=None,
    )
    assert out["exit_code"] == 0
    assert "one-two-three" in out["stdout"]
    assert out["stderr"] == ""
    assert out["timed_out"] is False


@test("shell", "handlers.shell_exec: foreground timeout sets timed_out=True")
async def t_handlers_exec_fg_timeout(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    out = await handlers.shell_exec(
        command="sleep 10",
        cwd=None, env=None, timeout=200,
        run_in_background=False, stdin=None, description=None,
        session_id=None,
    )
    assert out["timed_out"] is True
    assert out["signal"] in ("TERM", "KILL", "15", "9")


@test("shell", "handlers.shell_which: existing command returns path")
async def t_handlers_which_ok(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    out = await handlers.shell_which(command="sh")
    assert out["available"] is True
    assert out["path"].endswith("/sh") or out["path"].endswith("sh.exe")


@test("shell", "handlers.shell_which: missing command returns available=false")
async def t_handlers_which_missing(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    out = await handlers.shell_which(command="definitely_not_a_real_binary_xyz_123")
    assert out["available"] is False
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 4 failures — `ModuleNotFoundError: openagent.mcp.servers.shell.handlers`.

- [ ] **Step 3: Implement foreground + which handlers.**

Write `openagent/mcp/servers/shell/handlers.py`:

```python
"""Pure-Python handlers for the six shell tools.

Provider-agnostic: Claude SDK adapter and Agno adapter both wrap these
functions with their own decorators. All state lives on the ShellHub
singleton plus per-BackgroundShell buffers. No subprocess shenanigans
here beyond asyncio.create_subprocess_exec (in BackgroundShell).
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import shutil
import time
from typing import Any

from openagent.mcp.servers.shell.events import ShellEvent
from openagent.mcp.servers.shell.hub import ShellHub
from openagent.mcp.servers.shell.shells import BackgroundShell

logger = logging.getLogger(__name__)

# Defaults — match the spec § Tool surface and the v0.6 TS MCP.
DEFAULT_TIMEOUT_MS = 120_000
MAX_TIMEOUT_MS = 1_800_000  # 30 min


_hub_singleton: ShellHub | None = None


def get_hub() -> ShellHub:
    """Return the process-wide ShellHub singleton, creating on demand."""
    global _hub_singleton
    if _hub_singleton is None:
        _hub_singleton = ShellHub()
    return _hub_singleton


def _reset_hub_for_tests() -> None:
    """Test-only helper: replace the singleton with a fresh instance."""
    global _hub_singleton
    _hub_singleton = ShellHub()


def _new_shell_id() -> str:
    return f"sh_{secrets.token_hex(3)}"


def _clamp_timeout(ms: int | None) -> float:
    if ms is None:
        ms = DEFAULT_TIMEOUT_MS
    ms = max(1, min(ms, MAX_TIMEOUT_MS))
    return ms / 1000.0


# ── shell_exec ──────────────────────────────────────────────────────

async def shell_exec(
    command: str,
    *,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    timeout: int | None = None,
    run_in_background: bool = False,
    stdin: str | None = None,
    description: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Foreground or background shell command.

    Returns a dict. Foreground: exit_code / stdout / stderr /
    duration_ms / timed_out / signal / truncated_stdout /
    truncated_stderr. Background: shell_id / started_at.
    """
    if not command or not command.strip():
        raise ValueError("command must be a non-empty string")
    timeout_s = _clamp_timeout(timeout)
    shell_id = _new_shell_id()
    bg = BackgroundShell(
        shell_id=shell_id,
        command=command,
        cwd=cwd,
        env=env,
    )
    hub = get_hub()

    if run_in_background:
        await bg.start()
        rec = hub.register(
            shell_id=shell_id,
            session_id=session_id,
            command=command,
            shell=bg,
        )
        if stdin:
            await bg.write_stdin(stdin, press_enter=False)
        # Schedule a watcher task to detect completion and post event.
        asyncio.create_task(_watch_background(bg, session_id))
        return {
            "shell_id": shell_id,
            "started_at": rec.created_at,
            "description": description,
        }

    # Foreground path — no hub registration.
    result = await bg.run_with_timeout(
        timeout_seconds=timeout_s, stdin_data=stdin
    )
    return {
        "exit_code": result.exit_code,
        "signal": result.signal,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "duration_ms": result.duration_ms,
        "timed_out": result.timed_out,
        "truncated_stdout": result.stdout_dropped > 0,
        "truncated_stderr": result.stderr_dropped > 0,
    }


async def _watch_background(bg: BackgroundShell, session_id: str | None) -> None:
    """Wait for ``bg`` to exit and post a terminal event to the hub."""
    try:
        assert bg._proc is not None
        await bg._proc.wait()
    except Exception as e:  # noqa: BLE001
        logger.debug("_watch_background %s failed: %s", bg.shell_id, e)
        return
    await bg.finalise()
    hub = get_hub()
    hub.mark_completed(
        bg.shell_id, exit_code=bg.exit_code, signal=bg.signal,
    )
    kind = "completed"
    if bg.signal in ("TERM", "KILL", "INT", "9", "15", "2"):
        kind = "killed"
    event = ShellEvent(
        shell_id=bg.shell_id,
        kind=kind,
        exit_code=bg.exit_code,
        signal=bg.signal,
        bytes_stdout=bg.stdout_bytes_total,
        bytes_stderr=bg.stderr_bytes_total,
        at=time.time(),
    )
    hub.post_event(session_id, event)


# ── shell_which ─────────────────────────────────────────────────────

async def shell_which(command: str) -> dict[str, Any]:
    if not command or "/" in command or "\\" in command:
        # shutil.which handles "/" / "\\" differently across platforms;
        # reject anything that looks like a path so the model gets an
        # unambiguous error.
        raise ValueError("command must be a bare program name (no path separator)")
    path = shutil.which(command)
    if path is None:
        return {"available": False}
    return {"available": True, "path": path}
```

- [ ] **Step 4: Add a `conftest`-style per-test reset to the test file.**

Edit `scripts/tests/test_shell.py`: at the top (after the imports), add:

```python
def _reset_shell_hub() -> None:
    """Isolate hub state between tests so they don't see leaked shells."""
    from openagent.mcp.servers.shell import handlers
    handlers._reset_hub_for_tests()
```

Then edit the four existing `ShellHub` unit tests (Task 2–4) to call `_reset_shell_hub()` at the start of each test. *Also* call it at the start of every test in Task 9 onward. Example:

```python
@test("shell", "handlers.shell_exec: foreground success")
async def t_handlers_exec_fg_ok(ctx: TestContext) -> None:
    _reset_shell_hub()
    ...
```

- [ ] **Step 5: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 26 passes.

- [ ] **Step 6: Commit.**

```bash
git add openagent/mcp/servers/shell/handlers.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): handlers.shell_exec (foreground) and shell_which

Provider-agnostic async handlers plus a process-wide get_hub()
singleton. Foreground shell_exec runs through BackgroundShell.run_with_timeout
and returns the structured result the model consumes; shell_which
uses shutil.which and rejects paths so errors are unambiguous.
Background path is wired (returns shell_id) and schedules a watcher
that will post a terminal event on exit — fully exercised in the
next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `handlers.py` — `shell_output` + background end-to-end test

**Files:**
- Modify: `openagent/mcp/servers/shell/handlers.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "handlers.shell_exec background returns shell_id and posts terminal event")
async def t_handlers_exec_bg_event(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    started = await handlers.shell_exec(
        command="echo background-done",
        cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description=None,
        session_id="sess-A",
    )
    assert "shell_id" in started
    sid_shell = started["shell_id"]

    # Wait for the watcher to post the event.
    events = await handlers.get_hub().wait("sess-A", timeout=3.0)
    assert len(events) == 1
    ev = events[0]
    assert ev.shell_id == sid_shell
    assert ev.kind == "completed"
    assert ev.exit_code == 0


@test("shell", "handlers.shell_output: returns delta and marks not running")
async def t_handlers_output_delta(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    started = await handlers.shell_exec(
        command="printf 'abc'",
        cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description=None,
        session_id="sess-B",
    )
    sid_shell = started["shell_id"]
    # Wait until the watcher posts the terminal event, so we know
    # output has been fully drained.
    await handlers.get_hub().wait("sess-B", timeout=3.0)
    out = await handlers.shell_output(
        shell_id=sid_shell, filter=None, since_last=True,
    )
    assert out["still_running"] is False
    assert out["stdout_delta"] == "abc"
    assert out["stderr_delta"] == ""
    assert out["exit_code"] == 0
    # Second call with since_last=True returns empty delta (cursors advanced).
    out2 = await handlers.shell_output(
        shell_id=sid_shell, filter=None, since_last=True,
    )
    assert out2["stdout_delta"] == ""


@test("shell", "handlers.shell_output: filter matches per-line regex")
async def t_handlers_output_filter(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    started = await handlers.shell_exec(
        command="printf 'line-alpha\\nline-beta\\nline-gamma\\n'",
        cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description=None,
        session_id="sess-F",
    )
    sid_shell = started["shell_id"]
    await handlers.get_hub().wait("sess-F", timeout=3.0)
    out = await handlers.shell_output(
        shell_id=sid_shell, filter=r"beta|gamma", since_last=True,
    )
    lines = [l for l in out["stdout_delta"].splitlines() if l]
    assert lines == ["line-beta", "line-gamma"], f"got: {lines}"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 3 failures — `AttributeError: module ... has no attribute 'shell_output'` (and related).

- [ ] **Step 3: Implement `shell_output` + cursor tracking on the record.**

Edit `openagent/mcp/servers/shell/hub.py`: add two cursor fields to `ShellRecord`:

```python
@dataclass
class ShellRecord:
    shell_id: str
    session_id: str | None
    command: str
    created_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    exit_code: int | None = None
    signal: str | None = None
    shell: "BackgroundShell | None" = None
    # Per-caller cursor used by shell_output(since_last=True).
    last_read_stdout: int = 0
    last_read_stderr: int = 0
```

Add to `openagent/mcp/servers/shell/handlers.py`:

```python
import re as _re


async def shell_output(
    shell_id: str,
    *,
    filter: str | None = None,
    since_last: bool = True,
) -> dict[str, Any]:
    hub = get_hub()
    rec = hub.get(shell_id)
    if rec is None:
        raise ValueError(f"unknown shell_id: {shell_id}")
    bg = rec.shell
    if bg is None:
        # Race: registered without a shell (tests). Fall through as empty.
        return {
            "stdout_delta": "",
            "stderr_delta": "",
            "still_running": False,
            "exit_code": rec.exit_code,
            "signal": rec.signal,
            "stdout_bytes_total": 0,
            "stderr_bytes_total": 0,
            "truncated_stdout": False,
            "truncated_stderr": False,
        }
    since_stdout = rec.last_read_stdout if since_last else 0
    since_stderr = rec.last_read_stderr if since_last else 0
    stdout_delta, stderr_delta = bg.read(
        since_stdout=since_stdout, since_stderr=since_stderr,
    )
    if filter:
        pattern = _re.compile(filter)
        stdout_delta = "\n".join(
            l for l in stdout_delta.splitlines() if pattern.search(l)
        )
        stderr_delta = "\n".join(
            l for l in stderr_delta.splitlines() if pattern.search(l)
        )
    if since_last:
        rec.last_read_stdout = bg.stdout_bytes_total
        rec.last_read_stderr = bg.stderr_bytes_total
    return {
        "stdout_delta": stdout_delta,
        "stderr_delta": stderr_delta,
        "still_running": bg.is_running,
        "exit_code": bg.exit_code,
        "signal": bg.signal,
        "stdout_bytes_total": bg.stdout_bytes_total,
        "stderr_bytes_total": bg.stderr_bytes_total,
        "truncated_stdout": bg.stdout_dropped > 0,
        "truncated_stderr": bg.stderr_dropped > 0,
    }
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 29 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/handlers.py openagent/mcp/servers/shell/hub.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): shell_output + background terminal-event end-to-end

shell_output returns the stdout / stderr delta since the last call
per shell_id, with optional per-line regex filter. The watcher
coroutine scheduled by shell_exec(run_in_background=true) now
produces a real terminal event the hub can deliver to the agent
loop. ShellRecord carries the per-caller read cursor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `handlers.py` — `shell_input`, `shell_kill`, `shell_list`

**Files:**
- Modify: `openagent/mcp/servers/shell/handlers.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "handlers.shell_input writes to a running shell's stdin")
async def t_handlers_input(ctx: TestContext) -> None:
    import asyncio
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    started = await handlers.shell_exec(
        command="cat",
        cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description=None,
        session_id="sess-I",
    )
    sid = started["shell_id"]
    written = await handlers.shell_input(shell_id=sid, text="hey", press_enter=True)
    assert written["bytes_written"] == len("hey\n")
    # Kill to let the watcher fire so the hub state is clean.
    await handlers.shell_kill(shell_id=sid, signal="KILL")
    await handlers.get_hub().wait("sess-I", timeout=3.0)
    out = await handlers.shell_output(shell_id=sid, filter=None, since_last=True)
    assert "hey" in out["stdout_delta"]


@test("shell", "handlers.shell_kill terminates a running shell")
async def t_handlers_kill(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    started = await handlers.shell_exec(
        command="sleep 30",
        cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description=None,
        session_id="sess-K",
    )
    sid = started["shell_id"]
    res = await handlers.shell_kill(shell_id=sid, signal="TERM")
    assert res["killed"] is True
    await handlers.get_hub().wait("sess-K", timeout=3.0)
    rec = handlers.get_hub().get(sid)
    assert rec is not None and rec.is_completed


@test("shell", "handlers.shell_list returns running and recently-completed shells")
async def t_handlers_list(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    bg1 = await handlers.shell_exec(
        command="sleep 5", cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description="long",
        session_id="sess-L",
    )
    bg2 = await handlers.shell_exec(
        command="echo fast", cwd=None, env=None, timeout=None,
        run_in_background=True, stdin=None, description="short",
        session_id="sess-L",
    )
    await handlers.get_hub().wait("sess-L", timeout=3.0)  # fast one completes

    listing = await handlers.shell_list(session_id="sess-L")
    assert isinstance(listing, list)
    ids = {entry["shell_id"] for entry in listing}
    assert bg1["shell_id"] in ids and bg2["shell_id"] in ids
    states = {entry["shell_id"]: entry["state"] for entry in listing}
    assert states[bg2["shell_id"]] == "completed"
    assert states[bg1["shell_id"]] == "running"

    # Clean up long-runner.
    await handlers.shell_kill(shell_id=bg1["shell_id"], signal="KILL")
    await handlers.get_hub().wait("sess-L", timeout=3.0)
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 3 failures — `AttributeError: module ... has no attribute 'shell_input'` (and related).

- [ ] **Step 3: Implement `shell_input` + `shell_kill` + `shell_list`.**

Append to `openagent/mcp/servers/shell/handlers.py`:

```python
# ── shell_input ─────────────────────────────────────────────────────

async def shell_input(
    shell_id: str,
    *,
    text: str,
    press_enter: bool = True,
) -> dict[str, Any]:
    rec = get_hub().get(shell_id)
    if rec is None:
        raise ValueError(f"unknown shell_id: {shell_id}")
    if rec.shell is None:
        raise RuntimeError(f"shell {shell_id} has no spawned process")
    n = await rec.shell.write_stdin(text, press_enter=press_enter)
    return {"bytes_written": n}


# ── shell_kill ──────────────────────────────────────────────────────

async def shell_kill(
    shell_id: str,
    *,
    signal: str = "TERM",
) -> dict[str, Any]:
    rec = get_hub().get(shell_id)
    if rec is None:
        raise ValueError(f"unknown shell_id: {shell_id}")
    if rec.shell is None:
        raise RuntimeError(f"shell {shell_id} has no spawned process")
    sig_name = signal.upper()
    if sig_name not in ("TERM", "INT", "KILL"):
        raise ValueError(f"unsupported signal: {signal}")
    await rec.shell.kill(signal_name=sig_name)  # type: ignore[arg-type]
    return {
        "killed": True,
        "exit_code": rec.shell.exit_code,
        "signal": rec.shell.signal,
    }


# ── shell_list ──────────────────────────────────────────────────────

async def shell_list(session_id: str | None = None) -> list[dict[str, Any]]:
    hub = get_hub()
    records = hub.list_for_session(session_id)
    now = time.time()
    out: list[dict[str, Any]] = []
    for rec in records:
        bg = rec.shell
        if bg is None:
            state = "completed" if rec.is_completed else "running"
            started_at = rec.created_at
            runtime_ms = int((now - started_at) * 1000)
            stdout_bytes = 0
            stderr_bytes = 0
        else:
            if bg.is_running:
                state = "running"
            elif bg.signal is not None:
                state = "killed"
            else:
                state = "completed"
            started_at = bg.started_at or rec.created_at
            completed = bg.completed_at or now
            runtime_ms = int((completed - started_at) * 1000)
            stdout_bytes = bg.stdout_bytes_total
            stderr_bytes = bg.stderr_bytes_total
        out.append({
            "shell_id": rec.shell_id,
            "command": rec.command,
            "state": state,
            "started_at": started_at,
            "runtime_ms": runtime_ms,
            "stdout_bytes": stdout_bytes,
            "stderr_bytes": stderr_bytes,
            "exit_code": rec.exit_code,
            "session_id": rec.session_id,
        })
    return out
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 32 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/handlers.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): shell_input / shell_kill / shell_list handlers

Completes the tool surface: shell_input pipes stdin into a running
shell (optional newline append), shell_kill targets a shell by id
with TERM/INT/KILL and returns the outcome, shell_list enumerates
active + recently-completed shells with per-entry state / runtime /
bytes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Provider adapters — Claude SDK + Agno

**Files:**
- Create: `openagent/mcp/servers/shell/adapters.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "adapters.build_sdk_server exposes the six tools")
async def t_adapter_claude(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.adapters import build_sdk_server

    cfg = build_sdk_server()
    assert cfg is not None, "expected a non-None SDK server config"
    # McpSdkServerConfig is a TypedDict / dict in the SDK. Smoke check.
    assert "instance" in cfg or "server" in cfg or "type" in cfg, f"unexpected shape: {cfg!r}"


@test("shell", "adapters.build_agno_toolkit exposes the six tools by name")
async def t_adapter_agno(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell.adapters import build_agno_toolkit

    tk = build_agno_toolkit()
    names = set()
    for attr in ("functions",):
        container = getattr(tk, attr, None)
        if isinstance(container, dict):
            names.update(container.keys())
    # Agno's Toolkit populates .functions on init with the callables it
    # was given; names come from the function __name__.
    if not names:
        # Fallback: look at the underlying tools list.
        tools = getattr(tk, "tools", []) or []
        names = {t.__name__ for t in tools if callable(t)}
    for expected in ("shell_exec", "shell_output", "shell_input", "shell_kill", "shell_list", "shell_which"):
        assert expected in names, f"missing tool {expected} in {names}"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — `ModuleNotFoundError: openagent.mcp.servers.shell.adapters`.

- [ ] **Step 3: Implement the adapters.**

> **Schema note:** The SDK's `_python_type_to_json_schema` has no tuple branch — so `(str, None)` falls
> through to `{"type": "string"}` and every property becomes required. Use raw JSON-Schema dicts instead.

Write `openagent/mcp/servers/shell/adapters.py`:

```python
"""Provider adapters for the in-process shell MCP.

Both Claude Agent SDK and Agno accept in-process tool registration, so
the shell tools live as plain async functions in ``handlers.py`` and
we wrap them once per provider with the native decorator here.
"""
from __future__ import annotations

import json
from typing import Any

from openagent.mcp.servers.shell import handlers


def _json_dump(value: Any) -> str:
    return json.dumps(value, indent=2, default=str)


# ── Claude Agent SDK ────────────────────────────────────────────────

def build_sdk_server() -> Any:
    """Return a ``McpSdkServerConfig`` wrapping the six shell tools."""
    from claude_agent_sdk import create_sdk_mcp_server, tool as sdk_tool

    @sdk_tool(
        "shell_exec",
        "Execute a shell command. Returns foreground output, or if "
        "run_in_background=true returns a shell_id.",
        {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "cwd": {"type": "string"},
                "env": {"type": "object", "additionalProperties": {"type": "string"}},
                "timeout": {"type": "integer"},
                "run_in_background": {"type": "boolean"},
                "stdin": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["command"],
        },
    )
    async def _shell_exec(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_exec(
            command=args["command"],
            cwd=args.get("cwd"),
            env=args.get("env"),
            timeout=args.get("timeout"),
            run_in_background=args.get("run_in_background", False),
            stdin=args.get("stdin"),
            description=args.get("description"),
            session_id=args.get("_session_id"),
        ))}]}

    @sdk_tool(
        "shell_output",
        "Read new output from a background shell since the last call.",
        {
            "type": "object",
            "properties": {
                "shell_id": {"type": "string"},
                "filter": {"type": "string"},
                "since_last": {"type": "boolean"},
            },
            "required": ["shell_id"],
        },
    )
    async def _shell_output(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_output(
            shell_id=args["shell_id"],
            filter=args.get("filter"),
            since_last=args.get("since_last", True),
        ))}]}

    @sdk_tool(
        "shell_input",
        "Write text to a running background shell's stdin.",
        {
            "type": "object",
            "properties": {
                "shell_id": {"type": "string"},
                "text": {"type": "string"},
                "press_enter": {"type": "boolean"},
            },
            "required": ["shell_id", "text"],
        },
    )
    async def _shell_input(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_input(
            shell_id=args["shell_id"],
            text=args["text"],
            press_enter=args.get("press_enter", True),
        ))}]}

    @sdk_tool(
        "shell_kill",
        "Kill a background shell by id (TERM, INT, or KILL).",
        {
            "type": "object",
            "properties": {
                "shell_id": {"type": "string"},
                "signal": {"type": "string", "enum": ["TERM", "INT", "KILL"]},
            },
            "required": ["shell_id"],
        },
    )
    async def _shell_kill(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_kill(
            shell_id=args["shell_id"],
            signal=args.get("signal", "TERM"),
        ))}]}

    @sdk_tool(
        "shell_list",
        "List active and recently-completed background shells.",
        {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
            },
            "required": [],
        },
    )
    async def _shell_list(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_list(
            session_id=args.get("session_id") or args.get("_session_id"),
        ))}]}

    @sdk_tool(
        "shell_which",
        "Check whether a command is available on PATH.",
        {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
            },
            "required": ["command"],
        },
    )
    async def _shell_which(args: dict) -> dict:
        return {"content": [{"type": "text", "text": _json_dump(await handlers.shell_which(
            command=args["command"],
        ))}]}

    return create_sdk_mcp_server(
        "shell",
        tools=[_shell_exec, _shell_output, _shell_input, _shell_kill, _shell_list, _shell_which],
    )


# ── Agno ────────────────────────────────────────────────────────────

def build_agno_toolkit() -> Any:
    """Return an Agno ``Toolkit`` wrapping the six shell tools.

    The Toolkit pattern expects plain async callables; Agno introspects
    signatures to build the tool schema. We re-export the handlers
    directly (same names — match existing prompt conventions).
    """
    from agno.tools import Toolkit

    async def shell_exec(
        command: str,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: int | None = None,
        run_in_background: bool = False,
        stdin: str | None = None,
        description: str | None = None,
    ) -> dict:
        """Execute a shell command. Returns foreground output, or a shell_id when run_in_background=True."""
        return await handlers.shell_exec(
            command=command, cwd=cwd, env=env, timeout=timeout,
            run_in_background=run_in_background, stdin=stdin, description=description,
            session_id=None,  # Agno tools don't receive session_id directly; see adapter wiring in pool.
        )

    async def shell_output(
        shell_id: str, filter: str | None = None, since_last: bool = True,
    ) -> dict:
        """Read new output from a background shell since the last call."""
        return await handlers.shell_output(
            shell_id=shell_id, filter=filter, since_last=since_last,
        )

    async def shell_input(
        shell_id: str, text: str, press_enter: bool = True,
    ) -> dict:
        """Write text to a running background shell's stdin."""
        return await handlers.shell_input(
            shell_id=shell_id, text=text, press_enter=press_enter,
        )

    async def shell_kill(shell_id: str, signal: str = "TERM") -> dict:
        """Kill a background shell by id."""
        return await handlers.shell_kill(shell_id=shell_id, signal=signal)

    async def shell_list(session_id: str | None = None) -> list:
        """List active and recently-completed background shells."""
        return await handlers.shell_list(session_id=session_id)

    async def shell_which(command: str) -> dict:
        """Check whether a command is available on PATH."""
        return await handlers.shell_which(command=command)

    return Toolkit(
        name="shell",
        tools=[shell_exec, shell_output, shell_input, shell_kill, shell_list, shell_which],
    )
```

- [ ] **Step 4: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 34 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/mcp/servers/shell/adapters.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): provider adapters (Claude SDK + Agno)

Thin per-provider wrappers around handlers.py. Claude uses the SDK's
@tool + create_sdk_mcp_server for in-process registration; Agno uses
Toolkit(tools=[...]). Both expose the same six tools by the same
names. Session-id threading for Agno lands in Task 14 (the tool
signature can't take it directly, so we inject it via call-context
in the pool).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `MCPPool` — `in_process` spec category

**Files:**
- Modify: `openagent/mcp/builtins.py`
- Modify: `openagent/mcp/pool.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "MCPPool: in-process shell toolkit appears in agno_toolkits")
async def t_pool_in_process_agno(ctx: TestContext) -> None:
    from openagent.mcp.pool import MCPPool

    pool = MCPPool.from_config(
        mcp_config=[{"builtin": "shell"}],
        include_defaults=False,
        disable=None,
        db_path=str(ctx.db_path),
    )
    await pool.connect_all()
    try:
        kits = pool.agno_toolkits
        assert len(kits) == 1, f"expected 1 toolkit, got {len(kits)}: {kits}"
        kit = kits[0]
        assert getattr(kit, "name", None) == "shell"
    finally:
        await pool.close_all()


@test("shell", "MCPPool: in-process shell appears in claude_sdk_servers")
async def t_pool_in_process_claude(ctx: TestContext) -> None:
    from openagent.mcp.pool import MCPPool

    pool = MCPPool.from_config(
        mcp_config=[{"builtin": "shell"}],
        include_defaults=False,
        disable=None,
        db_path=str(ctx.db_path),
    )
    await pool.connect_all()
    try:
        servers = pool.claude_sdk_servers()
        assert "shell" in servers
        cfg = servers["shell"]
        # McpSdkServerConfig is a dict with SDK-specific keys.
        assert isinstance(cfg, dict) and cfg, f"expected non-empty dict, got {cfg!r}"
    finally:
        await pool.close_all()
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — something like "`MCP 'shell' has neither command nor url`" because `BUILTIN_MCP_SPECS["shell"]` still has the old Node spec shape.

- [ ] **Step 3: Update `BUILTIN_MCP_SPECS["shell"]` to in-process shape.**

Edit `openagent/mcp/builtins.py`. Find the `shell` entry and replace with:

```python
    "shell": {
        "in_process": True,
        "adapter_module": "openagent.mcp.servers.shell.adapters",
        "sdk_server_factory": "build_sdk_server",
        "agno_toolkit_factory": "build_agno_toolkit",
    },
```

Then update `resolve_builtin_entry` in the same file to understand the `in_process` flag. Find the function definition — it returns a dict used by `_ServerSpec`. Add `in_process` passthrough.

Locate the current `resolve_builtin_entry` function (near line 80-140). After the existing dict construction, add:

```python
    if spec.get("in_process"):
        return {
            "in_process": True,
            "adapter_module": spec["adapter_module"],
            "sdk_server_factory": spec.get("sdk_server_factory", "build_sdk_server"),
            "agno_toolkit_factory": spec.get("agno_toolkit_factory", "build_agno_toolkit"),
        }
```

at the TOP of the function (before the normal command-based resolution), so in-process entries short-circuit the subprocess path.

- [ ] **Step 4: Extend `_ServerSpec` in `openagent/mcp/pool.py` to hold in-process data.**

Find the `_ServerSpec` dataclass. Add these fields:

```python
    in_process: bool = False
    adapter_module: str | None = None
    sdk_server_factory: str = "build_sdk_server"
    agno_toolkit_factory: str = "build_agno_toolkit"
```

Find `_resolve_specs` (or wherever specs are constructed from config entries) and propagate the new fields when the dict from `resolve_builtin_entry` contains `in_process`.

- [ ] **Step 5: Teach `MCPPool` to handle in-process specs.**

In `openagent/mcp/pool.py`:

1. Introduce a parallel list `self._in_process_sdk_servers: dict[str, Any]` and `self._in_process_agno_toolkits: list[Any]`. Initialise in `__init__`.

2. In `connect_all`, after the existing loop that builds subprocess toolkits, add an in-process pass:

   ```python
           for spec in self.specs:
               if not spec.in_process:
                   continue
               import importlib
               mod = importlib.import_module(spec.adapter_module)
               sdk_factory = getattr(mod, spec.sdk_server_factory, None)
               agno_factory = getattr(mod, spec.agno_toolkit_factory, None)
               if sdk_factory is None or agno_factory is None:
                   logger.warning(
                       "in-process MCP '%s' missing factories (%s / %s) — skipping",
                       spec.name, spec.sdk_server_factory, spec.agno_toolkit_factory,
                   )
                   continue
               try:
                   sdk_cfg = sdk_factory()
                   agno_tk = agno_factory()
               except Exception as e:  # noqa: BLE001
                   logger.warning("in-process MCP '%s' factory error: %s", spec.name, e)
                   elog("mcp.error", name=spec.name, error=str(e))
                   continue
               self._in_process_sdk_servers[spec.name] = sdk_cfg
               self._in_process_agno_toolkits.append(agno_tk)
               count = 6  # six shell tools
               self._tool_counts[spec.name] = count
               elog("mcp.connect", name=spec.name, tools=count, kind="in_process")
   ```

3. Update `agno_toolkits` property:

   ```python
       @property
       def agno_toolkits(self) -> list[Any]:
           return list(self._agno_toolkits) + list(self._in_process_agno_toolkits)
   ```

4. Update `claude_sdk_servers`:

   ```python
       def claude_sdk_servers(self) -> dict[str, dict[str, Any]]:
           base = {
               spec.name: spec.claude_sdk_entry()
               for spec in self.specs
               if not spec.in_process
           }
           base.update(self._in_process_sdk_servers)
           return base
   ```

5. Update `close_all` to clear the in-process lists (stateless, no teardown needed — the handlers are plain Python):

   ```python
           self._in_process_sdk_servers.clear()
           self._in_process_agno_toolkits.clear()
   ```

- [ ] **Step 6: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 36 passes.

- [ ] **Step 7: Run the full test suite to confirm no regressions.**

```bash
bash scripts/test_openagent.sh --only shell,imports,setup,catalog,formatting,pool
```

Expected: all green.

- [ ] **Step 8: Commit.**

```bash
git add openagent/mcp/builtins.py openagent/mcp/pool.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(mcp): in_process spec category in MCPPool

Shell MCP is now an in-process builtin. resolve_builtin_entry
short-circuits in_process specs; MCPPool loads the adapter module,
calls build_sdk_server / build_agno_toolkit, and merges the results
into claude_sdk_servers() and agno_toolkits. Tool count is reported
so /status and dormant-server logic still behave.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Session-id threading for in-process handlers

**Files:**
- Modify: `openagent/mcp/servers/shell/adapters.py`
- Modify: `openagent/mcp/servers/shell/handlers.py`
- Modify: `scripts/tests/test_shell.py`

**Why this task:** Background shells need the caller's `session_id` so the hub can wake the right session. Claude SDK passes it through the call context; Agno does not. We use a context-variable + a small `set_session_context` helper that the provider call-sites can wrap around each call.

- [ ] **Step 1: Write the failing test.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "handlers: shell_exec picks up session_id from contextvar when arg is None")
async def t_handlers_session_ctxvar(ctx: TestContext) -> None:
    from openagent.mcp.servers.shell import handlers, adapters

    _reset_shell_hub()
    token = adapters.set_session_context("sess-CTX")
    try:
        started = await handlers.shell_exec(
            command="echo ctxvar",
            cwd=None, env=None, timeout=None,
            run_in_background=True, stdin=None, description=None,
            session_id=None,  # omit → fall back to contextvar
        )
    finally:
        adapters.reset_session_context(token)
    await handlers.get_hub().wait("sess-CTX", timeout=3.0)
    rec = handlers.get_hub().get(started["shell_id"])
    assert rec is not None
    assert rec.session_id == "sess-CTX", f"unexpected session_id: {rec.session_id}"
```

- [ ] **Step 2: Run the test; expect it to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: `AttributeError: module 'openagent.mcp.servers.shell.adapters' has no attribute 'set_session_context'`.

- [ ] **Step 3: Add a contextvar + helpers in `adapters.py`.**

At the top of `openagent/mcp/servers/shell/adapters.py`, add:

```python
import contextvars

_session_context: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "openagent_shell_session_id", default=None,
)


def set_session_context(session_id: str | None):
    """Install ``session_id`` into the contextvar and return the token."""
    return _session_context.set(session_id)


def reset_session_context(token) -> None:
    _session_context.reset(token)


def current_session_id() -> str | None:
    return _session_context.get()
```

- [ ] **Step 4: Update `handlers.shell_exec` to consult the contextvar on fallback.**

In `openagent/mcp/servers/shell/handlers.py`, inside `shell_exec`, after the `if not command or not command.strip()` guard:

```python
    if session_id is None:
        # Fall back to the contextvar set by the provider adapter.
        from openagent.mcp.servers.shell.adapters import current_session_id
        session_id = current_session_id()
```

- [ ] **Step 5: Do the same in `shell_list` (it also takes optional session_id).**

In `handlers.shell_list`:

```python
async def shell_list(session_id: str | None = None) -> list[dict[str, Any]]:
    if session_id is None:
        from openagent.mcp.servers.shell.adapters import current_session_id
        session_id = current_session_id()
    hub = get_hub()
    ...
```

- [ ] **Step 6: Run the test; expect it to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 37 passes.

- [ ] **Step 7: Commit.**

```bash
git add openagent/mcp/servers/shell/adapters.py openagent/mcp/servers/shell/handlers.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(shell): contextvar-based session_id threading

Claude SDK passes session_id through tool-call context; Agno does
not. A contextvar set by the provider wrapper around each call lets
handlers pick up the current session_id without changing the tool
signatures the model sees. set_session_context / reset_session_context
/ current_session_id — to be used by the agent run loop when it
invokes generate().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Config keys for the auto-loop

**Files:**
- Modify: `openagent/core/config.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Read the current config module.**

```bash
cat /Users/alessandrogerelli/OpenAgent/openagent/core/config.py
```

You will see existing config shapes. The shell config section goes under the top-level config dict at key `"shell"`.

- [ ] **Step 2: Write the failing test.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "config.shell_settings returns defaults when unset")
async def t_config_defaults(ctx: TestContext) -> None:
    from openagent.core.config import shell_settings

    s = shell_settings({})
    assert s.wake_wait_window_seconds == 60.0
    assert s.autoloop_cap == 25


@test("shell", "config.shell_settings honours overrides")
async def t_config_override(ctx: TestContext) -> None:
    from openagent.core.config import shell_settings

    s = shell_settings({"shell": {"wake_wait_window_seconds": 0, "autoloop_cap": 5}})
    assert s.wake_wait_window_seconds == 0.0
    assert s.autoloop_cap == 5
```

- [ ] **Step 3: Run the test; expect it to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: `ImportError: cannot import name 'shell_settings' ...`.

- [ ] **Step 4: Implement `shell_settings`.**

Append to `openagent/core/config.py`:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class ShellSettings:
    """Runtime knobs for the in-process shell MCP.

    wake_wait_window_seconds:
        How long ``agent._run_inner`` sits after the model's final turn
        waiting for a background shell to complete (so short builds get
        auto-continuation). 0 disables; the default is 60.

    autoloop_cap:
        Maximum number of auto-continuation iterations per
        ``agent.run()`` call, protecting against a runaway shell →
        reminder → model → shell chain. Default 25.
    """
    wake_wait_window_seconds: float = 60.0
    autoloop_cap: int = 25


def shell_settings(config: dict) -> ShellSettings:
    """Parse ShellSettings out of the top-level ``openagent.yaml`` dict."""
    raw = (config or {}).get("shell") or {}
    return ShellSettings(
        wake_wait_window_seconds=float(raw.get("wake_wait_window_seconds", 60.0)),
        autoloop_cap=int(raw.get("autoloop_cap", 25)),
    )
```

- [ ] **Step 5: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 39 passes.

- [ ] **Step 6: Commit.**

```bash
git add openagent/core/config.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(config): shell_settings (wake_wait_window_seconds, autoloop_cap)

Two knobs: how long _run_inner waits for a bg shell after the model's
final turn (default 60s, 0 disables), and the maximum auto-continuation
iterations per agent.run() (default 25). Surfaced via openagent.yaml
under the ``shell:`` key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `Agent._run_inner` auto-continuation loop

**Files:**
- Modify: `openagent/core/agent.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing test using a fake model.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "agent._run_inner: continues session when bg shell completes")
async def t_agent_autoloop_continues(ctx: TestContext) -> None:
    import asyncio
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse
    from openagent.mcp.servers.shell import handlers, adapters
    from openagent.mcp.servers.shell.events import ShellEvent

    _reset_shell_hub()

    class FakeModel(BaseModel):
        history_mode = "provider"

        def __init__(self):
            self.turns: list[str] = []

        async def generate(
            self, messages, system=None, tools=None, on_status=None, session_id=None,
        ) -> ModelResponse:
            content = messages[-1]["content"]
            self.turns.append(content)
            # Turn 1 — start a background shell then finish.
            if len(self.turns) == 1:
                # Simulate the tool-loop having kicked off a bg shell:
                token = adapters.set_session_context(session_id)
                try:
                    await handlers.shell_exec(
                        command="echo shell-done",
                        cwd=None, env=None, timeout=None,
                        run_in_background=True, stdin=None, description=None,
                        session_id=None,
                    )
                finally:
                    adapters.reset_session_context(token)
                return ModelResponse(content="Started build, will wait.")
            # Turn 2 — the reminder came in; produce final text.
            return ModelResponse(content=f"Saw reminder: {content[:40]}...")

    model = FakeModel()
    agent = Agent(name="test", model=model)
    # Skip heavy initialize path; shell MCP doesn't need any MCP pool.
    agent._initialized = True
    result = await agent._run_inner(
        message="please run the build",
        attachments=None,
        _status=lambda *_a, **_k: None,
        session_id="S-AUTO",
    )
    # Two turns must have run (the loop re-entered).
    assert len(model.turns) == 2, f"turns: {model.turns!r}"
    assert "Saw reminder" in result
    assert "shell-done" in model.turns[1] or "sh_" in model.turns[1]


@test("shell", "agent._run_inner: stops when no bg shells and no events")
async def t_agent_autoloop_stops(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse

    _reset_shell_hub()

    class NoShellModel(BaseModel):
        history_mode = "provider"
        async def generate(self, messages, system=None, tools=None, on_status=None, session_id=None):
            return ModelResponse(content="just text")

    agent = Agent(name="test", model=NoShellModel())
    agent._initialized = True
    result = await agent._run_inner(
        message="hi",
        attachments=None,
        _status=lambda *_a, **_k: None,
        session_id="S-NONE",
    )
    assert result == "just text"
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 2 failures. `t_agent_autoloop_continues` will assert `len(model.turns) == 2` but get `1` because the loop isn't in place yet.

- [ ] **Step 3: Implement the auto-loop in `_run_inner`.**

Open `openagent/core/agent.py` and locate `_run_inner` (currently around line 398). Refactor the single `model.generate` call into a loop.

Find the existing body of `_run_inner`. It ends with a single `model.generate` call whose `ModelResponse.content` is returned. Replace that section with:

```python
        from openagent.mcp.servers.shell.handlers import get_hub
        from openagent.mcp.servers.shell.adapters import set_session_context, reset_session_context
        from openagent.core.config import shell_settings

        hub = get_hub()
        settings = shell_settings(self.config or {})
        wake_window = settings.wake_wait_window_seconds
        cap = settings.autoloop_cap

        current_input = message
        last_response: ModelResponse | None = None
        iter_count = 0
        while True:
            iter_count += 1
            if iter_count > cap:
                elog(
                    "agent.run.autoloop_cap_hit",
                    session_id=session_id,
                    cap=cap,
                )
                break
            token = set_session_context(session_id)
            try:
                response = await self.model.generate(
                    [{"role": "user", "content": current_input}],
                    system=system,
                    tools=None,
                    on_status=_status,
                    session_id=session_id,
                )
            finally:
                reset_session_context(token)
            last_response = response

            events = hub.drain(session_id)
            if not events:
                if not hub.has_running(session_id):
                    break
                if wake_window > 0:
                    events = await hub.wait(session_id, timeout=wake_window)
                if not events:
                    break
            elog(
                "agent.run.autoloop_iter",
                session_id=session_id,
                iter=iter_count,
                events=len(events),
            )
            current_input = _format_shell_reminder(events)

        return (last_response.content if last_response else "") or "(Done — no final message was returned.)"
```

Add at module scope (top of `openagent/core/agent.py`, near the other helpers):

```python
def _format_shell_reminder(events) -> str:
    """Format terminal shell events into a <system-reminder> block.

    Keep it short — the model still has to call shell_output to read
    actual bytes. Includes a guard clause so the model knows it's OK to
    stop when the work is done.
    """
    lines = ["Background shell status update since your last message:"]
    for ev in events:
        if ev.kind == "completed":
            detail = f"completed with exit_code={ev.exit_code}"
        elif ev.kind == "timed_out":
            detail = "timed_out"
        else:
            detail = f"killed ({ev.signal or 'unknown'})"
        lines.append(
            f"- shell_id={ev.shell_id}: {detail}. stdout_bytes={ev.bytes_stdout}, "
            f"stderr_bytes={ev.bytes_stderr}. Call shell_output to read."
        )
    lines.append(
        "The user has not sent a new message; continue the task from where "
        "you left off, or summarise and stop if the work is complete."
    )
    body = "\n".join(lines)
    return f"<system-reminder>\n{body}\n</system-reminder>"
```

- [ ] **Step 4: The `Agent` class may not expose `self.config`.** Check and add if needed.

Read `openagent/core/agent.py` to confirm `Agent.__init__` stores `self.config = config` (or similar). If not, add:

```python
    def __init__(self, *, name, model, config: dict | None = None, ...):
        ...
        self.config = config or {}
```

or wherever existing init assigns fields. (If the tests use `Agent(name="test", model=model)` without config, our `shell_settings({})` fallback handles that fine.)

- [ ] **Step 5: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 41 passes.

- [ ] **Step 6: Run the broader suite to verify no regression.**

```bash
bash scripts/test_openagent.sh --only shell,imports,setup,catalog,formatting,pool,agno,router,gateway
```

Expected: all green. If a gateway / agno test expects single-turn behaviour and now sees multiple turns, investigate — but the loop only continues when there are bg shells, so unrelated tests should be untouched.

- [ ] **Step 7: Commit.**

```bash
git add openagent/core/agent.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(agent): _run_inner auto-continuation loop for bg shells

When the model finishes a turn, drain the shell hub: if there are
terminal events (or bg shells still running within the configured
wake_wait_window), inject a <system-reminder> and call
model.generate() again on the same session_id. Capped at 25 iterations
(configurable) with an elog for cap-hit telemetry. Works for any
BaseModel provider because the contract is just
generate(session_id=...).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Passive next-turn reminder

**Files:**
- Modify: `openagent/core/agent.py`
- Modify: `scripts/tests/test_shell.py`

**Why this task:** When a bg shell completes AFTER `agent.run()` has returned, the event sits in the hub. On the NEXT user message we must prepend it as a system reminder so the model knows what happened.

- [ ] **Step 1: Write the failing test.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "agent._run_inner: passive reminder on next turn")
async def t_agent_passive_reminder(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse
    from openagent.mcp.servers.shell import handlers
    from openagent.mcp.servers.shell.events import ShellEvent
    import time

    _reset_shell_hub()
    # Pre-seed the hub with a completed event for session S-P.
    handlers.get_hub().register(shell_id="sh_old", session_id="S-P", command="echo x")
    handlers.get_hub().mark_completed("sh_old", exit_code=0, signal=None)
    handlers.get_hub().post_event("S-P", ShellEvent(
        shell_id="sh_old", kind="completed", exit_code=0, signal=None,
        bytes_stdout=1, bytes_stderr=0, at=time.time(),
    ))

    class EchoModel(BaseModel):
        history_mode = "provider"
        last_input: str = ""
        async def generate(self, messages, system=None, tools=None, on_status=None, session_id=None):
            EchoModel.last_input = messages[-1]["content"]
            return ModelResponse(content="ok")

    agent = Agent(name="test", model=EchoModel())
    agent._initialized = True
    result = await agent._run_inner(
        message="anything new?",
        attachments=None,
        _status=lambda *_a, **_k: None,
        session_id="S-P",
    )
    assert result == "ok"
    assert "<system-reminder>" in EchoModel.last_input
    assert "sh_old" in EchoModel.last_input
    assert "anything new?" in EchoModel.last_input
```

- [ ] **Step 2: Run the test; expect it to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: failure — the current loop doesn't prepend a reminder before the first turn.

- [ ] **Step 3: Implement passive reminder at loop entry.**

In `openagent/core/agent.py`, before the `while True:` loop in `_run_inner`, add:

```python
        pending = hub.drain(session_id)
        if pending:
            pre = _format_shell_reminder(pending)
            current_input = f"{pre}\n\n{current_input}"
```

Place this after the `current_input = message` assignment and before the `while True:` line.

- [ ] **Step 4: Run the test; expect it to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 42 passes.

- [ ] **Step 5: Commit.**

```bash
git add openagent/core/agent.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(agent): passive next-turn shell reminder

When agent.run() starts a new turn and the hub already has queued
terminal events for the session (bg shells completed while the agent
was idle between user messages), prepend a <system-reminder> to the
user's message so the model sees what happened. Claude-Code-style
passive notification; complements the active wake-up from Task 16.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Auto-loop cap regression test

**Files:**
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing test.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "agent._run_inner: autoloop_cap stops runaway chains")
async def t_agent_autoloop_cap(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse
    from openagent.mcp.servers.shell import handlers, adapters

    _reset_shell_hub()

    class AlwaysStartsShellModel(BaseModel):
        history_mode = "provider"

        def __init__(self): self.turns = 0

        async def generate(self, messages, system=None, tools=None, on_status=None, session_id=None):
            self.turns += 1
            token = adapters.set_session_context(session_id)
            try:
                await handlers.shell_exec(
                    command="echo runaway",
                    cwd=None, env=None, timeout=None,
                    run_in_background=True, stdin=None, description=None,
                    session_id=None,
                )
            finally:
                adapters.reset_session_context(token)
            return ModelResponse(content=f"turn {self.turns}")

    model = AlwaysStartsShellModel()
    agent = Agent(name="test", model=model, config={"shell": {"autoloop_cap": 3}})
    agent._initialized = True
    result = await agent._run_inner(
        message="go",
        attachments=None,
        _status=lambda *_a, **_k: None,
        session_id="S-CAP",
    )
    # Cap is 3, so we see exactly 3 turns and stop.
    assert model.turns == 3, f"turns: {model.turns}"
    assert "turn 3" in result
```

- [ ] **Step 2: Run the test; expect it to pass (we implemented the cap in Task 16).**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 43 passes. If it fails, revisit the cap guard from Task 16.

- [ ] **Step 3: Commit.**

```bash
git add scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
test(shell): autoloop_cap stops runaway model+shell chains

Explicit regression test for the cap behaviour implemented in the
_run_inner loop: a fake model that starts a fresh bg shell every
turn hits the cap (here set to 3 for the test) and stops with the
last response.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Session lifecycle hooks

**Files:**
- Modify: `openagent/core/agent.py`
- Modify: `scripts/tests/test_shell.py`

- [ ] **Step 1: Write the failing tests.**

Append to `scripts/tests/test_shell.py`:

```python
@test("shell", "agent.forget_session purges hub entries for that session")
async def t_agent_forget_purges_hub(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    handlers.get_hub().register(shell_id="sh_x", session_id="S-FOR", command="echo")
    handlers.get_hub().mark_completed("sh_x", exit_code=0, signal=None)

    class NoopModel(BaseModel):
        history_mode = "provider"
        async def generate(self, *a, **kw): return ModelResponse(content="")

    agent = Agent(name="test", model=NoopModel())
    agent._initialized = True
    await agent.forget_session("S-FOR")
    assert handlers.get_hub().list_for_session("S-FOR") == []


@test("shell", "agent.shutdown clears the hub")
async def t_agent_shutdown_clears_hub(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.base import BaseModel, ModelResponse
    from openagent.mcp.servers.shell import handlers

    _reset_shell_hub()
    handlers.get_hub().register(shell_id="sh_y", session_id="S-SH", command="echo")
    handlers.get_hub().mark_completed("sh_y", exit_code=0, signal=None)

    class NoopModel(BaseModel):
        history_mode = "provider"
        async def generate(self, *a, **kw): return ModelResponse(content="")

    agent = Agent(name="test", model=NoopModel())
    agent._initialized = True
    await agent.shutdown()
    assert handlers.get_hub().get("sh_y") is None
```

- [ ] **Step 2: Run the tests; expect them to fail.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: two failures — the hub is still populated after forget/shutdown.

- [ ] **Step 3: Hook into `forget_session`.**

In `openagent/core/agent.py`, find `forget_session` (around line 229). At the end of the method body (after the existing model-forget logic), add:

```python
        try:
            from openagent.mcp.servers.shell.handlers import get_hub
            await get_hub().purge_session(session_id)
        except Exception as e:  # noqa: BLE001 — best-effort
            logger.debug("shell hub purge for %s failed: %s", session_id, e)
```

- [ ] **Step 4: Hook into `release_session`.**

Find `release_session` (around line 190). Near where the session resources are released, add the same purge call for that session id.

- [ ] **Step 5: Hook into `shutdown`.**

Find `shutdown` (around line 293). After the existing shutdown logic (after `self._mcp.close_all()`), add:

```python
        try:
            from openagent.mcp.servers.shell.handlers import get_hub
            await get_hub().shutdown()
        except Exception as e:  # noqa: BLE001
            logger.debug("shell hub shutdown failed: %s", e)
```

- [ ] **Step 6: Hook into the idle cleanup loop.**

Find `_run_idle_cleanup` (around line 280). When a session is identified as idle and released, call the hub purge for that id inside the same loop.

- [ ] **Step 7: Run the tests; expect them to pass.**

```bash
bash scripts/test_openagent.sh --only shell
```

Expected: 45 passes.

- [ ] **Step 8: Commit.**

```bash
git add openagent/core/agent.py scripts/tests/test_shell.py
git commit -m "$(cat <<'EOF'
feat(agent): wire ShellHub into session lifecycle

forget_session / release_session / idle cleanup now call
shell_hub.purge_session(id) so background shells tied to a released
session are killed. shutdown calls shell_hub.shutdown() so the agent
can exit cleanly without leaking subprocesses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Prompt update + pyproject cleanup

**Files:**
- Modify: `openagent/core/prompts.py`
- Modify: `pyproject.toml`
- Modify: `scripts/install.sh` and `scripts/setup.sh` (if they reference Node shell build)

- [ ] **Step 1: Read current prompt for the shell section.**

```bash
grep -n "shell" /Users/alessandrogerelli/OpenAgent/openagent/core/prompts.py
```

You will see the references to `shell_shell_exec` at lines 24 and 82.

- [ ] **Step 2: Update prompts.py to describe the new tools.**

Edit `openagent/core/prompts.py`. Replace the existing "Tool preference" section's shell paragraph with:

```
- Drop to the shell MCP only for operations no other MCP offers —
  one-off system admin, kernel-level debugging, compiling code, etc.
  The shell MCP exposes six tools:
    * ``shell_shell_exec`` — run a command. Pass
      ``run_in_background=true`` for long jobs (builds, installs,
      servers) to get back a ``shell_id`` immediately.
    * ``shell_shell_output`` — poll new stdout/stderr from a
      background shell (deltas only; uses an internal cursor).
    * ``shell_shell_input`` — pipe text to a running shell's stdin
      (e.g. answering a prompt or talking to a REPL).
    * ``shell_shell_kill`` — terminate a background shell.
    * ``shell_shell_list`` — list active and recently-completed shells
      for the current session.
    * ``shell_shell_which`` — check a command's availability on PATH.
  When you start a background shell, the runtime will notify you via a
  system reminder when it completes. Do NOT spawn a background shell
  and then poll in a tight loop — the agent will automatically
  continue the session when a terminal event fires.
```

Leave the existing guard clause ("Do NOT create throwaway helper scripts…") alone.

- [ ] **Step 3: Update pyproject.toml package-data to drop Node artifacts.**

Edit `openagent/pyproject.toml`, find `[tool.setuptools.package-data]`, and remove `mcp/servers/**/*.ts` and `mcp/servers/**/*.json` if they're listed (the shell MCP no longer needs them; other MCPs that DO need them should have more specific globs). If removing would break other bundled MCPs, leave the globs but verify they still work by checking the node_modules presence in the non-shell MCP dirs:

```bash
ls /Users/alessandrogerelli/OpenAgent/openagent/mcp/servers/*/package.json 2>/dev/null
```

Keep the globs if any other MCP still has a `package.json`. Only remove them if the shell MCP was the last one with Node artifacts.

- [ ] **Step 4: Update install/setup scripts.**

Grep for shell-specific Node steps:

```bash
grep -n "shell" /Users/alessandrogerelli/OpenAgent/scripts/install.sh /Users/alessandrogerelli/OpenAgent/scripts/setup.sh 2>/dev/null
```

If there are any `npm install` or `tsc` invocations targeting `openagent/mcp/servers/shell`, remove them. Leave Node-install steps for other MCPs untouched.

- [ ] **Step 5: Run the full test suite.**

```bash
bash scripts/test_openagent.sh --only imports,setup,catalog,formatting,pool,agno,router,gateway,shell
```

Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add openagent/core/prompts.py pyproject.toml scripts/install.sh scripts/setup.sh 2>/dev/null
git commit -m "$(cat <<'EOF'
chore(shell): prompt update + drop Node MCP artefacts

Describe the new six-tool shell surface in the framework prompt
(shell_shell_exec + _output / _input / _kill / _list / _which). Remove
package-data globs and install/setup steps that only existed for the
old Node-based shell MCP.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: End-to-end Claude CLI smoke test

**Files:**
- Modify: `scripts/tests/test_claude_cli.py`

**Why this task:** The unit tests cover the hub and handlers with a fake model. A real provider smoke test confirms the adapter plumbing works end-to-end. Uses the existing `--include-claude` gate so it only runs when the user asks.

- [ ] **Step 1: Write the failing test.**

Append to `scripts/tests/test_claude_cli.py`:

```python
@test("claude-cli", "shell MCP round-trip: start bg shell, receive reminder, read output")
async def t_claude_shell_bg_roundtrip(ctx: TestContext) -> None:
    from openagent.core.agent import Agent
    from openagent.models.claude_cli import ClaudeCLI
    from openagent.mcp.servers.shell.handlers import get_hub

    pool = ctx.extras.get("pool")
    if pool is None:
        raise TestSkip("pool fixture not set up")

    model = ClaudeCLI()
    model.set_mcp_servers(pool.claude_sdk_servers())
    agent = Agent(name="shell-e2e", model=model)
    agent._initialized = True

    prompt = (
        "Use shell_exec with run_in_background=true to run "
        "'sleep 1 && echo hello-e2e'. Wait for the system reminder, "
        "call shell_output to read the result, and reply with "
        "exactly the text you read."
    )
    result = await agent._run_inner(
        message=prompt,
        attachments=None,
        _status=lambda *_a, **_k: None,
        session_id="claude-shell-e2e",
    )
    assert "hello-e2e" in result, f"unexpected result: {result!r}"
```

- [ ] **Step 2: Run the test with the Claude gate.**

```bash
bash scripts/test_openagent.sh --only claude-cli --include-claude
```

Expected: pass. If the model calls the tools in a different order (e.g. polls shell_output early), the reminder should still eventually fire; that's OK as long as the final text contains `hello-e2e`.

- [ ] **Step 3: Commit.**

```bash
git add scripts/tests/test_claude_cli.py
git commit -m "$(cat <<'EOF'
test(claude-cli): shell MCP bg round-trip smoke test

Real Claude CLI SDK calling shell_exec(run_in_background=true),
receiving the auto-loop system reminder, and fetching shell_output.
Gated on --include-claude like the other claude-cli tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Spec-coverage sweep + final verification

**Files:** — (verification only)

- [ ] **Step 1: Review the spec against the code.**

Open the spec and walk through each section, confirming a task covered it:

```bash
less /Users/alessandrogerelli/OpenAgent/docs/superpowers/specs/2026-04-17-shell-mcp-active-background-design.md
```

Key items to verify in the committed code:

- [ ] Tool surface matches spec: `shell_exec` / `shell_output` / `shell_input` / `shell_kill` / `shell_list` / `shell_which` — all present in `handlers.py`.
- [ ] `BackgroundShell` has buffer caps at 1 MB and truncation markers (check `MAX_STREAM_BYTES` and overflow path in `shells.py`).
- [ ] `ShellHub` has GC with 10 min default TTL (check `gc(ttl_seconds=600.0)`).
- [ ] Agent loop has cap + wake_wait_window (check `_run_inner` and `config.py`).
- [ ] Passive next-turn reminder is wired.
- [ ] `elog` calls present for: `shell.bg.start` (in `shell_exec` background path), `shell.bg.exit` (in `_watch_background`), `agent.run.autoloop_iter`, `agent.run.autoloop_cap_hit`.

If any are missing, add them now with targeted edits + tests.

- [ ] **Step 2: Confirm the Node MCP is fully gone.**

```bash
find /Users/alessandrogerelli/OpenAgent -name "package.json" -path "*mcp/servers/shell*" 2>/dev/null
find /Users/alessandrogerelli/OpenAgent -name "*.ts" -path "*mcp/servers/shell*" 2>/dev/null
```

Expected: both return nothing.

- [ ] **Step 3: Final full-suite run.**

```bash
bash scripts/test_openagent.sh
```

Expected: all categories pass (excluding `--include-claude` which needs an explicit opt-in).

- [ ] **Step 4: Run with the Claude gate as well.**

```bash
bash scripts/test_openagent.sh --include-claude
```

Expected: all pass including Task 21's smoke test.

- [ ] **Step 5: Update the spec status to "implemented".**

Edit `docs/superpowers/specs/2026-04-17-shell-mcp-active-background-design.md`:

```markdown
Status: implemented
```

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/specs/2026-04-17-shell-mcp-active-background-design.md
git commit -m "$(cat <<'EOF'
docs(shell): mark spec as implemented

All 22 tasks landed; the in-process shell MCP is live, background
shells auto-continue the current session via the agent run loop, and
the full test suite (including the Claude CLI smoke test) passes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Rollback

If an issue surfaces after landing, the commits are individually revertable — each task is one commit. The lowest-risk rollback is:

1. `git revert <task-22>` through `<task-13>` — restores the Node MCP spec entry in `builtins.py`.
2. Restore `openagent/mcp/servers/shell/` from `git show <baseline>:openagent/mcp/servers/shell` to get the TS source back, plus `npm install && npm run build`.

The tasks are ordered so that the feature only "goes live" at Task 13 (the `BUILTIN_MCP_SPECS` switch). Reverting Task 13 alone is enough to fall back to the old Node MCP even if the Python handlers stay in the tree.
