/**
 * Shared types for OpenAgent WebSocket protocol and REST API.
 * Used by both the universal app and the desktop Electron wrapper.
 */

// ── WebSocket Protocol ──

export type ClientMessage =
  | { type: 'auth'; token: string; client_id?: string }
  | { type: 'message'; text: string; session_id: string }
  // ``session_id`` MUST be passed for ``stop`` / ``new`` / ``clear`` / ``reset``
  // when the client hosts multiple independent conversations on one ws
  // (e.g. two chat tabs). The gateway scopes those commands to the tab's
  // session so one tab's /clear doesn't wipe the others.
  | {
      type: 'command';
      name: 'stop' | 'new' | 'clear' | 'reset' | 'status' | 'queue' | 'help' | 'usage' | 'update' | 'restart';
      session_id?: string;
    }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'auth_ok'; agent_name: string; version: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'status'; text: string; session_id: string }
  | { type: 'response'; text: string; session_id: string; attachments?: Attachment[]; model?: string }
  | { type: 'error'; text: string }
  | { type: 'queued'; position: number }
  | { type: 'command_result'; text: string }
  | { type: 'pong' };

export interface Attachment {
  type: 'image' | 'file' | 'voice' | 'video';
  path: string;
  filename: string;
}

// ── Chat State ──

export interface ToolInfo {
  tool: string;
  params?: Record<string, any>;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  toolInfo?: ToolInfo;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText?: string;
}

// ── Connection ──

export interface ConnectionConfig {
  name: string;
  host: string;
  port: number;
  token: string;
  isLocal: boolean;
}

export interface SavedAccount extends ConnectionConfig {
  id: string;          // unique identifier
  createdAt: number;   // epoch ms
}

// ── Config ──

// OpenAgent v0.12 vocabulary:
//   - provider row = (name, framework) pair with a surrogate integer id
//   - the same vendor can appear twice (e.g. anthropic+agno and anthropic+claude-cli)
//   - api_key is NULL for claude-cli rows (subscription auth, no API key)
export type ModelFramework = 'agno' | 'claude-cli';

export interface ProviderConfig {
  id: number;
  name: string;
  framework: ModelFramework;
  api_key_display: string;    // "****abcd" | "${VAR}" | "—"
  base_url: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
}

export interface ModelCatalogEntry {
  model_id: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
}

export interface DailyUsageEntry {
  date: string;
  model: string;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

export interface ModelsResponse {
  // v0.12: flat list — dict-by-name would collide when the same vendor
  // is registered under both frameworks.
  models: ProviderConfig[];
}

export interface UsageData {
  monthly_spend: number;
  monthly_budget: number;
  remaining: number | null;
  by_model: Record<string, number>;
}

export interface McpServerConfig {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  oauth?: boolean;
  args?: string[];
}

// ── DB-backed registries (mcps + models tables) ──
// Managed via /api/mcps and /api/models/db — the ``mcps`` and ``models``
// SQLite tables are the source of truth. The ``mcps`` table is seeded
// from any legacy yaml ``mcp:`` entries once on first boot.

export interface MCPEntry {
  name: string;
  kind: 'builtin' | 'custom' | 'default';
  builtin_name?: string | null;
  command?: string[] | null;
  args: string[];
  url?: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
  oauth: boolean;
  enabled: boolean;
  source: string;
  created_at: number;
  updated_at: number;
}

// OpenAgent model-catalog vocabulary (v0.12+):
//   provider_id   = FK to providers.id — authoritative.
//   provider_name = the vendor (anthropic, openai, google, zai, …).
//                   Denormalised on the response for rendering.
//   framework     = inherited from the provider row ("agno" | "claude-cli").
//                   Same reason: denormalised for the UI.
//   model         = bare vendor id (gpt-4o-mini, claude-sonnet-4-6, …).
//   runtime_id    = derived string used in session pins and classifier
//                   output; computed server-side from
//                   (provider_name, model, framework).
export interface ModelEntry {
  id: number;
  provider_id: number;
  provider_name: string;
  framework: ModelFramework;
  runtime_id: string;
  model: string;
  display_name?: string | null;
  input_cost_per_million?: number | null;
  output_cost_per_million?: number | null;
  tier_hint?: string | null;
  enabled: boolean;
  provider_enabled?: boolean;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface AvailableModel {
  id: string;
  display_name: string;
  runtime_id?: string;
  added?: boolean;
}

// Source-of-truth yaml fields. Providers, models, MCPs, and scheduled
// tasks are DB-backed and live in SQLite — reach them via their
// dedicated REST endpoints (``/api/providers``, ``/api/models``,
// ``/api/mcps``, ``/api/scheduled-tasks``), not through this shape.
export interface AgentConfig {
  name?: string;
  system_prompt?: string;
  dream_mode?: { enabled: boolean; time: string };
  auto_update?: { enabled: boolean; mode: string; check_interval: string };
  channels?: Record<string, any>;
  services?: Record<string, any>;
  memory?: { db_path?: string; vault_path?: string };
}

// ── REST API — vault, config ──

export interface VaultNote {
  path: string;
  title: string;
  tags: string[];
  modified: string;
  content?: string;
}

export interface GraphData {
  nodes: { id: string; label: string; tags: string[] }[];
  edges: { source: string; target: string }[];
}

export interface HealthResponse {
  status: 'ok';
  agent: string;
  version: string;
  connected_clients: number;
}

// ── Scheduled Tasks ──

export interface ScheduledTask {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: boolean;
  last_run: number | null;
  next_run: number | null;
  created_at: number;
  updated_at: number;
  run_once: boolean;
  run_at?: number;
  run_at_iso?: string;
  last_run_iso?: string;
  next_run_iso?: string;
  created_at_iso?: string;
  updated_at_iso?: string;
}

export interface CreateScheduledTaskInput {
  name: string;
  cron_expression: string;
  prompt: string;
  enabled?: boolean;
}

export type UpdateScheduledTaskInput = Partial<
  Pick<ScheduledTask, 'name' | 'cron_expression' | 'prompt' | 'enabled'>
>;
