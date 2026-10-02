import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsWarning, pickDevice, rateWarning } from '../src/shared/devices.js';

const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'mic', label: 'Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'cable', label: 'CABLE Output (VB-Audio Virtual Cable)' },
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - Headphones (Headset)' },
  { kind: 'audiooutput', deviceId: 'phones', label: 'Headphones (Headset)' },
];

test('pickDevice: the saved id wins', () => {
  const { device, warning } = pickDevice(DEVICES, 'audioinput', { id: 'mic', label: 'x' }, 'CABLE Output');
  assert.equal(device.deviceId, 'mic');
  assert.equal(warning, null);
});

test('pickDevice: by label when the id changed', () => {
  const saved = { id: 'old', label: 'CABLE Output (VB-Audio Virtual Cable)' };
  assert.equal(pickDevice(DEVICES, 'audioinput', saved, null).device.deviceId, 'cable');
});

test('pickDevice: nothing saved -> preferred label, then the system default', () => {
  assert.equal(pickDevice(DEVICES, 'audioinput', null, 'CABLE Output').device.deviceId, 'cable');
  assert.equal(pickDevice(DEVICES, 'audiooutput', null, null).device.deviceId, 'default');
  assert.equal(pickDevice(DEVICES, 'audioinput', null, 'Line 1').device.deviceId, 'default');
});

test('pickDevice: a missing saved device falls back with a warning', () => {
  const saved = { id: 'gone', label: 'Line 1 (Virtual Audio Cable)' };
  const { device, warning } = pickDevice(DEVICES, 'audioinput', saved, 'CABLE Output');
  assert.equal(device.deviceId, 'cable');
  assert.equal(warning, 'Saved input "Line 1 (Virtual Audio Cable)" not found — using "CABLE Output (VB-Audio Virtual Cable)".');
});

test('pickDevice: no devices of that kind', () => {
  assert.deepEqual(pickDevice([], 'audioinput', null, 'CABLE Output'), { device: null, warning: null });
});

test('rate and channel warnings', () => {
  assert.match(rateWarning(48000, 44100), /48000 vs 44100 Hz/);
  assert.equal(rateWarning(44100, 44100), null);
  assert.equal(rateWarning(undefined, 44100), null);
  assert.match(channelsWarning(8), /8 channels/);
  assert.equal(channelsWarning(2), null);
});
