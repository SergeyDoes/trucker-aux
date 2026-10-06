import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_SIZE, cameraRecord, parsePose, SNAPSHOT_SIZE, truckKey } from '../src/main/telemetry.js';

function put(view, offset, value) {
  new Uint8Array(view.buffer).set(new TextEncoder().encode(value), offset);
}

test('parsePose reads the RenCloud plugin offsets', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  view.setUint8(0, 1);
  view.setUint8(4, 1);
  [0.01, -0.05, 0.02, 0.99, -0.0083, 0].forEach((v, i) => view.setFloat32(2024 + 4 * i, v, true));
  put(view, 2300, 'international');
  put(view, 2364, 'International');
  put(view, 2428, 'vehicle.international.9900i');
  put(view, 2492, '9900i');
  view.setUint8(1575, 1); // electricEnabled; engineEnabled at 1576 stays 0
  view.setBigUint64(24, 71709661n, true); // renderTime, µs
  view.setUint32(52, 2, true); // scs_values.game: ATS

  const pose = parsePose(view);

  assert.equal(pose.sdkActive, true);
  assert.equal(pose.paused, true);
  assert.equal(pose.electricOn, true);
  assert.equal(pose.engineOn, false);
  assert.equal(pose.renderTime, 71709661);
  assert.ok(Math.abs(pose.head.y - -0.05) < 1e-6);
  assert.ok(Math.abs(pose.head.heading - 0.99) < 1e-6);
  assert.ok(Math.abs(pose.head.pitch - -0.0083) < 1e-6);
  assert.deepEqual(pose.truck, {
    key: 'vehicle.international.9900i', variant: null, plate: null, quickJob: false, name: 'International 9900i', centerX: null,
    game: 'ats', brand: 'international', brandName: 'International',
  });
  view.setUint32(52, 1, true);
  assert.equal(parsePose(view).truck.game, 'ets2');
  view.setUint32(52, 0, true); // an older plugin or no game id
  assert.equal(parsePose(view).truck.game, null);
});

test('the truck axis comes from the head position (values read from the 9900i in ATS)', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  put(view, 2428, 'vehicle.intnational.9900i');
  [0, 3, -2].forEach((v, i) => view.setFloat32(1640 + 4 * i, v, true));           // cabinPosition
  [-0.477, -0.604, 1.196].forEach((v, i) => view.setFloat32(1652 + 4 * i, v, true)); // headPosition
  assert.equal(parsePose(view).truck.centerX, 0.477);
});

test('steering and gear: for following the game\'s look into turns', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  view.setFloat32(972, 0.5, true); // truck_f.gameSteer, positive is left
  view.setInt32(504, -1, true);    // truck_i.gear, negative is reverse
  const pose = parsePose(view);
  assert.equal(pose.steer, 0.5);
  assert.equal(pose.gear, -1);
});

test('blinkers: for following the game\'s look toward the blinker', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  assert.deepEqual(parsePose(view).blinkers, { left: false, right: false });
  view.setUint8(1579, 1); // truck_b.blinkerRightActive: the lever, not the blinking light
  assert.deepEqual(parsePose(view).blinkers, { left: false, right: true });
  view.setUint8(1578, 1); // truck_b.blinkerLeftActive
  assert.deepEqual(parsePose(view).blinkers, { left: true, right: true });
});

test('the plate names this very truck; a quick job lends a truck with a random plate', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  put(view, 2428, 'vehicle.intnational.9900i');
  put(view, 3212, 'WP-83695 '); // config_s.truckLicensePlate, read from the game with the space
  assert.equal(parsePose(view).truck.plate, 'WP-83695');
  assert.equal(parsePose(view).truck.quickJob, false);
  put(view, 3404, 'quick_job'); // config_s.jobMarket
  assert.equal(parsePose(view).truck.quickJob, true);
});

test('the variant is the fifth-wheel position, to 10 cm (9900i: short cab 2.118 m, sleeper 3.184 m)', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  put(view, 2428, 'vehicle.intnational.9900i');
  view.setFloat32(1672, 3.184, true); // config_fv.truckHookPositionZ
  assert.equal(parsePose(view).truck.variant, '3.2');
  view.setFloat32(1672, 2.118, true);
  assert.equal(parsePose(view).truck.variant, '2.1');
  view.setFloat32(1672, 0, true); // no hook reported
  assert.equal(parsePose(view).truck.variant, null);
});

test('empty memory: game inactive, no truck', () => {
  const pose = parsePose(new DataView(new ArrayBuffer(SNAPSHOT_SIZE)));
  assert.equal(pose.sdkActive, false);
  assert.equal(pose.truck, null);
  assert.equal(pose.engineOn, false);
});

test('engineEnabled is read at its own offset', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  view.setUint8(1576, 1);
  const pose = parsePose(view);
  assert.equal(pose.engineOn, true);
  assert.equal(pose.electricOn, false);
});

test('the plugin revision: the layout these offsets belong to', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  view.setUint32(40, 12, true); // scs_values.telemetry_plugin_revision
  assert.equal(parsePose(view).pluginRevision, 12);
});

test('the truck in the world and the cab on its suspension, for the game camera', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  [1000.5, 50.25, -2000.75, 0.25, 0.01, -0.02].forEach((v, i) => view.setFloat64(2200 + 8 * i, v, true)); // truck_dp
  [0.01, 0.02, 0.03, 0.001, 0.002, 0.003].forEach((v, i) => view.setFloat32(2000 + 4 * i, v, true)); // cabin offset
  [0, 3, -2].forEach((v, i) => view.setFloat32(1640 + 4 * i, v, true)); // cabinPosition
  [-0.477, -0.604, 1.196].forEach((v, i) => view.setFloat32(1652 + 4 * i, v, true)); // headPosition
  const pose = parsePose(view);
  assert.deepEqual(pose.world, { x: 1000.5, y: 50.25, z: -2000.75, heading: 0.25, pitch: 0.01, roll: -0.02 });
  const near = (actual, expected) => Object.entries(expected).forEach(([k, v]) => assert.ok(Math.abs(actual[k] - v) < 1e-6, `${k}: ${actual[k]} != ${v}`));
  near(pose.cabin, { x: 0.01, y: 0.02, z: 0.03, heading: 0.001, pitch: 0.002, roll: 0.003 });
  near(pose.cabinPosition, [0, 3, -2]);
  near(pose.headPosition, [-0.477, -0.604, 1.196]);
});

// Local\TruckerAuxCamera as native/camera-plugin/camera_block.h lays it out.
function cameraBlock({ layout = 1, sequence = 4, state = 1 } = {}) {
  const block = Buffer.alloc(CAMERA_SIZE);
  block.writeUInt32LE(layout, 0);
  block.writeUInt32LE(sequence, 4);
  block.writeUInt32LE(state, 8);
  block.writeUInt32LE(1, 12); // the current camera
  block.writeFloatLE(65, 16); // fov
  [1000.25, 50.5, -2000.75].forEach((v, i) => block.writeDoubleLE(v, 24 + 8 * i));
  [0.5, 0.5, 0.5, 0.5].forEach((v, i) => block.writeFloatLE(v, 48 + 4 * i));
  return block;
}

test('cameraRecord: the camera block, only when copied whole', () => {
  const block = cameraBlock();
  assert.deepEqual(cameraRecord(block, Buffer.from(block)), {
    sequence: 4, state: 1, camera: 1, fov: 65, x: 1000.25, y: 50.5, z: -2000.75, rotation: [0.5, 0.5, 0.5, 0.5],
  });
  // Being written (odd), changed between the two copies, or another layout: not used.
  assert.equal(cameraRecord(cameraBlock({ sequence: 5 }), cameraBlock({ sequence: 5 })), null);
  assert.equal(cameraRecord(cameraBlock({ sequence: 4 }), cameraBlock({ sequence: 6 })), null);
  assert.equal(cameraRecord(cameraBlock({ layout: 2 }), cameraBlock({ layout: 2 })), null);
});

test('truckKey falls back to brand id and model name', () => {
  assert.equal(truckKey({ brandId: 'kenworth', id: '', name: 'W900' }), 'kenworth/W900');
  assert.equal(truckKey({ brandId: '', id: '', name: '' }), null);
  assert.equal(truckKey({ brandId: 'x', id: 'vehicle.x', name: 'y' }), 'vehicle.x');
});
