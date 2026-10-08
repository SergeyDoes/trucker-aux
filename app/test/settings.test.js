import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/shared/settings.js';

const TURN_LOOK_OFF = { on: false, percent: 100, reverse: 'off', blinkers: false };

test('normalizeSettings: defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), {
    version: 1, source: 'input', input: null, output: null, muteWhen: 'electric', pauseBehavior: 'vehicle', matchLoudness: true,
    turnLook: TURN_LOOK_OFF, volume: 1,
  });
});

test('normalizeSettings: the volume is a slider fraction 0..1, to the percent; full by default', () => {
  assert.equal(normalizeSettings({ volume: 0.456 }).volume, 0.46);
  assert.equal(normalizeSettings({ volume: 0 }).volume, 0);
  assert.equal(normalizeSettings({ volume: 1.7 }).volume, 1);
  assert.equal(normalizeSettings({ volume: -0.2 }).volume, 0);
  assert.equal(normalizeSettings({ volume: 'loud' }).volume, 1);
});

test('normalizeSettings keeps valid devices and drops junk', () => {
  const settings = normalizeSettings({
    source: 'file',
    input: { id: 'cable', label: 'CABLE Output' },
    output: { id: '', label: 'x' },
    muteWhen: 'engine',
    pauseBehavior: 'muted',
    matchLoudness: false,
  });
  assert.deepEqual(settings, {
    version: 1, source: 'file', input: { id: 'cable', label: 'CABLE Output' }, output: null, muteWhen: 'engine', pauseBehavior: 'muted', matchLoudness: false,
    turnLook: TURN_LOOK_OFF, volume: 1,
  });
  assert.equal(normalizeSettings({ source: 'radio' }).source, 'input');
  assert.equal(normalizeSettings({ muteWhen: 'electric' }).muteWhen, 'electric');
  assert.equal(normalizeSettings({ muteWhen: 'always' }).muteWhen, 'electric');
  assert.equal(normalizeSettings({ muteWhen: 'never' }).muteWhen, 'never'); // a choice made stays
  assert.equal(normalizeSettings({ pauseBehavior: 'active' }).pauseBehavior, 'active');
  assert.equal(normalizeSettings({ pauseBehavior: 'sometimes' }).pauseBehavior, 'vehicle');
  assert.equal(normalizeSettings({ matchLoudness: 'yes' }).matchLoudness, true);
});

test('normalizeSettings: the game camera as in the game; percent within 0..200; reverse off, on or inverted', () => {
  assert.deepEqual(
    normalizeSettings({ turnLook: { on: true, percent: 250, reverse: 'sideways', blinkers: true } }).turnLook,
    { on: true, percent: 200, reverse: 'off', blinkers: true },
  );
  assert.deepEqual(normalizeSettings({ turnLook: { on: 1, percent: 'x', reverse: 'inverted', blinkers: 'yes' } }).turnLook, { on: false, percent: 100, reverse: 'inverted', blinkers: false });
  assert.equal(normalizeSettings({ turnLook: { percent: 74.6 } }).turnLook.percent, 75);
});

test('normalizeSettings: the first version saved the angle at full lock in degrees, and reverse as a checkbox', () => {
  assert.deepEqual(normalizeSettings({ turnLook: { on: true, degrees: 33.75, reverse: 'off' } }).turnLook, { on: true, percent: 75, reverse: 'off', blinkers: false });
  assert.equal(normalizeSettings({ turnLook: { on: true, degrees: 30, reverse: true } }).turnLook.reverse, 'on');
  assert.equal(normalizeSettings({ turnLook: { degrees: 30, reverse: false } }).turnLook.reverse, 'off');
});
