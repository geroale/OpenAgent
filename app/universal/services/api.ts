/**
 * REST API client for OpenAgent vault operations.
 */

import type {
  VaultNote, GraphData, AgentConfig, ProviderConfig, ModelsResponse,
  UsageData, ModelCatalogEntry, DailyUsageEntry, ScheduledTask,
  CreateScheduledTaskInput, UpdateScheduledTaskInput, MCPEntry,
  ModelEntry, AvailableModel,
  WorkflowTask, CreateWorkflowInput, UpdateWorkflowInput, WorkflowRun,
  WorkflowStats, BlockTypeSpec, MCPToolkitDescriptor,
  SystemSnapshot,
} from '../../common/types';

let baseUrl = '';

export function setBaseUrl(host: string, port: number) {
  baseUrl = `http://${host}:${port}`;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function put<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: object = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
}

async function patch<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Vault API ──

export async function listNotes(): Promise<VaultNote[]> {
  const data = await get<{ notes: VaultNote[] }>('/api/vault/notes');
  return data.notes;
}

export async function readNote(path: string): Promise<{
  path: string;
  content: string;
  frontmatter: Record<string, any>;
  body: string;
  links: string[];
  modified: number;
}> {
  return get(`/api/vault/notes/${path.split('/').map(encodeURIComponent).join('/')}`);
}

export async function writeNote(path: string, content: string): Promise<void> {
  await put(`/api/vault/notes/${path.split('/').map(encodeURIComponent).join('/')}`, { content });
}

export async function deleteNote(path: string): Promise<void> {
  await del(`/api/vault/notes/${path.split('/').map(encodeURIComponent).join('/')}`);
}

export async function searchNotes(query: string): Promise<VaultNote[]> {
  const data = await get<{ results: VaultNote[] }>(
    `/api/vault/search?q=${encodeURIComponent(query)}`
  );
  return data.results;
}

export async function getGraph(): Promise<GraphData> {
  return get<GraphData>('/api/vault/graph');
}

// ── Scheduled Tasks API ──

export async function getScheduledTasks(enabledOnly: boolean = false): Promise<ScheduledTask[]> {
  const q = enabledOnly ? '?enabled_only=true' : '';
  const data = await get<{ tasks: ScheduledTask[] }>(`/api/scheduled-tasks${q}`);
  return data.tasks;
}

export async function createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  return post<ScheduledTask>('/api/scheduled-tasks', input);
}

export async function updateScheduledTask(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
  return patch<ScheduledTask>(`/api/scheduled-tasks/${encodeURIComponent(id)}`, input);
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await del(`/api/scheduled-tasks/${encodeURIComponent(id)}`);
}

// ── Workflows API ──

export async function getWorkflows(
  opts: { enabledOnly?: boolean; hasTriggerType?: string } = {}
): Promise<WorkflowTask[]> {
  const params = new URLSearchParams();
  if (opts.enabledOnly) params.set('enabled_only', 'true');
  if (opts.hasTriggerType) params.set('has_trigger_type', opts.hasTriggerType);
  const qs = params.toString();
  const data = await get<{ workflows: WorkflowTask[] }>(
    `/api/workflows${qs ? `?${qs}` : ''}`
  );
  return data.workflows;
}

export async function getWorkflow(id: string): Promise<WorkflowTask> {
  return get<WorkflowTask>(`/api/workflows/${encodeURIComponent(id)}`);
}

export async function createWorkflow(
  input: CreateWorkflowInput
): Promise<WorkflowTask> {
  return post<WorkflowTask>('/api/workflows', input);
}

export async function updateWorkflow(
  id: string,
  input: UpdateWorkflowInput
): Promise<WorkflowTask> {
  return patch<WorkflowTask>(`/api/workflows/${encodeURIComponent(id)}`, input);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await del(`/api/workflows/${encodeURIComponent(id)}`);
}

// Trigger a run. When wait=true the server blocks until the run
// finishes and returns the full WorkflowRun with trace; when wait=false
// it returns {run_id, status:'running'} as soon as the executor has
// inserted the row.
export async function runWorkflow(
  id: string,
  opts: { inputs?: Record<string, unknown>; wait?: boolean; timeoutS?: number } = {}
): Promise<WorkflowRun | { run_id: string | null; status: string }> {
  return post(`/api/workflows/${encodeURIComponent(id)}/run`, {
    inputs: opts.inputs,
    wait: opts.wait ?? true,
    timeout_s: opts.timeoutS,
  });
}

export async function getWorkflowRuns(
  id: string,
  opts: { limit?: number; status?: string } = {}
): Promise<WorkflowRun[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  const data = await get<{ runs: WorkflowRun[] }>(
    `/api/workflows/${encodeURIComponent(id)}/runs${qs ? `?${qs}` : ''}`
  );
  return data.runs;
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  return get<WorkflowRun>(`/api/workflow-runs/${encodeURIComponent(runId)}`);
}

export async function getWorkflowStats(
  id: string,
  opts: { last?: number } = {},
): Promise<WorkflowStats> {
  const qs = opts.last ? `?last=${opts.last}` : '';
  return get<WorkflowStats>(
    `/api/workflows/${encodeURIComponent(id)}/stats${qs}`,
  );
}

export async function getWorkflowBlockTypes(): Promise<BlockTypeSpec[]> {
  const data = await get<{ block_types: BlockTypeSpec[] }>(
    '/api/workflow-block-types'
  );
  return data.block_types;
}

export async function getMcpTools(): Promise<MCPToolkitDescriptor[]> {
  const data = await get<{ mcps: MCPToolkitDescriptor[] }>('/api/mcp-tools');
  return data.mcps;
}

export interface CronDescribeResponse {
  expression: string;
  valid: boolean;
  one_shot?: boolean;
  upcoming?: Array<{ epoch: number; iso: string }>;
  error?: string;
}

export async function describeCron(
  expression: string,
  count: number = 3,
): Promise<CronDescribeResponse> {
  const qs = `expression=${encodeURIComponent(expression)}&count=${count}`;
  try {
    return await get<CronDescribeResponse>(`/api/cron/describe?${qs}`);
  } catch (e: any) {
    // The gateway returns 400 with a JSON body describing the
    // validation failure — re-shape that here so callers get a
    // uniform ``{valid, error}`` payload without having to inspect
    // HTTP status codes.
    const msg = e?.message ?? String(e);
    const match = /API \d+: (.+)$/.exec(msg);
    if (match) {
      try {
        const body = JSON.parse(match[1]);
        return {
          expression,
          valid: false,
          error: body.error || msg,
        };
      } catch {
        // fall through
      }
    }
    return { expression, valid: false, error: msg };
  }
}

// ── File Upload ──

export async function uploadFile(
  file: File | Blob,
  filename = 'upload',
  opts?: { language?: string },
): Promise<{
  path: string;
  filename: string;
  transcription?: string;
  // Set by /api/upload when the file is audio. The chat screen flips
  // ``input_was_voice`` on the WS message so the gateway returns a
  // spoken reply (mirror modality).
  transcribed_from_voice?: boolean;
}> {
  const form = new FormData();
  if (file instanceof File) {
    form.append('file', file);
  } else {
    form.append('file', file, filename);
  }
  // ``lang`` (ISO-639-1) hints the STT backend; empty means auto-detect.
  const qs = opts?.language ? `?lang=${encodeURIComponent(opts.language)}` : '';
  const res = await fetch(`${baseUrl}/api/upload${qs}`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

// ── File Download (agent → client) ──

/**
 * URL of the ``/api/files`` endpoint for a given server-side path.
 * Used when the agent returns an attachment in a ``response`` message
 * and the client needs to fetch it (remote install) or just link to
 * it (desktop w/ local gateway).
 *
 * Auth is enforced by the loopback sidecar's Iroh transport — the
 * URL doesn't need a token query param. The legacy ``token`` argument
 * is preserved for callers that still pass it; it's ignored.
 */
export function fileUrl(path: string, _token?: string): string {
  const params = new URLSearchParams({ path });
  return `${baseUrl}/api/files?${params.toString()}`;
}

/**
 * Fetch a file off the agent server and trigger a browser download.
 * Works on web + in the Electron webview. On pure-native mobile this
 * would need Expo FileSystem — not used today since the desktop app
 * is the primary target.
 */
export async function downloadFile(path: string, filename: string, _token?: string): Promise<void> {
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a beat to initiate the save dialog before we
  // revoke the ObjectURL — immediate revoke races on Firefox.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// ── Config API ──

export async function getConfig(): Promise<AgentConfig> {
  return get<AgentConfig>('/api/config');
}

export async function updateConfig(config: AgentConfig): Promise<{ ok: boolean }> {
  return put<{ ok: boolean }>('/api/config', config);
}

export async function updateConfigSection(
  section: string,
  data: any,
): Promise<{ ok: boolean; restart_required: boolean }> {
  const res = await fetch(`${baseUrl}/api/config/${section}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Control API ──

export async function triggerUpdate(): Promise<{ updated: boolean; version?: string; old?: string; new?: string }> {
  const res = await fetch(`${baseUrl}/api/update`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function triggerRestart(): Promise<{ ok: boolean }> {
  const res = await fetch(`${baseUrl}/api/restart`, { method: 'POST' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Providers API (DB-backed) ──
//
// Provider keys live in the SQLite ``providers`` table. The
// addModel/updateModel/deleteModel helpers below target the DB-backed
// ``/api/models/db`` endpoints.

export async function getProviders(): Promise<ProviderConfig[]> {
  const data = await get<{ providers: ProviderConfig[] }>('/api/providers');
  return data.providers;
}

export async function testProvider(
  providerId: number, model?: string,
): Promise<{ ok: boolean; error?: string; model?: string; response?: string }> {
  try {
    return await post(`/api/providers/${providerId}/test`, { model });
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function addProvider(body: {
  name: string;
  framework: 'agno' | 'claude-cli' | 'litellm';
  api_key?: string;
  base_url?: string;
  // ``kind`` defaults server-side to ``'llm'``. Audio providers (TTS
  // / STT) pass ``'tts'`` or ``'stt'`` so the LLM dispatcher skips them
  // and the audio modules route via LiteLLM.
  kind?: 'llm' | 'tts' | 'stt';
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; provider: ProviderConfig }> {
  return post('/api/providers', body);
}

export async function updateProvider(
  providerId: number, body: { api_key?: string; base_url?: string; enabled?: boolean },
): Promise<{ ok: boolean; provider: ProviderConfig }> {
  return put(`/api/providers/${providerId}`, body);
}

export async function deleteProvider(providerId: number): Promise<void> {
  await del(`/api/providers/${providerId}`);
}

export async function getModels(): Promise<ModelsResponse> {
  const providers = await getProviders();
  return { models: providers };
}

// ── Usage API ──

export async function getUsage(): Promise<UsageData> {
  return get<UsageData>('/api/usage');
}

export async function getDailyUsage(days: number = 7): Promise<DailyUsageEntry[]> {
  const data = await get<{ entries: DailyUsageEntry[] }>(`/api/usage/daily?days=${days}`);
  return data.entries;
}

export async function getModelPricing(): Promise<Record<string, { input: number; output: number }>> {
  const data = await get<{ pricing: Record<string, { input_cost_per_million: number; output_cost_per_million: number }> }>('/api/usage/pricing');
  const result: Record<string, { input: number; output: number }> = {};
  for (const [k, v] of Object.entries(data.pricing)) {
    result[k] = { input: v.input_cost_per_million, output: v.output_cost_per_million };
  }
  return result;
}

// ── Model Catalog API ──

export async function getModelCatalog(provider?: string): Promise<ModelCatalogEntry[]> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  const data = await get<{ models: ModelCatalogEntry[] }>(`/api/models/catalog${q}`);
  return data.models;
}

export async function getAvailableProviders(): Promise<string[]> {
  const data = await get<{ providers: string[] }>('/api/models/providers');
  return data.providers;
}

// ── DB-backed MCP registry (maps to /api/mcps) ──
//
// These replace the yaml-based MCP editor. The DB is the source of truth;
// writes trigger a pool hot-reload on the next message so the new server
// is live without a process restart.

export async function listMcps(): Promise<MCPEntry[]> {
  const data = await get<{ mcps: MCPEntry[] }>('/api/mcps');
  return data.mcps;
}

export async function getMcp(name: string): Promise<MCPEntry> {
  const data = await get<{ mcp: MCPEntry }>(`/api/mcps/${encodeURIComponent(name)}`);
  return data.mcp;
}

export async function createMcp(entry: Partial<MCPEntry> & { name: string }): Promise<MCPEntry> {
  const data = await post<{ mcp: MCPEntry }>('/api/mcps', entry);
  return data.mcp;
}

export async function updateMcp(name: string, patchBody: Partial<MCPEntry>): Promise<MCPEntry> {
  const data = await put<{ mcp: MCPEntry }>(`/api/mcps/${encodeURIComponent(name)}`, patchBody);
  return data.mcp;
}

export async function deleteMcp(name: string): Promise<void> {
  await del(`/api/mcps/${encodeURIComponent(name)}`);
}

export async function enableMcp(name: string): Promise<MCPEntry> {
  const data = await post<{ mcp: MCPEntry }>(`/api/mcps/${encodeURIComponent(name)}/enable`, {});
  return data.mcp;
}

export async function disableMcp(name: string): Promise<MCPEntry> {
  const data = await post<{ mcp: MCPEntry }>(`/api/mcps/${encodeURIComponent(name)}/disable`, {});
  return data.mcp;
}

// ── MCP Marketplace (registry.modelcontextprotocol.io via gateway proxy) ──
//
// Search hits a 5-min in-memory cache on the gateway; detail hits a 1-hr
// cache (server.json is immutable per version). Install writes the row
// straight to the same ``mcps`` table the manual "Add MCP" form uses, so
// the pool's hot-reload picks it up on the next message.

export type MarketplaceCard = {
  name: string;
  version?: string;
  title?: string;
  description?: string;
  status?: string;
  _meta?: Record<string, unknown>;
};

export type MarketplaceField = {
  name: string;
  isSecret: boolean;
  isRequired: boolean;
  description?: string;
  default?: string;
  value_template?: string;
};

export type MarketplacePlaceholder = {
  token: string;
  description?: string;
};

export type MarketplacePackage = {
  index: number;
  runtime: string;
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: string;
  env_required: MarketplaceField[];
  placeholders: MarketplacePlaceholder[];
  supported: boolean;
};

export type MarketplaceRemote = {
  index: number;
  url?: string;
  transport?: string;
  header_required: MarketplaceField[];
  placeholders: MarketplacePlaceholder[];
};

export type MarketplaceRequirements = {
  packages: MarketplacePackage[];
  remotes: MarketplaceRemote[];
};

export type MarketplaceSearchResult = {
  servers: MarketplaceCard[];
  nextCursor?: string;
  count?: number;
};

export type MarketplaceServerDetail = {
  server: any;
  _meta?: Record<string, unknown>;
  requirements: MarketplaceRequirements;
};

export type MarketplaceInstallChoice = { kind: 'package' | 'remote'; index: number };

export type MarketplaceInstallPayload = {
  name: string;
  version?: string;
  choice: MarketplaceInstallChoice;
  install_name?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  placeholders?: Record<string, string>;
};

export type MarketplaceInstallError = {
  status: number;
  error: string;
  suggested_name?: string;
};

export async function searchMcpMarketplace(
  q: string,
  cursor?: string,
  limit?: number,
): Promise<MarketplaceSearchResult> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return await get<MarketplaceSearchResult>(`/api/marketplace/search${qs ? `?${qs}` : ''}`);
}

export async function getMarketplaceServer(
  name: string,
  version: string = 'latest',
): Promise<MarketplaceServerDetail> {
  const params = new URLSearchParams({ name, version });
  return await get<MarketplaceServerDetail>(`/api/marketplace/servers?${params.toString()}`);
}

/**
 * Install an MCP from the marketplace. Returns the new MCPEntry on success.
 *
 * On 409 (name collision) the gateway returns ``{error, suggested_name}``;
 * we surface that as a typed ``MarketplaceInstallError`` thrown from this
 * function so the caller can offer the suggestion inline.
 */
export async function installFromMarketplace(
  payload: MarketplaceInstallPayload,
): Promise<MCPEntry> {
  const res = await fetch(`${baseUrl}/api/marketplace/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err: MarketplaceInstallError = {
      status: res.status,
      error: (body && body.error) || text || `HTTP ${res.status}`,
      suggested_name: body && body.suggested_name,
    };
    throw err;
  }
  return (body as { mcp: MCPEntry }).mcp;
}

// ── DB-backed Model catalog (/api/models) ──
//
// Each row is a (provider_id, model) pair under a provider row. The
// response carries the enriched provider_name + framework + derived
// runtime_id so the UI doesn't have to re-join.
//
// Available models (what a vendor actually exposes for a given API
// key) live at /api/models/available?provider_id=N.

export async function listDbModels(opts?: {
  providerId?: number;
  framework?: 'agno' | 'claude-cli';
  enabledOnly?: boolean;
}): Promise<ModelEntry[]> {
  const params = new URLSearchParams();
  if (opts?.providerId) params.set('provider_id', String(opts.providerId));
  if (opts?.framework) params.set('framework', opts.framework);
  if (opts?.enabledOnly) params.set('enabled_only', '1');
  const qs = params.toString();
  const data = await get<{ models: ModelEntry[] }>(`/api/models${qs ? `?${qs}` : ''}`);
  return data.models;
}

export async function createDbModel(entry: {
  provider_id: number;
  model: string;
  display_name?: string;
  tier_hint?: string;
  enabled?: boolean;
  is_classifier?: boolean;
  metadata?: Record<string, unknown>;
  // ``llm`` (default) goes to the SmartRouter; ``tts`` / ``stt`` rows
  // are picked by the audio resolvers and dispatched via LiteLLM.
  kind?: 'llm' | 'tts' | 'stt';
}): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>('/api/models', entry);
  return data.model;
}

// Opt this model into the SmartRouter classifier pool. Multiple rows
// may carry the flag at once — the router picks the first flagged
// entry in catalog order each turn. Narrow PUT that only touches this
// row; other flags stay intact.
export async function setClassifierModel(modelId: number): Promise<ModelEntry> {
  return updateDbModel(modelId, { is_classifier: true });
}

export async function unsetClassifierModel(modelId: number): Promise<ModelEntry> {
  return updateDbModel(modelId, { is_classifier: false });
}

export async function updateDbModel(modelId: number, patchBody: Partial<ModelEntry>): Promise<ModelEntry> {
  const data = await put<{ model: ModelEntry }>(`/api/models/${modelId}`, patchBody);
  return data.model;
}

export async function deleteDbModel(modelId: number): Promise<void> {
  await del(`/api/models/${modelId}`);
}

export async function enableDbModel(modelId: number): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>(`/api/models/${modelId}/enable`, {});
  return data.model;
}

export async function disableDbModel(modelId: number): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>(`/api/models/${modelId}/disable`, {});
  return data.model;
}

export async function listAvailableModels(providerId: number): Promise<AvailableModel[]> {
  const data = await get<{ provider_id: number; provider: string; framework: string; models: AvailableModel[] }>(
    `/api/models/available?provider_id=${providerId}`,
  );
  return data.models;
}

// ── System telemetry ──

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  return get<SystemSnapshot>('/api/system');
}
