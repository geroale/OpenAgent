/**
 * Electron main process.
 *
 * Dev:  loads from Expo web dev server (localhost:8081)
 * Prod: serves web-build via a local HTTP server (Expo Router needs
 *       proper URL routing which file:// can't provide)
 */

import { app, BrowserWindow, shell, dialog, protocol, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { registerStorageHandlers } from './services/storage';
import { registerLoopbackHandlers, stopAllLoopbacks } from './services/loopback';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.tiff']);

// Hard cap on ``dialog:readFile`` IPC payloads so a single runaway attachment
// can't OOM the renderer. The renderer streams these into a Blob before the
// HTTP upload; 200 MB covers any normal user attachment (PDFs, images, short
// videos) without letting the user accidentally paste their whole Downloads
// folder into memory.
const MAX_READ_BYTES = 200 * 1024 * 1024;

// Paths the user has explicitly picked through ``dialog:pickFiles`` in this
// session — ``dialog:readFile`` only accepts paths that show up here. This is
// defense-in-depth: we don't *believe* the renderer is hostile, but we also
// don't want a malicious page loaded via file:// in dev mode (or a compromised
// third-party script) to read ~/.ssh/id_rsa just because the renderer can
// send arbitrary IPC args.
const pickedPaths = new Set<string>();

function registerDialogHandlers(): void {
  ipcMain.handle('dialog:pickFiles', async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
    };
    const result = focused
      ? await dialog.showOpenDialog(focused, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths.length) return [];
    for (const p of result.filePaths) pickedPaths.add(p);
    return result.filePaths.map((p) => ({
      path: p,
      filename: path.basename(p),
      kind: IMAGE_EXTS.has(path.extname(p).toLowerCase()) ? 'image' : 'file',
    }));
  });

  // Read a file's bytes so the renderer can upload it via /api/upload.
  //
  // The **only** way the renderer can get bytes for an arbitrary local file
  // is via this IPC — Electron renderers with contextIsolation + no
  // nodeIntegration don't have ``fs``. We restrict reads to paths the user
  // has actually picked via the native dialog in this session, so the path
  // string is effectively a capability token issued by the OS file picker
  // rather than a free-form argument.
  ipcMain.handle('dialog:readFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      throw new Error('readFile: path must be a string');
    }
    if (!pickedPaths.has(filePath)) {
      throw new Error('readFile: path was not picked via the native dialog');
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`readFile: ${filePath} is not a regular file`);
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(
        `readFile: ${filePath} is ${stat.size} bytes (limit ${MAX_READ_BYTES})`,
      );
    }
    // Buffer crosses the IPC boundary as a Node Buffer which Electron
    // structured-clones into the renderer as a Uint8Array. No base64.
    return fs.promises.readFile(filePath);
  });
}

const isDev = !app.isPackaged;

app.setAboutPanelOptions({
  applicationName: 'OpenAgent',
  applicationVersion: app.getVersion(),
  website: 'https://openagent.uno/',
});

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.openagent.desktop');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let staticServer: http.Server | null = null;
let staticPort = 0;

// ── Static file server for production ──

function startStaticServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    // When packaged, web-build is shipped as an extraResource (outside the
    // asar), because electron-builder's default file filter strips any path
    // containing `node_modules` — which Expo's export uses for vendored
    // asset paths (e.g. `assets/node_modules/@react-navigation/.../*.png`).
    const webBuildDir = app.isPackaged
      ? path.join(process.resourcesPath, 'web-build')
      : path.resolve(__dirname, '..', 'web-build');

    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.map': 'application/json',
    };

    if (!fs.existsSync(webBuildDir)) {
      console.error(`[openagent] web-build directory missing: ${webBuildDir}`);
      return reject(new Error(`web-build directory missing at ${webBuildDir}`));
    }

    const server = http.createServer((req, res) => {
      // Strip query strings & fragments, decode percent-encoded chars
      const rawUrl = (req.url || '/').split('?')[0].split('#')[0];
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(rawUrl);
      } catch {
        urlPath = rawUrl;
      }

      // Resolve and guard against path traversal (stay within webBuildDir)
      let filePath = path.join(webBuildDir, urlPath === '/' ? 'index.html' : urlPath);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(webBuildDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // SPA fallback: serve index.html when the file doesn't exist *and*
      // it's not an asset request (assets should 404, not get HTML).
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '' || ext === '.html') {
          filePath = path.join(webBuildDir, 'index.html');
        }
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (err) {
        console.error(`[openagent] 404 ${req.url} -> ${filePath}`);
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      staticServer = server;
      console.log(`[openagent] static server listening on 127.0.0.1:${port} serving ${webBuildDir}`);
      resolve(port);
    });

    server.on('error', reject);
  });
}

// ── Window ──

function createWindow(): void {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'OpenAgent',
    show: true,
    backgroundColor: '#F5F6F8',  // match theme bg, avoids white flash
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Defensive re-entry: kiosk should make this unreachable, but if any path
  // (unusual Linux WM, future Electron change) drops out of fullscreen, snap
  // straight back in.
  mainWindow.on('leave-full-screen', () => {
    if (!mainWindow) return;
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8081');
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${staticPort}`);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Auto-updater ──

function setupAutoUpdater(): void {
  if (isDev) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info: any) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `OpenAgent ${info.version} is ready to install.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }: { response: number }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Auto-updater error:', err.message);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// ── Lifecycle ──

app.whenReady().then(async () => {
  registerStorageHandlers();
  registerDialogHandlers();
  registerLoopbackHandlers();

  // Renderer-initiated quit. The window is locked in kiosk fullscreen with no
  // traffic-lights, so we expose an IPC the in-app close button can call.
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // In production, start a local HTTP server for the web build
  // (Expo Router needs proper URL routing that file:// can't do)
  if (!isDev) {
    staticPort = await startStaticServer();
  }

  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAllLoopbacks();
    if (staticServer) staticServer.close();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllLoopbacks();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  if (staticServer) staticServer.close();
});
