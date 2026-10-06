import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAB_RADIUS, cameraView, createCameraWatch, eulerToQuaternion, expectedHead, quaternionToEuler, qmul, withCameraView,
} from '../src/shared/camera.js';

const deg = (d) => d / 360; // SCS angles are turns
const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test('euler angles in turns to a quaternion and back (heading, then pitch, then roll)', () => {
  for (const [h, p, r] of [[0, 0, 0], [deg(30), 0, 0], [deg(-75), deg(12), deg(-5)], [deg(170), deg(-40), deg(20)]]) {
    const back = quaternionToEuler(eulerToQuaternion(h, p, r));
    near(back.heading, h);
    near(back.pitch, p);
    near(back.roll, r);
  }
  // Heading turns to the left: ahead (-Z) goes to -X.
  const [w, x, y, z] = eulerToQuaternion(deg(90), 0, 0);
  near(w, Math.SQRT1_2);
  near(y, Math.SQRT1_2);
  near(x, 0);
  near(z, 0);
});

// A truck turned 90° left in the world, its cab joint 3 m up and 2 m ahead of the vehicle's
// origin, the head 0.5 m left, 0.6 m down and 1.2 m back in the cab.
const POSE = {
  sdkActive: true,
  truck: { key: 'vehicle.x', name: 'X' },
  world: { x: 100, y: 5, z: -200, heading: deg(90), pitch: 0, roll: 0 },
  cabin: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 },
  cabinPosition: [0, 3, -2],
  headPosition: [-0.5, -0.6, 1.2],
  head: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 },
};

test('expectedHead: where the cab camera is in the world', () => {
  const [x, y, z] = expectedHead(POSE);
  // In the vehicle (-0.5, 2.4, -0.8); turned 90° left: x = -0.8, z = +0.5.
  near(x, 99.2);
  near(y, 7.4);
  near(z, -199.5);
  // The head offset and the cab on its suspension move it too.
  const leaned = expectedHead({ ...POSE, head: { ...POSE.head, x: 0.1 }, cabin: { ...POSE.cabin, y: 0.05 } });
  near(leaned[1], 7.45);
  near(leaned[2], -199.6); // 0.1 m to the cab's right is -Z in the world here
});

const camera = (pose, turn, extra = {}) => {
  const [x, y, z] = expectedHead(pose);
  const truck = eulerToQuaternion(pose.world.heading, pose.world.pitch, pose.world.roll);
  const cab = qmul(truck, eulerToQuaternion(pose.cabin.heading, pose.cabin.pitch, pose.cabin.roll));
  return { layout: 1, sequence: 2, state: 1, camera: 1, fov: 65, x, y, z, rotation: qmul(cab, eulerToQuaternion(...turn)), ...extra };
};

test('cameraView: the cab camera gives the view turned in the cab; an outside one keeps the head', () => {
  const view = cameraView(POSE, camera(POSE, [deg(26), deg(-3), 0]), true);
  assert.equal(view.source, 'game');
  near(view.heading, deg(26));
  near(view.pitch, deg(-3));
  near(view.roll, 0);
  near(view.distance, 0);
  // The cab pitched on its suspension: the view in the cab stays the same.
  const pitched = { ...POSE, cabin: { ...POSE.cabin, pitch: deg(2) } };
  near(cameraView(pitched, camera(pitched, [deg(10), 0, 0]), true).pitch, 0);
  // 6 m behind: an outside camera.
  const chase = camera(POSE, [0, 0, 0], { x: POSE.world.x - 6 });
  const outside = cameraView(POSE, chase, true);
  assert.equal(outside.source, 'outside');
  assert.ok(outside.distance > CAB_RADIUS);
  // Not reading, stale, no game or no truck: not used.
  assert.equal(cameraView(POSE, camera(POSE, [0, 0, 0], { state: 0 }), true).source, null);
  assert.equal(cameraView(POSE, camera(POSE, [0, 0, 0]), false).source, null);
  assert.equal(cameraView({ ...POSE, truck: null }, camera(POSE, [0, 0, 0]), true).source, null);
  assert.equal(cameraView(POSE, null, true).source, null);
});

test('withCameraView: the listener turned by the game camera, at rest on an outside one', () => {
  const pose = { ...POSE, head: { x: 0.1, y: 0, z: 0, heading: deg(5), pitch: 0, roll: 0 } };
  const turned = withCameraView(pose, { source: 'game', heading: deg(30), pitch: deg(2), roll: 0 });
  assert.deepEqual(turned.head, { x: 0.1, y: 0, z: 0, heading: deg(30), pitch: deg(2), roll: 0 });
  assert.deepEqual(withCameraView(pose, { source: 'outside' }).head, { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 });
  assert.equal(withCameraView(pose, { source: null }), pose);
});

test('createCameraWatch: fresh while the sequence moves; stale after a second without a new frame', () => {
  const fresh = createCameraWatch(1000);
  assert.equal(fresh({ sequence: 2 }, 0), true);
  assert.equal(fresh({ sequence: 4 }, 500), true);
  assert.equal(fresh({ sequence: 4 }, 1400), true);
  assert.equal(fresh({ sequence: 4 }, 1600), false);
  assert.equal(fresh({ sequence: 6 }, 1700), true);
  assert.equal(fresh(null, 1800), false);
});
