import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './paths.js';
import { loadData, saveLayouts, saveSettings } from './store.js';
import { openTelemetry } from './telemetry.js';
import { presetsDirFor, readCollection, watchCollection, writePresetFile } from './collection.js';
import { presetFileName } from '../shared/collection.js';

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

// Shared presets, one file each (collection.js): read with the store, again when the
// folder changes; Export writes a new file there and shows it in Explorer.
const presetsDir = presetsDirFor(dataDir);

ipcMain.handle('store:load', () => ({ ...loadData(dataDir), collection: readCollection(presetsDir) }));
ipcMain.handle('store:save-layouts', (_event, store) => saveLayouts(dataDir, store));
ipcMain.handle('store:save-settings', (_event, settings) => saveSettings(dataDir, settings));
ipcMain.handle('collection:export', (_event, fileName, data) => {
  // The name is made safe again here: a file goes into presets/ and nowhere else.
  const result = writePresetFile(presetsDir, presetFileName(String(fileName).replace(/\.json$/i, '')), data);
  if (result.file) shell.showItemInFolder(result.file);
  return result;
});

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
  const stopWatching = watchCollection(presetsDir, () => {
    if (!win.isDestroyed()) win.webContents.send('collection', readCollection(presetsDir));
  });
  win.on('closed', stopWatching);
}

app.whenReady().then(() => {
  // The window needs an input device and output selection.
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
