/**
 * Local re-exports / minimal shims for the ``@number0/iroh`` API
 * surface we touch. Centralising the imports here keeps every other
 * file's dependency-on-iroh down to a single import line, and makes
 * future iroh API churn a one-place fix.
 *
 * The official ``@number0/iroh`` types ARE present in the package's
 * ``index.d.ts``, but `Iroh.memory()` and the connection chain don't
 * always have stable named exports across versions, so we model just
 * what we actually use as duck-typed interfaces — slightly looser than
 * the real types but stable across iroh-js bumps.
 */

/** A subset of the iroh ``SendStream`` we use. */
export interface IrohSendStream {
  writeAll(buf: Uint8Array): Promise<void>;
  finish?(): Promise<void>;
}

/** A subset of the iroh ``RecvStream`` we use. */
export interface IrohRecvStream {
  /**
   * Reads up to ``buf.length`` bytes into ``buf`` and returns the count
   * (or ``null`` on EOF — iroh-py 0.35's API). Some iroh-js versions
   * return ``bigint`` for the count.
   */
  read(buf: Uint8Array): Promise<bigint | null>;
}

export interface IrohBiStream {
  send: IrohSendStream;
  recv: IrohRecvStream;
}

export interface IrohConnection {
  openBi(): Promise<IrohBiStream>;
  close(errorCode: bigint, reason: Uint8Array): void;
  remoteNodeId?(): string;
}

export interface IrohEndpoint {
  connect(nodeAddr: { nodeId: string }, alpn: Uint8Array): Promise<IrohConnection>;
  nodeId(): string;
}

export interface IrohNode {
  /** ``iroh.node.endpoint()`` accessor. */
  node: { endpoint(): IrohEndpoint; shutdown(): Promise<void> };
}
