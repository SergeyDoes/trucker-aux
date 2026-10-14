import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupData, copyPresetFiles, exportData, findData, importData, importable } from '../src/main/data-transfer.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trucker-aux-transfer-'));
const put = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

// An older version's folder: data/ with both files, its presets/ with a file of others and the defaults.
function olderApp() {
  const app = tempDir();
  put(app, 'data/layouts.json', '{"version":3,"old":true}');
  put(app, 'data/settings.json', '{"version":1,"old":true}');
  put(app, 'presets/theirs.json', 'THEIRS');
  put(app, 'presets/default/Default layout.json', 'DEFAULT');
  return app;
}

// This version's folder.
function currentApp() {
  const app = tempDir();
  put(app, 'data/layouts.json', '{"version":3,"current":true}');
  put(app, 'data/settings.json', '{"version":1,"current":true}');
  return { app, data: path.join(app, 'data'), presets: path.join(app, 'presets') };
}

test('findData: an app folder (its data/) or a data folder itself, else null', () => {
  const app = olderApp();
  assert.deepEqual(findData(app), { dataDir: path.join(app, 'data'), presetsDir: path.join(app, 'presets') });
  assert.deepEqual(findData(path.join(app, 'data')), { dataDir: path.join(app, 'data'), presetsDir: path.join(app, 'presets') });
  assert.equal(findData(tempDir()), null);
  assert.deepEqual(importable(findData(app), 'settings'), ['settings.json']);
  assert.deepEqual(importable(findData(app), 'all'), ['layouts.json', 'settings.json']);
});

test('importData: all of it replaced after a backup; your preset files along, not the defaults', () => {
  const older = olderApp();
  const now = currentApp();
  const done = importData(findData(older), 'all', now.data, now.presets, new Date(2026, 9, 14, 12, 30, 5));
  assert.equal(done.backup, path.join(now.data, 'backup-2026-10-14-12-30-05'));
  assert.deepEqual([done.files, done.presets], [['layouts.json', 'settings.json'], 1]);
  assert.equal(read(now.data, 'layouts.json'), '{"version":3,"old":true}');
  assert.equal(read(now.data, 'settings.json'), '{"version":1,"old":true}');
  assert.equal(read(done.backup, 'layouts.json'), '{"version":3,"current":true}');
  assert.equal(read(now.presets, 'theirs.json'), 'THEIRS');
  assert.equal(fs.existsSync(path.join(now.presets, 'default')), false);
});

test('importData: only the presets, or only the settings', () => {
  const older = olderApp();
  const presets = currentApp();
  importData(findData(older), 'presets', presets.data, presets.presets);
  assert.deepEqual([read(presets.data, 'layouts.json'), read(presets.data, 'settings.json')], ['{"version":3,"old":true}', '{"version":1,"current":true}']);
  assert.ok(fs.existsSync(path.join(presets.presets, 'theirs.json')));
  const settings = currentApp();
  const done = importData(findData(older), 'settings', settings.data, settings.presets);
  assert.deepEqual([read(settings.data, 'layouts.json'), read(settings.data, 'settings.json')], ['{"version":3,"current":true}', '{"version":1,"old":true}']);
  assert.equal(done.presets, 0);
  assert.equal(fs.existsSync(settings.presets), false);
});

test('copyPresetFiles: the very same file is left as it is; another of that name becomes "name (2)"', () => {
  const from = tempDir();
  const to = tempDir();
  put(from, 'same.json', 'A');
  put(from, 'clash.json', 'NEW');
  put(from, 'sub/deep.json', 'D');
  put(to, 'same.json', 'A');
  put(to, 'clash.json', 'OLD');
  assert.equal(copyPresetFiles(from, to), 2);
  assert.deepEqual([read(to, 'clash.json'), read(to, 'clash (2).json'), read(to, 'sub/deep.json')], ['OLD', 'NEW', 'D']);
  assert.equal(copyPresetFiles(from, to), 0); // again: all there
});

test('exportData: laid out as an app folder, which findData reads back; backupData copies both files', () => {
  const now = currentApp();
  put(now.presets, 'mine.json', 'MINE');
  put(now.presets, 'default/x.json', 'DEFAULT');
  const to = path.join(tempDir(), 'Trucker AUX data');
  assert.equal(exportData(now.data, now.presets, to), 1);
  assert.deepEqual(findData(to), { dataDir: path.join(to, 'data'), presetsDir: path.join(to, 'presets') });
  assert.equal(read(path.join(to, 'data'), 'settings.json'), '{"version":1,"current":true}');
  assert.equal(fs.existsSync(path.join(to, 'presets', 'default')), false);
  const backup = backupData(now.data, new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(path.basename(backup), 'backup-2026-01-02-03-04-05');
  assert.deepEqual(fs.readdirSync(backup).sort(), ['layouts.json', 'settings.json']);
});
