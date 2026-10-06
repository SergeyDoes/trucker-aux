// The game camera (native/camera-plugin, Local\TruckerAuxCamera) for the listener. In the cab
// camera the view's rotation comes from the game, so the game's look into turns and toward the
// blinker are in it (the SDK's head leaves them out); its position stays the SDK's, which is the
// camera's to a millimetre there. An outside camera leaves the head at rest; the free camera
// puts the listener where it is, in the cab or out of it.
// docs/superpowers/specs/2026-10-06-camera-plugin-design.md
//
// World axes as in the game: X east, Y up, Z south; a vehicle looks along its -Z. SCS angles
// come in turns: heading about Y (left positive), then pitch about X (up), then roll about Z.
// Quaternions are [w, x, y, z].

// The cameras are told apart by the camera manager's index, not by distance: the free camera in
// the cab, and the one leaning out of the window (index 4, 0.9 m away), are as close to the head
// as the cab camera. Measured in ATS 1.61 (tools/camera_block.py, docs/findings.md). The free
// camera is the game's developer camera: g_developer "1" in the game's config.cfg, then 0.
export const CAB_CAMERA = 2;
export const FREE_CAMERA = 0;
// m: the cab camera is also within it of where the SDK puts the head, else it is not trusted
// (the physics and the rendered frame differ by up to about 0.5 m at speed).
export const CAB_RADIUS = 1.5;

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

const sub = (a, b) => a.map((v, i) => v - b[i]);

// The other way: a point in the world as an offset from the driver's default head, in the cab's
// axes, as the SDK's head offset is.
export function headOffset(pose, point) {
  const inVehicle = rotate(conj(truckRotation(pose)), sub(point, [pose.world.x, pose.world.y, pose.world.z]));
  const joint = add(pose.cabinPosition, [pose.cabin.x, pose.cabin.y, pose.cabin.z]);
  const [x, y, z] = sub(rotate(conj(cabinRotation(pose)), sub(inVehicle, joint)), pose.headPosition);
  return { x, y, z };
}

// The view for the listener: { source: 'game', heading, pitch, roll, distance } in the cab camera
// (angles in the cab, as the SDK's head offset gives them); { source: 'free', x, y, z, heading,
// pitch, roll, distance } for the free camera (where it is, as a head offset); { source:
// 'outside', distance } for any other camera; { source: null } when the camera is not known (no
// plugin, stale, not reading, no game or no truck): the telemetry then, as before. distance is
// the camera's from where the SDK puts the head.
export function cameraView(pose, camera, fresh) {
  if (!fresh || !camera || camera.state !== 1 || !pose?.sdkActive || !pose.truck || !pose.world) return { source: null };
  const head = expectedHead(pose);
  const distance = Math.hypot(camera.x - head[0], camera.y - head[1], camera.z - head[2]);
  const free = camera.camera === FREE_CAMERA;
  const cab = camera.camera === CAB_CAMERA && distance <= CAB_RADIUS;
  if (!free && !cab) return { source: 'outside', distance };
  const turned = quaternionToEuler(qmul(conj(qmul(truckRotation(pose), cabinRotation(pose))), camera.rotation));
  if (free) return { source: 'free', ...headOffset(pose, [camera.x, camera.y, camera.z]), ...turned, distance };
  return { source: 'game', ...turned, distance };
}

// The pose for the engine and the views: the SDK's head turned as the game camera looks, the
// head where the free camera is, or at rest when the camera is outside; untouched without the
// camera.
export function withCameraView(pose, view) {
  if (view.source === 'game') return { ...pose, head: { ...pose.head, heading: view.heading, pitch: view.pitch, roll: view.roll } };
  if (view.source === 'free') {
    const { x, y, z, heading, pitch, roll } = view;
    return { ...pose, head: { x, y, z, heading, pitch, roll } };
  }
  if (view.source === 'outside') return { ...pose, head: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 } };
  return pose;
}

// Where the free camera is in layout coordinates (X from the truck's axis, the head's rest at
// headX), for a speaker added there; null on any other camera.
export function cameraPoint(view, headX) {
  return view.source === 'free' ? [headX + view.x, view.y, view.z] : null;
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

// Whether the app has seen that the game's camera is not there: the game world up with a vehicle
// for confirmMs on end while the camera gave nothing (no plugin, a game version it does not know,
// a fault), so the view falls back to the telemetry and the Game camera settings are needed. It
// holds through the menus; it goes off as soon as the camera works, and a short gap does not
// confirm it (the camera may still be on its way into a new world).
export function createFallbackWatch(confirmMs = 3000) {
  let confirmed = false;
  let since = null;
  return ({ inWorld, truck, source }, now) => {
    if (source) {
      confirmed = false;
      since = null;
    } else if (!inWorld || !truck) {
      since = null;
    } else {
      if (since === null) since = now;
      if (now - since >= confirmMs) confirmed = true;
    }
    return confirmed;
  };
}
