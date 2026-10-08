import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEAD_X, angleText, createFrameWatch, createPauseHold, createRamp, headRestX, levelHead, musicSilenced, pluginWarning, turnLook, turnsToDeg, listenerVectors, withTurnLook,
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

test('look into turns: the steering times 35° at 100 %; in reverse off, on or inverted', () => {
  const look = { on: true, percent: 100, reverse: 'off', blinkers: false };
  near(turnLook(drive(1), look).steer, deg(35)); // full lock left
  near(turnLook(drive(-0.5), { ...look, percent: 200 }).steer, deg(-35));
  near(turnLook(drive(1), { ...look, percent: 75 }).steer, deg(26.25)); // measured in the game: 26.2°
  near(turnLook(drive(1, 0), look).steer, deg(35)); // neutral counts as forward
  near(turnLook(drive(1, -1), look).steer, 0);
  near(turnLook(drive(1, -1), { ...look, reverse: 'on' }).steer, deg(35));
  near(turnLook(drive(1, -1), { ...look, reverse: 'inverted' }).steer, deg(-35));
  near(turnLook(drive(1, 2), { ...look, reverse: 'inverted' }).steer, deg(35)); // forward is never inverted
  near(turnLook(drive(1), { ...look, on: false }).steer, 0);
  near(turnLook({ ...drive(1), paused: true }, look).steer, deg(35)); // the pause keeps it, as the game does
  assert.deepEqual(turnLook(drive(1), null), { steer: 0, blinker: 0 });
  assert.deepEqual(turnLook(null, look), { steer: 0, blinker: 0 });
});

test('look toward the blinker: at least 20° toward the driver\'s side or 40° across, whatever the steering', () => {
  const look = { on: true, percent: 100, reverse: 'off', blinkers: true };
  const total = (pose, l = look) => { const t = turnLook(pose, l); return t.steer + t.blinker; };
  // A left-hand-drive cab (measured in the game): 20° left, 40° right.
  near(total(drive(0, 3, { left: true })), deg(20));
  near(total(drive(0, 3, { right: true })), deg(-40));
  near(total(drive(-0.2, 3, { left: true })), deg(20)); // steering right does not pull it back
  near(total(drive(1, 3, { left: true })), deg(35)); // steering further left wins
  near(total(drive(-1, 3, { right: true })), deg(-40)); // full lock is 35°, the limit 40°
  near(total(drive(-1, 3, { right: true }), { ...look, percent: 200 }), deg(-70));
  near(total(drive(0.5, 3, { right: true })), deg(-40));
  // The blinker part is kept apart, for the app to ramp it in.
  near(turnLook(drive(0.4, 3, { left: true }), look).blinker, deg(20 - 14));
  // Hazard lights (both blinkers) do not turn the camera.
  near(total(drive(0, 3, { left: true, right: true })), 0);
  // Without look into turns the blinkers still work; switched off they do not.
  near(total(drive(0, 3, { left: true }), { ...look, on: false }), deg(20));
  near(total(drive(0, 3, { left: true }), { ...look, blinkers: false }), 0);
  // In reverse the game keeps the same limits, even with inverted look into turns.
  near(total(drive(0, -1, { left: true }), { ...look, reverse: 'inverted' }), deg(20));
  near(total(drive(0.5, -1, { left: true }), { ...look, reverse: 'inverted' }), deg(20)); // inverted steering -17.5°, the limit 20°
  near(total(drive(1, -1, { right: true }), look), deg(-40));
});

test('look toward the blinker: mirrored in a right-hand-drive cab (the head right of the axis)', () => {
  const look = { on: false, percent: 100, reverse: 'off', blinkers: true };
  const total = (pose) => { const t = turnLook(pose, look); return t.steer + t.blinker; };
  const inTruck = (centerX, blinkers) => ({ ...drive(0, 3, blinkers), truck: { key: 'vehicle.x', centerX } });
  near(total(inTruck(-0.45, { left: true })), deg(40));
  near(total(inTruck(-0.45, { right: true })), deg(-20));
  near(total(inTruck(0.459, { left: true })), deg(20));
  near(total(inTruck(0.459, { right: true })), deg(-40));
  // Without the truck's centre, the 40 cm left-hand-drive default.
  near(total(inTruck(null, { left: true })), deg(20));
});

test('ramp: moves toward the target at a steady speed; the first value and a long gap jump', () => {
  const ramp = createRamp(80);
  assert.equal(ramp(0, 0), 0);
  near(ramp(deg(40), 100), deg(8)); // 80°/s for 0.1 s
  near(ramp(deg(40), 400), deg(32));
  near(ramp(deg(40), 600), deg(40)); // reached, not passed
  near(ramp(0, 700), deg(32)); // back at the same speed
  near(ramp(deg(-20), 2000), deg(-20)); // after a gap of over a second
  const first = createRamp(80);
  near(first(deg(20), 100), deg(20)); // the first value is taken as it is
});

test('levelHead: the ears stay level in the cab; heading, pitch and position stay', () => {
  const pose = { sdkActive: true, head: { x: 0.1, y: 0.02, z: -0.03, heading: deg(20), pitch: deg(-3), roll: deg(4) } };
  assert.deepEqual(levelHead(pose).head, { x: 0.1, y: 0.02, z: -0.03, heading: deg(20), pitch: deg(-3), roll: 0 });
  const level = { ...pose, head: { ...pose.head, roll: 0 } };
  assert.equal(levelHead(level), level);
  assert.equal(levelHead(null), null);
});

test('pause hold: while paused the head stays where it was in the game', () => {
  const hold = createPauseHold();
  const at = (paused, x, heading, sdkActive = true) => ({ sdkActive, paused, head: { x, y: 0.1, z: 0, heading, pitch: 0, roll: 0 } });
  assert.deepEqual(hold(at(false, 0.2, deg(30))).head, at(false, 0.2, deg(30)).head);
  // Paused: the camera or the telemetry may say otherwise (a menu camera, a stale block).
  const paused = hold(at(true, 0, 0));
  assert.equal(paused.paused, true);
  assert.deepEqual(paused.head, at(false, 0.2, deg(30)).head);
  assert.deepEqual(hold(at(true, -0.5, deg(-90))).head, at(false, 0.2, deg(30)).head);
  // Back in the game: the game's head again.
  assert.deepEqual(hold(at(false, 0.1, deg(5))).head, at(false, 0.1, deg(5)).head);
  // A game paused before any frame of play, or gone: nothing to hold.
  const fresh = createPauseHold();
  assert.deepEqual(fresh(at(true, 0.3, deg(10))).head, at(true, 0.3, deg(10)).head);
  assert.equal(hold(null), null);
  hold(at(false, 0.4, 0, false)); // the game closed: forget the head
  assert.deepEqual(hold(at(true, 0.3, deg(10))).head, at(true, 0.3, deg(10)).head);
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

test('angleText: whole degrees of one width, so the status line stays put', () => {
  const FIG = ' '; // figure space, a digit wide
  assert.equal(angleText(-11.4, 3), `−${FIG}11°`);
  assert.equal(angleText(140, 3), '+140°'); // a plus as wide as the minus (U+2212)
  assert.equal(angleText(-0.4, 2), `+${FIG}0°`); // no minus for a zero
  assert.equal(angleText(5, 2), `+${FIG}5°`);
  for (const d of [-180, -45, -3, 0, 7, 90, 179]) assert.equal(angleText(d, 3).length, 5);
});

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
