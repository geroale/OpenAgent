/**
 * REST API client for OpenAgent vault operations.
 */

import type { VaultNote, GraphData, AgentConfig } from '../../common/types';

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

async function del(path: string): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
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

// ── File Upload ──

export async function uploadFile(file: File): Promise<{ path: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
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
