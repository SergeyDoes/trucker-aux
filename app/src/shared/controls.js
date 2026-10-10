// Keys and controller buttons for actions in the cab (docs/superpowers/specs/2026-10-10-controls-
// voice-design.md), polled in the main process whatever window has the focus (main/controls.js).
// Input ids:
//   "key:<virtual key>"                    a key, by its Windows virtual-key code (decimal)
//   "joy:<vid>:<pid>:<button>"             a controller's button 1..32 (vid, pid: 4 hex digits)
//   "joy:<vid>:<pid>:pov-up|right|down|left"  its hat (a D-pad), as four buttons
// A controller is known by its USB ids, so a binding outlives a replug; two alike are one.

export const ACTIONS = ['next', 'previous', 'auto'];
export const ACTION_NAMES = { next: 'Next variant', previous: 'Previous variant', auto: 'Auto' };
export const MAX_COMBO = 3;
export const ESCAPE = 'key:27'; // cancels a capture, so it is never bound

const INPUT_ID = /^(key:\d{1,3}|joy:[0-9a-f]{4}:[0-9a-f]{4}:([1-9]|[12]\d|3[0-2]|pov-(up|right|down|left)))$/;
export const isInputId = (id) => typeof id === 'string' && INPUT_ID.test(id) && id !== ESCAPE;

// A binding: up to MAX_COMBO inputs, once each; anything else is left out.
export function normalizeBinding(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter(isInputId))].slice(0, MAX_COMBO) : [];
}

// { next: [ids], previous: [ids], auto: [ids] }, empty ones unbound.
export function normalizeControls(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(ACTIONS.map((action) => [action, normalizeBinding(src[action])]));
}

export const isBound = (controls) => ACTIONS.some((action) => controls[action]?.length);

// Watches the inputs held, poll by poll: (bindings, held: Set of ids) -> the action that fires
// now, or null. A binding fires when its last input goes down while the rest are held; other
// inputs held do not matter (a key held to drive). Of those firing at once the longest wins, so
// Ctrl + F9 does not also fire F9.
export function bindingWatch() {
  let before = new Set();
  return (bindings, held) => {
    const pressed = [...held].filter((id) => !before.has(id));
    before = new Set(held);
    if (!pressed.length) return null;
    let best = null;
    for (const action of ACTIONS) {
      const ids = bindings[action] ?? [];
      if (!ids.length || !ids.every((id) => held.has(id)) || !ids.some((id) => pressed.includes(id))) continue;
      if (!best || ids.length > best.ids.length) best = { action, ids };
    }
    return best?.action ?? null;
  };
}

// Takes a combination as it is pressed, poll by poll: held -> undefined while it is not done,
// the ids (in the order pressed; what was held at the most, up to MAX_COMBO) once everything is
// let go, or null when Escape is pressed. Inputs held when it starts count only once let go.
export function captureWatch() {
  let stale = null;
  let order = [];
  let most = [];
  return (held) => {
    if (held.has(ESCAPE)) return null;
    if (!stale) stale = new Set(held);
    for (const id of stale) if (!held.has(id)) stale.delete(id);
    const now = [...held].filter((id) => !stale.has(id) && isInputId(id));
    order = [...order.filter((id) => now.includes(id)), ...now.filter((id) => !order.includes(id))];
    if (order.length > most.length) most = order.slice(0, MAX_COMBO);
    return now.length || !most.length ? undefined : most;
  };
}

// Names of the virtual keys (US layout); others read "Key <code>".
const KEY_NAMES = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 19: 'Pause', 20: 'Caps Lock',
  32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
  44: 'Print Screen', 45: 'Insert', 46: 'Delete', 91: 'Win', 92: 'Win', 93: 'Menu',
  106: 'Num *', 107: 'Num +', 109: 'Num -', 110: 'Num .', 111: 'Num /', 144: 'Num Lock', 145: 'Scroll Lock',
  186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'",
};

export function keyName(vk) {
  if (KEY_NAMES[vk]) return KEY_NAMES[vk];
  if ((vk >= 48 && vk <= 57) || (vk >= 65 && vk <= 90)) return String.fromCharCode(vk);
  if (vk >= 96 && vk <= 105) return `Num ${vk - 96}`;
  if (vk >= 112 && vk <= 135) return `F${vk - 111}`;
  return `Key ${vk}`;
}

// The virtual keys polled for a capture: the keyboard, without the mouse buttons and the
// left/right twins of Shift, Ctrl and Alt (the keys themselves stand for both sides).
export const CAPTURE_KEYS = Array.from({ length: 247 }, (_, i) => i + 8).filter((vk) => vk < 0xa0 || vk > 0xa5);

const POV_NAMES = { 'pov-up': 'D-pad up', 'pov-right': 'D-pad right', 'pov-down': 'D-pad down', 'pov-left': 'D-pad left' };

// A controller's name: as Windows names it (names: { "vid:pid": name }), else its USB ids.
export const deviceName = (device, names = {}) => names[device] ?? `Controller ${device.toUpperCase()}`;

// A binding as the panel shows it: "Ctrl + F9", "Xbox 360 Controller: button 5 + D-pad up";
// a controller's name once for its inputs in a row. "Not set" when empty.
export function bindingText(ids, names = {}) {
  if (!ids?.length) return 'Not set';
  let device = null;
  return ids.map((id) => {
    const [kind, ...rest] = id.split(':');
    if (kind === 'key') {
      device = null;
      return keyName(Number(rest[0]));
    }
    const here = `${rest[0]}:${rest[1]}`;
    const input = POV_NAMES[rest[2]] ?? `button ${rest[2]}`;
    const text = here === device ? input : `${deviceName(here, names)}: ${input}`;
    device = here;
    return text;
  }).join(' + ');
}
