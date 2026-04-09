"""Core Agent class: orchestrates model, MCP tools, and memory."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable

from openagent.memory.db import MemoryDB
from openagent.mcp.client import MCPRegistry, MCPTools
from openagent.models.base import BaseModel
from openagent.prompts import FRAMEWORK_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 10
_TOOL_STATUS_RE = re.compile(r"^Using (?P<name>.+?)\.\.\.$")

StatusCallback = Callable[[str], Awaitable[None]]


@dataclass
class AgentEvent:
    type: str
    data: dict[str, Any] = field(default_factory=dict)


EventCallback = Callable[[AgentEvent], Awaitable[None]]


class Agent:
    """Main agent class. Ties together a model, MCP tools, and memory."""

    def __init__(
        self,
        name: str = "agent",
        model: BaseModel | None = None,
        system_prompt: str = "You are a helpful assistant.",
        mcp_tools: list[MCPTools] | None = None,
        mcp_registry: MCPRegistry | None = None,
        memory: MemoryDB | str | None = None,
    ):
        self.name = name
        self.model = model
        self.system_prompt = system_prompt

        if mcp_registry:
            self._mcp = mcp_registry
        else:
            self._mcp = MCPRegistry()
            for tool in (mcp_tools or []):
                self._mcp.add(tool)

        if isinstance(memory, str):
            self._db = MemoryDB(memory)
        elif isinstance(memory, MemoryDB):
            self._db = memory
        else:
            self._db = None

        self._initialized = False

    async def initialize(self) -> None:
        """Connect MCP servers and initialize memory DB."""
        if self._initialized:
            return
        await self._mcp.connect_all()
        if self._db:
            await self._db.connect()

        from openagent.models.claude_cli import ClaudeCLI

        if isinstance(self.model, ClaudeCLI):
            mcp_configs = self._build_cli_mcp_configs()
            if mcp_configs:
                self.model.set_mcp_servers(mcp_configs)

        self._initialized = True

    def _build_cli_mcp_configs(self) -> dict[str, dict]:
        """Build MCP server configs for the Claude Agent SDK."""
        import os
        import shutil

        configs = {}
        for server in self._mcp._servers:
            if server.command:
                full_cmd = server.command + server.args
                cmd_name = full_cmd[0]

                if not os.path.isabs(cmd_name):
                    resolved = shutil.which(cmd_name)
                    if resolved:
                        cmd_name = resolved
                    else:
                        logger.warning(
                            "MCP '%s': command %r not found on PATH — "
                            "Claude CLI will likely drop this server",
                            server.name,
                            cmd_name,
                        )

                entry: dict[str, Any] = {
                    "command": cmd_name,
                    "args": full_cmd[1:],
                }

                env = dict(server.env) if server.env else {}

                if server.name == "messaging":
                    for var in (
                        "TELEGRAM_BOT_TOKEN",
                        "DISCORD_BOT_TOKEN",
                        "GREEN_API_ID",
                        "GREEN_API_TOKEN",
                    ):
                        val = os.environ.get(var)
                        if val:
                            env[var] = val

                if server.name == "scheduler" and "OPENAGENT_DB_PATH" not in env:
                    if self._db and getattr(self._db, "db_path", None):
                        env["OPENAGENT_DB_PATH"] = os.path.abspath(self._db.db_path)

                if env:
                    entry["env"] = env

                configs[server.name] = entry
            elif server.url:
                configs[server.name] = {"type": "http", "url": server.url}

        return configs

    async def shutdown(self) -> None:
        """Close all connections."""
        try:
            await self._mcp.close_all()
        except BaseException as e:
            logger.warning("Agent MCP shutdown error: %s", e)

        if self._db:
            try:
                await self._db.close()
            except BaseException as e:
                logger.warning("Agent DB shutdown error: %s", e)
        self._initialized = False

    async def run(
        self,
        message: str,
        user_id: str = "",
        session_id: str | None = None,
        attachments: list[dict] | None = None,
        on_status: StatusCallback | None = None,
        on_event: EventCallback | None = None,
    ) -> str:
        """Run the agent with a user message and return the final response."""
        del user_id  # reserved for future routing/telemetry use

        if not self.model:
            raise RuntimeError("No model configured. Set agent.model before calling run().")

        await self.initialize()

        active_inferred_tool: str | None = None

        async def _emit(event_type: str, **data: Any) -> None:
            if on_event:
                try:
                    await on_event(AgentEvent(type=event_type, data=data))
                except Exception:
                    pass

        async def _status(msg: str, *, infer_tool: bool = True) -> None:
            nonlocal active_inferred_tool

            if on_status:
                try:
                    await on_status(msg)
                except Exception:
                    pass

            await _emit("status", status=msg)

            if not infer_tool:
                return

            match = _TOOL_STATUS_RE.match(msg.strip())
            if match:
                tool_name = match.group("name")
                if active_inferred_tool and active_inferred_tool != tool_name:
                    await _emit(
                        "tool_finished",
                        tool_name=active_inferred_tool,
                        inferred=True,
                    )
                if active_inferred_tool != tool_name:
                    await _emit(
                        "tool_started",
                        tool_name=tool_name,
                        inferred=True,
                    )
                active_inferred_tool = tool_name
            elif active_inferred_tool:
                await _emit(
                    "tool_finished",
                    tool_name=active_inferred_tool,
                    inferred=True,
                )
                active_inferred_tool = None

        try:
            result = await self._run_inner(
                message=message,
                session_id=session_id,
                attachments=attachments,
                emit=_emit,
                status=_status,
            )
            if active_inferred_tool:
                await _emit(
                    "tool_finished",
                    tool_name=active_inferred_tool,
                    inferred=True,
                )
            return result
        except BaseException as e:
            logger.error("Agent.run() fatal error: %s", e)
            if active_inferred_tool:
                await _emit(
                    "tool_finished",
                    tool_name=active_inferred_tool,
                    inferred=True,
                )
            await _emit("run_error", error=str(e))
            return f"Error: {e}"

    async def _run_inner(
        self,
        message: str,
        session_id: str | None,
        attachments: list[dict] | None,
        emit,
        status,
    ) -> str:
        await emit("run_started", message=message, session_id=session_id)
        await status("Loading context...", infer_tool=False)

        system = self._combined_system_prompt()
        prepared_message = self._prepare_message(message, attachments)
        messages: list[dict[str, Any]] = [{"role": "user", "content": prepared_message}]
        tools = self._mcp.all_tools() or None

        await status("Thinking...", infer_tool=False)

        response = None
        for iteration in range(MAX_TOOL_ITERATIONS):
            response = await self.model.generate(
                messages,
                system=system,
                tools=tools,
                session_id=session_id,
                on_status=status,
            )

            if response.tool_calls:
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": response.content,
                    "tool_calls": [
                        {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
                        for tc in response.tool_calls
                    ],
                }
                messages.append(assistant_msg)

                for tc in response.tool_calls:
                    await emit(
                        "tool_started",
                        tool_name=tc.name,
                        arguments=tc.arguments,
                        tool_call_id=tc.id,
                        inferred=False,
                    )
                    await status(f"Using {tc.name}...", infer_tool=False)

                    try:
                        result = await self._mcp.call_tool(tc.name, tc.arguments)
                    except Exception as e:
                        result = f"Error calling tool {tc.name}: {e}"
                        logger.error(result)
                        await emit(
                            "tool_failed",
                            tool_name=tc.name,
                            arguments=tc.arguments,
                            tool_call_id=tc.id,
                            error=str(e),
                            result=result,
                        )
                    else:
                        await emit(
                            "tool_finished",
                            tool_name=tc.name,
                            arguments=tc.arguments,
                            tool_call_id=tc.id,
                            result=result,
                            inferred=False,
                        )

                    messages.append(
                        {
                            "role": "tool",
                            "content": result,
                            "tool_call_id": tc.id,
                        }
                    )

                if iteration < MAX_TOOL_ITERATIONS - 1:
                    await status("Thinking...", infer_tool=False)
                continue

            final_content = response.content or ""
            if final_content:
                await emit("assistant_delta", delta=final_content)
                await emit("assistant_message", content=final_content)
            await emit("run_finished", content=final_content)
            return final_content

        final_content = response.content if response else "I wasn't able to complete the request."
        if final_content:
            await emit("assistant_delta", delta=final_content)
            await emit("assistant_message", content=final_content)
        await emit("run_finished", content=final_content)
        return final_content

    def _prepare_message(self, message: str, attachments: list[dict] | None) -> str:
        if not attachments:
            return message

        lines = ["The user attached the following files:"]
        for attachment in attachments:
            a_type = attachment.get("type", "file")
            a_name = attachment.get("filename", "")
            a_path = attachment.get("path", "")
            if a_path:
                lines.append(f"- {a_type}: {a_name} — local path: {a_path}")
            else:
                lines.append(f"- {a_type}: {a_name}")
        lines.append(
            "Use the Read tool (or an MCP tool) with the local path to "
            "inspect each file. For images, Read returns the image content "
            "for you to see directly."
        )
        att_block = "\n".join(lines)
        return f"{att_block}\n\n{message}" if message else att_block

    def _combined_system_prompt(self) -> str:
        """Prepend the framework-level prompt to the user's system prompt."""
        user = (self.system_prompt or "").strip()
        if not user:
            return FRAMEWORK_SYSTEM_PROMPT
        return (
            FRAMEWORK_SYSTEM_PROMPT
            + "\n\n── User-specific identity and project context ──\n\n"
            + user
        )

    async def stream_run(
        self,
        message: str,
        user_id: str = "",
        session_id: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream the agent's response. Does not support tool use in streaming mode."""
        del user_id

        if not self.model:
            raise RuntimeError("No model configured.")

        await self.initialize()

        system = self._combined_system_prompt()
        messages: list[dict[str, Any]] = [{"role": "user", "content": message}]

        async for chunk in self.model.stream(
            messages,
            system=system,
            session_id=session_id,
        ):
            yield chunk

    async def __aenter__(self):
        await self.initialize()
        return self

    async def __aexit__(self, *args):
        await self.shutdown()
