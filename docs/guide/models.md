# Models

OpenAgent is model agnostic by design. It supports multiple LLM providers, and every model gets the same MCP tools, memory behavior, channels, and client surfaces.

## Smart Router

The recommended default. Classifies each incoming message into a tier (`simple` / `medium` / `hard`) using a cheap classifier model, then routes to the tier-appropriate model. Also falls back to a cheaper model automatically when your monthly budget is nearly exhausted.

```yaml
model:
  provider: smart
  monthly_budget: 50              # USD; router downgrades when near/over budget
  classifier_model: gpt-4o-mini   # cheap model that picks the tier
  routing:
    simple: gpt-4o-mini
    medium: gpt-4.1-mini
    hard: gpt-4.1
    fallback: gpt-4o-mini         # used when budget is exhausted
```

Every request gets logged to a `usage_log` table with input / output tokens and computed cost. The REST endpoint `GET /api/usage` returns the running totals; `GET /api/usage/pricing` returns the price-per-million table used for cost computation.

Model prices come from a bundled default pricing file (gpt-4.1 / gpt-4o-mini / gemini-2.5-flash / claude-sonnet-4-6 / etc.). User overrides in `providers.<name>.models[].input_cost_per_million` take precedence.

## Claude CLI (Claude Agent SDK)

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

## OpenAI

Standard OpenAI-hosted models run through the same Agno provider as Z.ai; the only difference is you put the key under `providers.openai` and reference the model as `openai:<id>` (or use the Smart Router above).

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      - gpt-4o-mini
      - gpt-4.1-mini
      - gpt-4.1
```

## Hot Reload

Change `model:` or `providers:` in `openagent.yaml` and the gateway rebuilds the active model on the next incoming message — no restart. Other sections (`mcp`, `scheduler`, `channels`, `system_prompt`) still need a restart to take effect.
