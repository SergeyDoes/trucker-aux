import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadData, readJson, saveLayouts, writeJsonAtomic } from '../src/main/store.js';
import { defaultLayout, normalizeStore } from '../src/shared/layout.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trucker-aux-'));

test('readJson: a missing file is not an error', () => {
  assert.deepEqual(readJson(path.join(tempDir(), 'nope.json')), { value: null, warning: null });
});

test('writeJsonAtomic + readJson round trip, creating folders', () => {
  const file = path.join(tempDir(), 'deep', 'a.json');
  assert.equal(writeJsonAtomic(file, { a: 1 }), null);
  assert.deepEqual(readJson(file), { value: { a: 1 }, warning: null });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('readJson: a broken file is moved aside with a warning', () => {
  const dir = tempDir();
  const file = path.join(dir, 'layouts.json');
  fs.writeFileSync(file, '{ not json');
  const result = readJson(file, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.value, null);
  assert.match(result.warning, /layouts\.json was invalid and was moved to .*layouts\.json\.broken-2026-09-30T12-00-00-000Z/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('writeJsonAtomic: an unwritable path gives a warning', () => {
  const dir = tempDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  assert.match(writeJsonAtomic(path.join(blocker, 'a.json'), {}), /^Cannot save to /);
});

test('loadData: a fresh folder gives defaults without warnings', () => {
  const data = loadData(tempDir());
  assert.deepEqual(data.store.presets[data.store.assignments.all], defaultLayout());
  assert.deepEqual(data.settings, { version: 1, source: 'input', input: null, output: null, muteWhen: 'never', pauseBehavior: 'vehicle', matchLoudness: true, turnLook: { on: false, percent: 100, reverse: 'off', blinkers: false } });
  assert.deepEqual(data.warnings, []);
});

test('saveLayouts then loadData returns the same store', () => {
  const dir = tempDir();
  const store = normalizeStore({ version: 2, trucks: { k: { name: 'K', width: 0.3 } } });
  assert.equal(saveLayouts(dir, store), null);
  assert.deepEqual(loadData(dir).store, store);
});

test('loadData keeps a copy of an older layouts file once, before it is saved in the new format', () => {
  const dir = tempDir();
  const old = `${JSON.stringify({ version: 1, default: { field: { min: [-0.75, -1, -1], max: [1.55, 1, 1] } } })}\n`;
  fs.writeFileSync(path.join(dir, 'layouts.json'), old);
  const data = loadData(dir);
  assert.deepEqual(data.warnings, []);
  assert.equal(fs.readFileSync(path.join(dir, 'layouts.v1.json'), 'utf8'), old);
  // Saved in the new format and loaded again: the copy stays the old one.
  saveLayouts(dir, data.store);
  loadData(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'layouts.v1.json'), 'utf8'), old);
  // A file without a version is version 1 too; an up-to-date file gets no copy.
  const fresh = tempDir();
  saveLayouts(fresh, normalizeStore({}));
  loadData(fresh);
  assert.deepEqual(fs.readdirSync(fresh), ['layouts.json']);
});

test('loadData: a broken layouts file gives defaults and a warning', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'layouts.json'), '[1,');
  const data = loadData(dir);
  assert.deepEqual(data.store.presets[data.store.assignments.all], defaultLayout());
  assert.equal(data.warnings.length, 1);
});
