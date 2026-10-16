import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, stepVolume } from '../src/shared/settings.js';

const TURN_LOOK_OFF = { on: false, percent: 100, reverse: 'off', blinkers: false };
const NO_CONTROLS = { next: ['key:190'], previous: ['key:188'], auto: ['key:191'], volumeUp: [], volumeDown: [], mute: [] }; // the default keys

test('normalizeSettings: defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), {
    version: 1, source: 'input', input: null, output: null, muteWhen: 'electric', pauseBehavior: 'vehicle', matchLoudness: true,
    turnLook: TURN_LOOK_OFF, volume: 1, controls: NO_CONTROLS, voice: 'system', voiceVolume: 1, autoFollow: true, headFrom: 'game', axisLocks: { game: { yaw: false, pitch: false, roll: true }, vr: { yaw: false, pitch: false, roll: false }, telemetry: { yaw: false, pitch: false, roll: true } },
  });
});

test('normalizeSettings: the volume is a slider fraction 0..2 (up to 200 %), to the percent; 100 % by default', () => {
  assert.equal(normalizeSettings({ volume: 0.456 }).volume, 0.46);
  assert.equal(normalizeSettings({ volume: 0 }).volume, 0);
  assert.equal(normalizeSettings({ volume: 1.7 }).volume, 1.7);
  assert.equal(normalizeSettings({ volume: 2.5 }).volume, 2);
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
    turnLook: TURN_LOOK_OFF, volume: 1, controls: NO_CONTROLS, voice: 'system', voiceVolume: 1, autoFollow: true, headFrom: 'game', axisLocks: { game: { yaw: false, pitch: false, roll: true }, vr: { yaw: false, pitch: false, roll: false }, telemetry: { yaw: false, pitch: false, roll: true } },
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

test('normalizeSettings: the controls and the voice', () => {
  const settings = normalizeSettings({ controls: { next: ['key:120', 'nope'], auto: ['joy:045e:028e:5'] }, voice: false });
  assert.deepEqual(settings.controls, { next: ['key:120'], previous: ['key:188'], auto: ['joy:045e:028e:5'], volumeUp: [], volumeDown: [], mute: [] });
  assert.equal(settings.voice, 'off'); // the first version's checkbox
  assert.equal(normalizeSettings({ voice: 'aux' }).voice, 'aux');
  assert.equal(normalizeSettings({ voice: 'yes' }).voice, 'system');
  assert.equal(normalizeSettings({ voice: true }).voice, 'system');
  assert.deepEqual([0.333, 3, -1, 'x'].map((v) => normalizeSettings({ voiceVolume: v }).voiceVolume), [0.33, 2, 0, 1]);
});

test('normalizeSettings: the head from the game camera, VR or the telemetry', () => {
  assert.equal(normalizeSettings({ headFrom: 'telemetry' }).headFrom, 'telemetry');
  assert.equal(normalizeSettings({ headFrom: 'webcam' }).headFrom, 'game');
});

test('normalizeSettings: the camera modes and their locked axes', () => {
  assert.equal(normalizeSettings({ headFrom: 'vr' }).headFrom, 'vr');
  const locks = normalizeSettings({ axisLocks: { game: { roll: false, yaw: true }, vr: { pitch: 'x' }, other: { roll: true } } }).axisLocks;
  assert.deepEqual(locks, {
    game: { yaw: true, pitch: false, roll: false },
    vr: { yaw: false, pitch: false, roll: false },
    telemetry: { yaw: false, pitch: false, roll: true },
  });
});

test('normalizeSettings: Auto follows the vehicle unless turned off', () => {
  assert.deepEqual([undefined, true, false, 'no', 0].map((v) => normalizeSettings({ autoFollow: v }).autoFollow), [true, true, false, true, true]);
});

test('stepVolume: Volume Up and Down go 5 % along the slider, on the 5 % steps, within 0..200 %', () => {
  assert.deepEqual([0.83, 0.85, 1, 1.98, 2].map((v) => stepVolume(v, 1)), [0.85, 0.9, 1.05, 2, 2]);
  assert.deepEqual([0.83, 0.85, 1, 0.03, 0].map((v) => stepVolume(v, -1)), [0.8, 0.8, 0.95, 0, 0]);
});
