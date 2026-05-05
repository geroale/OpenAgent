/**
 * In-process loopback supervisor: brings up an iroh node, registers/logs
 * in to the coordinator, and exposes a localhost port the renderer hits
 * with plain HTTP/WS.
 *
 * Replaces the previous subprocess model (spawning ``openagent network
 * loopback``) with a native TS implementation. The renderer-facing IPC
 * shape is unchanged: the renderer still calls ``loopback:start`` /
 * ``loopback:stop`` and gets a port back.
 */
import { ipcMain } from 'electron';
import {
  startNativeLoopback,
  type RunningLoopback,
  type StartLoopbackArgs as NativeStartArgs,
} from '../network/start.js';

interface LoopbackHandle {
  id: string;
  loopback: RunningLoopback;
  startedAt: number;
}

const handles = new Map<string, LoopbackHandle>();

export interface StartLoopbackArgs {
  accountId: string;
  password: string;
  agent?: string;
  ticket?: string;
  handle?: string;
  network?: string;
}

export async function startLoopback(args: StartLoopbackArgs): Promise<number> {
  const existing = handles.get(args.accountId);
  if (existing) {
    return existing.loopback.port;
  }

  const nativeArgs: NativeStartArgs = {
    password: args.password,
    ticket: args.ticket,
    handle: args.handle,
    network: args.network,
    agent: args.agent,
  };

  const loopback = await startNativeLoopback(nativeArgs);
  handles.set(args.accountId, {
    id: args.accountId,
    loopback,
    startedAt: Date.now(),
  });
  return loopback.port;
}

export async function stopLoopback(accountId: string): Promise<void> {
  const h = handles.get(accountId);
  if (!h) return;
  handles.delete(accountId);
  try {
    await h.loopback.stop();
  } catch (err) {
    console.warn(`[loopback ${accountId}] stop error:`, err);
  }
}

export async function stopAllLoopbacks(): Promise<void> {
  const ids = Array.from(handles.keys());
  await Promise.all(ids.map((id) => stopLoopback(id)));
}

export function registerLoopbackHandlers(): void {
  ipcMain.handle('loopback:start', async (_event, raw: unknown) => {
    const args = raw as StartLoopbackArgs;
    if (!args || typeof args.accountId !== 'string' || typeof args.password !== 'string') {
      throw new Error('loopback:start: accountId + password are required');
    }
    const hasTicket = typeof args.ticket === 'string' && args.ticket.length > 0;
    const hasHandleNet =
      typeof args.handle === 'string' && args.handle.length > 0 &&
      typeof args.network === 'string' && args.network.length > 0;
    if (!hasTicket && !hasHandleNet) {
      throw new Error('loopback:start: pass either ticket, or handle + network');
    }
    for (const k of ['ticket', 'handle', 'network', 'agent'] as const) {
      const v = (args as unknown as Record<string, unknown>)[k];
      if (v !== undefined && typeof v !== 'string') {
        throw new Error(`loopback:start: ${k} must be a string when present`);
      }
    }
    return await startLoopback(args);
  });

  ipcMain.handle('loopback:stop', async (_event, raw: unknown) => {
    const args = raw as { accountId: string };
    if (!args || typeof args.accountId !== 'string') {
      throw new Error('loopback:stop: accountId required');
    }
    await stopLoopback(args.accountId);
  });
}
