/**
 * Bound every iroh ``endpoint.connect()`` with a wall-clock timeout. The
 * iroh-js bindings don't take an AbortSignal, so a hung dial used to hang
 * the whole login chain forever (no error, no UI feedback). The wrapper:
 *
 *  - rejects with ``DialTimeoutError`` after ``timeoutMs``,
 *  - lets the underlying promise keep running so a late-arriving
 *    connection self-cleans (closed instead of leaked into iroh state).
 */
import type { IrohConnection, IrohEndpoint, IrohNodeAddr } from './iroh-types.js';

export const DEFAULT_DIAL_TIMEOUT_MS = 20_000;

export class DialTimeoutError extends Error {
  readonly nodeId: string;
  readonly timeoutMs: number;
  constructor(nodeId: string, timeoutMs: number) {
    super(`iroh dial to ${nodeId.slice(0, 12)}… timed out after ${timeoutMs}ms`);
    this.name = 'DialTimeoutError';
    this.nodeId = nodeId;
    this.timeoutMs = timeoutMs;
  }
}

export async function dialWithTimeout(
  endpoint: IrohEndpoint,
  nodeAddr: IrohNodeAddr,
  alpn: Uint8Array,
  timeoutMs: number = DEFAULT_DIAL_TIMEOUT_MS,
): Promise<IrohConnection> {
  const dialPromise = endpoint.connect(nodeAddr, alpn);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new DialTimeoutError(nodeAddr.nodeId, timeoutMs));
    }, timeoutMs);
  });

  // If the underlying dial resolves AFTER we've timed out, close the
  // connection so it doesn't leak as an unowned iroh resource.
  dialPromise.then(
    (conn) => {
      if (timedOut) {
        try { conn.close(0n, new Uint8Array()); } catch { /* ignore */ }
      }
    },
    () => { /* error already surfaced via race */ },
  );

  try {
    return await Promise.race([dialPromise, timeoutPromise]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}
