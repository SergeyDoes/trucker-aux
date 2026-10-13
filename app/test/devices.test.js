import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cableOutputFor, channelsWarning, deviceSource, isCable, pickDevice, rateWarning } from '../src/shared/devices.js';

// As Chromium lists them on a Russian Windows with a headset, a USB card, VB-Cable and Steam's
// streaming devices (2026-10-10).
const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d (Logitech PRO X Gaming Headset) (046d:0aaa)' },
  { kind: 'audioinput', deviceId: 'communications', label: 'Communications - \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d (Logitech PRO X Gaming Headset) (046d:0aaa)' },
  { kind: 'audioinput', deviceId: 'mic', label: '\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d (Logitech PRO X Gaming Headset) (046d:0aaa)' },
  { kind: 'audioinput', deviceId: 'steam', label: '\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 \u0440\u0430\u0437\u044a\u0435\u043c  AUX (Steam Streaming Speakers)' },
  { kind: 'audioinput', deviceId: 'cable', label: 'CABLE Output (VB-Audio Virtual Cable)' },
  { kind: 'audioinput', deviceId: 'card', label: 'Microphone (Sound Blaster Play! 3) (041e:324d)' },
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers (Sound Blaster Play! 3) (041e:324d)' },
  { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers (Sound Blaster Play! 3) (041e:324d)' },
  { kind: 'audiooutput', deviceId: 'phones', label: '\u041d\u0430\u0443\u0448\u043d\u0438\u043a\u0438 (Logitech PRO X Gaming Headset) (046d:0aaa)' },
  { kind: 'audiooutput', deviceId: 'cable-in', label: 'CABLE Input (VB-Audio Virtual Cable)' },
  { kind: 'audiooutput', deviceId: 'steam-out', label: '\u0414\u0438\u043d\u0430\u043c\u0438\u043a\u0438 (Steam Streaming Speakers)' },
  { kind: 'audiooutput', deviceId: 'steam-mic', label: '\u0414\u0438\u043d\u0430\u043c\u0438\u043a\u0438 (Steam Streaming Microphone)' },
];
const only = (...ids) => DEVICES.filter((d) => d.kind === 'audiooutput' || ids.includes(d.deviceId));
const VAC = [
  { kind: 'audioinput', deviceId: 'line2', label: 'Line 2 (Virtual Audio Cable)' },
  { kind: 'audioinput', deviceId: 'line1', label: 'Line 1 (Virtual Audio Cable)' },
  { kind: 'audiooutput', deviceId: 'out1', label: 'Line 1 (Virtual Audio Cable)' },
  { kind: 'audiooutput', deviceId: 'out2', label: 'Line 2 (Virtual Audio Cable)' },
];

test('deviceSource: the last part in brackets, a USB id left out', () => {
  assert.equal(deviceSource('CABLE Output (VB-Audio Virtual Cable)'), 'VB-Audio Virtual Cable');
  assert.equal(deviceSource('Default - \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d (Logitech PRO X Gaming Headset) (046d:0aaa)'), 'Logitech PRO X Gaming Headset');
  assert.equal(deviceSource('\u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 \u0440\u0430\u0437\u044a\u0435\u043c  AUX (Steam Streaming Speakers)'), 'Steam Streaming Speakers');
  assert.equal(deviceSource('Headphones'), null);
  assert.equal(isCable('Line 3 (Virtual Audio Cable)'), true);
  assert.equal(isCable('CABLE-A Output (VB-Audio Cable A)'), true);
  assert.equal(isCable('\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d (Steam Streaming Microphone)'), false); // a virtual microphone, no cable
});

test('pickDevice: the saved id wins, then the saved label', () => {
  assert.deepEqual(pickDevice(DEVICES, 'audioinput', { id: 'mic', label: 'x' }), { device: DEVICES[2], warning: null });
  assert.equal(pickDevice(DEVICES, 'audioinput', { id: 'old', label: 'CABLE Output (VB-Audio Virtual Cable)' }).device.deviceId, 'cable');
});

test('pickDevice, a new setup: the input is a virtual cable, never a microphone', () => {
  assert.deepEqual(pickDevice(DEVICES, 'audioinput', null), { device: DEVICES[4], warning: null }); // VB-Cable before Steam's
  assert.equal(pickDevice(only('mic', 'steam'), 'audioinput', null).device.deviceId, 'steam');
  assert.equal(pickDevice(VAC, 'audioinput', null).device.deviceId, 'line2'); // the first listed
  const none = pickDevice(only('default', 'mic', 'card'), 'audioinput', null);
  assert.equal(none.device, null);
  assert.match(none.warning, /^No virtual cable found/);
});

test('pickDevice, a new setup: the output is the default, unless that is a virtual device', () => {
  assert.equal(pickDevice(DEVICES, 'audiooutput', null).device.deviceId, 'default');
  const looped = DEVICES.map((d) => (d.kind === 'audiooutput' && d.deviceId === 'default' ? { ...d, label: 'Default - CABLE Input (VB-Audio Virtual Cable)' } : d));
  const { device, warning } = pickDevice(looped, 'audiooutput', null);
  assert.equal(device.deviceId, 'speakers');
  assert.equal(warning, 'The system\'s default output is a virtual device: playing to "Speakers (Sound Blaster Play! 3) (041e:324d)".');
});

test('pickDevice: a missing saved device falls back with a warning, a missing input to a cable', () => {
  const saved = { id: 'gone', label: 'Line 1 (Virtual Audio Cable)' };
  assert.deepEqual(pickDevice(DEVICES, 'audioinput', saved), {
    device: DEVICES[4],
    warning: 'Saved input "Line 1 (Virtual Audio Cable)" not found — using "CABLE Output (VB-Audio Virtual Cable)".',
  });
  assert.equal(pickDevice(only('default', 'mic'), 'audioinput', saved).warning, 'Saved input "Line 1 (Virtual Audio Cable)" not found — using nothing.');
  assert.deepEqual(pickDevice([], 'audiooutput', null), { device: null, warning: null });
});

test('cableOutputFor: the side to play the music into', () => {
  const by = (id) => DEVICES.find((d) => d.deviceId === id);
  assert.equal(cableOutputFor(DEVICES, by('cable')).deviceId, 'cable-in');
  assert.equal(cableOutputFor(DEVICES, by('steam')).deviceId, 'steam-out');
  assert.equal(cableOutputFor(VAC, VAC[1]).deviceId, 'out1'); // Line 1 with Line 1
  assert.equal(cableOutputFor(DEVICES, by('mic')), null);
  assert.equal(cableOutputFor(DEVICES, null), null);
});

test('rate and channel warnings', () => {
  assert.match(rateWarning(48000, 44100), /48000 vs 44100 Hz/);
  assert.equal(rateWarning(44100, 44100), null);
  assert.equal(rateWarning(undefined, 44100), null);
  assert.match(channelsWarning(8), /8 channels/);
  assert.equal(channelsWarning(2), null);
});
