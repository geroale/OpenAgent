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

/** Hard cap on the whole sidecar bring-up: iroh dial + SRP login +
 *  list_agents + proxy bind. iroh-js exposes no AbortSignal, so we can't
 *  cancel the inner promise — when the timeout fires we let it run, but
 *  attach a teardown so any partial RunningLoopback that resolves later
 *  gets cleaned up rather than leaked. Was: hung indefinitely when iroh
 *  discovery couldn't reach the coordinator (common in DMG builds where
 *  macOS Local Network access is blocked). */
const STARTUP_TIMEOUT_MS = 30_000;

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

  const startPromise = startNativeLoopback(nativeArgs);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`loopback startup timed out after ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);
  });

  // If the native loopback eventually succeeds AFTER we've timed out, tear
  // it down so the iroh node + proxy don't leak.
  startPromise.then(
    (lb) => {
      if (timedOut) {
        lb.stop().catch(() => { /* ignore */ });
      }
    },
    () => { /* error surfaces through Promise.race below */ },
  );

  let loopback: RunningLoopback;
  try {
    loopback = await Promise.race([startPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle);
  }

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
