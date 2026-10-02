import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDataDir } from '../src/main/paths.js';

test('development: data folder inside the app folder', () => {
  const dir = resolveDataDir({ isPackaged: false, appPath: 'E:/Repos/x/app', execPath: 'C:/electron.exe' });
  assert.equal(dir, path.join('E:/Repos/x/app', 'data'));
});

test('packaged portable build: next to the portable exe', () => {
  const dir = resolveDataDir({ isPackaged: true, appPath: 'C:/tmp/app.asar', execPath: 'C:/tmp/x.exe', portableDir: 'D:/Tools/Trucker AUX' });
  assert.equal(dir, path.join('D:/Tools/Trucker AUX', 'data'));
});

test('packaged unpacked build: next to the executable', () => {
  const dir = resolveDataDir({ isPackaged: true, appPath: 'D:/T/resources/app.asar', execPath: 'D:/T/Trucker AUX.exe' });
  assert.equal(dir, path.join('D:/T', 'data'));
});
