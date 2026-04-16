/**
 * Tasks state: scheduled tasks stored in the backend SQLite database.
 *
 * All CRUD flows through /api/scheduled-tasks — the same source of truth
 * the Scheduler loop and the scheduler MCP server use. No restart required
 * when changing tasks; the runtime picks up changes on its next tick (~30s).
 */

import { create } from 'zustand';
import type {
  ScheduledTask,
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
} from '../../common/types';
import * as api from '../services/api';

interface TasksState {
  tasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  saved: boolean;

  loadTasks: () => Promise<void>;
  createTask: (input: CreateScheduledTaskInput) => Promise<boolean>;
  updateTask: (id: string, input: UpdateScheduledTaskInput) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  toggleTask: (id: string, enabled: boolean) => Promise<boolean>;
  clearSaved: () => void;
}

export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  saved: false,

  loadTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await api.getScheduledTasks();
      set({ tasks, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  createTask: async (input) => {
    try {
      set({ error: null });
      const created = await api.createScheduledTask(input);
      set({ tasks: [created, ...get().tasks], saved: true });
      setTimeout(() => set({ saved: false }), 2000);
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  updateTask: async (id, input) => {
    try {
      set({ error: null });
      const updated = await api.updateScheduledTask(id, input);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
        saved: true,
      });
      setTimeout(() => set({ saved: false }), 2000);
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  deleteTask: async (id) => {
    try {
      set({ error: null });
      await api.deleteScheduledTask(id);
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },

  toggleTask: async (id, enabled) => {
    return get().updateTask(id, { enabled });
  },

  clearSaved: () => set({ saved: false }),
}));
