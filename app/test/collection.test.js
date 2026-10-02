import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionLabel, isCollectionKey, parsePresetFile, presetFile, presetFileName,
} from '../src/shared/collection.js';
import { defaultLayout } from '../src/shared/layout.js';

const SHARED = {
  truckerAuxPreset: 1,
  name: 'Kenworth T680 2014, sleeper',
  vehicle: 'vehicle.kenworth.t680@2.7',
  vehicleName: 'Kenworth T680 2014',
  author: 'SergeyDoes',
  layout: { width: 1.2, speakers: [{ id: 'a', name: 'Door L', channel: 'L', position: [-0.6, -0.5, -0.3] }] },
};

test('parsePresetFile reads a shared preset; its key is the file inside presets/', () => {
  const { entry, warning } = parsePresetFile(SHARED, 'kenworth/t680.json');
  assert.equal(warning, undefined);
  assert.equal(entry.key, 'file:kenworth/t680.json');
  assert.equal(isCollectionKey(entry.key), true);
  assert.equal(isCollectionKey('vehicle.kenworth.t680'), false);
  assert.equal(entry.file, 'kenworth/t680.json');
  assert.equal(entry.name, 'Kenworth T680 2014, sleeper');
  assert.equal(entry.vehicle, 'vehicle.kenworth.t680@2.7');
  assert.equal(entry.vehicleName, 'Kenworth T680 2014');
  assert.equal(entry.author, 'SergeyDoes');
  assert.equal(entry.layout.name, 'Kenworth T680 2014, sleeper');
  assert.equal(entry.layout.width, 1.2);
  assert.deepEqual(entry.layout.speakers.map((s) => [s.id, s.name, s.channel]), [['a', 'Door L', 'L']]);
  assert.equal(collectionLabel(entry), 'Kenworth T680 2014, sleeper — SergeyDoes');
});

test('parsePresetFile: the name falls back to the file name; a plate is never a vehicle', () => {
  const { entry } = parsePresetFile({ truckerAuxPreset: 1, layout: {} }, 'sub/My cab.json');
  assert.equal(entry.name, 'My cab');
  assert.equal(entry.vehicle, null);
  assert.equal(entry.vehicleName, null);
  assert.equal(entry.author, null);
  assert.equal(collectionLabel(entry), 'My cab');
  assert.equal(parsePresetFile({ ...SHARED, vehicle: 'vehicle.kenworth.t680#WP-83695' }, 'a.json').entry.vehicle, null);
  assert.equal(parsePresetFile({ ...SHARED, vehicle: 42 }, 'a.json').entry.vehicle, null);
});

test('parsePresetFile: anything else is skipped with a warning naming the file', () => {
  assert.deepEqual(parsePresetFile(null, 'a.json'), { warning: 'presets/a.json is not a Trucker AUX preset.' });
  assert.deepEqual(parsePresetFile({ name: 'x' }, 'a.json'), { warning: 'presets/a.json is not a Trucker AUX preset.' });
  assert.deepEqual(parsePresetFile({ truckerAuxPreset: 1 }, 'a.json'), { warning: 'presets/a.json has no layout.' });
  assert.deepEqual(parsePresetFile({ truckerAuxPreset: 2, layout: {} }, 'a.json'), {
    warning: 'presets/a.json is made by a newer Trucker AUX (format 2).',
  });
});

test('presetFile writes what parsePresetFile reads; empty fields are left out', () => {
  const layout = { ...defaultLayout(), name: 'Cab' };
  const data = presetFile({ name: 'Cab', vehicle: 'vehicle.a@1.5', vehicleName: 'A', layout });
  assert.deepEqual(Object.keys(data), ['truckerAuxPreset', 'name', 'vehicle', 'vehicleName', 'layout']);
  assert.deepEqual(Object.keys(data.layout), ['width', 'bounds', 'speakers']);
  assert.deepEqual(parsePresetFile(data, 'Cab.json').entry.layout, layout);
  assert.deepEqual(Object.keys(presetFile({ name: 'Cab', vehicle: null, vehicleName: null, layout })), ['truckerAuxPreset', 'name', 'layout']);
});

test('presetFileName makes a safe Windows file name', () => {
  assert.equal(presetFileName('Kenworth T680 2014, hook 2.7 m'), 'Kenworth T680 2014, hook 2.7 m.json');
  assert.equal(presetFileName('A/B: "C"?*'), 'A-B- -C---.json');
  assert.equal(presetFileName('  dots and spaces.  '), 'dots and spaces.json');
  assert.equal(presetFileName(''), 'preset.json');
  assert.equal(presetFileName('x'.repeat(200)).length, 80 + '.json'.length);
});
