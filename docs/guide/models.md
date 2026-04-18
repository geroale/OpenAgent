# Models

OpenAgent is model agnostic by design. It supports Agno providers (OpenAI, Anthropic API, Google, Groq, xAI, DeepSeek, Mistral, Cerebras, Z.ai, OpenRouter) and Claude CLI (Claude Pro/Max subscription) — every model gets the same MCP tools, memory behaviour, channels, and client surfaces.

## One router to rule them all

Since v0.9.0 the active runtime is **always** the SmartRouter. It:

1. Reads the enabled models from the `models` SQLite table.
2. Classifies each incoming message into a tier (`simple` / `medium` / `hard`) using a cheap classifier model.
3. Routes to the tier-appropriate model — which may be an Agno provider OR a `claude-cli` model, whichever is enabled in the DB.
4. Enforces **session-side binding**: once a session has been served by one side (agno or claude-cli), every subsequent turn stays there. Conversation state lives in that side's store (Agno's SqliteDb vs Claude's own session store), and mixing the two would split the history. Bindings persist across restarts via the `sdk_sessions` and `session_bindings` tables.
5. Degrades to the fallback tier when the monthly budget is near-exhausted.

```yaml
model:
  permission_mode: bypass        # auto-approve tool calls (agent deployments)
  monthly_budget: 50             # USD; 0 disables
  classifier_model: openai:gpt-4o-mini
  # Optional explicit routing — leave empty to auto-derive from the
  # enabled models in the DB (sorted by output cost per million).
  # routing:
  #   simple: openai:gpt-4o-mini
  #   medium: openai:gpt-4.1-mini
  #   hard: claude-cli/claude-sonnet-4-6
  #   fallback: openai:gpt-4o-mini
```

Legacy `model.provider` values (`claude-cli`, `anthropic`, `zhipu`, …) still work — they get translated into a SmartRouter whose tiers all point at the single configured model.

## API keys live in yaml, models live in the DB

`providers.<name>.api_key` and `base_url` stay in `openagent.yaml` — they are the source of truth for credentials:

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  google:
    api_key: ${GOOGLE_API_KEY}
```

The per-provider **model list** (which ids are available to route to) lives in the `models` table and is managed via:

- **From the agent** — the `model-manager` built-in MCP exposes `list_models`, `list_available_models` (dynamic discovery via the provider's `/v1/models` or OpenRouter fallback), `add_model`, `update_model`, `enable_model`, `disable_model`, `remove_model`, `test_model`.
- **REST** — `GET/POST/PUT/DELETE /api/models/db[/...]`, plus `/enable` and `/disable`. `GET /api/models/available?provider=openai` returns the live catalog for a given provider.
- **UI** — the Models screen in the desktop app or the `/models` slash command in the CLI.

Upgrading an install from <v0.9.0 copies the yaml `providers.X.models:` lists into the DB once and then ignores them on subsequent boots.

## Claude CLI (Claude Pro/Max subscription)

Install Claude CLI 2.1.96+, run `claude login`, then register at least one claude-cli model:

```text
> use model-manager to add claude-sonnet-4-6 under the claude-cli provider
```

Or:

```bash
curl -X POST http://localhost:8765/api/models/db -H 'Content-Type: application/json' -d '{
  "provider": "claude-cli",
  "model_id": "claude-sonnet-4-6"
}'
```

The runtime_id becomes `claude-cli/claude-sonnet-4-6`. When SmartRouter picks it, the session is served by `ClaudeCLIRegistry` (multi-model; pins a session to a specific claude-cli model on first dispatch).

## No models enabled = reject

With zero enabled models in the DB, the gateway replies with a clear error (`"No models are enabled. Add one via /models…"`) instead of silently falling through. Use this as a forcing function: no config, no service.

## Cost tracking

Every dispatch gets logged to `usage_log` with input / output tokens and computed cost. Prices come from the user's per-model metadata first, then OpenRouter's live catalog. There is no bundled offline pricing table — if OpenRouter is unreachable at the moment cost is computed, the entry is logged as `missing` with zero cost. `claude-cli` always resolves to zero (Pro/Max subscription). `GET /api/usage` returns the running totals; `GET /api/usage/pricing` returns the price-per-million table used for cost computation.

## Hot reload

Edit a model via the manager MCP, the REST endpoints, or the UI — the gateway sees the bumped `updated_at` on the next message, rebuilds the routing table, and the new model is live. Sessions already bound stay bound; only fresh sessions can land on the new entry.
