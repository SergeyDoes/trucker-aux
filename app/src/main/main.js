import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './paths.js';
import { loadData, saveLayouts, saveSettings } from './store.js';
import { openTelemetry } from './telemetry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POSE_PERIOD_MS = 10; // shared-memory polling, ~100 Hz
const RETRY_MS = 1000;     // how often to look for the memory while the game is not running

// Everything, including Chromium's profile, lives in the app folder, not in %APPDATA%.
const dataDir = resolveDataDir({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  execPath: process.execPath,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
});
app.setPath('userData', path.join(dataDir, 'profile'));

ipcMain.handle('store:load', () => loadData(dataDir));
ipcMain.handle('store:save-layouts', (_event, store) => saveLayouts(dataDir, store));
ipcMain.handle('store:save-settings', (_event, settings) => saveSettings(dataDir, settings));

function startPoseFeed(win) {
  let telemetry = null;
  let lastTry = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    if (!telemetry && now - lastTry >= RETRY_MS) {
      lastTry = now;
      telemetry = openTelemetry();
    }
    if (!win.isDestroyed()) win.webContents.send('pose', telemetry ? telemetry.read() : null);
  }, POSE_PERIOD_MS);
  win.on('closed', () => clearInterval(timer));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Trucker AUX',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  win.loadFile(path.join(here, '../renderer/index.html'));
  startPoseFeed(win);
}

app.whenReady().then(() => {
  // The window needs an input device and output selection.
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
