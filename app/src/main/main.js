import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron';
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

// Debug tools (the test file source, the default menu with DevTools and reload):
// when run from source, or in a build started with --dev-tools (Electron rejects --debug as an old Node flag).
const debug = !app.isPackaged || process.argv.includes('--dev-tools');

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

ipcMain.handle('store:load', () => ({ ...loadData(dataDir), collection: readCollection(presetsDir), debug }));
ipcMain.handle('store:save-layouts', (_event, store) => saveLayouts(dataDir, store));
ipcMain.handle('store:save-settings', (_event, settings) => saveSettings(dataDir, settings));
ipcMain.handle('collection:export', (_event, fileName, data) => {
  // The name is made safe again here: a file goes into presets/ and nowhere else.
  const result = writePresetFile(presetsDir, presetFileName(String(fileName).replace(/\.json$/i, '')), data);
  if (result.file) shell.showItemInFolder(result.file);
  return result;
});

// Debug only: TRUCKER_AUX_FAKE_TRUCK='{"key":"vehicle.x.y","name":"X Y","variant":"3.2",...}'
// stands for the game, for trying the preset card without it (on a Mac too). The truck's
// fields as parsePose gives them; the head looks straight ahead.
function fakeTelemetry() {
  const json = debug && process.env.TRUCKER_AUX_FAKE_TRUCK;
  if (!json) return null;
  const truck = { variant: null, plate: null, quickJob: false, game: 'ats', brand: null, brandName: null, centerX: 0.45, ...JSON.parse(json) };
  const start = Date.now();
  return {
    read: () => ({
      sdkActive: true, paused: false, renderTime: (Date.now() - start) * 1000, steer: 0, gear: 1, electricOn: true, engineOn: true,
      blinkers: { left: false, right: false }, head: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }, truck,
    }),
  };
}

function startPoseFeed(win) {
  let telemetry = fakeTelemetry();
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
  if (!debug) Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
