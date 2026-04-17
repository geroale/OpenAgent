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

// ── Provider API ──

export async function getProviders(): Promise<Record<string, ProviderConfig>> {
  const data = await get<{ providers: Record<string, ProviderConfig> }>('/api/providers');
  return data.providers;
}

export async function testProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${baseUrl}/api/providers/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  return res.json();
}

// ── Models API (all via config PATCH — works on any agent version) ──

export async function getModels(): Promise<ModelsResponse> {
  const cfg = await getConfig();
  return { models: cfg.providers || {}, active: cfg.model || {} as ModelConfig };
}

export async function addModel(
  name: string, config: { api_key?: string; base_url?: string },
): Promise<{ ok: boolean }> {
  const cfg = await getConfig();
  const providers = cfg.providers || {};
  providers[name] = config;
  return updateConfigSection('providers', providers) as any;
}

export async function updateModel(
  name: string, config: Record<string, any>,
): Promise<{ ok: boolean }> {
  const cfg = await getConfig();
  const providers = { ...(cfg.providers || {}) };
  providers[name] = { ...providers[name], ...config };
  return updateConfigSection('providers', providers) as any;
}

export async function deleteModel(name: string): Promise<void> {
  const cfg = await getConfig();
  const providers = { ...(cfg.providers || {}) };
  delete providers[name];
  await updateConfigSection('providers', providers);
}

export async function testModel(
  name: string, _modelId?: string,
): Promise<{ ok: boolean; error?: string }> {
  // Test by trying the providers/test endpoint, fall back to a no-op success
  try {
    return await post(`/api/providers/test`, { provider: name, model_id: _modelId });
  } catch {
    return { ok: false, error: 'Test not available — restart the agent with the latest version' };
  }
}

export async function setActiveModel(model: ModelConfig): Promise<{ ok: boolean }> {
  return updateConfigSection('model', model) as any;
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

// ── DB-backed Model catalog (maps to /api/models/db) ──
//
// These replace the per-provider ``models:`` arrays in yaml. Available
// models (what a provider actually exposes for a given API key) live at
// /api/models/available?provider=X.

export async function listDbModels(opts?: { provider?: string; enabledOnly?: boolean }): Promise<ModelEntry[]> {
  const params = new URLSearchParams();
  if (opts?.provider) params.set('provider', opts.provider);
  if (opts?.enabledOnly) params.set('enabled_only', '1');
  const qs = params.toString();
  const data = await get<{ models: ModelEntry[] }>(`/api/models/db${qs ? `?${qs}` : ''}`);
  return data.models;
}

export async function createDbModel(entry: {
  provider: string;
  model_id: string;
  display_name?: string;
  input_cost_per_million?: number;
  output_cost_per_million?: number;
  tier_hint?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>('/api/models/db', entry);
  return data.model;
}

export async function updateDbModel(runtimeId: string, patchBody: Partial<ModelEntry>): Promise<ModelEntry> {
  const data = await put<{ model: ModelEntry }>(`/api/models/db/${encodeURIComponent(runtimeId)}`, patchBody);
  return data.model;
}

export async function deleteDbModel(runtimeId: string): Promise<void> {
  await del(`/api/models/db/${encodeURIComponent(runtimeId)}`);
}

export async function enableDbModel(runtimeId: string): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>(`/api/models/db/${encodeURIComponent(runtimeId)}/enable`, {});
  return data.model;
}

export async function disableDbModel(runtimeId: string): Promise<ModelEntry> {
  const data = await post<{ model: ModelEntry }>(`/api/models/db/${encodeURIComponent(runtimeId)}/disable`, {});
  return data.model;
}

export async function listAvailableModels(provider: string): Promise<AvailableModel[]> {
  const data = await get<{ provider: string; models: AvailableModel[] }>(
    `/api/models/available?provider=${encodeURIComponent(provider)}`,
  );
  return data.models;
}
