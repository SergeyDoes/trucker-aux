import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './paths.js';
import { loadData, saveLayouts, saveSettings, writeJsonAtomic } from './store.js';
import { openCamera, openTelemetry } from './telemetry.js';
import { createControls } from './controls.js';
import { createVoice } from './voice.js';
import { RELEASES_URL, checkForUpdates } from './updates.js';
import { IMPORT_KINDS, exportData, findData, importData, importable, timeStamp } from './data-transfer.js';
import { findGame, installPlugins, pluginPlan } from './game-plugins.js';
import { presetsDirFor, readCollection, watchCollection, writePresetSet } from './collection.js';
import { parsePresetFile, presetFileName } from '../shared/collection.js';
import { normalizeControls } from '../shared/controls.js';
import { dropImportedDefaults, foldChassis, seedAll } from '../shared/presets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POSE_PERIOD_MS = 10; // shared-memory polling, ~100 Hz
const RETRY_MS = 1000;     // how often to look for the memory while the game is not running
const WM_DEVICECHANGE = 0x0219;

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

// Crashes are kept for a look afterwards, never sent: Chromium's minidumps in data/crashes/, and
// a line each in data/crash.log for a process gone (the window's renderer, the GPU, …) or an
// error in this one. The app closing by itself with neither: a crash of this process (its dump).
// The folder is made first: Chromium's crash handler does not start where its parent is missing
// (the first run of a new unpack, before data/ exists).
const crashDumps = path.join(dataDir, 'crashes');
try {
  fs.mkdirSync(crashDumps, { recursive: true });
} catch {
  // no dumps then; the app runs
}
app.setPath('crashDumps', crashDumps);
crashReporter.start({ uploadToServer: false });
function crashLog(text) {
  try {
    fs.appendFileSync(path.join(dataDir, 'crash.log'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // nowhere to write it
  }
}
process.on('uncaughtExceptionMonitor', (err) => crashLog(`main: ${err?.stack ?? err}`));
process.on('unhandledRejection', (reason) => crashLog(`main, a promise: ${reason?.stack ?? reason}`));
app.on('render-process-gone', (_event, _contents, details) => crashLog(`renderer gone: ${details.reason} (${details.exitCode})`));
app.on('child-process-gone', (_event, details) => crashLog(`${details.type}${details.name ? ` (${details.name})` : ''} gone: ${details.reason} (${details.exitCode})`));

// Shared presets, one file each (collection.js): read with the store, again when the
// folder changes.
const presetsDir = presetsDirFor(dataDir);
// The presets that come with the app, inside it (app.asar in a build): a newer build replaces
// them whole, so unpacking it over an older one leaves no stale default behind.
const defaultsDir = path.join(app.getAppPath(), 'presets', 'default');

// A new store (no layouts.json yet) starts with the default preset for all vehicles (seedAll);
// one from 0.1.1 lets its copies of the defaults give way to them (dropImportedDefaults). Presets
// an older store has on chassis keys become variants of their model, the hooks remembering them
// (foldChassis): saved with the next change.
ipcMain.handle('store:load', () => {
  const data = loadData(dataDir);
  const shared = readCollection(presetsDir, defaultsDir);
  if (data.fresh) data.store = seedAll(data.store, shared.collection);
  if (data.store.defaultsImported) {
    data.store = dropImportedDefaults(data.store, shared.collection);
    const warning = saveLayouts(dataDir, data.store);
    if (warning) data.warnings.push(warning);
  }
  data.store = foldChassis(data.store);
  if (importNotice) data.warnings.push(importNotice);
  importNotice = null;
  return { ...data, collection: shared, debug };
});

// File › Import › data of another folder (data-transfer.js): asked which folder, then whether to
// replace (the current files are backed up first). The window reloads after { ok }, and the next
// load says what came from where.
let importNotice = null;
const IMPORT_WHAT = { all: 'presets and settings', presets: 'presets', settings: 'settings' };
ipcMain.handle('data:import', async (event, kind) => {
  if (!IMPORT_KINDS.includes(kind)) return { canceled: true };
  const win = BrowserWindow.fromWebContents(event.sender);
  const what = IMPORT_WHAT[kind];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: `Import ${what} from another Trucker AUX folder`,
    defaultPath: path.dirname(path.dirname(dataDir)),
    buttonLabel: 'Import',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const source = findData(filePaths[0]);
  if (!source) return { warning: `No Trucker AUX data in ${filePaths[0]}: pick the folder of another version, or its data folder.` };
  if (path.resolve(source.dataDir) === path.resolve(dataDir)) return { warning: 'That is this app\'s own data.' };
  const files = importable(source, kind);
  if (!files.length) return { warning: `No ${kind === 'settings' ? 'settings.json' : 'layouts.json'} in ${source.dataDir}.` };
  const presetFiles = kind !== 'settings' && fs.existsSync(source.presetsDir) ? ', and your preset files from its presets folder' : '';
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Import data',
    message: `Replace your ${what} with those in "${path.dirname(source.dataDir)}"?`,
    detail: `Brought: ${files.join(', ')}${presetFiles}. The current files are kept in a backup folder in data first.`,
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return { canceled: true };
  try {
    const done = importData(source, kind, dataDir, presetsDir);
    const copied = done.presets ? ` with ${done.presets} preset file(s)` : '';
    importNotice = `Imported ${what}${copied} from ${path.dirname(source.dataDir)}. The previous ones are in ${done.backup}.`;
    return { ok: true };
  } catch (err) {
    return { warning: `Import failed: ${err.message}` };
  }
});

// File › Export › All data: your data folder's files and preset files into a new folder, laid out
// as an app folder (an import reads it back).
let dataExportDir = null;
ipcMain.handle('data:export', async (event) => {
  const day = timeStamp(new Date()).slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Export all data into a folder',
    defaultPath: path.join(dataExportDir ?? app.getPath('documents'), `Trucker AUX data ${day}`),
    buttonLabel: 'Export',
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return { canceled: true };
  dataExportDir = path.dirname(filePath);
  try {
    const presets = exportData(dataDir, presetsDir, filePath);
    shell.openPath(filePath);
    return { path: filePath, presets };
  } catch (err) {
    return { warning: `Export failed: ${err.message}` };
  }
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

// The cab's keys and controller buttons (controls.js), and the voice that says what plays then
// (voice.js), for the window; a warning goes to its list.
let mainWindow = null;
const toWindow = (channel, value) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
};
const controls = createControls({ onAction: (action) => toWindow('controls:action', action), onError: (message) => toWindow('controls:warning', message) });
const voice = createVoice({ onError: (message) => toWindow('controls:warning', message) });
ipcMain.handle('controls:set', (_event, bindings) => controls.setBindings(normalizeControls(bindings)));
ipcMain.handle('controls:capture', () => controls.capture());
ipcMain.handle('controls:cancel', () => controls.cancelCapture());
ipcMain.handle('controls:names', () => controls.names());
ipcMain.handle('voice:warm', () => voice.warm());
ipcMain.handle('voice:speak', async (_event, text) => {
  const wav = await voice.speak(text);
  return wav ? new Uint8Array(wav) : null;
});
app.on('will-quit', () => {
  controls.stop();
  voice.stop();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 800,
    title: 'Trucker AUX',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  win.loadFile(path.join(here, '../renderer/index.html'));
  mainWindow = win;
  // A controller plugged in or out: the input poller looks for the controllers again.
  if (process.platform === 'win32') win.hookWindowMessage(WM_DEVICECHANGE, () => controls.devicesChanged());
  startPoseFeed(win);
  const stopWatching = watchCollection(presetsDir, () => {
    if (!win.isDestroyed()) win.webContents.send('collection', readCollection(presetsDir, defaultsDir));
  });
  win.on('closed', stopWatching);
}

// Help › Install game plugins (game-plugins.js): the app's plugin/ folder (beside data/, from
// source app/plugin/) into the game folder picked, after a look at what is there and a yes.
const pluginDir = path.join(path.dirname(dataDir), 'plugin');
const STEAM_GAMES = 'C:\\Program Files (x86)\\Steam\\steamapps\\common';
const PLAN_TEXT = { new: 'added', same: 'already there', other: 'replaces another build (kept beside it as .backup-<time>)' };
let gamesDir = null;
async function installGamePlugins() {
  const tell = (type, message, detail = '') => dialog.showMessageBox(mainWindow, { type, title: 'Install game plugins', message, detail });
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'The folder of American Truck Simulator or Euro Truck Simulator 2',
    defaultPath: gamesDir ?? (fs.existsSync(STEAM_GAMES) ? STEAM_GAMES : undefined),
    buttonLabel: 'Install here',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths.length) return;
  const game = findGame(filePaths[0]);
  if (!game) {
    tell('warning', 'No ATS or ETS2 there.', `Pick the game's folder, the one with bin\\win_x64\\amtrucks.exe or eurotrucks2.exe (${filePaths[0]}).`);
    return;
  }
  gamesDir = path.dirname(game.root);
  const plan = pluginPlan(pluginDir, game.pluginsDir);
  const missing = plan.filter((p) => p.state === 'missing').map((p) => p.file);
  if (missing.length) {
    tell('warning', 'The app has no plugins to install.', `${missing.join(', ')} not in ${pluginDir}: unpack the release again.`);
    return;
  }
  if (plan.every((p) => p.state === 'same')) {
    tell('info', `${game.name} has these plugins already.`, game.pluginsDir);
    return;
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Install game plugins',
    message: `Install the plugins into ${game.name}?`,
    detail: `${game.pluginsDir}\n${plan.map((p) => `${p.file}: ${PLAN_TEXT[p.state]}`).join('\n')}`,
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    installPlugins(pluginDir, game.pluginsDir);
    tell('info', `Installed into ${game.name}.`, 'The game loads them when it starts (restart it if it runs) and asks about "advanced SDK features": accept.');
  } catch (err) {
    tell('error', 'The plugins were not installed.', err.message);
  }
}

// Help › Open crash log: data/crash.log in its editor, and data/crashes/ when it holds a dump.
function openCrashLog() {
  const log = path.join(dataDir, 'crash.log');
  const dumps = path.join(dataDir, 'crashes');
  let hasDump = false;
  try {
    hasDump = fs.readdirSync(dumps, { recursive: true }).some((file) => /\.dmp$/i.test(file));
  } catch {
    // no dumps folder
  }
  if (fs.existsSync(log)) shell.openPath(log);
  if (hasDump) shell.openPath(dumps);
  if (!hasDump && !fs.existsSync(log)) {
    dialog.showMessageBox(mainWindow, { type: 'info', title: 'Crash log', message: 'No crashes recorded.', detail: dataDir });
  }
}

// Edit › Undo / Redo follow the window's history (app.js render): there is something to undo or not.
ipcMain.on('menu:history', (_event, can) => {
  for (const id of ['undo', 'redo']) {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item) item.enabled = Boolean(can?.[id]);
  }
});

// The menu bar: File (Import and Export of data and presets, the data folder), Edit (Undo, Redo),
// View (Reset panel layout), Help (the update check, asked only when pressed, the releases page,
// the game plugins, the crash log, the version). The debug tools add Electron's reload and
// DevTools to View, and its Window menu.
function appMenu() {
  const help = {
    label: 'Help',
    submenu: [
      { label: 'Check for updates…', click: () => checkForUpdates(mainWindow) },
      { label: 'Releases page', click: () => shell.openExternal(RELEASES_URL) },
      { type: 'separator' },
      { label: 'Install game plugins…', click: () => installGamePlugins() },
      { label: 'Open crash log', click: openCrashLog },
      { type: 'separator' },
      {
        label: 'About Trucker AUX',
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'About Trucker AUX', message: `Trucker AUX ${app.getVersion()}`, detail: RELEASES_URL.replace(/\/releases$/, ''),
        }),
      },
    ],
  };
  // Most items are the window's to carry out (app.js onMenu): it saves first, and reloads after
  // an import.
  const toWindowMenu = (action) => () => toWindow('menu', action);
  const fileMenu = {
    label: 'File',
    submenu: [
      {
        label: 'Import',
        submenu: [
          { label: 'Data from older version…', click: toWindowMenu('import-data:all') },
          { label: 'From data (only presets)…', click: toWindowMenu('import-data:presets') },
          { label: 'From data (only settings)…', click: toWindowMenu('import-data:settings') },
          { type: 'separator' },
          { label: 'Preset files…', click: toWindowMenu('import-presets') },
        ],
      },
      {
        label: 'Export',
        submenu: [
          { label: 'All data…', click: toWindowMenu('export-data') },
          { label: 'All presets…', click: toWindowMenu('export-all-presets') },
          { label: 'Presets…', click: toWindowMenu('export-presets') },
        ],
      },
      { label: 'Open data folder', click: () => shell.openPath(dataDir) },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  // The keys stay the window's (registerAccelerator: false): Ctrl+Z in a text field undoes its text.
  const editMenu = {
    label: 'Edit',
    submenu: [
      { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, enabled: false, click: toWindowMenu('undo') },
      { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, enabled: false, click: toWindowMenu('redo') },
    ],
  };
  const viewMenu = {
    label: 'View',
    submenu: [
      { label: 'Reset panel layout', click: toWindowMenu('reset-layout') },
      ...(debug ? [{ type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] : []),
    ],
  };
  const tools = debug ? [{ role: 'windowMenu' }] : [];
  return Menu.buildFromTemplate([fileMenu, editMenu, viewMenu, ...tools, help]);
}

app.whenReady().then(() => {
  // The window needs an input device and output selection.
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  Menu.setApplicationMenu(appMenu());
  createWindow();
});
app.on('window-all-closed', () => app.quit());
