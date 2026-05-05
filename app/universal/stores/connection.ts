/**
 * Connection state with multi-account support.
 *
 * Accounts represent ``handle@network`` memberships persisted via the
 * storage service (electron-store on desktop, localStorage on web).
 * Connecting an account spawns the loopback sidecar (handled by the
 * Electron main process) which exposes a localhost port that proxies
 * HTTP/WS over the Iroh transport. The renderer keeps using ``fetch``
 * and ``WebSocket`` against ``http://127.0.0.1:<sidecarPort>`` exactly
 * like before — auth + transport are below the visible layer.
 *
 * Passwords are never persisted: the user is prompted on every
 * connect (the cert TTL bounds re-prompt frequency to ~30 days when
 * the cached cert is still valid).
 */

import { create } from 'zustand';
import type { ConnectionConfig, SavedAccount } from '../../common/types';
import { OpenAgentWS } from '../services/ws';
import { setBaseUrl } from '../services/api';
import * as storage from '../services/storage';
import { useChat } from './chat';

const STORAGE_KEY = 'openagent:accounts';

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Translate a raw loopback / coordinator failure into something a human
 * can act on. The desktop bridge surfaces the Python child's stderr
 * verbatim — that's noisy ("loopback exited before printing port
 * (code=1); stderr: …") and leaks internal terminology. We strip the
 * envelope, then map the known coordinator error codes to plain
 * sentences. Anything we don't recognise falls through cleaned-up but
 * intact so we don't hide unexpected failures.
 */
function humanizeLoginError(raw: string | undefined | null): string {
  if (!raw) return 'Something went wrong. Please try again.';
  let msg = String(raw);

  // Drop the loopback envelope from the desktop bridge.
  msg = msg.replace(/^Error invoking remote method [^:]+: ?/, '');
  msg = msg.replace(/^Error: /, '');
  msg = msg.replace(/^loopback exited before printing port \(code=\d+\); stderr: ?/, '');
  msg = msg.replace(/^loopback startup timed out after \d+ms; stderr: ?/, '');
  // Click leaves a trailing "Aborted!" line on every error.
  msg = msg.replace(/\bAborted!\s*$/, '').trim();

  // Common Python-CLI error prefixes the user shouldn't have to read.
  msg = msg.replace(/^join failed: ?/, '');
  msg = msg.replace(/^login failed: ?/, '');

  const lower = msg.toLowerCase();

  if (lower.includes('unauthorized') || lower.includes('login failed')) {
    return 'Wrong password. Try again — passwords are case-sensitive.';
  }
  if (lower.includes('invalid_invite')) {
    if (lower.includes('different handle')) {
      return 'This invite is bound to a different handle. Ask the owner for one for your handle, or pick a fresh user invite.';
    }
    return 'This invite is no longer valid — expired, already used, or for the wrong role. Ask the network owner for a fresh one.';
  }
  if (lower.includes('handle') && lower.includes('already taken')) {
    const m = msg.match(/'([^']+)'/);
    const taken = m ? m[1] : 'that handle';
    return `“${taken}” is already in use on this network. Pick a different handle and try again.`;
  }
  if (lower.includes('could not reach') || lower.includes('is the openagent server running')) {
    return 'Can’t reach the agent server. Make sure ‘openagent serve’ is running on the host that issued the invite, and that this device has internet access.';
  }
  if (lower.includes('expected handle@network')) {
    return 'Pick a saved network or paste an invite ticket — the field can’t be empty.';
  }
  if (lower.includes('unknown network')) {
    return 'This device doesn’t know that network yet. Use a fresh invite to join from this Mac.';
  }
  if (lower.includes('cert') && lower.includes('expired')) {
    return 'Your saved credentials expired. Sign in again to refresh them.';
  }
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return 'Can’t reach the agent server. Make sure it’s running and reachable.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The agent didn’t respond in time. Check that the server is running and try again.';
  }
  if (lower.includes('password is required')) {
    return 'Enter your password to continue.';
  }

  // Trim whitespace + cap length so we never overflow the card.
  msg = msg.trim();
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.length > 280) msg = msg.slice(0, 277) + '…';

  // Capitalise the first letter for politeness; keep the rest verbatim.
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

interface DesktopAPI {
  startLoopback: (args: {
    accountId: string;
    password: string;
    // Ticket-based first-time join (carries network name, ID,
    // coordinator NodeId, invite code in one string):
    ticket?: string;
    // Re-login for an already-saved account:
    handle?: string;
    network?: string;
    agent?: string;
  }) => Promise<number>;
  stopLoopback: (args: { accountId: string }) => Promise<void>;
}

function desktop(): DesktopAPI | null {
  // ``window.desktop`` is exposed by the Electron preload. On web this
  // is undefined — the connection flow surfaces a clear error and we
  // skip the sidecar altogether.
  if (typeof window === 'undefined') return null;
  // @ts-ignore — runtime-injected
  const d = (window as any).desktop;
  if (!d || typeof d.startLoopback !== 'function') return null;
  return d as DesktopAPI;
}

export interface JoinNetworkArgs {
  // Single string the user pastes — carries network name, network ID,
  // coordinator NodeId, invite code, role, and (for device tickets)
  // the handle to bind to. Generate one with ``openagent network invite``.
  ticket: string;
  // Required when the ticket is role=user (the new user picks their
  // own handle); ignored for role=device tickets. The CLI re-derives
  // it from the ticket on its end either way.
  handle: string;
  password: string;
  isLocal?: boolean;
  displayName?: string;
}

interface ConnectionState {
  // Persisted
  accounts: SavedAccount[];
  // Runtime
  activeAccountId: string | null;
  config: ConnectionConfig | null;
  ws: OpenAgentWS | null;
  isConnected: boolean;
  isConnecting: boolean;
  agentName: string | null;
  agentVersion: string | null;
  error: string | null;
  isLoading: boolean;

  // Account management
  loadAccounts: () => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  // Onboarding & connection
  joinNetwork: (args: JoinNetworkArgs) => Promise<void>;
  connectAccount: (accountId: string, password: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  config: null,
  ws: null,
  isConnected: false,
  isConnecting: false,
  agentName: null,
  agentVersion: null,
  error: null,
  isLoading: true,

  // ── persistence ──

  loadAccounts: async () => {
    set({ isLoading: true });
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      const accounts: SavedAccount[] = raw ? JSON.parse(raw) : [];
      set({ accounts, isLoading: false });
    } catch {
      set({ accounts: [], isLoading: false });
    }
  },

  removeAccount: async (id) => {
    const { accounts, activeAccountId } = get();
    if (activeAccountId === id) {
      await get().disconnect();
    }
    const filtered = accounts.filter((a) => a.id !== id);
    set({ accounts: filtered });
    await storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    // Best-effort cleanup of any lingering sidecar for this account.
    try {
      await desktop()?.stopLoopback({ accountId: id });
    } catch {
      // ignore
    }
  },

  // ── connection ──
  //
  // Both join + connect funnel through ``startLoopback``. Join passes
  // the invite + coordinator so the underlying CLI registers the user
  // on its way to opening the proxy; subsequent connects only pass
  // password and reuse the persisted ``coordinatorNodeId``.

  joinNetwork: async (args) => {
    const d = desktop();
    if (!d) {
      set({ error: 'Joining a network requires the desktop app — the loopback sidecar is unavailable here.' });
      return;
    }
    set({ isConnecting: true, error: null });

    const accountId = genId();

    // Spawn the loopback in ticket mode. The Python CLI parses the
    // ticket, registers/logs in via SRP-6a, mints the cert, persists
    // the network in the user store, and prints the bound port. We
    // don't see the ticket bits at all — just hand them off.
    let port: number;
    try {
      port = await d.startLoopback({
        accountId,
        password: args.password,
        ticket: args.ticket,
        handle: args.handle,
      });
    } catch (e: any) {
      set({ isConnecting: false, error: humanizeLoginError(e?.message || String(e)) });
      return;
    }

    // We don't yet know the network name the ticket points at — the
    // ``auth_ok`` frame from the gateway will tell us. Save a
    // placeholder row; ``_openWebsocket`` patches it on connect.
    const newAccount: SavedAccount = {
      id: accountId,
      name: args.displayName ?? args.handle,
      network: '',
      handle: args.handle,
      isLocal: !!args.isLocal,
      createdAt: Date.now(),
    };
    const accounts = [...get().accounts, newAccount];
    set({ accounts });
    await storage.setItem(STORAGE_KEY, JSON.stringify(accounts));

    _openWebsocket(get, set, { ...newAccount, sidecarPort: port }, accountId);
  },

  connectAccount: async (accountId, password) => {
    const d = desktop();
    if (!d) {
      set({ error: 'Connecting requires the desktop app — the loopback sidecar is unavailable here.' });
      return;
    }
    const account = get().accounts.find((a) => a.id === accountId);
    if (!account) {
      set({ error: 'Account not found' });
      return;
    }
    set({ isConnecting: true, error: null });

    // Tear down any prior connection first so a switch from A→B
    // doesn't leave A's sidecar running.
    const old = get().ws;
    if (old) {
      old.disconnect();
    }
    if (get().activeAccountId && get().activeAccountId !== accountId) {
      try { await d.stopLoopback({ accountId: get().activeAccountId! }); } catch { /* ignore */ }
    }
    useChat.getState().clearAll();

    let port: number;
    try {
      port = await d.startLoopback({
        accountId,
        password,
        handle: account.handle,
        network: account.network,
        agent: account.agentHandle,
      });
    } catch (e: any) {
      set({ isConnecting: false, error: humanizeLoginError(e?.message || String(e)) });
      return;
    }

    _openWebsocket(get, set, { ...account, sidecarPort: port }, accountId);
  },

  disconnect: async () => {
    const { ws, activeAccountId } = get();
    ws?.disconnect();
    // Flip the visible state SYNCHRONOUSLY before any await. Subscribers
    // (notably the login screen's auto-redirect effect) read this on
    // their next render — if we awaited the IPC first, a route change
    // racing in between would land them on /(tabs)/chat with the old
    // ``isConnected: true`` still latched.
    useChat.getState().clearAll();
    set({
      ws: null,
      isConnected: false,
      isConnecting: false,
      config: null,
      agentName: null,
      agentVersion: null,
      activeAccountId: null,
    });
    // Best-effort sidecar cleanup. Even if this fails we're already
    // disconnected from the renderer's perspective.
    if (activeAccountId) {
      try { await desktop()?.stopLoopback({ accountId: activeAccountId }); } catch { /* ignore */ }
    }
  },
}));

/** Wire up the WebSocket once we have a sidecar port. */
function _openWebsocket(
  get: () => ConnectionState,
  set: (s: Partial<ConnectionState>) => void,
  config: ConnectionConfig & { sidecarPort: number },
  accountId: string,
) {
  const host = '127.0.0.1';
  const port = config.sidecarPort;
  const url = `ws://${host}:${port}/ws`;
  const ws = new OpenAgentWS(url, undefined);

  ws.onMessage((msg) => {
    if (msg.type === 'auth_ok') {
      set({
        isConnected: true,
        isConnecting: false,
        // @ts-ignore — server sends both old shape (agent_name/version) and new (handle/network)
        agentName: msg.agent_name,
        // @ts-ignore
        agentVersion: msg.version,
        error: null,
      });
      // Patch the saved account from the gateway's auth_ok frame —
      // covers post-join when we didn't yet know the network ID, and
      // keeps the display label fresh as the agent name evolves.
      const acc = get().accounts.find((a) => a.id === accountId);
      const serverAgent = (msg as any).agent_name as string | undefined;
      const serverNetwork = (msg as any).network as string | undefined;
      const serverHandle = (msg as any).handle as string | undefined;
      if (acc) {
        const updated = get().accounts.map((a) => {
          if (a.id !== accountId) return a;
          const next = { ...a };
          if (serverNetwork && !a.network) next.network = serverNetwork;
          if (serverHandle && !a.handle) next.handle = serverHandle;
          // Auto-name only when the account row is still sitting on
          // the bare handle / placeholder — leave user-customised
          // labels alone.
          if (serverAgent && (a.name === a.handle || a.name === '')) {
            next.name = `${next.handle}@${next.network} — ${serverAgent}`;
          }
          return next;
        });
        set({ accounts: updated });
        storage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } else if (msg.type === 'auth_error') {
      set({
        isConnected: false,
        isConnecting: false,
        error: humanizeLoginError((msg as any).reason),
      });
    }
  });

  ws.connect();
  setBaseUrl(host, port);
  set({
    config,
    ws,
    isConnected: false,
    error: null,
    activeAccountId: accountId,
  });
}
