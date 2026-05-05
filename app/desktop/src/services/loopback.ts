/**
 * Loopback supervisor: spawns ``openagent network loopback`` and exposes
 * the bound localhost port to the renderer.
 *
 * One supervisor per active account. The renderer talks to the gateway
 * through ``http://127.0.0.1:<port>`` / ``ws://127.0.0.1:<port>/ws``;
 * the child process tunnels traffic onto the Iroh transport with the
 * device cert minted at login.
 *
 * The renderer never sees iroh — it keeps using ``fetch`` and
 * ``WebSocket`` exactly like before, just against ``localhost``.
 */

import { spawn, ChildProcess } from 'child_process';
import { app, ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface LoopbackHandle {
  id: string;             // account UUID — same key the renderer uses
  child: ChildProcess;
  port: number;
  startedAt: number;
}

const handles = new Map<string, LoopbackHandle>();

/**
 * Find the openagent CLI executable.
 *
 * In dev: the CLI is on PATH (the user installed openagent-framework
 * from pip). In packaged builds we ship a frozen binary alongside the
 * Electron app and resolve it relative to the bundle.
 */
function resolveOpenagentBinary(): string {
  // The frozen-binary path lives next to the app's resources/ dir;
  // ``app.getAppPath()`` plus a known relative path is what we'd use
  // in production. For dev we fall back to PATH.
  const candidates: string[] = [];

  if (process.env.OPENAGENT_BINARY) {
    candidates.push(process.env.OPENAGENT_BINARY);
  }

  const isWin = process.platform === 'win32';
  const exe = isWin ? 'openagent.exe' : 'openagent';

  // Bundled (production) — beside the Electron resources dir.
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
    candidates.push(path.join(process.resourcesPath, exe));
  }

  // Dev mode: prefer the repo's editable venv install over a stale
  // ``~/.local/bin/openagent`` PyInstaller binary that may be on PATH
  // but predate the iroh ``network`` group. ``app.getAppPath()`` in dev
  // resolves to ``OpenAgent/app/desktop``; the venv sits two levels up.
  if (!app.isPackaged) {
    const appPath = app.getAppPath();
    const venvBin = isWin ? path.join('Scripts', exe) : path.join('bin', exe);
    candidates.push(path.join(appPath, '..', '..', '.venv', venvBin));
    candidates.push(path.join(appPath, '..', '..', 'venv', venvBin));
  }

  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) {
        return c;
      }
    } catch {
      // ignore
    }
  }
  // Fallback: PATH lookup. ``spawn`` resolves bare names against the
  // user's PATH so this works in the typical "developer installed
  // openagent-framework via pip" case.
  return 'openagent';
}

/** Wait for the child to print one line on stdout (the port number). */
function readFirstLine(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let stderrBuffer = '';
    const timer = setTimeout(() => {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onErr);
      reject(new Error(`loopback startup timed out after ${timeoutMs}ms; stderr: ${stderrBuffer.slice(-512)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx >= 0) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onErr);
        resolve(buffer.slice(0, newlineIdx).trim());
      }
    };
    const onErr = (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf-8');
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onErr);
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onErr);
      reject(new Error(`loopback exited before printing port (code=${code}); stderr: ${stderrBuffer.slice(-512)}`));
    });
  });
}

export interface StartLoopbackArgs {
  accountId: string;
  password: string;        // never logged; piped via stdin
  agent?: string;          // specific agent handle within the network

  // The CLI accepts either a ticket OR a saved handle@network. The
  // renderer picks one form and passes it through; the loopback child
  // does the rest. First-time joins use ``ticket`` (+ ``handle`` when
  // the ticket is role=user); re-logins use ``handle`` + ``network``.
  ticket?: string;
  handle?: string;
  network?: string;
}

export async function startLoopback(args: StartLoopbackArgs): Promise<number> {
  // If we already have one for this account, reuse it.
  const existing = handles.get(args.accountId);
  if (existing && !existing.child.killed) {
    return existing.port;
  }

  const target = args.ticket
    ? args.ticket
    : (args.handle && args.network ? `${args.handle}@${args.network}` : null);
  if (!target) {
    throw new Error('startLoopback: pass either ticket, or handle + network');
  }

  const bin = resolveOpenagentBinary();
  const cliArgs = [
    'network', 'loopback', target,
    '--password-stdin', '--print-port',
  ];
  if (args.agent) {
    cliArgs.push('--agent', args.agent);
  }
  // For role=user tickets the CLI needs a handle to register as. For
  // role=device tickets the handle is bound, so this is ignored. For
  // handle@network targets the handle is in the target string itself.
  if (args.ticket && args.handle) {
    cliArgs.push('--handle', args.handle);
  }

  const child = spawn(bin, cliArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  // Send the password and close stdin AFTER the proxy has had a chance
  // to read it. We can't close stdin yet — the loopback uses stdin
  // closure as a "shutdown" signal.
  child.stdin?.write(args.password + '\n');
  // Don't end stdin: the child reads ``stdin.read()`` in run_loopback
  // and exits when it hits EOF. We keep the pipe open for the account's
  // lifetime, then call ``stop`` to close it.

  let port: number;
  try {
    const portLine = await readFirstLine(child, 30_000);
    port = parseInt(portLine, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`loopback printed unexpected first line: ${portLine!.slice(0, 80)!}`);
    }
  } catch (err) {
    child.kill();
    throw err;
  }

  child.once('exit', (code, signal) => {
    handles.delete(args.accountId);
    if (code !== 0 && code !== null) {
      console.warn(`[loopback ${args.accountId}] exited code=${code} signal=${signal}`);
    }
  });

  handles.set(args.accountId, {
    id: args.accountId,
    child,
    port,
    startedAt: Date.now(),
  });

  return port;
}

export function stopLoopback(accountId: string): void {
  const h = handles.get(accountId);
  if (!h) return;
  // Closing stdin is the cooperative shutdown signal — the child
  // unblocks from its ``stdin.read()`` await, drains the proxy and
  // exits. Kill is the fallback if it doesn't honour that quickly.
  try {
    h.child.stdin?.end();
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (!h.child.killed && h.child.exitCode === null) {
      try {
        h.child.kill();
      } catch {
        // ignore
      }
    }
  }, 2_000);
  handles.delete(accountId);
}

export function stopAllLoopbacks(): void {
  for (const id of handles.keys()) {
    stopLoopback(id);
  }
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
      const v = (args as any)[k];
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
    stopLoopback(args.accountId);
  });
}
