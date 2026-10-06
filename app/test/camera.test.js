import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAB_CAMERA, CAB_RADIUS, FREE_CAMERA, cameraPoint, cameraView, createCameraWatch, eulerToQuaternion, expectedHead, headOffset, quaternionToEuler,
  qmul, withCameraView,
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

const OTHER_CAMERA = 4; // leaning out of the window: an outside camera 0.9 m from the head

test('headOffset: a point in the world as an offset from the default head, in the cab axes', () => {
  const tilted = { ...POSE, cabin: { x: 0.01, y: 0.05, z: 0, heading: deg(1), pitch: deg(3), roll: deg(-2) } };
  const offset = { x: 0.8, y: -0.3, z: 2.5 };
  const back = headOffset(tilted, expectedHead({ ...tilted, head: { ...tilted.head, ...offset } }));
  near(back.x, 0.8);
  near(back.y, -0.3);
  near(back.z, 2.5);
});

const camera = (pose, turn, extra = {}) => {
  const [x, y, z] = expectedHead(pose);
  const truck = eulerToQuaternion(pose.world.heading, pose.world.pitch, pose.world.roll);
  const cab = qmul(truck, eulerToQuaternion(pose.cabin.heading, pose.cabin.pitch, pose.cabin.roll));
  return { layout: 1, sequence: 2, state: 1, camera: CAB_CAMERA, fov: 65, x, y, z, rotation: qmul(cab, eulerToQuaternion(...turn)), ...extra };
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
  const chase = camera(POSE, [0, 0, 0], { x: POSE.world.x - 6, camera: 1 });
  const outside = cameraView(POSE, chase, true);
  assert.equal(outside.source, 'outside');
  assert.ok(outside.distance > CAB_RADIUS);
  // Another camera close to the head is outside too, told by its index.
  const leaning = { ...POSE, head: { ...POSE.head, x: -0.6, y: 0.2, z: 0.2 } };
  const leaningOut = cameraView(POSE, camera(leaning, [0, 0, 0], { camera: OTHER_CAMERA }), true);
  assert.equal(leaningOut.source, 'outside');
  assert.ok(leaningOut.distance < CAB_RADIUS);
  // The cab's index far from where the head should be: not trusted as the cab camera.
  assert.equal(cameraView(POSE, camera(POSE, [0, 0, 0], { x: POSE.world.x - 6 }), true).source, 'outside');
  // Not reading, stale, no game or no truck: not used.
  assert.equal(cameraView(POSE, camera(POSE, [0, 0, 0], { state: 0 }), true).source, null);
  assert.equal(cameraView(POSE, camera(POSE, [0, 0, 0]), false).source, null);
  assert.equal(cameraView({ ...POSE, truck: null }, camera(POSE, [0, 0, 0]), true).source, null);
  assert.equal(cameraView(POSE, null, true).source, null);
});

test('cameraView: the free camera is where it is, in the cab or far outside, by its index', () => {
  // Placed and turned in the cab's axes, from the default head; the SDK's head offset does not matter.
  const at = (pose, [x, y, z], turn) => camera({ ...pose, head: { ...pose.head, x, y, z } }, turn, { camera: FREE_CAMERA });
  const looking = { ...POSE, head: { ...POSE.head, x: 0.1, heading: deg(20) } };
  const view = cameraView(looking, at(POSE, [0.8, -0.3, -0.5], [deg(-40), deg(-10), 0]), true);
  assert.equal(view.source, 'free');
  near(view.x, 0.8);
  near(view.y, -0.3);
  near(view.z, -0.5);
  near(view.heading, deg(-40));
  near(view.pitch, deg(-10));
  near(view.roll, 0);
  assert.ok(view.distance < CAB_RADIUS); // as close as the cab camera, and still the free one
  // 20 m behind, the cab pitched on its suspension.
  const pitched = { ...POSE, cabin: { ...POSE.cabin, y: 0.02, pitch: deg(3) } };
  const far = cameraView(pitched, at(pitched, [0, 0, 20], [deg(180), 0, 0]), true);
  assert.equal(far.source, 'free');
  near(far.z, 20);
  near(Math.abs(far.heading), deg(180));
  // Another camera there is an outside one.
  assert.equal(cameraView(pitched, { ...at(pitched, [0, 0, 20], [0, 0, 0]), camera: OTHER_CAMERA }, true).source, 'outside');
  assert.equal(cameraView(POSE, { ...at(POSE, [0, 0, 0], [0, 0, 0]), state: 0 }, true).source, null);
});

test('withCameraView: the listener turned by the game camera, at rest on an outside one', () => {
  const pose = { ...POSE, head: { x: 0.1, y: 0, z: 0, heading: deg(5), pitch: 0, roll: 0 } };
  const turned = withCameraView(pose, { source: 'game', heading: deg(30), pitch: deg(2), roll: 0 });
  assert.deepEqual(turned.head, { x: 0.1, y: 0, z: 0, heading: deg(30), pitch: deg(2), roll: 0 });
  assert.deepEqual(withCameraView(pose, { source: 'outside' }).head, { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 });
  const free = withCameraView(pose, { source: 'free', x: 0.8, y: -0.3, z: 2, heading: deg(-40), pitch: 0, roll: deg(1), distance: 2.2 });
  assert.deepEqual(free.head, { x: 0.8, y: -0.3, z: 2, heading: deg(-40), pitch: 0, roll: deg(1) });
  assert.equal(withCameraView(pose, { source: null }), pose);
});

test('cameraPoint: the free camera in layout coordinates (X from the truck axis), for a new speaker', () => {
  assert.deepEqual(cameraPoint({ source: 'free', x: 0.75, y: -0.25, z: -0.5, heading: 0, pitch: 0, roll: 0 }, -0.5), [0.25, -0.25, -0.5]);
  assert.equal(cameraPoint({ source: 'game', heading: 0, pitch: 0, roll: 0 }, -0.5), null);
  assert.equal(cameraPoint({ source: 'outside' }, -0.5), null);
  assert.equal(cameraPoint({ source: null }, -0.5), null);
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
