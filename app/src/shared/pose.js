// The driver's default head in layout coordinates (X from the truck's axis): left of the
// axis by what the game reports (truck.centerX), or by 40 cm, a typical left-hand-drive
// truck, without the game. head.offset (looking around, and the seat setting: up to 10 cm
// each way, docs/findings.md) moves the listener from here; the zero point stays.
export const DEFAULT_HEAD_X = -0.4;

export function headRestX(truck) {
  return typeof truck?.centerX === 'number' ? -truck.centerX : DEFAULT_HEAD_X;
}

// The game's "look into turns" turns the camera with the steering, even standing still,
// and its "look toward the blinker" turns it while a blinker is on; the telemetry's head
// shows neither (a 90 s drive: steering up to full lock, head heading 0.0 throughout), the
// game's camera does (trucker_aux_camera.dll, camera.js). Without the camera the app adds
// them, as the game does with the same options (settings.turnLook), by the game's camera
// in docs/findings.md: the steering times 35° at 100 % (26.2° at full lock was measured
// at 75 %); with a blinker at least 20° toward the driver's side or 40° across, whatever
// the percent (measured in a left-hand-drive cab: 20° left, 40° right; taken as mirrored
// in a right-hand-drive one). The camera turns to a blinker's angle and back at about
// 80°/s.
export const FULL_LOCK_DEG = 35;
export const BLINKER_DEG = { near: 20, far: 40 };
export const BLINKER_DEG_PER_S = 80;

// The camera's extra turn, in turns, positive looking left: steer from look into turns,
// blinker what the blinker adds on top. Kept apart so the app can ramp in the blinker's
// step. On the reverse gear look into turns is off, the same, or inverted, as set; the
// blinker limits stay the same (so does the game, even inverted). Both blinkers at once
// are the hazard lights, which the game ignores. The driver sits right of the axis
// (headRestX > 0) in a right-hand-drive cab. The pause keeps it, as the game keeps its camera.
export function turnLook(pose, look) {
  if (!look || !pose || !pose.sdkActive) return { steer: 0, blinker: 0 };
  const reverse = pose.gear < 0;
  let steer = 0;
  if (look.on && (!reverse || look.reverse === 'on' || look.reverse === 'inverted')) {
    const sign = reverse && look.reverse === 'inverted' ? -1 : 1;
    steer = (sign * (pose.steer ?? 0) * FULL_LOCK_DEG * (look.percent / 100)) / 360;
  }
  const left = pose.blinkers?.left === true;
  const right = pose.blinkers?.right === true;
  const rightHand = headRestX(pose.truck) > 0;
  const leftDeg = rightHand ? BLINKER_DEG.far : BLINKER_DEG.near;
  const rightDeg = rightHand ? BLINKER_DEG.near : BLINKER_DEG.far;
  let target = steer;
  if (look.blinkers && left && !right) target = Math.max(steer, leftDeg / 360);
  if (look.blinkers && right && !left) target = Math.min(steer, -rightDeg / 360);
  return { steer, blinker: target - steer };
}

// Moves a value (in turns) toward its target at a steady degPerSecond, as the game turns
// its camera toward a blinker and back, so the sound does not jump. The first value, and
// one after a gap of over a second, is taken as it is.
export function createRamp(degPerSecond = BLINKER_DEG_PER_S) {
  let value = 0;
  let last = null;
  return (target, now) => {
    const dt = last === null ? Infinity : now - last;
    last = now;
    if (dt > 1000) {
      value = target;
    } else {
      const step = (degPerSecond / 360) * (dt / 1000);
      value = target > value ? Math.min(target, value + step) : Math.max(target, value - step);
    }
    return value;
  };
}

// The pose with turns added to the head's heading, for the engine and the views.
export function withTurnLook(pose, turns) {
  return turns ? { ...pose, head: { ...pose.head, heading: pose.head.heading + turns } } : pose;
}

// The listener's ears stay level in the cab: the game's camera (and head.offset) leans against
// the cab while the cab sways, and tilted ears move the speakers above and below them sideways,
// a centred one most audibly. A seated driver leans with the cab. Heading, pitch and the head's
// place stay.
export function levelHead(pose) {
  return pose?.head?.roll ? { ...pose, head: { ...pose.head, roll: 0 } } : pose;
}

// While the game is paused the head stays where it was in the game: the last head heard
// before the pause, whatever the camera or the telemetry say meanwhile (the pause menu may
// show another camera, the camera block may go stale). Without such a head (paused from the
// start, or the game gone) the pose is taken as it is.
export function createPauseHold() {
  let last = null;
  return (pose) => {
    if (!pose?.sdkActive) {
      last = null;
      return pose;
    }
    if (!pose.paused) {
      last = pose.head;
      return pose;
    }
    return last ? { ...pose, head: last } : pose;
  };
}

// Whether the game world is up. renderTime advances with every frame, also in the pause
// menu; in the main menu, while loading, and in a hung game it stands still while the
// plugin's memory keeps the last truck (docs/findings.md). The first reading proves nothing.
export function createFrameWatch(timeoutMs = 1000) {
  let last;
  let since = -Infinity;
  return (renderTime, now) => {
    if (renderTime === undefined || renderTime === null) {
      last = undefined;
      return false;
    }
    if (renderTime !== last) {
      if (last !== undefined) since = now;
      last = renderTime;
    }
    return now - since < timeoutMs;
  };
}

// RenCloud's scs-telemetry revisions whose memory layout main/telemetry.js reads. Another one
// (another mod may install its own) may have moved the values, so the panel says so.
export const KNOWN_PLUGIN_REVISIONS = [12];

export function pluginWarning(pose) {
  if (!pose?.sdkActive || KNOWN_PLUGIN_REVISIONS.includes(pose.pluginRevision)) return null;
  return `scs-telemetry.dll revision ${pose.pluginRevision} is not one Trucker AUX knows (${KNOWN_PLUGIN_REVISIONS.join(', ')}): the values it reads may be wrong.`;
}

// Whether the music is muted: while the vehicle is switched off (settings.muteWhen), and
// on pause as settings.pauseBehavior says: 'active' plays, 'muted' mutes, 'vehicle' goes
// by muteWhen as when driving. Without the game, before a vehicle is loaded, or outside
// the game world (inWorld false: main menu, loading) the music plays as usual.
export function musicSilenced(pose, mode, inWorld = true, onPause = 'vehicle') {
  if (!pose || !pose.sdkActive || !pose.truck || !inWorld) return false;
  if (pose.paused && onPause === 'muted') return true;
  if (pose.paused && onPause === 'active') return false;
  if (mode === 'engine') return !pose.engineOn;
  if (mode === 'electric') return !pose.electricOn;
  return false;
}

// SCS angles come in turns: heading in [0,1), pitch and roll in [-0.5,0.5].
export function turnsToDeg(turns) {
  const deg = turns * 360;
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

// SCS head pose -> Web Audio listener vectors. The axes match:
// X right, Y up, Z back (forward is -Z).
// R = Ry(heading) * Rx(pitch) * Rz(roll), right-hand rotations:
// heading > 0 looks left, pitch > 0 looks up, roll > 0 tilts the top of the head left.
export function listenerVectors(headingTurns, pitchTurns, rollTurns) {
  const h = headingTurns * 2 * Math.PI;
  const p = pitchTurns * 2 * Math.PI;
  const r = rollTurns * 2 * Math.PI;
  const sh = Math.sin(h), ch = Math.cos(h);
  const sp = Math.sin(p), cp = Math.cos(p);
  const sr = Math.sin(r), cr = Math.cos(r);
  return {
    forward: [-cp * sh, sp, -cp * ch],
    up: [-sr * ch + cr * sp * sh, cr * cp, sr * sh + cr * sp * ch],
  };
}
