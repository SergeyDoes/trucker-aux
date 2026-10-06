import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEAD_X, createEase, createFrameWatch, headRestX, musicSilenced, pluginWarning, turnLook, turnsToDeg, listenerVectors, withTurnLook,
} from '../src/shared/pose.js';

test('pluginWarning: an scs-telemetry revision the offsets were not made for', () => {
  assert.equal(pluginWarning({ sdkActive: true, pluginRevision: 12 }), null);
  assert.equal(
    pluginWarning({ sdkActive: true, pluginRevision: 13 }),
    'scs-telemetry.dll revision 13 is not one Trucker AUX knows (12): the values it reads may be wrong.',
  );
  // Only while the game runs: the plugin clears it when the game closes.
  assert.equal(pluginWarning({ sdkActive: false, pluginRevision: 0 }), null);
  assert.equal(pluginWarning(null), null);
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const deg = (d) => d / 360;
const drive = (steer, gear = 3, blinkers = {}) => ({
  sdkActive: true, paused: false, steer, gear, blinkers: { left: false, right: false, ...blinkers }, head: { heading: 0.02 },
});

test('look into turns: the steering times 45° at 100 %; in reverse off, on or inverted', () => {
  const look = { on: true, percent: 100, reverse: 'off', blinkers: false };
  near(turnLook(drive(1), look).steer, deg(45)); // full lock left
  near(turnLook(drive(-0.5), { ...look, percent: 200 }).steer, deg(-45)); // 200 % looks sideways at full lock
  near(turnLook(drive(1), { ...look, percent: 75 }).steer, deg(33.75));
  near(turnLook(drive(1, 0), look).steer, deg(45)); // neutral counts as forward
  near(turnLook(drive(1, -1), look).steer, 0);
  near(turnLook(drive(1, -1), { ...look, reverse: 'on' }).steer, deg(45));
  near(turnLook(drive(1, -1), { ...look, reverse: 'inverted' }).steer, deg(-45));
  near(turnLook(drive(1, 2), { ...look, reverse: 'inverted' }).steer, deg(45)); // forward is never inverted
  near(turnLook(drive(1), { ...look, on: false }).steer, 0);
  assert.deepEqual(turnLook({ ...drive(1), paused: true }, look), { steer: 0, blinker: 0 });
  assert.deepEqual(turnLook(drive(1), null), { steer: 0, blinker: 0 });
  assert.deepEqual(turnLook(null, look), { steer: 0, blinker: 0 });
});

test('look toward the blinker: at least 30° left or 45° right, whatever the steering', () => {
  const look = { on: true, percent: 100, reverse: 'off', blinkers: true };
  const total = (pose, l = look) => { const t = turnLook(pose, l); return t.steer + t.blinker; };
  near(total(drive(0, 3, { left: true })), deg(30));
  near(total(drive(0, 3, { right: true })), deg(-45));
  near(total(drive(-0.2, 3, { left: true })), deg(30)); // steering right does not pull it back
  near(total(drive(1, 3, { left: true })), deg(45)); // steering further left wins
  near(total(drive(-1, 3, { right: true })), deg(-45));
  near(total(drive(0.5, 3, { right: true })), deg(-45));
  // The blinker part is kept apart, for the app to ease it in.
  near(turnLook(drive(0.4, 3, { left: true }), look).blinker, deg(30 - 18));
  // Hazard lights (both blinkers) do not turn the camera.
  near(total(drive(0, 3, { left: true, right: true })), 0);
  // Without look into turns the blinkers still work; switched off they do not.
  near(total(drive(0, 3, { left: true }), { ...look, on: false }), deg(30));
  near(total(drive(0, 3, { left: true }), { ...look, blinkers: false }), 0);
  // In reverse the game keeps the same limits, even with inverted look into turns.
  near(total(drive(0, -1, { left: true }), { ...look, reverse: 'inverted' }), deg(30));
  near(total(drive(0.5, -1, { left: true }), { ...look, reverse: 'inverted' }), deg(30)); // inverted steering -22.5°, the limit 30°
  near(total(drive(1, -1, { right: true }), look), deg(-45));
});

test('ease: follows a step with the time constant; a long gap jumps', () => {
  const ease = createEase(250);
  assert.equal(ease(0, 0), 0);
  near(ease(1, 250), 1 - Math.exp(-1));
  near(ease(1, 500), 1 - Math.exp(-2));
  assert.equal(ease(0.5, 2000), 0.5); // after a gap of over a second
  const first = createEase(250);
  assert.equal(first(0.3, 100), 0.3); // the first value is taken as it is
});

test('withTurnLook adds turns to the head\'s heading for the engine and the views', () => {
  near(withTurnLook(drive(1), deg(45)).head.heading, 0.02 + deg(45));
  const still = drive(0);
  assert.equal(withTurnLook(still, 0), still);
});

test('frame watch: the game world is there while renderTime moves', () => {
  const inWorld = createFrameWatch(1000);
  assert.equal(inWorld(500, 0), false); // the first reading proves nothing yet
  assert.equal(inWorld(516, 16), true);
  assert.equal(inWorld(516, 900), true); // a short stall
  assert.equal(inWorld(516, 1100), false); // main menu, loading or a hung game
  assert.equal(inWorld(532, 1116), true);
  assert.equal(inWorld(undefined, 1200), false); // no game
});

test('musicSilenced: no muting outside the game world (main menu, loading)', () => {
  const pose = { sdkActive: true, engineOn: false, electricOn: false, truck: { key: 'vehicle.x', name: 'X' } };
  assert.equal(musicSilenced(pose, 'engine', true), true);
  assert.equal(musicSilenced(pose, 'engine', false), false);
  assert.equal(musicSilenced(pose, 'engine'), true); // in the world unless told otherwise
});

test('headRestX: the driver sits left of the truck axis by what the game says, else 40 cm', () => {
  assert.equal(headRestX({ key: 'vehicle.intnational.9900i', centerX: 0.477 }), -0.477);
  assert.equal(headRestX({ key: 'x', centerX: null }), DEFAULT_HEAD_X);
  assert.equal(headRestX(null), -0.4);
});

test('musicSilenced follows the chosen system, only while the game runs with a truck', () => {
  const truck = { key: 'vehicle.ford.f150_23', name: 'Ford F150 2023', centerX: 0.459 };
  const pose = (sdkActive, engineOn, electricOn, current = truck) => ({ sdkActive, engineOn, electricOn, truck: current });
  // No truck loaded yet: the flags mean nothing.
  assert.equal(musicSilenced(pose(true, false, false, null), 'engine'), false);
  assert.equal(musicSilenced(pose(true, false, false, null), 'electric'), false);
  assert.equal(musicSilenced(pose(true, false, false), 'never'), false);
  assert.equal(musicSilenced(pose(true, false, true), 'engine'), true);
  assert.equal(musicSilenced(pose(true, true, true), 'engine'), false);
  assert.equal(musicSilenced(pose(true, false, true), 'electric'), false);
  assert.equal(musicSilenced(pose(true, false, false), 'electric'), true);
  // No game: music plays as usual.
  assert.equal(musicSilenced(pose(false, false, false), 'engine'), false);
  assert.equal(musicSilenced(null, 'electric'), false);
});

test('musicSilenced on pause: always active, always muted, or as the vehicle (the default)', () => {
  const vehicle = { key: 'vehicle.ford.f150_23', name: 'Ford F150 2023' };
  const pose = (paused, engineOn) => ({ sdkActive: true, paused, engineOn, electricOn: engineOn, truck: vehicle });
  // Paused with the engine off, "Mute when: engine".
  assert.equal(musicSilenced(pose(true, false), 'engine', true, 'vehicle'), true);
  assert.equal(musicSilenced(pose(true, false), 'engine', true), true);
  assert.equal(musicSilenced(pose(true, false), 'engine', true, 'active'), false);
  // Paused with the engine on.
  assert.equal(musicSilenced(pose(true, true), 'engine', true, 'vehicle'), false);
  assert.equal(musicSilenced(pose(true, true), 'never', true, 'muted'), true);
  // Not paused: only "Mute when" counts.
  assert.equal(musicSilenced(pose(false, true), 'never', true, 'muted'), false);
  assert.equal(musicSilenced(pose(false, false), 'engine', true, 'active'), true);
  // The main menu (paused, frames stand still) is outside the world: music plays.
  assert.equal(musicSilenced(pose(true, true), 'never', false, 'muted'), false);
});

function close(actual, expected, eps = 1e-9) {
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < eps, `[${i}] ${actual[i]} != ${e}`));
}

test('turnsToDeg maps turns to -180..180', () => {
  assert.ok(Math.abs(turnsToDeg(0.99) - -3.6) < 1e-9);
  assert.equal(turnsToDeg(0.25), 90);
  assert.equal(turnsToDeg(-0.25), -90);
  assert.equal(turnsToDeg(0), 0);
});

test('head straight: forward -Z, up +Y', () => {
  const v = listenerVectors(0, 0, 0);
  close(v.forward, [0, 0, -1]);
  close(v.up, [0, 1, 0]);
});

test('heading 0.25 looks left', () => {
  close(listenerVectors(0.25, 0, 0).forward, [-1, 0, 0]);
});

test('pitch 0.125 looks 45° up', () => {
  const v = listenerVectors(0, 0.125, 0);
  close(v.forward, [0, Math.SQRT1_2, -Math.SQRT1_2]);
  close(v.up, [0, Math.SQRT1_2, Math.SQRT1_2]);
});

test('roll 0.25 tilts the top of the head left', () => {
  close(listenerVectors(0, 0, 0.25).up, [-1, 0, 0]);
});
