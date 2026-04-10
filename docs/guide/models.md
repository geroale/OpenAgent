# Models

OpenAgent supports multiple LLM providers. Every model gets the same MCP tools — no provider-specific behavior.

## Claude CLI (Claude Code SDK)

Uses your Claude Pro/Max membership — flat rate, not pay-per-token.

```yaml
model:
  provider: claude-cli
  model_id: claude-sonnet-4-6
  permission_mode: bypass     # auto-approve all tool calls
```

Requires `claude` CLI installed and authenticated (`claude login`).

## Claude API (Anthropic SDK)

```yaml
model:
  provider: claude-api
  model_id: claude-sonnet-4-6
  api_key: ${ANTHROPIC_API_KEY}
```

## Z.ai GLM / Any OpenAI-compatible

```yaml
model:
  provider: zhipu
  model_id: glm-5
  api_key: ${ZAI_API_KEY}
  base_url: https://api.z.ai/api/paas/v4
```

Works with Ollama, vLLM, LM Studio — just change `base_url`:

```yaml
model:
  provider: zhipu
  model_id: llama3
  base_url: http://localhost:11434/v1
  api_key: ollama
```
