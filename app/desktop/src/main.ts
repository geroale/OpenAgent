/**
 * Electron main process.
 *
 * Loads the web build from universal/ (dev: localhost:8081, prod: file://).
 * Injects desktop-only services via preload.ts context bridge.
 * Auto-updates from GitHub Releases via electron-updater.
 */

import { app, BrowserWindow, shell, dialog } from 'electron';
import * as path from 'path';
import { registerStorageHandlers } from './services/storage';

const isDev = !app.isPackaged;

app.setAboutPanelOptions({
  applicationName: 'OpenAgent',
  applicationVersion: app.getVersion(),
  website: 'https://geroale.github.io/OpenAgent/',
});

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.openagent.desktop');
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 500,
    title: 'OpenAgent',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8081');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'web-build', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Auto-updater (production only) ──
function setupAutoUpdater(): void {
  if (isDev) return;

  // Dynamic import so dev doesn't need electron-updater resolved
  const { autoUpdater } = require('electron-updater');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info: any) => {
    console.log('Update available:', info.version);
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `OpenAgent ${info.version} is ready to install.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Auto-updater error:', err.message);
  });

  // Check for updates after window is ready
  autoUpdater.checkForUpdatesAndNotify();
}

app.on('ready', () => {
  registerStorageHandlers();
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
