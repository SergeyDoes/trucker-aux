import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGame, installPlugins, pluginPlan } from '../src/main/game-plugins.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trucker-aux-plugins-'));
const put = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

// The app's plugin/ folder, and a game folder (its exe, maybe plugins already there).
function shipped() {
  const dir = tempDir();
  put(dir, 'scs-telemetry.dll', 'TELEMETRY');
  put(dir, 'trucker_aux_camera.dll', 'CAMERA');
  return dir;
}
function game(exe = 'amtrucks.exe') {
  const root = path.join(tempDir(), 'American Truck Simulator');
  put(root, `bin/win_x64/${exe}`, 'EXE');
  return root;
}

test('findGame: the game folder or one inside it, ATS or ETS2; else null', () => {
  const ats = game();
  const plugins = path.join(ats, 'bin', 'win_x64', 'plugins');
  assert.deepEqual(findGame(ats), { root: ats, name: 'American Truck Simulator', pluginsDir: plugins });
  assert.equal(findGame(path.join(ats, 'bin', 'win_x64')).root, ats);
  fs.mkdirSync(plugins);
  assert.equal(findGame(plugins).root, ats);
  assert.equal(findGame(game('eurotrucks2.exe')).name, 'Euro Truck Simulator 2');
  assert.equal(findGame(tempDir()), null);
});

test('pluginPlan: new, the same, another build, or missing from the app', () => {
  const from = shipped();
  const plugins = path.join(game(), 'bin', 'win_x64', 'plugins');
  assert.deepEqual(pluginPlan(from, plugins).map((p) => p.state), ['new', 'new']);
  put(plugins, 'scs-telemetry.dll', 'TELEMETRY');
  put(plugins, 'trucker_aux_camera.dll', 'OLDER CAMERA');
  assert.deepEqual(pluginPlan(from, plugins).map((p) => [p.file, p.state]), [['scs-telemetry.dll', 'same'], ['trucker_aux_camera.dll', 'other']]);
  fs.rmSync(path.join(from, 'scs-telemetry.dll'));
  assert.equal(pluginPlan(from, plugins)[0].state, 'missing');
});

test('installPlugins: the plugins folder made; another build kept beside as a backup, the same left alone', () => {
  const from = shipped();
  const plugins = path.join(game(), 'bin', 'win_x64', 'plugins');
  assert.deepEqual(installPlugins(from, plugins), []);
  assert.deepEqual([read(plugins, 'scs-telemetry.dll'), read(plugins, 'trucker_aux_camera.dll')], ['TELEMETRY', 'CAMERA']);
  put(plugins, 'trucker_aux_camera.dll', 'OLDER CAMERA');
  const backups = installPlugins(from, plugins, new Date(2026, 9, 14, 9, 5, 0));
  assert.deepEqual(backups, [path.join(plugins, 'trucker_aux_camera.dll.backup-2026-10-14-09-05-00')]);
  assert.equal(read(plugins, 'trucker_aux_camera.dll'), 'CAMERA');
  assert.equal(fs.readFileSync(backups[0], 'utf8'), 'OLDER CAMERA');
  assert.deepEqual(fs.readdirSync(plugins).filter((f) => f.endsWith('.dll')).sort(), ['scs-telemetry.dll', 'trucker_aux_camera.dll']);
});
