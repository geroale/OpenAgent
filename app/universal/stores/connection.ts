/**
 * Connection state with multi-account support.
 *
 * Accounts are persisted via the storage service (electron-store on
 * desktop, localStorage on web). Only one account is connected at a
 * time — switching disconnects the current WS and connects the new one.
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

interface ConnectionState {
  // Persisted
  accounts: SavedAccount[];
  // Runtime
  activeAccountId: string | null;
  config: ConnectionConfig | null;
  ws: OpenAgentWS | null;
  isConnected: boolean;
  agentName: string | null;
  agentVersion: string | null;
  error: string | null;
  isLoading: boolean;

  // Account management
  loadAccounts: () => Promise<void>;
  saveAccount: (config: ConnectionConfig) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  switchAccount: (id: string) => void;

  // Connection
  connect: (config: ConnectionConfig, accountId?: string) => void;
  disconnect: () => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  config: null,
  ws: null,
  isConnected: false,
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

  saveAccount: async (config) => {
    const account: SavedAccount = {
      ...config,
      id: genId(),
      createdAt: Date.now(),
    };
    const accounts = [...get().accounts, account];
    set({ accounts });
    await storage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    // Connect immediately
    get().connect(config, account.id);
  },

  removeAccount: async (id) => {
    const { accounts, activeAccountId } = get();
    // Disconnect if removing the active account
    if (activeAccountId === id) {
      get().disconnect();
    }
    const filtered = accounts.filter((a) => a.id !== id);
    set({ accounts: filtered });
    await storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },

  switchAccount: (id) => {
    const account = get().accounts.find((a) => a.id === id);
    if (!account) return;
    // Clear chat state
    useChat.getState().clearAll();
    // Disconnect current and connect new
    get().connect(account, account.id);
  },

  // ── connection ──

  connect: (config, accountId) => {
    const old = get().ws;
    old?.disconnect();

    const url = `ws://${config.host}:${config.port}/ws`;
    const ws = new OpenAgentWS(url, config.token);

    ws.onMessage((msg) => {
      if (msg.type === 'auth_ok') {
        set({
          isConnected: true,
          agentName: msg.agent_name,
          agentVersion: msg.version,
          error: null,
        });
      } else if (msg.type === 'auth_error') {
        set({ isConnected: false, error: msg.reason });
      }
    });

    ws.connect();
    setBaseUrl(config.host, config.port);
    set({
      config,
      ws,
      isConnected: false,
      error: null,
      activeAccountId: accountId ?? null,
    });
  },

  disconnect: () => {
    get().ws?.disconnect();
    useChat.getState().clearAll();
    set({
      ws: null,
      isConnected: false,
      config: null,
      agentName: null,
      agentVersion: null,
      activeAccountId: null,
    });
  },
}));
