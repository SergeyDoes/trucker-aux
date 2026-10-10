import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_KEYS, ESCAPE, bindingText, bindingWatch, captureWatch, isBound, keyName, normalizeBinding, normalizeControls,
} from '../src/shared/controls.js';

const CTRL = 'key:17';
const F9 = 'key:120';
const W = 'key:87';
const PAD = 'joy:045e:028e';

test('normalizeBinding: valid ids, once each, up to three; Escape never', () => {
  assert.deepEqual(normalizeBinding([CTRL, F9, CTRL, 'key:x', `${PAD}:5`, `${PAD}:pov-up`]), [CTRL, F9, `${PAD}:5`]);
  assert.deepEqual(normalizeBinding([`${PAD}:33`, `${PAD}:0`, 'joy:45e:28e:1', ESCAPE, 42]), []);
  assert.deepEqual(normalizeBinding('F9'), []);
  assert.deepEqual(normalizeControls({ next: [F9], auto: 'x', other: [W] }), { next: [F9], previous: [], auto: [] });
  assert.equal(isBound(normalizeControls({})), false);
  assert.equal(isBound(normalizeControls({ auto: [`${PAD}:8`] })), true);
});

test('bindingWatch: fires when the last input goes down, the rest held; the longest wins', () => {
  const bindings = { next: [CTRL, F9], previous: [F9], auto: [`${PAD}:5`, `${PAD}:pov-up`] };
  const watch = bindingWatch();
  const step = (...held) => watch(bindings, new Set(held));
  assert.equal(step(F9), 'previous');
  assert.equal(step(F9), null); // held: once
  assert.equal(step(), null);
  assert.equal(step(CTRL), null);
  assert.equal(step(CTRL, F9), 'next'); // not "previous" too
  assert.equal(step(), null);
  assert.equal(step(W), null);
  assert.equal(step(W, F9), 'previous'); // a key held to drive does not matter
  assert.equal(step(`${PAD}:pov-up`), null);
  assert.equal(step(`${PAD}:pov-up`, `${PAD}:5`), 'auto'); // in any order
  assert.equal(step(), null);
  assert.equal(watch({ next: [], previous: [], auto: [] }, new Set([F9])), null);
});

test('captureWatch: what was held at the most, once all is let go; Escape cancels; stale keys wait', () => {
  let capture = captureWatch();
  assert.equal(capture(new Set()), undefined);
  assert.equal(capture(new Set([CTRL])), undefined);
  assert.equal(capture(new Set([CTRL, F9])), undefined);
  assert.equal(capture(new Set([F9])), undefined);
  assert.deepEqual(capture(new Set()), [CTRL, F9]);
  capture = captureWatch();
  assert.equal(capture(new Set([CTRL])), undefined); // held already: not taken
  assert.equal(capture(new Set([CTRL, `${PAD}:3`])), undefined);
  assert.deepEqual(capture(new Set([CTRL])), [`${PAD}:3`]);
  capture = captureWatch();
  capture(new Set());
  capture(new Set(['key:65', 'key:66', 'key:67', 'key:68']));
  assert.deepEqual(capture(new Set()), ['key:65', 'key:66', 'key:67']); // three at the most
  capture = captureWatch();
  capture(new Set([F9]));
  assert.equal(capture(new Set([F9, ESCAPE])), null);
});

test('names: keys, controllers by their Windows name or USB ids, a controller named once in a row', () => {
  assert.deepEqual([keyName(120), keyName(65), keyName(49), keyName(100), keyName(17), keyName(255)], ['F9', 'A', '1', 'Num 4', 'Ctrl', 'Key 255']);
  assert.equal(bindingText([CTRL, F9]), 'Ctrl + F9');
  assert.equal(bindingText([`${PAD}:5`, `${PAD}:pov-up`], { '045e:028e': 'Xbox 360 Controller' }), 'Xbox 360 Controller: button 5 + D-pad up');
  assert.equal(bindingText([`${PAD}:5`, CTRL, `${PAD}:6`]), 'Controller 045E:028E: button 5 + Ctrl + Controller 045E:028E: button 6');
  assert.equal(bindingText([]), 'Not set');
  assert.equal(CAPTURE_KEYS.includes(1), false); // no mouse buttons
  assert.equal(CAPTURE_KEYS.includes(0xa2), false); // Ctrl stands for both sides
  assert.ok(CAPTURE_KEYS.includes(120) && CAPTURE_KEYS.includes(254));
});
