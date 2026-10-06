import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './paths.js';
import { loadData, saveLayouts, saveSettings, writeJsonAtomic } from './store.js';
import { openCamera, openTelemetry } from './telemetry.js';
import { presetsDirFor, readCollection, watchCollection, writePresetSet } from './collection.js';
import { parsePresetFile, presetFileName } from '../shared/collection.js';
import { dropImportedDefaults, seedAll } from '../shared/presets.js';

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
// folder changes.
const presetsDir = presetsDirFor(dataDir);

// A new store (no layouts.json yet) starts with the default preset for all vehicles (seedAll);
// one from 0.1.1 lets its copies of the defaults give way to them (dropImportedDefaults).
ipcMain.handle('store:load', () => {
  const data = loadData(dataDir);
  const shared = readCollection(presetsDir);
  if (data.fresh) data.store = seedAll(data.store, shared.collection);
  if (data.store.defaultsImported) {
    data.store = dropImportedDefaults(data.store, shared.collection);
    const warning = saveLayouts(dataDir, data.store);
    if (warning) data.warnings.push(warning);
  }
  return { ...data, collection: shared, debug };
});
ipcMain.handle('store:save-layouts', (_event, store) => saveLayouts(dataDir, store));
ipcMain.handle('store:save-settings', (_event, settings) => saveSettings(dataDir, settings));
// Export (the export window's ticked presets, as files): where to, asked as Save As does;
// one preset is a file, more a folder of them. Shown in Explorer. Offered first in presets/
// (where it joins the collection at once), then where the last one went.
let exportDir = null;
ipcMain.handle('collection:export', async (event, files, name) => {
  const one = files.length === 1;
  const safe = presetFileName(String(one ? files[0].fileName : name).replace(/\.json$/i, ''));
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: one ? 'Export the preset' : `Export ${files.length} presets into a folder`,
    defaultPath: path.join(exportDir ?? presetsDir, one ? safe : safe.replace(/\.json$/i, '')),
    buttonLabel: 'Export',
    filters: one ? [{ name: 'Trucker AUX preset', extensions: ['json'] }] : [],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return { canceled: true };
  exportDir = path.dirname(filePath);
  if (one) {
    const warning = writeJsonAtomic(filePath, files[0].data);
    if (!warning) shell.showItemInFolder(filePath);
    return { path: filePath, written: warning ? 0 : 1, warning };
  }
  const result = writePresetSet(filePath, files.map((f) => ({ fileName: presetFileName(String(f.fileName).replace(/\.json$/i, '')), data: f.data })));
  if (result.written) shell.openPath(filePath);
  return { path: filePath, ...result };
});

// Import: preset files picked as Open does, parsed (collection.js). { entries, warnings }, or
// { canceled }. The entries carry no "file:" key: they are not in the collection.
let importDir = null;
ipcMain.handle('collection:import', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Import presets',
    defaultPath: importDir ?? presetsDir,
    buttonLabel: 'Import',
    filters: [{ name: 'Trucker AUX presets', extensions: ['json'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  importDir = path.dirname(filePaths[0]);
  const entries = [];
  const warnings = [];
  for (const file of filePaths) {
    const name = path.basename(file);
    let parsed;
    try {
      parsed = parsePresetFile(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), name); // never changed, broken or not
    } catch {
      parsed = { warning: `${name} is not valid JSON.` };
    }
    if (parsed.entry) entries.push({ ...parsed.entry, key: null });
    else warnings.push(parsed.warning.replace(`presets/${name}`, name));
  }
  return { entries, warnings };
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
  // The game camera from trucker_aux_camera.dll, when it is installed (shared/camera.js).
  let camera = null;
  let lastCameraTry = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    if (!telemetry && now - lastTry >= RETRY_MS) {
      lastTry = now;
      telemetry = openTelemetry();
    }
    if (!camera && now - lastCameraTry >= RETRY_MS) {
      lastCameraTry = now;
      camera = openCamera();
    }
    const pose = telemetry ? telemetry.read() : null;
    if (pose) pose.camera = camera ? camera.read() : null;
    if (!win.isDestroyed()) win.webContents.send('pose', pose);
  }, POSE_PERIOD_MS);
  win.on('closed', () => clearInterval(timer));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
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
