from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock

from openagent.agent import Agent
from openagent.mcp.client import MCPTools


class ShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_shutdown_suppresses_close_errors(self):
        agent = Agent()
        agent._initialized = True
        agent._mcp = AsyncMock()
        agent._mcp.close_all.side_effect = asyncio.CancelledError()
        agent._db = AsyncMock()
        agent._db.close.side_effect = RuntimeError("db close failed")

        await agent.shutdown()

        self.assertFalse(agent._initialized)
        agent._mcp.close_all.assert_awaited_once()
        agent._db.close.assert_awaited_once()

    async def test_mcp_tools_close_suppresses_exit_stack_errors(self):
        tool = MCPTools(name="test")
        tool._exit_stack = AsyncMock()
        tool._exit_stack.aclose.side_effect = asyncio.CancelledError()
        tool._session = object()
        tool._tools = [{"name": "demo"}]

        await tool.close()

        self.assertIsNone(tool._exit_stack)
        self.assertIsNone(tool._session)
        self.assertEqual(tool._tools, [])


if __name__ == "__main__":
    unittest.main()
