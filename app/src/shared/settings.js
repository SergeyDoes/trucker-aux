// settings.json: which devices to use, where the audio comes from and when to mute it.

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

function reverseMode(value) {
  if (value === true) return 'on'; // the first version had a checkbox
  return TURN_LOOK_REVERSE.includes(value) ? value : 'off';
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

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
    // The volume slider's place, 0..1 (to the percent); loudness.js perceptualGain makes it a gain.
    volume: finite(src.volume) ? Math.round(Math.min(1, Math.max(0, src.volume)) * 100) / 100 : 1,
  };
}
