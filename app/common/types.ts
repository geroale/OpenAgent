/**
 * Shared types for OpenAgent WebSocket protocol and REST API.
 * Used by both the universal app and the desktop Electron wrapper.
 */

// ── WebSocket Protocol ──

export type ClientMessage =
  // Legacy AUTH frame: ignored by the gateway (auth is enforced at the
  // Iroh transport layer via the device cert), but we keep sending one
  // for back-compat with code that waits for AUTH_OK as a "ready"
  // signal. ``token`` is no longer required.
  | { type: 'auth'; token?: string; client_id?: string }
  // ``input_was_voice``: true when the user just spoke (mic + ASR via
  // /api/upload). The gateway responds via the streaming TTS pipeline
  // when a TTS provider is configured, falling through to text-only
  // otherwise. Mirror-modality semantics — text-typed messages get
  // text-only replies regardless of voice mode.
  // ``voice_language``: ISO-639-1 hint matching what Whisper used for
  // transcription. The gateway forwards it to Piper so a transcribed
  // Italian message gets spoken with an Italian voice instead of the
  // default American one. Ignored unless ``input_was_voice`` is true.
  | {
      type: 'message';
      text: string;
      session_id: string;
      input_was_voice?: boolean;
      voice_language?: string;
    }
  // ``session_id`` MUST be passed for ``stop`` / ``new`` / ``clear`` / ``reset``
  // when the client hosts multiple independent conversations on one ws
  // (e.g. two chat tabs). The gateway scopes those commands to the tab's
  // session so one tab's /clear doesn't wipe the others.
  | {
      type: 'command';
      name: 'stop' | 'new' | 'clear' | 'reset' | 'status' | 'queue' | 'help' | 'usage' | 'update' | 'restart';
      session_id?: string;
    }
  | { type: 'ping' }
  // ── Stream protocol (additive) ──
  // Long-lived realtime sessions carry typed events on top of the same
  // WS. ``session_open`` begins; ``audio_chunk_in`` / ``video_frame`` /
  // ``text_delta`` / ``text_final`` / ``attachment`` push input;
  // ``interrupt`` triggers barge-in; ``session_close`` ends. The legacy
  // ``message`` frame still works for one-shot text turns; the new
  // surface is opt-in. Audio/video bytes are base64-encoded.
  | {
      type: 'session_open';
      session_id: string;
      profile?: 'realtime' | 'batched';
      llm_pin?: string;
      stt_pin?: string;
      tts_pin?: string;
      language?: string;
      client_kind?: string;
      // Debounce window for typed-text bursts. Server-side StreamSession
      // coalesces messages arriving during an in-flight turn into a
      // single merged turn. ``0`` = disabled (preempt-on-each-message).
      // Voice/STT messages always bypass the window.
      coalesce_window_ms?: number;
      // When false, the session never invokes its TTS sidecar even if
      // a provider is configured. Chat-tab sessions pass false so typed
      // replies stay silent; voice-mode sessions keep the default.
      speak?: boolean;
    }
  | { type: 'session_close'; session_id: string }
  | { type: 'text_delta'; session_id: string; text: string; final?: boolean }
  | {
      type: 'text_final';
      session_id: string;
      text: string;
      source?: 'user_typed' | 'stt' | 'system';
      attachments?: Attachment[];
    }
  | {
      type: 'audio_chunk_in';
      session_id: string;
      data: string;
      end_of_speech?: boolean;
      sample_rate?: number;
      encoding?: string;
    }
  | { type: 'audio_end_in'; session_id: string }
  | {
      type: 'video_frame';
      session_id: string;
      stream: string;
      data: string;
      width?: number;
      height?: number;
      keyframe?: boolean;
    }
  | {
      type: 'attachment';
      session_id: string;
      kind: 'image' | 'file' | 'voice' | 'video';
      path?: string;
      filename?: string;
      mime_type?: string;
    }
  | {
      type: 'interrupt';
      session_id: string;
      reason?: 'user_speech' | 'user_text' | 'manual';
    };

export type ResourceKind = 'mcp' | 'scheduled_task' | 'workflow' | 'vault' | 'config';
export type ResourceAction = 'created' | 'updated' | 'deleted' | 'changed';

export type ServerMessage =
  | { type: 'auth_ok'; agent_name: string; version: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'status'; text: string; session_id: string }
  // Token-streaming frame for text-mode chat. Clients accumulate each
  // ``text`` chunk into the in-progress assistant bubble; the trailing
  // ``response`` is the canonical record (full text + attachments +
  // model meta) and replaces the streamed buffer. Older clients that
  // don't recognize ``delta`` ignore it and render the final
  // ``response`` like before — backward-compatible.
  | { type: 'delta'; text: string; session_id: string }
  | { type: 'response'; text: string; session_id: string; attachments?: Attachment[]; model?: string }
  // ``session_id`` is set by the gateway when the error originated from
  // a specific session's processing (see _process_message). Older client
  // builds tolerated its absence — keep it optional for back-compat.
  | { type: 'error'; text: string; session_id?: string }
  | { type: 'queued'; position: number }
  | { type: 'command_result'; text: string }
  | { type: 'pong' }
  // Resource-change ping: a list the desktop app might be showing
  // moved on the server. Subscribed stores refetch on receipt.
  | { type: 'resource_event'; resource: ResourceKind; action: ResourceAction; id?: string }
  // Live host telemetry — emitted every ~2s by the gateway when at
  // least one client is connected. The System screen subscribes here
  // and re-renders without polling.
  | { type: 'system_snapshot'; snapshot: SystemSnapshot }
  // Streaming TTS frames for voice-mode replies. ``audio_start`` opens
  // the playback queue, ``audio_chunk`` carries one segment of audio
  // (base64 of MP3 frames by default — see ``mime``), ``audio_end``
  // closes it. The trailing ``response`` event still carries the full
  // text + attachments so non-audio-aware clients render unchanged.
  | { type: 'audio_start'; session_id: string; format: string; voice_id: string; mime: string }
  | { type: 'audio_chunk'; session_id: string; seq: number; data: string }
  | { type: 'audio_end'; session_id: string; total_chunks: number }
  // ── Stream protocol (additive) ──
  // ``turn_complete`` marks the end of one logical assistant turn for
  // batched-channel consumers; realtime clients can ignore it (the
  // ``response`` frame already drives "Thinking…" → "Done"). Backward
  // compat: clients that don't recognise these types ignore them.
  //
  // ``text_final`` echoes a recognised user utterance from streaming
  // STT — voice mode renders it as the user message in the transcript
  // without round-tripping through the legacy REST upload. ``source``
  // distinguishes user-typed (no UI update needed; chat already added
  // it) from STT (server-recognised — UI adds it now).
  | { type: 'turn_complete'; session_id: string }
  | {
      type: 'text_final';
      session_id: string;
      text: string;
      source?: 'user_typed' | 'stt' | 'system';
      attachments?: Attachment[];
    }
  | {
      type: 'video_frame_out';
      session_id: string;
      stream: string;
      data: string;
      width?: number;
      height?: number;
    };

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
  // True while the assistant bubble is being progressively populated
  // by ``delta`` frames. The trailing ``response`` clears the flag and
  // replaces ``text`` with the canonical clean version (strips the
  // attachment markers ``parse_response_markers`` extracted on the
  // server side). Used by MessageList to render a soft caret / cursor.
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText?: string;
}

// ── System telemetry ──

// Mirror of the dict produced by openagent/gateway/api/system.py.
// Cross-platform: same shape on Windows, macOS, Linux. Values from
// psutil are byte counts (memory, disk, network); the UI converts
// to human units. Fields that the host doesn't expose surface as
// 0 or null rather than being omitted, so consumers can render a
// stable layout.
export interface SystemSnapshot {
  timestamp: number;
  host: SystemHost;
  cpu: SystemCpu;
  memory: SystemMemory;
  swap: SystemSwap;
  disks: SystemDisk[];
  network: SystemNetwork;
  processes: SystemProcess[];
}

export interface SystemHost {
  hostname: string;
  platform: string;          // 'Darwin' | 'Linux' | 'Windows'
  os: string;                // human-readable, e.g. 'macOS 15.2', 'Windows 11'
  release: string;
  arch: string;              // 'arm64', 'x86_64', ...
  uptime_seconds: number;
  boot_time: number;         // epoch seconds
  loadavg: [number, number, number];
  users: number;
  python_version: string;
  openagent_version: string;
}

export interface SystemCpu {
  model: string;
  cores_physical: number;
  cores_logical: number;
  freq_mhz: number;
  freq_min_mhz: number;
  freq_max_mhz: number;
  usage_pct: number;
  per_core_pct: number[];
  temp_c: number | null;     // null when sensors unavailable (typical on Windows/macOS)
}

export interface SystemMemory {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  free_bytes: number;
  cached_bytes: number | null;  // Linux-only
  percent: number;
}

export interface SystemSwap {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent: number;
}

export interface SystemDisk {
  mount: string;
  device: string;
  fs: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent: number;
}

export interface SystemNetwork {
  primary_iface: string;
  ipv4: string;
  ipv6: string;
  rx_bytes_total: number;
  tx_bytes_total: number;
  rx_bps: number;            // bytes/sec, computed across snapshots
  tx_bps: number;
  connections: number;
}

export interface SystemProcess {
  pid: number;
  name: string;
  user: string;
  cpu_pct: number;
  rss_bytes: number;
  threads: number;
  status: string;
}

// ── Connection ──
//
// The legacy {host, port, token} shape is gone. Connections are now
// addressed by ``handle@network`` and authenticated via a device cert
// minted by the network's coordinator. The Electron main process runs
// a ``openagent network loopback`` child for each active account; that
// child binds a localhost port that proxies HTTP/WS traffic onto the
// Iroh transport. The renderer keeps using ``fetch`` / ``WebSocket``
// against ``localhost:<sidecarPort>``.
//
// First-time onboarding only needs: a ticket string + (for user-role
// tickets) a chosen handle + a password. Coordinator NodeId, network
// name, network ID, and invite code are all packed into the ticket.

export interface ConnectionConfig {
  name: string;                  // display label (e.g. "Personal")
  network: string;               // network short name (e.g. "homelab")
  handle: string;                // user handle within that network
  agentHandle?: string;          // active agent (default: first registered)
  // Set by the Electron main process after it spawns the loopback
  // sidecar — the renderer never picks this; it just hits the URL.
  sidecarPort?: number;
  isLocal: boolean;              // hint: same-machine vs. remote agent
}

export interface SavedAccount extends ConnectionConfig {
  id: string;          // unique identifier
  createdAt: number;   // epoch ms
}

// Inputs the onboarding screen collects to add a new account. The
// renderer doesn't see coordinator NodeIds or network IDs — those
// come from the ticket and are pinned by the loopback child.
export interface JoinNetworkInput {
  ticket: string;     // pasted oa1… string from `openagent network invite`
  handle: string;     // user-chosen for role=user; ignored for role=device
  password: string;   // PAKE secret, sent over IPC+stdin only
  displayName?: string; // optional friendly label saved on the account row
}

// ── Config ──

// OpenAgent v0.12 vocabulary:
//   - provider row = (name, framework) pair with a surrogate integer id
//   - the same vendor can appear twice (e.g. anthropic+agno and anthropic+claude-cli)
//   - api_key is NULL for claude-cli rows (subscription auth, no API key)
export type ModelFramework = 'agno' | 'claude-cli' | 'litellm';
// ``llm`` covers the existing text-generation rows; ``tts`` covers
// audio synthesis providers (ElevenLabs in v1). The LLM dispatcher
// filters to ``kind='llm'`` so a TTS row never gets handed a turn.
export type ProviderKind = 'llm' | 'tts' | 'stt';

export interface ProviderConfig {
  id: number;
  name: string;
  framework: ModelFramework;
  kind: ProviderKind;
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
  // Capability discriminator. ``llm`` rows go through the SmartRouter;
  // ``tts`` / ``stt`` rows are picked by the audio resolvers and
  // dispatched via LiteLLM.
  kind: ProviderKind;
  runtime_id: string;
  model: string;
  display_name?: string | null;
  input_cost_per_million?: number | null;
  output_cost_per_million?: number | null;
  tier_hint?: string | null;
  enabled: boolean;
  // When true, this row is eligible to act as the SmartRouter's turn-1
  // classifier. Multiple rows may carry the flag — the router picks
  // the first flagged entry in catalog order each turn, so the flag
  // opts a model into the "classifier pool" rather than claiming
  // exclusive ownership.
  is_classifier?: boolean;
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
  // Inferred by ``discovery.py`` from the model id (``tts-1`` → tts,
  // ``whisper-1`` → stt). The Add Model flow forwards this to
  // /api/models so the row lands with the correct ``kind``.
  kind?: ProviderKind;
}

// Source-of-truth yaml fields. Providers, models, MCPs, and scheduled
// tasks are DB-backed and live in SQLite — reach them via their
// dedicated REST endpoints (``/api/providers``, ``/api/models``,
// ``/api/mcps``, ``/api/scheduled-tasks``), not through this shape.
export interface AgentConfig {
  name?: string;
  system_prompt?: string;
  dream_mode?: { enabled: boolean; time: string };
  // Weekly self-review built-in. Cron defaults to "0 9 * * MON" — the
  // settings panel can override it; toggle ``enabled`` to suppress
  // the scheduled run without removing the row from the database.
  manager_review?: { enabled: boolean; cron: string };
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

// ── Workflows (n8n-style multi-block pipelines) ──

// A workflow is a DAG of blocks (nodes) connected by edges. The
// ``graph`` payload round-trips through the AI's workflow-manager
// MCP, the REST API, and the React-Flow / SVG editor unchanged.
//
// Triggering is declared *inside the graph* via trigger-* blocks
// (trigger-manual, trigger-schedule, trigger-ai). A workflow has no
// row-level trigger field — any workflow can be fired manually, by
// the AI, or on a schedule at any time, depending on what blocks it
// carries. Multiple trigger-schedule blocks fire independently.

export type WorkflowRunStatus = 'running' | 'success' | 'failed' | 'cancelled';

export type BlockCategory = 'triggers' | 'ai' | 'tools' | 'flow' | 'utility';

export type BlockType =
  | 'trigger-manual'
  | 'trigger-schedule'
  | 'trigger-ai'
  | 'mcp-tool'
  | 'ai-prompt'
  | 'if'
  | 'loop'
  | 'wait'
  | 'parallel'
  | 'merge'
  | 'set-variable'
  | 'http-request';

export interface WorkflowNode {
  id: string;
  type: BlockType;
  label?: string;
  position: { x: number; y: number };
  // Per-block config. Shape depends on ``type`` — see BlockTypeSpec.config_schema.
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;  // 'out' by default; 'true'|'false' for if, etc.
  targetHandle?: string;  // 'in' by default
  label?: string | null;
}

export interface WorkflowGraph {
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
}

// One schedule per ``trigger-schedule`` block, keyed by node_id. The
// scheduler loop polls this shape; the UI's list row + history drawer
// surface ``next_run_at_iso`` / ``last_run_at_iso``.
export interface WorkflowSchedule {
  id: string;
  workflow_id: string;
  node_id: string;
  cron_expression: string;
  next_run_at: number;
  last_run_at: number | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
  next_run_at_iso?: string | null;
  last_run_at_iso?: string | null;
  created_at_iso?: string;
  updated_at_iso?: string;
}

export interface WorkflowTask {
  id: string;
  name: string;
  description?: string | null;
  graph: WorkflowGraph;
  enabled: boolean;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  last_run_at_iso?: string | null;
  created_at_iso?: string;
  updated_at_iso?: string;
  // Derived server-side from graph nodes — e.g. ``['trigger-manual',
  // 'trigger-schedule']`` when the workflow carries both kinds. Used
  // by the list badge + AI's ``has_trigger_type`` filter.
  trigger_types: string[];
  // Per-block schedule state (one row per ``trigger-schedule`` block).
  schedules: WorkflowSchedule[];
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  variables?: Record<string, unknown>;
}

export type UpdateWorkflowInput = Partial<{
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  enabled: boolean;
}>;

// Per-block trace entry appended to workflow_runs.trace_json after
// each block finishes. Shared between the UI's RunHistoryDrawer and
// the workflow-manager MCP's get_workflow_run tool.
export interface WorkflowTraceEntry {
  node_id: string;
  type: BlockType;
  started_at: number;
  finished_at: number | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger: 'manual' | 'schedule' | 'ai' | 'api';
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error: string | null;
  trace: WorkflowTraceEntry[];
  started_at_iso?: string;
  finished_at_iso?: string | null;
}

// Block type catalog — one entry per BlockType. Served by
// ``GET /api/workflow-block-types`` and consumed by the editor's
// palette + properties panel.
export interface BlockTypeFieldSpec {
  type: 'string' | 'integer' | 'number' | 'object' | 'array' | 'boolean';
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
  items?: BlockTypeFieldSpec;
}

export interface BlockTypeSpec {
  type: BlockType;
  category: BlockCategory;
  description: string;
  config_schema: Record<string, BlockTypeFieldSpec>;
  source_handles: string[];
  target_handles: string[];
  output_shape: string;
}

// One MCP + its tools as seen by the editor's tool picker. Served by
// ``GET /api/mcp-tools``.
export interface MCPToolParameter {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
}

export interface MCPToolDescriptor {
  name: string;
  description?: string;
  parameters_schema?: Record<string, unknown>;
}

export interface MCPToolkitDescriptor {
  mcp_name: string;
  tools: MCPToolDescriptor[];
}

// Stats surface for RunHistoryDrawer + list row sparklines.
export interface WorkflowRunSummary {
  id: string;
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
  duration_s: number | null;
  started_at_iso?: string | null;
  finished_at_iso?: string | null;
}

export interface WorkflowStats {
  total_runs: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  running_count: number;
  success_rate: number;
  avg_duration_s: number | null;
  last: WorkflowRunSummary[];
}
