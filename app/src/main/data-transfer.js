// File › Import and Export of a whole data folder (main.js): your presets (layouts.json, and your
// preset files in presets/), your settings (settings.json), from or to another Trucker AUX folder.
// An import replaces what it brings, after a copy of the current files in data/backup-<time>/;
// the app then loads them as at a start (an older store is converted then: store.js, presets.js
// foldChassis). The defaults (presets/default/ of an older version) are never brought along.
import fs from 'node:fs';
import path from 'node:path';
import { jsonFiles } from './collection.js';

const LAYOUTS = 'layouts.json';
const SETTINGS = 'settings.json';

// What an import brings: 'all', 'presets' (layouts.json and the preset files) or 'settings'.
export const IMPORT_KINDS = ['all', 'presets', 'settings'];
const bringsPresets = (kind) => kind === 'all' || kind === 'presets';
const bringsSettings = (kind) => kind === 'all' || kind === 'settings';

const hasData = (dir) => [LAYOUTS, SETTINGS].some((file) => fs.existsSync(path.join(dir, file)));

// The data in a folder picked: an app folder (its data/), or a data folder itself. { dataDir,
// presetsDir } (presetsDir: the presets/ beside that data folder, maybe missing), or null.
export function findData(dir) {
  for (const dataDir of [path.join(dir, 'data'), dir]) {
    if (hasData(dataDir)) return { dataDir, presetsDir: path.join(path.dirname(dataDir), 'presets') };
  }
  return null;
}

// What a data folder holds for the import kind: [file names] there.
export function importable(source, kind) {
  return [bringsPresets(kind) && LAYOUTS, bringsSettings(kind) && SETTINGS].filter((f) => f && fs.existsSync(path.join(source.dataDir, f)));
}

// The local time as a folder name: 2026-10-14-12-30-05.
export const timeStamp = (now) => [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
  .map((n) => String(n).padStart(2, '0')).join('-');

// Copies the current layouts.json and settings.json into data/backup-<time>/. Gives its path.
export function backupData(dataDir, now = new Date()) {
  const backup = path.join(dataDir, `backup-${timeStamp(now)}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const file of [LAYOUTS, SETTINGS]) {
    if (fs.existsSync(path.join(dataDir, file))) fs.copyFileSync(path.join(dataDir, file), path.join(backup, file));
  }
  return backup;
}

// Your preset files (not the defaults) from one presets/ folder into another: the very same
// file there is left as it is, another one of that name makes "name (2).json". Gives how many
// were copied.
export function copyPresetFiles(from, to) {
  let copied = 0;
  for (const file of jsonFiles(from).filter((f) => !f.startsWith('default/'))) {
    const content = fs.readFileSync(path.join(from, file));
    const base = path.join(to, file).replace(/\.json$/i, '');
    let target = `${base}.json`;
    let same = false;
    for (let n = 2; fs.existsSync(target); n++) {
      if (fs.readFileSync(target).equals(content)) {
        same = true;
        break;
      }
      target = `${base} (${n}).json`;
    }
    if (same) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    copied++;
  }
  return copied;
}

// Brings the data of `source` (findData) into dataDir and presetsDir for the import kind, after
// a backup of the current files. { backup, files: [names replaced], presets: files copied }.
export function importData(source, kind, dataDir, presetsDir, now = new Date()) {
  const files = importable(source, kind);
  const backup = backupData(dataDir, now);
  for (const file of files) fs.copyFileSync(path.join(source.dataDir, file), path.join(dataDir, file));
  const presets = bringsPresets(kind) && fs.existsSync(source.presetsDir) && path.resolve(source.presetsDir) !== path.resolve(presetsDir)
    ? copyPresetFiles(source.presetsDir, presetsDir)
    : 0;
  return { backup, files, presets };
}

// All your data into a new folder `to`, laid out as an app folder (data/, presets/), so an
// import reads it back. Gives how many preset files went along.
export function exportData(dataDir, presetsDir, to) {
  fs.mkdirSync(path.join(to, 'data'), { recursive: true });
  for (const file of [LAYOUTS, SETTINGS]) {
    if (fs.existsSync(path.join(dataDir, file))) fs.copyFileSync(path.join(dataDir, file), path.join(to, 'data', file));
  }
  return fs.existsSync(presetsDir) ? copyPresetFiles(presetsDir, path.join(to, 'presets')) : 0;
}
