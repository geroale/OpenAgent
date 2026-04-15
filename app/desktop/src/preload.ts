/**
 * Preload script — exposes desktop-only APIs to the renderer via
 * contextBridge. The renderer accesses them as window.desktop.*.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,

  // Storage (electron-store based, persists across restarts)
  getItem: (key: string): Promise<string | null> =>
    ipcRenderer.invoke('storage:get', key),
  setItem: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('storage:set', key, value),
  removeItem: (key: string): Promise<void> =>
    ipcRenderer.invoke('storage:remove', key),

  // Native file picker — returns absolute paths for locally-selected files.
  // On desktop the agent runs on the same machine, so the path is directly
  // usable and no HTTP upload round-trip is needed.
  pickFiles: (): Promise<{ path: string; filename: string; kind: 'image' | 'file' }[]> =>
    ipcRenderer.invoke('dialog:pickFiles'),
});
