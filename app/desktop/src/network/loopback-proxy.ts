/**
 * Tiny TCP↔iroh proxy so the renderer's ``fetch`` / ``WebSocket`` keep
 * working unchanged. Mirrors ``openagent/network/client/session.py:LoopbackProxy``.
 *
 * Listens on ``127.0.0.1:0`` (OS-assigned port), accepts TCP from the
 * renderer, opens a fresh authed iroh stream per accepted socket, then
 * pumps bytes both ways. The renderer talks plain HTTP/WS to localhost;
 * the gateway sees authed iroh streams.
 *
 * The proxy is byte-blind — HTTP keep-alive and WS upgrade are
 * transparent. Each TCP connection maps to one iroh bi-stream for the
 * connection's lifetime.
 */
import * as net from 'node:net';
import type { GatewayStream, SessionDialer } from './session-dialer.js';

const READ_CHUNK = 64 * 1024;

export interface LoopbackProxyAddress {
  host: string;
  port: number;
}

export class LoopbackProxy {
  private readonly dialer: SessionDialer;
  private readonly targetNodeId: string;
  private server: net.Server | null = null;
  private addr: LoopbackProxyAddress | null = null;
  private readonly sockets: Set<net.Socket> = new Set();

  constructor(dialer: SessionDialer, targetNodeId: string) {
    this.dialer = dialer;
    this.targetNodeId = targetNodeId;
  }

  get address(): LoopbackProxyAddress {
    if (this.addr == null) throw new Error('LoopbackProxy.start() not awaited');
    return this.addr;
  }

  get baseUrl(): string {
    return `http://${this.address.host}:${this.address.port}`;
  }

  get wsUrl(): string {
    return `ws://${this.address.host}:${this.address.port}/ws`;
  }

  get port(): number {
    return this.address.port;
  }

  async start(): Promise<LoopbackProxyAddress> {
    return await new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleLocalSocket(socket).catch(() => {
          try { socket.destroy(); } catch { /* ignore */ }
        });
      });
      const onError = (err: Error) => {
        server.removeListener('error', onError);
        reject(err);
      };
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        const a = server.address();
        if (a == null || typeof a === 'string') {
          reject(new Error('LoopbackProxy: unexpected server address'));
          return;
        }
        server.removeListener('error', onError);
        this.server = server;
        this.addr = { host: a.address, port: a.port };
        resolve(this.addr);
      });
    });
  }

  async stop(): Promise<void> {
    const srv = this.server;
    this.server = null;
    this.addr = null;
    if (srv == null) return;
    for (const sock of this.sockets) {
      try { sock.destroy(); } catch { /* ignore */ }
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private async handleLocalSocket(socket: net.Socket): Promise<void> {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => { /* swallow — close handler cleans up */ });

    let stream: GatewayStream;
    try {
      stream = await this.dialer.openGatewayStream(this.targetNodeId);
    } catch {
      socket.destroy();
      return;
    }

    socket.on('data', (chunk: Buffer) => {
      const view = chunk instanceof Uint8Array
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Uint8Array.from(chunk);
      // writeAll is async; pause local reads while we flush so we don't
      // race ahead of the iroh send buffer.
      socket.pause();
      stream.send.writeAll(view).then(
        () => socket.resume(),
        () => socket.destroy(),
      );
    });
    socket.on('end', () => {
      // Local peer half-closed write half → finish the iroh send half so
      // the gateway server sees EOF (matches HTTP/1.1 connection-close).
      stream.closeSend().catch(() => { /* ignore */ });
    });

    // iroh recv → local socket write.
    void (async () => {
      try {
        while (!socket.destroyed) {
          const buf = new Uint8Array(READ_CHUNK);
          const got = await stream.recv.read(buf);
          if (got === null || got === 0n) break;
          const n = Number(got);
          const out = Buffer.from(buf.buffer, buf.byteOffset, n);
          if (!socket.write(out)) {
            await new Promise<void>((resolve) => socket.once('drain', resolve));
          }
        }
      } catch {
        // ignore
      }
      try { socket.end(); } catch { /* ignore */ }
    })();
  }
}
