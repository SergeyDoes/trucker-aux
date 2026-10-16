// The cab's keys and controller buttons (shared/controls.js), polled at 50 Hz whatever window
// has the focus: GetAsyncKeyState for the keys, the Windows joystick API (winmm joyGetPosEx)
// for up to 16 controllers (wheels, button boxes, pads). Only read: the game sees every key and
// button as well. Windows only.
// It runs in a process of its own (main/controls.js starts it): winmm, with DirectInput under
// it, has corrupted the heap while rebuilding its device list (joyGetPosEx > joyOpen >
// DIHid_BuildHidList; crash dumps of 2026-10-12 and 14, the second as the game was quit), and
// that took the whole app down. The controllers are looked for at start and when Windows says
// the devices changed (rescan), not on a timer: each joystick number not plugged in makes winmm
// rebuild that list again.
import { CAPTURE_KEYS, bindingWatch, captureWatch, isBound } from '../shared/controls.js';

const koffi = process.platform === 'win32' ? (await import('koffi')).default : null;

const POLL_MS = 20;
const CAPTURE_MS = 15000;     // a capture nobody finishes ends
const JOY_IDS = 16;
const JOY_RETURNALL = 0xff;
const JOY_RETURNPOVCTS = 0x200; // the hat in hundredths of a degree
const POV_CENTERED = 0xffff;
const KEY_DOWN = 0x8000;
// Where Windows keeps a controller's name (the Game Controllers panel shows it).
const OEM_KEY = 'System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\Joystick\\OEM';
const HKEY_CURRENT_USER = -0x7fffffff; // (HKEY)(LONG)0x80000001, sign-extended
const HKEY_LOCAL_MACHINE = -0x7ffffffe;
const RRF_RT_REG_SZ = 0x2;

let api;
function load() {
  if (api !== undefined) return api;
  api = null;
  if (!koffi) return api;
  const winmm = koffi.load('winmm.dll');
  const user32 = koffi.load('user32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const JOYINFOEX = koffi.struct('TruckerAuxJoyInfoEx', {
    dwSize: 'uint32', dwFlags: 'uint32',
    dwXpos: 'uint32', dwYpos: 'uint32', dwZpos: 'uint32', dwRpos: 'uint32', dwUpos: 'uint32', dwVpos: 'uint32',
    dwButtons: 'uint32', dwButtonNumber: 'uint32', dwPOV: 'uint32', dwReserved1: 'uint32', dwReserved2: 'uint32',
  });
  const JOYCAPSW = koffi.struct('TruckerAuxJoyCapsW', {
    wMid: 'uint16', wPid: 'uint16', szPname: koffi.array('int16', 32, 'String'),
    wXmin: 'uint32', wXmax: 'uint32', wYmin: 'uint32', wYmax: 'uint32', wZmin: 'uint32', wZmax: 'uint32',
    wNumButtons: 'uint32', wPeriodMin: 'uint32', wPeriodMax: 'uint32',
    wRmin: 'uint32', wRmax: 'uint32', wUmin: 'uint32', wUmax: 'uint32', wVmin: 'uint32', wVmax: 'uint32',
    wCaps: 'uint32', wMaxAxes: 'uint32', wNumAxes: 'uint32', wMaxButtons: 'uint32',
    szRegKey: koffi.array('int16', 32, 'String'), szOEMVxD: koffi.array('int16', 260, 'String'),
  });
  api = {
    infoSize: koffi.sizeof(JOYINFOEX),
    capsSize: koffi.sizeof(JOYCAPSW),
    getPos: winmm.func('uint32 __stdcall joyGetPosEx(uint32 id, _Inout_ TruckerAuxJoyInfoEx *info)'),
    getCaps: winmm.func('uint32 __stdcall joyGetDevCapsW(uintptr_t id, _Out_ TruckerAuxJoyCapsW *caps, uint32 size)'),
    keyState: user32.func('int16 __stdcall GetAsyncKeyState(int key)'),
    regGetValue: advapi32.func('int32 __stdcall RegGetValueW(intptr_t hkey, str16 subkey, str16 value, uint32 flags, _Out_ uint32 *type, _Out_ void *data, _Inout_ uint32 *size)'),
  };
  return api;
}

const hex = (n) => n.toString(16).padStart(4, '0');

// A controller's name as Windows keeps it, or null.
function oemName(device) {
  const [vid, pid] = device.toUpperCase().split(':');
  for (const root of [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]) {
    const data = Buffer.alloc(512);
    const size = [data.length];
    if (api.regGetValue(root, `${OEM_KEY}\\VID_${vid}&PID_${pid}`, 'OEMName', RRF_RT_REG_SZ, [0], data, size) === 0) {
      const name = data.toString('utf16le', 0, Math.max(0, size[0] - 2)).trim();
      if (name) return name;
    }
  }
  return null;
}

// The hat's angle (hundredths of a degree) as the directions held: a diagonal is two.
function hatDirections(pov) {
  if (pov === POV_CENTERED || pov > 36000) return [];
  const a = pov / 100;
  return [
    (a <= 45 || a >= 315) && 'pov-up', a >= 45 && a <= 135 && 'pov-right',
    a >= 135 && a <= 225 && 'pov-down', a >= 225 && a <= 315 && 'pov-left',
  ].filter(Boolean);
}

// onAction(action): a binding fired. onError(message): the controls cannot work here.
export function createPoller({ onAction, onError = () => {} }) {
  let bindings = { next: [], previous: [], auto: [] };
  let boundKeys = [];
  let joysWanted = false;
  let capturing = null; // { watch, resolve, timer }
  let timer = null;
  let devices = new Map(); // joystick number -> "vid:pid"
  let scanned = false; // the controllers are looked for again when false
  const watch = bindingWatch();

  function scan() {
    devices = new Map();
    for (let id = 0; id < JOY_IDS; id++) {
      if (api.getPos(id, { dwSize: api.infoSize, dwFlags: JOY_RETURNALL }) !== 0) continue;
      const caps = {};
      if (api.getCaps(id, caps, api.capsSize) === 0) devices.set(id, `${hex(caps.wMid)}:${hex(caps.wPid)}`);
    }
  }

  function held(keys, joys) {
    const ids = new Set();
    for (const vk of keys) if (api.keyState(vk) & KEY_DOWN) ids.add(`key:${vk}`);
    if (!joys) return ids;
    for (const [id, device] of devices) {
      const info = { dwSize: api.infoSize, dwFlags: JOY_RETURNALL | JOY_RETURNPOVCTS };
      if (api.getPos(id, info) !== 0) {
        devices.delete(id); // unplugged: looked for again when the devices change
        continue;
      }
      for (let b = 0; b < 32; b++) if ((info.dwButtons >>> b) & 1) ids.add(`joy:${device}:${b + 1}`);
      for (const dir of hatDirections(info.dwPOV)) ids.add(`joy:${device}:${dir}`);
    }
    return ids;
  }

  function tick() {
    const joys = Boolean(capturing) || joysWanted;
    if (joys && !scanned) {
      scanned = true;
      scan();
    }
    if (capturing) {
      const combo = capturing.watch(held(CAPTURE_KEYS, true));
      if (combo !== undefined) finishCapture(combo);
      return;
    }
    const action = watch(bindings, held(boundKeys, joys), performance.now());
    if (action) onAction(action);
  }

  function run() {
    const wanted = Boolean(capturing) || isBound(bindings);
    if (wanted && !timer && load()) timer = setInterval(() => {
      try {
        tick();
      } catch (err) {
        clearInterval(timer);
        timer = null;
        onError(`Keys and controller buttons do not work: ${err.message}`);
      }
    }, POLL_MS);
    if (!wanted && timer) {
      clearInterval(timer);
      timer = null;
    }
    if (wanted && !api) onError('Keys and controller buttons work on Windows only.');
  }

  function finishCapture(combo) {
    if (!capturing) return;
    const { resolve, timer: limit } = capturing;
    clearTimeout(limit);
    capturing = null;
    run();
    resolve(combo);
  }

  return {
    // bindings: settings.controls (shared/controls.js normalizeControls).
    setBindings(next) {
      bindings = next;
      const ids = Object.values(bindings).flat();
      boundKeys = [...new Set(ids.filter((id) => id.startsWith('key:')).map((id) => Number(id.slice(4))))];
      joysWanted = ids.some((id) => id.startsWith('joy:'));
      run();
    },
    // The next combination pressed (ids), or null: Escape, cancelCapture, or nothing for 15 s.
    capture() {
      finishCapture(null);
      return new Promise((resolve) => {
        capturing = { watch: captureWatch(), resolve, timer: setTimeout(() => finishCapture(null), CAPTURE_MS) };
        run();
      });
    },
    cancelCapture() {
      finishCapture(null);
    },
    // The devices changed (a controller plugged in or out): looked for at the next poll.
    rescan() {
      scanned = false;
    },
    // The names Windows gives the controllers bound or plugged in: { "vid:pid": name }.
    names() {
      if (!load()) return {};
      const bound = Object.values(bindings).flat().filter((id) => id.startsWith('joy:')).map((id) => id.split(':').slice(1, 3).join(':'));
      const all = [...new Set([...bound, ...devices.values()])];
      return Object.fromEntries(all.map((d) => [d, oemName(d)]).filter(([, name]) => name));
    },
    stop() {
      finishCapture(null);
      bindings = { next: [], previous: [], auto: [] };
      run();
    },
  };
}

// As a utility process (main/controls.js): its messages in, the poller's out.
const port = process.parentPort;
if (port) {
  const poller = createPoller({
    onAction: (action) => port.postMessage({ type: 'action', action }),
    onError: (message) => port.postMessage({ type: 'error', message }),
  });
  port.on('message', async ({ data }) => {
    if (data.type === 'bindings') poller.setBindings(data.bindings);
    else if (data.type === 'capture') port.postMessage({ type: 'captured', ids: await poller.capture() });
    else if (data.type === 'cancel') poller.cancelCapture();
    else if (data.type === 'rescan') poller.rescan();
    else if (data.type === 'names') port.postMessage({ type: 'names', names: poller.names() });
  });
}
