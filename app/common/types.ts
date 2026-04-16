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

export interface ModelConfig {
  provider: string;        // "claude-cli" | "claude-api" | "zhipu" | "litellm" | "smart"
  model_id?: string;
  permission_mode?: string; // "bypass" | "auto" | "default"
  api_key?: string;
  base_url?: string;
  monthly_budget?: number;
  routing?: { simple?: string; medium?: string; hard?: string; fallback?: string };
  classifier_model?: string;
}

export interface ProviderConfig {
  api_key?: string;
  api_key_display?: string;
  base_url?: string;
  models?: string[];
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
  models: Record<string, ProviderConfig>;
  active: ModelConfig;
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

export interface AgentConfig {
  name?: string;
  system_prompt?: string;
  model?: ModelConfig;
  providers?: Record<string, ProviderConfig>;
  mcp_defaults?: boolean;
  mcp_disable?: string[];
  mcp?: McpServerConfig[];
  dream_mode?: { enabled: boolean; time: string };
  auto_update?: { enabled: boolean; mode: string; check_interval: string };
  channels?: Record<string, any>;
  scheduler?: { enabled: boolean; tasks?: any[] };
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
