/**
 * Electron main process.
 *
 * Dev:  loads from Expo web dev server (localhost:8081)
 * Prod: serves web-build via a local HTTP server (Expo Router needs
 *       proper URL routing which file:// can't provide)
 */

import { app, BrowserWindow, shell, dialog, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { registerStorageHandlers } from './services/storage';

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
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 500,
    title: 'OpenAgent',
    titleBarStyle: 'hiddenInset',
    show: true,
    backgroundColor: '#F5F6F8',  // match theme bg, avoids white flash
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
    if (staticServer) staticServer.close();
    app.quit();
  }
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
