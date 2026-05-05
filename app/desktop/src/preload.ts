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

  // Native file picker — returns absolute paths plus a simple "image" vs
  // "file" classification. The path is NOT a handle the agent can
  // dereference directly: when the agent runs on a different machine
  // (lyra VPS, a remote server, Linux container, etc.) the path doesn't
  // exist there. The renderer is expected to follow up with ``readFile``
  // to get the bytes, wrap them in a ``File``, and POST to ``/api/upload``
  // so the gateway gives back a path valid on the agent's own filesystem.
  pickFiles: (): Promise<{ path: string; filename: string; kind: 'image' | 'file' }[]> =>
    ipcRenderer.invoke('dialog:pickFiles'),

  // Read a previously-picked file's bytes. Main enforces that ``filePath``
  // must be one of the paths the user picked via ``pickFiles`` in this
  // session — arbitrary filesystem reads from the renderer are refused.
  // Returns a ``Uint8Array`` (structured-cloned from the Node ``Buffer``
  // on the main side), size-capped at 200 MB.
  readFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('dialog:readFile', filePath),

  // Quit the app from the renderer. The Electron window is locked in kiosk
  // fullscreen with no traffic-lights, so the in-app close button uses this
  // to exit. (Cmd+Q / Alt+F4 still work too.)
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  // ── Network loopback (Iroh transport bridge) ──
  // Brings up an in-process iroh node + localhost proxy for one
  // account; the renderer hits the returned port over plain HTTP/WS.
  // The password is sent over IPC and is NEVER persisted by the main
  // process — used only to derive the SRP-6a verifier with the
  // coordinator, then discarded.
  // Either form works:
  //   - ``{ ticket }`` for first-time joins (paste the oa1… string)
  //   - ``{ handle, network }`` for re-logins to a saved account
  // ``handle`` is also passed alongside a role=user ticket so the new
  // user picks their own handle on registration.
  startLoopback: (args: {
    accountId: string;
    password: string;
    ticket?: string;
    handle?: string;
    network?: string;
    agent?: string;
  }): Promise<number> => ipcRenderer.invoke('loopback:start', args),

  stopLoopback: (args: { accountId: string }): Promise<void> =>
    ipcRenderer.invoke('loopback:stop', args),
});
