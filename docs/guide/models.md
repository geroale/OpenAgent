# Models

OpenAgent is model agnostic by design. It supports Agno providers (OpenAI, Anthropic API, Google, Groq, xAI, DeepSeek, Mistral, Cerebras, Z.ai, OpenRouter) and Claude CLI (Claude Pro/Max subscription) — every model gets the same MCP tools, memory behaviour, channels, and client surfaces.

## One router to rule them all

The active runtime is **always** the SmartRouter. It:

1. Reads the enabled models from the `models` SQLite table.
2. Classifies each incoming message with a cheap classifier model and picks the single best `runtime_id` from the enabled catalog.
3. Dispatches to the chosen model — which may be an Agno provider OR a `claude-cli` model, whichever is enabled in the DB.
4. Enforces **session-side binding**: once a session has been served by one side (agno or claude-cli), every subsequent turn stays there. Conversation state lives in that side's store (Agno's SqliteDb vs Claude's own session store), and mixing the two would split the history. Bindings persist across restarts via the `sdk_sessions` and `session_bindings` tables.

## Providers and models live in the DB

Provider credentials (`api_key`, `base_url`) live in the `providers` SQLite table. Add one via the CLI:

```bash
openagent provider add openai --key=$OPENAI_API_KEY
openagent provider add anthropic --key=$ANTHROPIC_API_KEY
openagent provider add google --key=$GOOGLE_API_KEY
```

Or via REST:

```bash
curl -X POST http://localhost:8765/api/providers -H 'Content-Type: application/json' -d '{
  "name": "openai",
  "api_key": "sk-..."
}'
```

The per-provider **model list** (which ids are available to route to) lives in the `models` table and is managed via:

- **From the agent** — the `model-manager` built-in MCP exposes `list_models`, `list_available_models` (dynamic discovery via the provider's `/v1/models` or OpenRouter fallback), `add_model`, `update_model`, `enable_model`, `disable_model`, `remove_model`, `test_model`.
- **REST** — `GET/POST/PUT/DELETE /api/models[/...]`, plus `/enable` and `/disable`. `GET /api/models/available?provider=openai` returns the live catalog for a given provider.
- **UI** — the Models / Providers screens in the desktop app or the `/models` slash command in the CLI.

## Claude CLI (Claude Pro/Max subscription)

Install Claude CLI 2.1.96+, run `claude login`, then register at least one claude-cli model:

```text
> use model-manager to add claude-sonnet-4-6 under the claude-cli provider
```

Or:

```bash
curl -X POST http://localhost:8765/api/models -H 'Content-Type: application/json' -d '{
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
