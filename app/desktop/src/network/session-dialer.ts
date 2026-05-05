/**
 * Authenticated dialer: opens cert-prefixed iroh streams to a target NodeId.
 *
 * Mirrors ``openagent/network/client/session.py:SessionDialer``. Each
 * ``openGatewayStream`` call writes ``u32(BE) cert_len || cert_wire``
 * to the new bi-stream's send half; the gateway side reads that prefix
 * before handing the stream to its HTTP/WS server.
 *
 * Connections are pooled per NodeId so multiple concurrent HTTP/WS
 * requests share one iroh connection. The cache stores the Promise,
 * not the resolved connection, so two simultaneous callers don't race
 * to open two connections.
 */
import { GATEWAY_ALPN } from './coordinator-rpc.js';
import type { IrohConnection, IrohEndpoint, IrohSendStream, IrohRecvStream } from './iroh-types.js';

export interface GatewayStream {
  send: IrohSendStream;
  recv: IrohRecvStream;
  targetNodeId: string;
  /** Half-close the send half — caller still drains recv. */
  closeSend(): Promise<void>;
}

export class SessionDialer {
  private readonly endpoint: IrohEndpoint;
  private certWire: Uint8Array;
  private readonly connections: Map<string, Promise<IrohConnection>> = new Map();

  constructor(endpoint: IrohEndpoint, certWire: Uint8Array) {
    this.endpoint = endpoint;
    this.certWire = certWire;
  }

  get cert(): Uint8Array {
    return this.certWire;
  }

  /**
   * Swap in a freshly-refreshed cert. In-flight streams keep using the
   * cert that was current when their connection was established; new
   * streams pick up the new cert immediately.
   */
  updateCert(newCertWire: Uint8Array): void {
    this.certWire = newCertWire;
  }

  /** Open one bi-stream to ``targetNodeId`` with the cert prefix attached. */
  async openGatewayStream(targetNodeId: string): Promise<GatewayStream> {
    const conn = await this.getOrOpenConnection(targetNodeId);
    const bi = await conn.openBi();
    const cert = this.certWire;
    const prefix = new Uint8Array(4 + cert.length);
    new DataView(prefix.buffer).setUint32(0, cert.length, false);
    prefix.set(cert, 4);
    await bi.send.writeAll(prefix);
    return {
      send: bi.send,
      recv: bi.recv,
      targetNodeId,
      closeSend: async () => {
        if (typeof bi.send.finish === 'function') {
          try {
            await bi.send.finish();
          } catch {
            // ignore
          }
        }
      },
    };
  }

  private async getOrOpenConnection(nodeId: string): Promise<IrohConnection> {
    let p = this.connections.get(nodeId);
    if (p === undefined) {
      p = this.endpoint.connect({ nodeId }, GATEWAY_ALPN);
      this.connections.set(nodeId, p);
      p.catch(() => {
        if (this.connections.get(nodeId) === p) {
          this.connections.delete(nodeId);
        }
      });
    }
    return p;
  }

  async close(): Promise<void> {
    const all = Array.from(this.connections.values());
    this.connections.clear();
    for (const cp of all) {
      try {
        const c = await cp;
        c.close(0n, new Uint8Array());
      } catch {
        // ignore — already closed or never opened
      }
    }
  }
}
