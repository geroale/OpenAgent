/**
 * High-level entrypoint: bring up an in-process iroh node, register or
 * log in to a coordinator, find the gateway target, and start a
 * ``LoopbackProxy``. Returns the bound port + a ``stop()`` for the
 * caller's lifetime management.
 *
 * Mirrors ``openagent/network/cli_commands.py:_run_loopback`` end to
 * end. The desktop main process used to spawn ``openagent network
 * loopback`` for this; ``startNativeLoopback`` replaces that subprocess
 * with native TS. Same wire on the iroh side, same renderer-facing
 * shape (just a localhost port).
 */
import {
  loadOrCreateIdentity,
} from './identity.js';
import {
  decodeTicket,
  looksLikeTicket,
} from './ticket.js';
import {
  coordinatorNodeIdToPubkeyBytes,
  fetchNetworkInfo,
  login as netLogin,
  register as netRegister,
  refreshCert,
  LoginError,
  type LoginResult,
} from './login.js';
import { rpcCall, COORDINATOR_ALPN } from './coordinator-rpc.js';
import { dialWithTimeout, DialTimeoutError } from './dial-helpers.js';
import { SessionDialer } from './session-dialer.js';
import { LoopbackProxy } from './loopback-proxy.js';
import {
  loadStore,
  saveStore,
  addOrUpdate,
  find,
  writeCert,
  userIdentityPath,
  certPathFor,
  type StoredNetwork,
} from './network-store.js';
import type { IrohEndpoint, IrohNodeAddr } from './iroh-types.js';

export interface StartLoopbackArgs {
  password: string;
  /** Either a ticket (oa1…) OR (handle + network) is required. */
  ticket?: string;
  handle?: string;
  network?: string;
  /** When omitted, we connect to the first registered agent. */
  agent?: string;
}

export interface RunningLoopback {
  port: number;
  baseUrl: string;
  wsUrl: string;
  agentNodeId: string;
  agentHandle: string;
  /** Idempotent. Tears down proxy, closes iroh, and releases all sockets. */
  stop(): Promise<void>;
}

interface IrohRuntime {
  endpoint: IrohEndpoint;
  /** Seed a known peer address. Bypasses iroh's discovery for the next
   *  ``endpoint.connect`` to that NodeId — required when mDNS is gated
   *  (DMG without Local Network access) or pkarr can't resolve the
   *  coordinator's NodeId (fresh same-machine setup). No-op on errors —
   *  worst case the discovery layer takes over. */
  addPeerAddr(addr: IrohNodeAddr): Promise<void>;
  shutdown(): Promise<void>;
}

async function startIrohNode(secret: Uint8Array): Promise<IrohRuntime> {
  const iroh = await import('@number0/iroh');
  const node = await iroh.Iroh.memory({
    secretKey: Array.from(secret),
  });
  const endpoint = node.node.endpoint() as unknown as IrohEndpoint;
  // ``net`` is the iroh client surface that owns peer-table writes
  // (``addNodeAddr``) — separate from the ``Endpoint`` which only does
  // ``connect``/``nodeId``. Get-once: it's a stable reference for the
  // node's lifetime.
  const net = (node as unknown as { net: { addNodeAddr(addr: IrohNodeAddr): Promise<void> } }).net;
  return {
    endpoint,
    addPeerAddr: async (addr: IrohNodeAddr) => {
      // No direct addresses or relay → nothing to seed; iroh discovery
      // takes over.
      const hasHints = (addr.addresses && addr.addresses.length > 0) || !!addr.relayUrl;
      if (!hasHints || !net?.addNodeAddr) return;
      try {
        await net.addNodeAddr(addr);
      } catch (err) {
        // addNodeAddr rejects on malformed addrs — log and let
        // discovery retry. We don't want a bad ticket to take the
        // whole connect path down.
        console.warn('[iroh] addNodeAddr failed; falling back to discovery:', err);
      }
    },
    shutdown: async () => {
      try {
        await node.node.shutdown();
      } catch {
        // ignore — node may already be torn down
      }
    },
  };
}

export async function startNativeLoopback(
  args: StartLoopbackArgs,
): Promise<RunningLoopback> {
  if (!args.password) {
    throw new LoginError('password is required');
  }

  let coordinatorNodeId: string | null = null;
  let inviteCode: string | null = null;
  let ticketRole: string | null = null;
  let bindTo = '';
  let networkName: string | undefined;
  let handle: string | undefined;
  let coordinatorAddrHint: IrohNodeAddr | undefined;

  if (args.ticket) {
    if (!looksLikeTicket(args.ticket)) {
      throw new LoginError('invalid ticket: missing oa1 prefix');
    }
    const t = decodeTicket(args.ticket);
    coordinatorNodeId = t.coordinatorNodeId;
    inviteCode = t.code;
    ticketRole = t.role;
    bindTo = t.bindTo;
    networkName = t.networkName;
    handle = bindTo || (args.handle ?? '').trim().toLowerCase();
    if (!handle) {
      throw new LoginError(
        'user-role tickets need a handle (no interactive prompt available here)',
      );
    }
    // Forward-compatible: tickets minted by older servers omit these,
    // and the dial falls back to iroh discovery as before.
    if (t.relayUrl || (t.addresses && t.addresses.length > 0)) {
      coordinatorAddrHint = {
        nodeId: t.coordinatorNodeId,
        relayUrl: t.relayUrl,
        addresses: t.addresses,
      };
    }
  } else {
    if (!args.handle || !args.network) {
      throw new LoginError('pass either ticket, or handle + network');
    }
    handle = args.handle.trim().toLowerCase();
    networkName = args.network.trim().toLowerCase();
  }

  const store = loadStore();
  let net: StoredNetwork | null = networkName ? find(store, networkName) : null;

  const identity = await loadOrCreateIdentity(userIdentityPath());
  const runtime = await startIrohNode(identity.secret);
  let proxy: LoopbackProxy | null = null;
  let dialer: SessionDialer | null = null;

  const teardown = async () => {
    try { if (proxy) await proxy.stop(); } catch { /* ignore */ }
    try { if (dialer) await dialer.close(); } catch { /* ignore */ }
    try { await runtime.shutdown(); } catch { /* ignore */ }
  };

  // Seed iroh's peer table BEFORE the first dial. Without this,
  // ``endpoint.connect({ nodeId })`` triggers full discovery (mDNS +
  // pkarr DNS) — both can hang on macOS DMG builds where Local
  // Network access isn't granted and the coordinator isn't published.
  if (coordinatorAddrHint) {
    await runtime.addPeerAddr(coordinatorAddrHint);
  }

  try {
    let loginResult: LoginResult;
    let resolvedNet: StoredNetwork;

    if (net == null) {
      if (!coordinatorNodeId || !inviteCode) {
        throw new LoginError(
          `unknown network ${JSON.stringify(networkName)}; paste an oa1 ticket ` +
            `(it carries the coordinator NodeId + invite code in one string)`,
        );
      }
      const coordPubkey = await coordinatorNodeIdToPubkeyBytes(coordinatorNodeId);
      try {
        if (ticketRole === 'device') {
          loginResult = await netLogin({
            endpoint: runtime.endpoint,
            coordinatorNodeId,
            coordinatorPubkey: coordPubkey,
            handle: handle!,
            password: args.password,
            devicePubkey: identity.publicKey,
            inviteCode,
            coordinatorAddr: coordinatorAddrHint,
          });
        } else {
          loginResult = await netRegister({
            endpoint: runtime.endpoint,
            coordinatorNodeId,
            coordinatorPubkey: coordPubkey,
            handle: handle!,
            password: args.password,
            devicePubkey: identity.publicKey,
            inviteCode,
            coordinatorAddr: coordinatorAddrHint,
          });
        }
      } catch (e) {
        if (e instanceof LoginError) {
          throw new LoginError(`join failed: ${e.message}`);
        }
        throw e;
      }
      const cert = loginResult.cert;
      resolvedNet = addOrUpdate(store, {
        name: networkName ?? cert.networkId,
        networkId: cert.networkId,
        coordinatorNodeId,
        coordinatorPubkeyHex: bytesToHex(coordPubkey),
        handle: handle!,
        // Persist the ticket's address hints so future logins skip
        // discovery on the warm path (the very next reconnect after
        // join).
        coordinatorRelayUrl: coordinatorAddrHint?.relayUrl,
        coordinatorAddresses: coordinatorAddrHint?.addresses,
      });
      writeCert(resolvedNet, loginResult.certWire);
      saveStore(store);
    } else {
      if (net.handle !== handle) {
        throw new LoginError(
          `network ${networkName} is bound to ${net.handle}, not ${handle}`,
        );
      }
      // Reuse cached coordinator addresses (from a previous join's
      // ticket) on the refresh-cert path so this dial also skips
      // discovery.
      const refreshAddr: IrohNodeAddr | undefined =
        net.coordinatorRelayUrl || (net.coordinatorAddresses && net.coordinatorAddresses.length > 0)
          ? {
              nodeId: net.coordinatorNodeId,
              relayUrl: net.coordinatorRelayUrl,
              addresses: net.coordinatorAddresses,
            }
          : undefined;
      if (refreshAddr) {
        await runtime.addPeerAddr(refreshAddr);
        coordinatorAddrHint = refreshAddr;
      }
      try {
        loginResult = await refreshCert({
          endpoint: runtime.endpoint,
          coordinatorNodeId: net.coordinatorNodeId,
          coordinatorPubkey: hexToBytes(net.coordinatorPubkeyHex),
          handle: handle!,
          password: args.password,
          devicePubkey: identity.publicKey,
          networkId: net.networkId,
          coordinatorAddr: refreshAddr,
        });
      } catch (e) {
        if (e instanceof LoginError) {
          throw new LoginError(`login failed: ${e.message}`);
        }
        throw e;
      }
      resolvedNet = net;
      writeCert(resolvedNet, loginResult.certWire);
      saveStore(store);
    }

    const agents = await listAgents(
      runtime.endpoint,
      resolvedNet.coordinatorNodeId,
      coordinatorAddrHint,
    );
    if (agents.length === 0) {
      throw new LoginError('no agents registered in network');
    }
    const chosen = args.agent
      ? agents.find((a) => a.handle === args.agent) ?? agents[0]
      : agents[0];
    if (!chosen.nodeId) {
      throw new LoginError('agent record missing node_id');
    }

    dialer = new SessionDialer(runtime.endpoint, loginResult.certWire);
    proxy = new LoopbackProxy(dialer, chosen.nodeId);
    const addr = await proxy.start();

    return {
      port: addr.port,
      baseUrl: proxy.baseUrl,
      wsUrl: proxy.wsUrl,
      agentNodeId: chosen.nodeId,
      agentHandle: chosen.handle ?? '',
      stop: teardown,
    };
  } catch (e) {
    await teardown();
    throw e;
  }
}

interface AgentRow {
  handle?: string;
  nodeId?: string;
}

async function listAgents(
  endpoint: IrohEndpoint,
  coordinatorNodeId: string,
  coordinatorAddr?: IrohNodeAddr,
): Promise<AgentRow[]> {
  const addr: IrohNodeAddr = coordinatorAddr ?? { nodeId: coordinatorNodeId };
  let conn;
  try {
    conn = await dialWithTimeout(endpoint, addr, COORDINATOR_ALPN);
  } catch (e) {
    if (e instanceof DialTimeoutError) {
      throw new LoginError(
        `list_agents: coordinator unreachable (timed out after ${e.timeoutMs}ms)`,
      );
    }
    throw e;
  }
  const result = await rpcCall(conn, 'list_agents', {});
  const raw = Array.isArray(result.agents) ? result.agents : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') return {};
    const m = entry as Record<string, unknown>;
    return {
      handle: typeof m.handle === 'string' ? m.handle : undefined,
      nodeId: typeof m.node_id === 'string' ? m.node_id : undefined,
    };
  });
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, '0');
  }
  return s;
}

function hexToBytes(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new Error(`hex length is odd: ${s.length}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Re-export network-store for callers that want to read stored networks
// without going through this module.
export { loadStore, find, certPathFor, fetchNetworkInfo };
