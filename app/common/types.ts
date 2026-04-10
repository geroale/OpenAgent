/**
 * Shared types for OpenAgent WebSocket protocol and REST API.
 * Used by both the universal app and the desktop Electron wrapper.
 */

// ── WebSocket Protocol ──

export type ClientMessage =
  | { type: 'auth'; token: string; client_id?: string }
  | { type: 'message'; text: string; session_id: string }
  | { type: 'command'; name: 'stop' | 'new' | 'status' | 'queue' | 'help' | 'usage' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'auth_ok'; agent_name: string; version: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'status'; text: string; session_id: string }
  | { type: 'response'; text: string; session_id: string; attachments?: Attachment[] }
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  attachments?: Attachment[];
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
  provider: string;        // "claude-cli" | "claude-api" | "zhipu"
  model_id: string;
  permission_mode?: string; // "bypass" | "auto" | "default"
  api_key?: string;
  base_url?: string;
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
