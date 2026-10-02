import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  presetsDirFor, readCollection, watchCollection, writePresetFile,
} from '../src/main/collection.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trucker-aux-presets-'));
const preset = (name, vehicle) => JSON.stringify({ truckerAuxPreset: 1, name, vehicle, layout: { width: 1 } });

function put(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

test('presets/ sits next to the data folder', () => {
  assert.equal(presetsDirFor(path.join('E:', 'app', 'data')), path.join('E:', 'app', 'presets'));
});

test('readCollection reads every preset file, subfolders too, and skips the rest with a warning', () => {
  const dir = tempDir();
  put(dir, 'a.json', preset('A', 'vehicle.a'));
  put(dir, 'kenworth/t680.json', `﻿${preset('T680', 'vehicle.kenworth.t680@2.7')}`); // with a BOM
  put(dir, 'broken.json', '{ not json');
  put(dir, 'other.json', '{"foo": 1}');
  put(dir, 'readme.txt', 'not a preset');
  const before = fs.readFileSync(path.join(dir, 'broken.json'), 'utf8');
  const { collection, warnings } = readCollection(dir);
  assert.deepEqual(Object.keys(collection), ['file:a.json', 'file:kenworth/t680.json']);
  assert.equal(collection['file:kenworth/t680.json'].vehicle, 'vehicle.kenworth.t680@2.7');
  assert.deepEqual(warnings, [
    'presets/broken.json is not valid JSON.',
    'presets/other.json is not a Trucker AUX preset.',
  ]);
  // Not our files: never moved or changed.
  assert.equal(fs.readFileSync(path.join(dir, 'broken.json'), 'utf8'), before);
});

test('readCollection: no folder, no presets and no warnings', () => {
  assert.deepEqual(readCollection(path.join(tempDir(), 'missing')), { collection: {}, warnings: [] });
});

test('writePresetFile writes under a free name and creates the folder', () => {
  const dir = path.join(tempDir(), 'presets');
  const data = JSON.parse(preset('Cab', 'vehicle.a'));
  const first = writePresetFile(dir, 'Cab.json', data);
  const second = writePresetFile(dir, 'Cab.json', data);
  assert.deepEqual(first, { file: path.join(dir, 'Cab.json'), warning: null });
  assert.deepEqual(second, { file: path.join(dir, 'Cab (2).json'), warning: null });
  assert.deepEqual(Object.keys(readCollection(dir).collection), ['file:Cab (2).json', 'file:Cab.json']);
});

test('watchCollection calls back once the folder settles after a change', async () => {
  const dir = path.join(tempDir(), 'presets');
  let calls = 0;
  const stop = watchCollection(dir, () => { calls++; }, 100);
  assert.equal(fs.existsSync(dir), true); // created for watching
  put(dir, 'new.json', preset('New', 'vehicle.a'));
  put(dir, 'second.json', preset('Second', 'vehicle.a'));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  stop();
  assert.equal(calls, 1);
});
