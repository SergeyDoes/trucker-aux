// npm run test:engine: renders the engine offline in a hidden window and checks it in dB.
import { app, BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', path.join(os.tmpdir(), 'trucker-aux-engine-check'));

app.whenReady().then(() => {
  const timer = setTimeout(() => {
    console.error('Engine check timed out (the page probably failed to load).');
    app.exit(2);
  }, 60000);
  ipcMain.once('engine-check:done', (_event, result) => {
    clearTimeout(timer);
    console.log(result.report);
    app.exit(result.ok ? 0 : 1);
  });
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(here, 'engine-check-preload.cjs') } });
  win.loadFile(path.join(here, 'engine-check.html'));
});
