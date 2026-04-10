/**
 * Config state: agent configuration loaded from the server.
 */

import { create } from 'zustand';
import type { AgentConfig } from '../../common/types';
import * as api from '../services/api';

interface ConfigState {
  config: AgentConfig | null;
  loading: boolean;
  error: string | null;
  dirty: boolean;

  loadConfig: () => Promise<void>;
  updateSection: (section: string, data: any) => Promise<boolean>;
  setConfig: (config: AgentConfig) => void;
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,
  dirty: false,

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const config = await api.getConfig();
      set({ config, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  updateSection: async (section, data) => {
    try {
      set({ error: null });
      await api.updateConfigSection(section, data);
      // Reload full config after update
      const config = await api.getConfig();
      set({ config, dirty: false });
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  setConfig: (config) => set({ config, dirty: true }),
}));
