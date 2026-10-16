// settings.json: which devices to use, where the audio comes from and when to mute it.
import { normalizeControls } from './controls.js';

// Mute the music like a car radio: never, when the engine is off, or when the electrics are off.
export const MUTE_MODES = ['never', 'engine', 'electric'];

// While the game is paused the music plays, is muted, or follows the vehicle as "Mute when" says.
export const PAUSE_BEHAVIORS = ['active', 'muted', 'vehicle'];

function deviceRef(raw) {
  return raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id
    ? { id: raw.id, label: typeof raw.label === 'string' ? raw.label : '' }
    : null;
}

// The game's camera options, set here as in the game (pose.js turnLook): "look into turns"
// (on, percent: 100 % turns 35° at full lock; reverse: on the reverse gear off, on, or
// inverted) and "look toward the blinker". They turn the camera, but not the telemetry's
// head, so the app adds them.
export const TURN_LOOK_REVERSE = ['off', 'on', 'inverted'];

// Where the head comes from (Camera › Mode): 'game', Raw Camera, the game's camera through
// trucker_aux_camera.dll when it reads it, else the telemetry; 'vr', Raw Telemetry, the
// telemetry's head as it is (a VR headset's), nothing added; 'telemetry', Adjusted Telemetry,
// the telemetry's head with the turn look emulated (the camera not read: no free camera either,
// for when Raw Camera misbehaves).
export const HEAD_SOURCES = ['game', 'vr', 'telemetry'];

// The head's turns locked per way (Camera › Lock): a locked axis stays at 0 in the cab. At first
// the roll for the game's camera and the telemetry (the camera leans against the cab while it
// sways, pose.js levelHead); none in VR, where a head's tilt is real.
export const AXES = ['yaw', 'pitch', 'roll'];
const AXIS_LOCKS = {
  game: { yaw: false, pitch: false, roll: true },
  vr: { yaw: false, pitch: false, roll: false },
  telemetry: { yaw: false, pitch: false, roll: true },
};

function axisLocks(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(HEAD_SOURCES.map((way) => [way, Object.fromEntries(AXES.map((axis) => {
    const value = src[way]?.[axis];
    return [axis, typeof value === 'boolean' ? value : AXIS_LOCKS[way][axis]];
  }))]));
}

function reverseMode(value) {
  if (value === true) return 'on'; // the first version had a checkbox
  return TURN_LOOK_REVERSE.includes(value) ? value : 'off';
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// The voice: off; 'system', over everything on the output device (no speakers, not muted, not
// at the music's volume); 'aux', from the cab's speakers as the music is, muted with it.
export const VOICE_MODES = ['off', 'system', 'aux'];

// Volume Up / Down (controls.js): the slider's next 5 % step that way, within 0..200 %.
const VOLUME_STEP = 0.05;
export function stepVolume(volume, direction) {
  const steps = volume / VOLUME_STEP;
  const next = direction > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  return Math.round(Math.min(2, Math.max(0, next * VOLUME_STEP)) * 100) / 100;
}

function voiceMode(value) {
  if (value === false) return 'off'; // the first version had a checkbox
  return VOICE_MODES.includes(value) ? value : 'system';
}

function turnLookSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  // The first version saved the angle at full lock in degrees.
  let percent = finite(src.percent) ? src.percent : (finite(src.degrees) ? (src.degrees / 45) * 100 : 100);
  percent = Math.round(Math.min(200, Math.max(0, percent)));
  return { on: src.on === true, percent, reverse: reverseMode(src.reverse), blinkers: src.blinkers === true };
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    source: src.source === 'file' ? 'file' : 'input',
    input: deviceRef(src.input),
    output: deviceRef(src.output),
    // Like a car radio by default: silent while the vehicle's electrics are off.
    muteWhen: MUTE_MODES.includes(src.muteWhen) ? src.muteWhen : 'electric',
    pauseBehavior: PAUSE_BEHAVIORS.includes(src.pauseBehavior) ? src.pauseBehavior : 'vehicle',
    // Trim every preset to the loudness of the default layout (loudness.js).
    matchLoudness: typeof src.matchLoudness === 'boolean' ? src.matchLoudness : true,
    turnLook: turnLookSettings(src.turnLook),
    // Where the head comes from (HEAD_SOURCES).
    headFrom: HEAD_SOURCES.includes(src.headFrom) ? src.headFrom : 'game',
    axisLocks: axisLocks(src.axisLocks),
    // The volume slider's place, 0..2 (up to 200 %, to the percent); loudness.js perceptualGain
    // makes it a gain.
    volume: finite(src.volume) ? Math.round(Math.min(2, Math.max(0, src.volume)) * 100) / 100 : 1,
    // Keys and controller buttons for the actions in the cab (controls.js), and the voice that
    // says what plays then (VOICE_MODES) at a volume of its own, 0..2 as the music's.
    controls: normalizeControls(src.controls),
    voice: voiceMode(src.voice),
    voiceVolume: finite(src.voiceVolume) ? Math.round(Math.min(2, Math.max(0, src.voiceVolume)) * 100) / 100 : 1,
    // Auto, the tree's toggle: getting out of a vehicle plays the next one's preset in Auto; off,
    // what plays stays (app.js onPose).
    autoFollow: src.autoFollow !== false,
  };
}
