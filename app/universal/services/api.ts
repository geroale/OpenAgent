/**
 * REST API client for OpenAgent vault operations.
 */

import type { VaultNote, GraphData, AgentConfig, ModelConfig, ProviderConfig, ModelsResponse, UsageData, ModelCatalogEntry, DailyUsageEntry, ScheduledTask, CreateScheduledTaskInput, UpdateScheduledTaskInput, MCPEntry, ModelEntry, AvailableModel } from '../../common/types';

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

// ── File Upload ──

export async function uploadFile(file: File): Promise<{ path: string; filename: string; transcription?: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
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
 * The gateway token, if configured, is passed via ``?token=`` so the
 * URL works in plain browser anchors / `<img src>` / webviews that
 * can't set custom headers.
 */
export function fileUrl(path: string, token?: string): string {
  const params = new URLSearchParams({ path });
  if (token) params.set('token', token);
  return `${baseUrl}/api/files?${params.toString()}`;
}

/**
 * Fetch a file off the agent server and trigger a browser download.
 * Works on web + in the Electron webview. On pure-native mobile this
 * would need Expo FileSystem — not used today since the desktop app
 * is the primary target.
 */
export async function downloadFile(path: string, filename: string, token?: string): Promise<void> {
  const res = await fetch(fileUrl(path, token));
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
  framework: 'agno' | 'claude-cli';
  api_key?: string;
  base_url?: string;
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
  const [providers, activeRes] = await Promise.all([
    getProviders(),
    get<{ active: ModelConfig }>('/api/models/active').catch(() => ({ active: {} as ModelConfig })),
  ]);
  return { models: providers, active: activeRes.active };
}

export async function setActiveModel(model: ModelConfig): Promise<{ ok: boolean }> {
  return put('/api/models/active', model);
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
  metadata?: Record<string, unknown>;
}): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>('/api/models', entry);
  return data.model;
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
