import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY, boxSelect, clickSelect, pruneSelection, selectAll,
} from '../src/shared/selection.js';

const ORDER = ['s1', 's2', 's3', 's4'];

test('a plain click selects only that speaker; empty space clears', () => {
  const sel = { ids: ['s1', 's3'], primary: 's3' };
  assert.deepEqual(clickSelect(sel, 's2', {}, ORDER), { ids: ['s2'], primary: 's2' });
  assert.deepEqual(clickSelect(sel, null, {}, ORDER), EMPTY);
  assert.deepEqual(clickSelect(sel, null, { toggle: true }, ORDER), sel);
});

test('ctrl+click adds or removes, keeping the list order', () => {
  let sel = clickSelect(EMPTY, 's3', {}, ORDER);
  sel = clickSelect(sel, 's1', { toggle: true }, ORDER);
  assert.deepEqual(sel, { ids: ['s1', 's3'], primary: 's1' });
  sel = clickSelect(sel, 's1', { toggle: true }, ORDER);
  assert.deepEqual(sel, { ids: ['s3'], primary: 's3' });
  assert.deepEqual(clickSelect(sel, 's3', { toggle: true }, ORDER), EMPTY);
});

test('shift+click selects the range from the primary, which stays the anchor', () => {
  const sel = clickSelect(EMPTY, 's2', {}, ORDER);
  assert.deepEqual(clickSelect(sel, 's4', { range: true }, ORDER), { ids: ['s2', 's3', 's4'], primary: 's2' });
  assert.deepEqual(clickSelect(sel, 's1', { range: true }, ORDER), { ids: ['s1', 's2'], primary: 's2' });
  assert.deepEqual(clickSelect(EMPTY, 's4', { range: true }, ORDER), { ids: ['s4'], primary: 's4' });
});

test('box selection replaces or adds', () => {
  const sel = { ids: ['s4'], primary: 's4' };
  assert.deepEqual(boxSelect(sel, ['s2', 's1'], false, ORDER), { ids: ['s1', 's2'], primary: 's1' });
  assert.deepEqual(boxSelect(sel, ['s2'], true, ORDER), { ids: ['s2', 's4'], primary: 's4' });
  assert.deepEqual(boxSelect(sel, [], false, ORDER), EMPTY);
});

test('select all; pruning drops speakers that are gone', () => {
  assert.deepEqual(selectAll({ ids: ['s3'], primary: 's3' }, ORDER), { ids: ORDER, primary: 's3' });
  assert.deepEqual(selectAll(EMPTY, ORDER), { ids: ORDER, primary: 's1' });
  assert.deepEqual(pruneSelection({ ids: ['s1', 's9'], primary: 's9' }, ORDER), { ids: ['s1'], primary: 's1' });
  const same = { ids: ['s1'], primary: 's1' };
  assert.equal(pruneSelection(same, ORDER), same);
});
