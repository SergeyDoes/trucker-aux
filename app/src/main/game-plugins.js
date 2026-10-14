// Help › Install game plugins (main.js): the two plugins the app ships in plugin/ copied into
// bin/win_x64/plugins/ of the ATS or ETS2 folder the user picks. Of the game only its exe is
// looked for (and the plugins already there compared); its configs are never read. A plugin
// there of another build is renamed <file>.backup-<time> first: not a .dll, so the game does not
// load it, and a running game keeps the one it loaded (renaming a loaded DLL works where
// overwriting it does not), taking the new one at its next start.
import fs from 'node:fs';
import path from 'node:path';
import { timeStamp } from './data-transfer.js';

export const PLUGINS = ['scs-telemetry.dll', 'trucker_aux_camera.dll'];
const GAMES = [['amtrucks.exe', 'American Truck Simulator'], ['eurotrucks2.exe', 'Euro Truck Simulator 2']];

// The game in a folder picked: the game's folder or one inside it (bin, win_x64, plugins).
// { root, name, pluginsDir } or null.
export function findGame(dir) {
  for (let root = path.resolve(dir), up = 0; up < 4; up++, root = path.dirname(root)) {
    const found = GAMES.find(([exe]) => fs.existsSync(path.join(root, 'bin', 'win_x64', exe)));
    if (found) return { root, name: found[1], pluginsDir: path.join(root, 'bin', 'win_x64', 'plugins') };
    if (path.dirname(root) === root) break;
  }
  return null;
}

// What an install would do with each plugin: [{ file, state }], state 'new', 'same' (that very
// file there), 'other' (another build there) or 'missing' (not in the app's plugin/).
export function pluginPlan(fromDir, pluginsDir) {
  return PLUGINS.map((file) => {
    const from = path.join(fromDir, file);
    const to = path.join(pluginsDir, file);
    if (!fs.existsSync(from)) return { file, state: 'missing' };
    if (!fs.existsSync(to)) return { file, state: 'new' };
    return { file, state: fs.readFileSync(to).equals(fs.readFileSync(from)) ? 'same' : 'other' };
  });
}

// Copies the plugins that are new or of another build (that one renamed as a backup first, put
// back if the copy fails). Gives [backup paths]; throws as fs does (no write access, …).
export function installPlugins(fromDir, pluginsDir, now = new Date()) {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const backups = [];
  for (const { file, state } of pluginPlan(fromDir, pluginsDir)) {
    if (state !== 'new' && state !== 'other') continue;
    const to = path.join(pluginsDir, file);
    const backup = state === 'other' ? `${to}.backup-${timeStamp(now)}` : null;
    if (backup) fs.renameSync(to, backup);
    try {
      fs.copyFileSync(path.join(fromDir, file), to);
    } catch (err) {
      if (backup) fs.renameSync(backup, to);
      throw err;
    }
    if (backup) backups.push(backup);
  }
  return backups;
}
