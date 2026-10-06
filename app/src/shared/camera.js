// The game camera (native/camera-plugin, Local\TruckerAuxCamera) for the listener. In the cab
// camera the view's rotation comes from the game, so the game's look into turns and toward the
// blinker are in it (the SDK's head leaves them out); its position stays the SDK's, which is the
// camera's to a millimetre there. An outside or free camera leaves the head at rest.
// docs/superpowers/specs/2026-10-06-camera-plugin-design.md
//
// World axes as in the game: X east, Y up, Z south; a vehicle looks along its -Z. SCS angles
// come in turns: heading about Y (left positive), then pitch about X (up), then roll about Z.
// Quaternions are [w, x, y, z].

export const CAB_RADIUS = 1.5; // m: the cab camera is within it (an outside one is 6 m away)

const TURN = 2 * Math.PI;

export function qmul([aw, ax, ay, az], [bw, bx, by, bz]) {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

const conj = ([w, x, y, z]) => [w, -x, -y, -z];

function rotate(q, [x, y, z]) {
  const [, rx, ry, rz] = qmul(qmul(q, [0, x, y, z]), conj(q));
  return [rx, ry, rz];
}

const axis = (angle, [x, y, z]) => [Math.cos(angle / 2), x * Math.sin(angle / 2), y * Math.sin(angle / 2), z * Math.sin(angle / 2)];

// SCS euler angles (turns) as a rotation: Ry(heading) · Rx(pitch) · Rz(roll).
export function eulerToQuaternion(heading, pitch, roll) {
  return qmul(qmul(axis(heading * TURN, [0, 1, 0]), axis(pitch * TURN, [1, 0, 0])), axis(roll * TURN, [0, 0, 1]));
}

// Back to heading, pitch, roll (turns): from where it looks (-Z) and its right (+X) and up (+Y).
export function quaternionToEuler(q) {
  const [fx, fy, fz] = rotate(q, [0, 0, -1]);
  const right = rotate(q, [1, 0, 0]);
  const up = rotate(q, [0, 1, 0]);
  return {
    heading: Math.atan2(-fx, -fz) / TURN,
    pitch: Math.asin(Math.max(-1, Math.min(1, fy))) / TURN,
    roll: Math.atan2(right[1], up[1]) / TURN,
  };
}

const add = (a, b) => a.map((v, i) => v + b[i]);

const truckRotation = (pose) => eulerToQuaternion(pose.world.heading, pose.world.pitch, pose.world.roll);
const cabinRotation = (pose) => eulerToQuaternion(pose.cabin.heading, pose.cabin.pitch, pose.cabin.roll);

// Where the cab camera should be in the world: the truck's position plus, turned with it, the cab's
// joint and offset and, turned with the cab, the head's default position and offset (SDK).
export function expectedHead(pose) {
  const inCab = add(pose.headPosition, [pose.head.x, pose.head.y, pose.head.z]);
  const inVehicle = add(add(pose.cabinPosition, [pose.cabin.x, pose.cabin.y, pose.cabin.z]), rotate(cabinRotation(pose), inCab));
  return add([pose.world.x, pose.world.y, pose.world.z], rotate(truckRotation(pose), inVehicle));
}

// The view for the listener: { source: 'game', heading, pitch, roll, distance } in the cab camera
// (angles in the cab, as the SDK's head offset gives them); { source: 'outside', distance } for an
// outside or free camera; { source: null } when the camera is not known (no plugin, stale, not
// reading, no game or no truck): the telemetry then, as before.
export function cameraView(pose, camera, fresh) {
  if (!fresh || !camera || camera.state !== 1 || !pose?.sdkActive || !pose.truck || !pose.world) return { source: null };
  const head = expectedHead(pose);
  const distance = Math.hypot(camera.x - head[0], camera.y - head[1], camera.z - head[2]);
  if (!(distance <= CAB_RADIUS)) return { source: 'outside', distance };
  const inCab = qmul(conj(qmul(truckRotation(pose), cabinRotation(pose))), camera.rotation);
  return { source: 'game', ...quaternionToEuler(inCab), distance };
}

// The pose for the engine and the views: the SDK's head turned as the game camera looks, or at
// rest when the camera is outside; untouched without the camera.
export function withCameraView(pose, view) {
  if (view.source === 'game') return { ...pose, head: { ...pose.head, heading: view.heading, pitch: view.pitch, roll: view.roll } };
  if (view.source === 'outside') return { ...pose, head: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 } };
  return pose;
}

// Whether the camera block is fresh: its sequence moved within timeoutMs. It stops in the main
// menu and when the game is gone; the first reading counts.
export function createCameraWatch(timeoutMs = 1000) {
  let last;
  let since = -Infinity;
  return (camera, now) => {
    if (!camera) {
      last = undefined;
      return false;
    }
    if (camera.sequence !== last) {
      last = camera.sequence;
      since = now;
    }
    return now - since <= timeoutMs;
  };
}
