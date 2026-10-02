# E0: Electron prototype (spike) — implementation plan

> **For agentic workers:** required skill — superpowers:subagent-driven-development (recommended) or superpowers:executing-plans; tasks run in order, steps are tracked with checkboxes (`- [ ]`).

**Status (2026-09-30):** done and superseded by E1. The open questions were answered by direct diagnostics instead of the remaining manual steps; the results are in `docs/findings.md`. Unchecked steps below were not run.

**Goal:** a minimal Electron app that mixes two sources (a test file and `CABLE Output`) into a graph of HRTF speakers, turns the listener with the head pose from ATS and objectively counts clicks at the cable input.

**Architecture:** the main process polls the shared memory `Local\SCSTelemetry` through koffi (~100 Hz) and sends the pose over IPC. The window holds one `AudioContext`: M/S width → two HRTF `PannerNode`s → output; the `AudioListener` follows the pose. The cable comes in through `getUserMedia`. An AudioWorklet detector of 1 kHz tone dropouts sits at the input.

**Stack:** Electron 44, koffi 3, Web Audio (PannerNode HRTF, AudioWorklet), `node --test`, Python 3 (fake shared memory).

**Spec:** `PLAN.md` (sections "Architecture", "Open questions", milestone E0). Memory and pose data: `docs/findings.md`, `tools/shm_probe.py`.

> **Change 2026-09-30:** the built-in browser was dropped at the user's request: an app offering sign-ins looks suspicious. Everything about the tab (task 4, steps 6–9 and 11–12; `tone.html`; the "tab" row in the results) is cancelled and the code removed. The click detector stays for the cable.

## Global constraints

- Windows 11 x64; Node v24.19.0, npm 12.1.0; `electron` ^44.5.1, `koffi` ^3.3.2 — the only dependencies of E0.
- ESM code (`"type": "module"`), except the preload: `preload.cjs`.
- Comments and UI strings in Russian (changed to English in E1).
- The user commits. Instead of a "Commit" step, each task ends by showing the changed files and the diff.
- `npm install` and any downloads only after the user's explicit permission.
- The app only opens the shared memory `Local\SCSTelemetry` for reading (`OpenFileMappingW`), never creates it.
- Memory field offsets as in `tools/shm_probe.py`: `sdkActive` @0, `paused` @4, head.offset @2024 (6 floats LE), `truckBrand` @2364, `truckName` @2492 (64 bytes each).
- SCS axes = Web Audio axes: X right, Y up, Z back; forward = −Z.

## Files

| File | Responsibility |
|---|---|
| `app/package.json`, `app/.gitignore` | project, `start` and `test` scripts |
| `app/src/shared/pose.js` | turns → degrees; pose → listener vectors |
| `app/src/shared/layout.js` | default speaker layout; width gains |
| `app/src/shared/glitch.js` | dropout counter for a clean tone |
| `app/src/main/telemetry.js` | reading and parsing the shared memory (koffi) |
| `app/src/main/main.js` | window, tab, tab audio capture, pose feed, permissions |
| `app/src/main/preload.cjs` | window API: `onPose`, `loadTab`, `loadToneTab` |
| `app/src/renderer/index.html`, `app.js` | control panel, sources, counters |
| `app/src/renderer/engine.js` | graph: width → HRTF speakers → output, listener |
| `app/src/renderer/worklets/glitch-detector.js` | AudioWorklet around `glitch.js` |
| ~~`app/src/renderer/tone.html`~~ | ~~test page for the tab~~ — removed with the browser |
| `app/scripts/pose-dump.js` | manual check of the memory reader from Node |
| `app/test/*.test.js` | `node --test` tests |
| `tools/fake_shm.py` | fake shared memory for work without the game |
| `docs/findings.md` | E0 results |

---

### Task 1: app skeleton and pose math

**Files:**
- Create: `app/package.json`, `app/.gitignore`, `app/src/shared/pose.js`
- Test: `app/test/pose.test.js`

**Interfaces:**
- Consumes: —
- Produces: `turnsToDeg(turns: number): number` — degrees in [−180, 180); `listenerVectors(headingTurns, pitchTurns, rollTurns): { forward: [x, y, z], up: [x, y, z] }`.

- [x] **Step 1: create `app/package.json` and `app/.gitignore`**

```json
{
  "name": "trucker-aux",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test"
  },
  "dependencies": {
    "koffi": "^3.3.2"
  },
  "devDependencies": {
    "electron": "^44.5.1"
  }
}
```

```gitignore
node_modules/
out/
```

- [x] **Step 2: ask for permission and install the dependencies**

Ask the user: "May I run `npm install` in `app/`? It downloads electron 44 (~110 MB) and koffi 3 (~20 MB) from npmjs.com". After a "yes":

Run: `cd app && npm install`
Expected: `added N packages`, no `ERR!`.

- [x] **Step 3: write the failing test `app/test/pose.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnsToDeg, listenerVectors } from '../src/shared/pose.js';

function close(actual, expected, eps = 1e-9) {
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < eps, `[${i}] ${actual[i]} != ${e}`));
}

test('turnsToDeg maps turns to -180..180', () => {
  assert.ok(Math.abs(turnsToDeg(0.99) - -3.6) < 1e-9);
  assert.equal(turnsToDeg(0.25), 90);
  assert.equal(turnsToDeg(-0.25), -90);
  assert.equal(turnsToDeg(0), 0);
});

test('head straight: forward -Z, up +Y', () => {
  const v = listenerVectors(0, 0, 0);
  close(v.forward, [0, 0, -1]);
  close(v.up, [0, 1, 0]);
});

test('heading 0.25 looks left', () => {
  close(listenerVectors(0.25, 0, 0).forward, [-1, 0, 0]);
});

test('pitch 0.125 looks 45° up', () => {
  const v = listenerVectors(0, 0.125, 0);
  close(v.forward, [0, Math.SQRT1_2, -Math.SQRT1_2]);
  close(v.up, [0, Math.SQRT1_2, Math.SQRT1_2]);
});

test('roll 0.25 tilts the top of the head left', () => {
  close(listenerVectors(0, 0, 0.25).up, [-1, 0, 0]);
});
```

- [x] **Step 4: make sure the test fails**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/shared/pose.js`.

- [x] **Step 5: implement `app/src/shared/pose.js`**

```js
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
```

- [x] **Step 6: make sure the tests pass**

Run: `cd app && npm test`
Expected: `pass 5`, `fail 0`.

- [x] **Step 7: show the user the new files (they commit)**

---

### Task 2: reading the shared memory

**Files:**
- Create: `app/src/main/telemetry.js`, `app/scripts/pose-dump.js`, `tools/fake_shm.py`
- Test: `app/test/telemetry.test.js`

**Interfaces:**
- Consumes: `turnsToDeg` from task 1 (only in `pose-dump.js`).
- Produces:
  - `SNAPSHOT_SIZE: number` (2556);
  - `parsePose(view: DataView): Pose`, where `Pose = { sdkActive: boolean, paused: boolean, head: { x, y, z, heading, pitch, roll }, truck: string }` — metres and turns, as in the SDK;
  - `openTelemetry(): { read(): Pose } | null` — `null` when there is no memory (the game with the plugin is not running).

- [x] **Step 1: write the failing test `app/test/telemetry.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePose, SNAPSHOT_SIZE } from '../src/main/telemetry.js';

test('parsePose reads the RenCloud plugin offsets', () => {
  const view = new DataView(new ArrayBuffer(SNAPSHOT_SIZE));
  view.setUint8(0, 1);
  view.setUint8(4, 1);
  [0.01, -0.05, 0.02, 0.99, -0.0083, 0].forEach((v, i) => view.setFloat32(2024 + 4 * i, v, true));
  const bytes = new Uint8Array(view.buffer);
  bytes.set(new TextEncoder().encode('International'), 2364);
  bytes.set(new TextEncoder().encode('9900i'), 2492);

  const pose = parsePose(view);

  assert.equal(pose.sdkActive, true);
  assert.equal(pose.paused, true);
  assert.ok(Math.abs(pose.head.y - -0.05) < 1e-6);
  assert.ok(Math.abs(pose.head.heading - 0.99) < 1e-6);
  assert.ok(Math.abs(pose.head.pitch - -0.0083) < 1e-6);
  assert.equal(pose.truck, 'International 9900i');
});

test('empty memory: game inactive, no truck', () => {
  const pose = parsePose(new DataView(new ArrayBuffer(SNAPSHOT_SIZE)));
  assert.equal(pose.sdkActive, false);
  assert.equal(pose.truck, '');
});
```

- [x] **Step 2: make sure the test fails**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/main/telemetry.js`.

- [x] **Step 3: implement `app/src/main/telemetry.js`**

The memory is copied with `RtlMoveMemory` into a plain `Buffer`: `koffi.view` creates an external ArrayBuffer, which Electron forbids (V8 memory cage).

```js
import koffi from 'koffi';

export const MMF_NAME = 'Local\\SCSTelemetry';
const MMF_SIZE = 32 * 1024;
const FILE_MAP_READ = 0x0004;

// Offsets from third_party/scs-sdk-plugin/scs-telemetry/inc/scs-telemetry-common.hpp
// (offsetof, MSVC x64), the same as in tools/shm_probe.py.
const OFF_SDK_ACTIVE = 0;
const OFF_PAUSED = 4;
const OFF_HEAD_OFFSET = 2024; // 6 floats: x y z heading pitch roll, angles in turns
const OFF_TRUCK_BRAND = 2364;
const OFF_TRUCK_NAME = 2492;
const STR_SIZE = 64;
export const SNAPSHOT_SIZE = OFF_TRUCK_NAME + STR_SIZE; // only the start of the structure is copied

const decoder = new TextDecoder();

function readString(view, offset) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, STR_SIZE);
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

export function parsePose(view) {
  const f = (i) => view.getFloat32(OFF_HEAD_OFFSET + 4 * i, true);
  return {
    sdkActive: view.getUint8(OFF_SDK_ACTIVE) !== 0,
    paused: view.getUint8(OFF_PAUSED) !== 0,
    head: { x: f(0), y: f(1), z: f(2), heading: f(3), pitch: f(4), roll: f(5) },
    truck: `${readString(view, OFF_TRUCK_BRAND)} ${readString(view, OFF_TRUCK_NAME)}`.trim(),
  };
}

let kernel32 = null;

function api() {
  if (!kernel32) {
    const lib = koffi.load('kernel32.dll');
    kernel32 = {
      OpenFileMappingW: lib.func('void *OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
      MapViewOfFile: lib.func('void *MapViewOfFile(void *mapping, uint32_t access, uint32_t offsetHigh, uint32_t offsetLow, size_t size)'),
      RtlMoveMemory: lib.func('void RtlMoveMemory(void *dst, void *src, size_t size)'),
    };
  }
  return kernel32;
}

// Only opens existing memory: if the app created it before the game,
// the plugin might not get write access.
export function openTelemetry() {
  const { OpenFileMappingW, MapViewOfFile, RtlMoveMemory } = api();
  const mapping = OpenFileMappingW(FILE_MAP_READ, 0, MMF_NAME);
  if (!mapping) return null;
  const base = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, MMF_SIZE);
  if (!base) return null;
  const snapshot = Buffer.alloc(SNAPSHOT_SIZE);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, SNAPSHOT_SIZE);
  return {
    read() {
      RtlMoveMemory(snapshot, base, SNAPSHOT_SIZE);
      return parsePose(view);
    },
  };
}
```

- [x] **Step 4: make sure the tests pass**

Run: `cd app && npm test`
Expected: `pass 7`, `fail 0`.

- [x] **Step 5: create `tools/fake_shm.py`**

```python
"""Fake shared memory of scs-sdk-plugin for debugging without the game.

Creates Local\\SCSTelemetry and swings heading as a ±90° sine with an 8 s period.
Run only with the game closed: otherwise the plugin and the script write to the same memory.

    py tools/fake_shm.py
"""
import math
import mmap
import struct
import time

MMF_NAME = "Local\\SCSTelemetry"
MMF_SIZE = 32 * 1024


def main():
    # If another process still holds the memory (for example shm_to_osc.py after a game),
    # it contains game data: overwrite whole fields.
    mem = mmap.mmap(-1, MMF_SIZE, tagname=MMF_NAME)
    struct.pack_into("?", mem, 0, True)   # sdkActive
    struct.pack_into("?", mem, 4, False)  # paused
    mem[2364:2364 + 64] = b"Fake".ljust(64, b"\0")
    mem[2492:2492 + 64] = b"Truck".ljust(64, b"\0")
    print("writing the pose to Local\\SCSTelemetry, Ctrl+C to quit")
    start = time.monotonic()
    while True:
        t = time.monotonic() - start
        heading = (0.25 * math.sin(2 * math.pi * t / 8)) % 1.0  # turns in [0,1), as in the SDK
        struct.pack_into("6f", mem, 2024, 0.0, -0.05, 0.0, heading, 0.0, 0.0)
        time.sleep(0.01)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
```

- [x] **Step 6: create `app/scripts/pose-dump.js`**

```js
// Manual check of the shared-memory reader from Node, without Electron.
import { openTelemetry } from '../src/main/telemetry.js';
import { turnsToDeg } from '../src/shared/pose.js';

const telemetry = openTelemetry();
if (!telemetry) {
  console.log('Local\\SCSTelemetry not found: start the game with scs-telemetry.dll or tools/fake_shm.py');
  process.exit(1);
}
setInterval(() => {
  const p = telemetry.read();
  console.log(`${p.sdkActive ? ' ' : 'X'}${p.paused ? 'P' : ' '} ${p.truck || '-'}`
    + `  yaw ${turnsToDeg(p.head.heading).toFixed(1)}°  pitch ${turnsToDeg(p.head.pitch).toFixed(1)}°`);
}, 200);
```

- [x] **Step 7: manual check with the fake**

Game closed. Terminal 1: `py tools/fake_shm.py`. Terminal 2: `cd app && node scripts/pose-dump.js`.
Expected: lines `  Fake Truck  yaw ...`, yaw sweeping smoothly from −90 to +90, pitch −0.0.
If `koffi` fails on `RtlMoveMemory` with an argument type error, change `void *dst` to `_Out_ uint8_t *dst` in the prototype and retry.

- [ ] **Step 8: manual check in the game (if ATS is available)**

Close `fake_shm.py`, start ATS, sit in the cab, `node scripts/pose-dump.js`, turn the mouse.
Expected: the truck name, yaw and pitch follow the camera; `P` at the start of the line while paused.

- [ ] **Step 9: show the user the changes**

---

### Task 3: window, HRTF speaker graph and the "file" source

**Files:**
- Create: `app/src/shared/layout.js`, `app/src/main/main.js`, `app/src/main/preload.cjs`, `app/src/renderer/index.html`, `app/src/renderer/app.js`, `app/src/renderer/engine.js`
- Test: `app/test/layout.test.js`

**Interfaces:**
- Consumes: `listenerVectors` (task 1), `openTelemetry`, `Pose` (task 2).
- Produces:
  - `widthGains(width: number): { direct: number, cross: number }`;
  - `DEFAULT_SPEAKERS: Array<{ name: string, channel: 0 | 1, position: [x, y, z] }>`;
  - `createEngine(ctx: AudioContext, speakers?): { input: GainNode, setPose(pose: Pose | null): void, setWidth(width: number): void }` — `input` takes stereo;
  - IPC `pose` (main → window) with `Pose | null` every 10 ms; `window.aux.onPose(listener)`.

- [x] **Step 1: write the failing test `app/test/layout.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthGains, DEFAULT_SPEAKERS } from '../src/shared/layout.js';

test('width 1 leaves the signal as is', () => {
  assert.deepEqual(widthGains(1), { direct: 1, cross: 0 });
});

test('width 0 is mono', () => {
  assert.deepEqual(widthGains(0), { direct: 0.5, cross: 0.5 });
});

test('widening keeps a mono signal unchanged', () => {
  const { direct, cross } = widthGains(1.5);
  assert.equal(direct * 1 + cross * 1, 1); // L = R = 1 -> L' = 1
  assert.ok(cross < 0);
});

test('by default two door speakers below the head, symmetric', () => {
  const [l, r] = DEFAULT_SPEAKERS;
  assert.equal(l.channel, 0);
  assert.equal(r.channel, 1);
  assert.ok(l.position[0] < 0 && r.position[0] > 0);
  assert.equal(l.position[0], -r.position[0]);
  assert.ok(l.position[1] < 0);
});
```

- [x] **Step 2: make sure the test fails**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/shared/layout.js`.

- [x] **Step 3: implement `app/src/shared/layout.js`**

```js
// Stereo width via M/S: 1 = as is, 0 = mono, above 1 = wider.
// L' = direct*L + cross*R, R' = cross*L + direct*R.
export function widthGains(width) {
  return { direct: (1 + width) / 2, cross: (1 - width) / 2 };
}

// Metres in SCS cab axes from the default head position:
// X right, Y up, Z back. Door speakers below the head and slightly forward,
// azimuth about ±67°: at ±30° in A0 the channels blended too much.
export const DEFAULT_SPEAKERS = [
  { name: 'L', channel: 0, position: [-0.7, -0.4, -0.3] },
  { name: 'R', channel: 1, position: [0.7, -0.4, -0.3] },
];
```

- [x] **Step 4: make sure the tests pass**

Run: `cd app && npm test`
Expected: `pass 11`, `fail 0`.

- [x] **Step 5: create `app/src/renderer/engine.js`**

```js
import { DEFAULT_SPEAKERS, widthGains } from '../shared/layout.js';
import { listenerVectors } from '../shared/pose.js';

const SMOOTH = 0.02;      // pose smoothing time constant, s
const REF_DISTANCE = 0.5; // closer than this the level stops growing
const MAKEUP = 1.7;       // restores the level of speakers ~0.86 m away with REF_DISTANCE 0.5

export function createEngine(ctx, speakers = DEFAULT_SPEAKERS) {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  input.connect(split);

  // Width matrix: matrix[from][to], each channel = direct*own + cross*other.
  const mix = [0, 1].map(() => new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit' }));
  const matrix = [0, 1].map((from) => [0, 1].map((to) => {
    const gain = new GainNode(ctx);
    split.connect(gain, from);
    gain.connect(mix[to]);
    return gain;
  }));

  const master = new GainNode(ctx, { gain: MAKEUP });
  master.connect(ctx.destination);
  for (const speaker of speakers) {
    const [positionX, positionY, positionZ] = speaker.position;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: REF_DISTANCE,
      rolloffFactor: 1,
      positionX, positionY, positionZ,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    mix[speaker.channel].connect(panner).connect(master);
  }

  function setWidth(width) {
    const { direct, cross } = widthGains(width);
    matrix[0][0].gain.value = direct;
    matrix[1][1].gain.value = direct;
    matrix[0][1].gain.value = cross;
    matrix[1][0].gain.value = cross;
  }

  const listener = ctx.listener;
  const neutral = listenerVectors(0, 0, 0);

  // No game (pose = null or sdkActive = false) or pause: neutral.
  function setPose(pose) {
    const active = pose && pose.sdkActive && !pose.paused;
    const position = active ? [pose.head.x, pose.head.y, pose.head.z] : [0, 0, 0];
    const { forward, up } = active
      ? listenerVectors(pose.head.heading, pose.head.pitch, pose.head.roll)
      : neutral;
    const t = ctx.currentTime;
    [listener.positionX, listener.positionY, listener.positionZ]
      .forEach((param, i) => param.setTargetAtTime(position[i], t, SMOOTH));
    [listener.forwardX, listener.forwardY, listener.forwardZ]
      .forEach((param, i) => param.setTargetAtTime(forward[i], t, SMOOTH));
    [listener.upX, listener.upY, listener.upZ]
      .forEach((param, i) => param.setTargetAtTime(up[i], t, SMOOTH));
  }

  setWidth(1);
  setPose(null);
  return { input, setPose, setWidth };
}
```

- [x] **Step 6: create `app/src/main/main.js`**

```js
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTelemetry } from './telemetry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POSE_PERIOD_MS = 10; // shared-memory polling, ~100 Hz
const RETRY_MS = 1000;     // how often to look for the memory while the game is not running

function startPoseFeed(win) {
  let telemetry = null;
  let lastTry = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    if (!telemetry && now - lastTry >= RETRY_MS) {
      lastTry = now;
      telemetry = openTelemetry();
    }
    if (!win.isDestroyed()) win.webContents.send('pose', telemetry ? telemetry.read() : null);
  }, POSE_PERIOD_MS);
  win.on('closed', () => clearInterval(timer));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Trucker AUX — E0',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  win.loadFile(path.join(here, '../renderer/index.html'));
  startPoseFeed(win);
  return win;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [x] **Step 7: create `app/src/main/preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aux', {
  onPose: (listener) => ipcRenderer.on('pose', (_event, pose) => listener(pose)),
});
```

- [x] **Step 8: create `app/src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Trucker AUX — E0</title>
  <style>
    body { font: 13px system-ui, sans-serif; margin: 8px; width: 300px; }
    fieldset { margin: 0 0 8px; }
    input[type=url], audio { width: 100%; box-sizing: border-box; }
    pre { margin: 0; white-space: pre-wrap; }
  </style>
</head>
<body>
  <fieldset><legend>Head pose</legend><pre id="pose">no data</pre></fieldset>
  <fieldset><legend>File</legend>
    <input type="file" id="file" accept="audio/*">
    <audio id="player" controls></audio>
  </fieldset>
  <fieldset><legend>Width</legend>
    <input type="range" id="width" min="0" max="2" step="0.05" value="1">
    <span id="width-value">1.00</span>
  </fieldset>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [x] **Step 9: create `app/src/renderer/app.js`**

```js
import { createEngine } from './engine.js';
import { turnsToDeg } from '../shared/pose.js';

const $ = (id) => document.getElementById(id);
const ctx = new AudioContext();
const engine = createEngine(ctx);
document.addEventListener('click', () => ctx.resume());

window.aux.onPose((pose) => {
  engine.setPose(pose);
  $('pose').textContent = !pose
    ? 'game not running'
    : `${pose.truck || '-'}${pose.sdkActive ? '' : ' (game closed)'}${pose.paused ? ' (paused)' : ''}\n`
      + `yaw ${turnsToDeg(pose.head.heading).toFixed(1)}°  pitch ${turnsToDeg(pose.head.pitch).toFixed(1)}°`;
});

let fileSource = null;
$('file').onchange = () => {
  const file = $('file').files[0];
  if (!file) return;
  $('player').src = URL.createObjectURL(file);
  if (!fileSource) {
    fileSource = ctx.createMediaElementSource($('player'));
    fileSource.connect(engine.input);
  }
  $('player').play();
};

$('width').oninput = () => {
  const width = Number($('width').value);
  engine.setWidth(width);
  $('width-value').textContent = width.toFixed(2);
};
```

- [ ] **Step 10: manual check with the fake pose**

Game closed. Terminal 1: `py tools/fake_shm.py`. Terminal 2: `cd app && npm start`.
Check:
1. "Head pose" shows `Fake Truck`, yaw sweeping from −90 to +90.
2. Pick an mp3 in "File": music from two points below the ears, at the sides.
3. When yaw goes to +90 (head left), the music moves right; to −90, left.
4. Width slider: 0 pulls the sound to the centre, 2 makes it wider.
5. Close `fake_shm.py`: "(game closed)" will not appear (our process holds the memory), the pose freezes at the last value. Expected for the fake; the plugin sets `sdkActive` = 0 when the game exits.

If the window is empty and DevTools (Ctrl+Shift+I) shows a module load error from `file://` because of CORS, tell the user and move the window to a custom scheme: in `main.js` before `app.whenReady` add
`protocol.registerSchemesAsPrivileged([{ scheme: 'aux', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);`,
in `whenReady` before `createWindow` — `protocol.handle('aux', (req) => net.fetch(pathToFileURL(path.join(here, '..', new URL(req.url).pathname)).toString()));`
(imports `protocol`, `net` from `electron`, `pathToFileURL` from `node:url`), and replace `win.loadFile(...)` with `win.loadURL('aux://app/renderer/index.html')`.

- [ ] **Step 11: manual check in the game**

Close `fake_shm.py` and the app, start ATS, then `npm start`, pick the file again.
Expected: the pose with the truck name; turning the mouse turns the scene; the sound goes neutral while paused.

- [ ] **Step 12: show the user the changes**

---

### Task 4: click detector and tab audio

**Files:**
- Create: `app/src/shared/glitch.js`, `app/src/renderer/worklets/glitch-detector.js`, `app/src/renderer/tone.html`
- Modify: `app/src/main/main.js` (`createWindow`, imports), `app/src/main/preload.cjs`, `app/src/renderer/index.html`, `app/src/renderer/app.js`
- Test: `app/test/glitch.test.js`

**Interfaces:**
- Consumes: `createEngine().input` (task 3).
- Produces:
  - `class GlitchCounter(frequency, sampleRate, { threshold = 0.05, holdSamples = sampleRate / 10 })` with `process(block: Float32Array): number` (accumulated click count) and fields `glitches`, `samples`;
  - AudioWorklet `'glitch-detector'` (`processorOptions: { frequency }`), posts `{ glitches, seconds }` once a second;
  - `attachDetector(node: AudioNode, label: string)` in `app.js`;
  - `window.aux.loadTab(url)`, `window.aux.loadToneTab()`.

- [x] **Step 1: write the failing test `app/test/glitch.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GlitchCounter } from '../src/shared/glitch.js';

const SR = 48000;
const F = 1000;
const sine = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * F * i) / SR));

test('a clean tone in blocks of 128 has no clicks', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  for (let i = 0; i < s.length; i += 128) counter.process(s.subarray(i, i + 128));
  assert.equal(counter.glitches, 0);
});

test('100 dropped samples give exactly one click', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  const broken = new Float32Array(s.length - 100);
  broken.set(s.subarray(0, SR));
  broken.set(s.subarray(SR + 100), SR);
  assert.equal(counter.process(broken), 1);
});

test('inserted silence gives a click', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  s.fill(0, SR, SR + 256);
  assert.ok(counter.process(s) >= 1);
});
```

- [x] **Step 2: make sure the test fails**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/shared/glitch.js`.

- [x] **Step 3: implement `app/src/shared/glitch.js`**

```js
// Click counter for a clean tone. For x[n] = A*sin(wn + phi),
// x[n+1] + x[n-1] = 2cos(w)*x[n]; a break in the signal makes the residual spike.
export class GlitchCounter {
  constructor(frequency, sampleRate, { threshold = 0.05, holdSamples = sampleRate / 10 } = {}) {
    this.k = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
    this.threshold = threshold; // fraction of the amplitude
    this.hold = holdSamples;    // one break is not counted twice
    this.prev1 = 0;
    this.prev2 = 0;
    this.peak = 0;
    this.cooldown = 0;
    this.glitches = 0;
    this.samples = 0;
  }

  process(block) {
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      this.peak = Math.max(this.peak * 0.99999, Math.abs(x));
      const residual = x + this.prev2 - this.k * this.prev1; // residual for the previous sample
      if (this.cooldown > 0) {
        this.cooldown--;
      } else if (this.samples >= 2 && this.peak > 0.01 && Math.abs(residual) > this.threshold * this.peak) {
        this.glitches++;
        this.cooldown = this.hold;
      }
      this.prev2 = this.prev1;
      this.prev1 = x;
      this.samples++;
    }
    return this.glitches;
  }
}
```

- [x] **Step 4: make sure the tests pass**

Run: `cd app && npm test`
Expected: `pass 14`, `fail 0`.

- [x] **Step 5: create `app/src/renderer/worklets/glitch-detector.js`**

```js
import { GlitchCounter } from '../../shared/glitch.js';

class GlitchDetector extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.counter = new GlitchCounter(processorOptions.frequency, sampleRate);
    this.lastReport = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.counter.process(channel);
    if (currentTime - this.lastReport >= 1) {
      this.lastReport = currentTime;
      this.port.postMessage({ glitches: this.counter.glitches, seconds: this.counter.samples / sampleRate });
    }
    return true;
  }
}

registerProcessor('glitch-detector', GlitchDetector);
```

- [x] **Step 6: create `app/src/renderer/tone.html`**

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>1 kHz tone</title></head>
<body>
  <button id="start" style="font-size: 24px">Start the 1 kHz tone</button>
  <script>
    document.getElementById('start').onclick = () => {
      const ctx = new AudioContext();
      const osc = new OscillatorNode(ctx, { frequency: 1000 });
      osc.connect(new GainNode(ctx, { gain: 0.5 })).connect(ctx.destination);
      osc.start();
    };
  </script>
</body>
</html>
```

- [x] **Step 7: tab and capture handler in `app/src/main/main.js`**

Replace the import with:

```js
import { app, BrowserWindow, WebContentsView, ipcMain, session } from 'electron';
```

After `const RETRY_MS = 1000; ...` add:

```js
const PANEL_WIDTH = 320; // control panel on the left, tab on the right
```

Replace `createWindow` entirely:

```js
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Trucker AUX — E0',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  win.loadFile(path.join(here, '../renderer/index.html'));

  // The tab gets its own session: sign-ins survive restarts,
  // and the capture handler below (on defaultSession) only affects the window.
  const browse = session.fromPartition('persist:browse');
  // Google refuses sign-in in embedded browsers and recognizes them by the
  // "Electron/..." and "<app name>/..." tokens in the User-Agent: the tab keeps a plain Chrome string.
  const tokens = new RegExp(` (Electron|${app.getName()})/\\S+`, 'g');
  browse.setUserAgent(app.userAgentFallback.replace(tokens, ''));
  const tab = new WebContentsView({ webPreferences: { session: browse } });
  win.contentView.addChildView(tab);
  const layout = () => {
    const [width, height] = win.getContentSize();
    tab.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
  };
  layout();
  win.on('resize', layout);

  ipcMain.on('tab:load', (_event, url) => tab.webContents.loadURL(url));
  ipcMain.on('tab:tone', () => tab.webContents.loadFile(path.join(here, '../renderer/tone.html')));

  // getDisplayMedia from the window captures the tab's audio; Electron mutes the
  // tab's own output meanwhile (enableLocalEcho defaults to false).
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const frame = tab.webContents.mainFrame;
    callback({ video: frame, audio: frame });
  });

  startPoseFeed(win);
  return win;
}
```

- [x] **Step 8: replace `app/src/main/preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aux', {
  onPose: (listener) => ipcRenderer.on('pose', (_event, pose) => listener(pose)),
  loadTab: (url) => ipcRenderer.send('tab:load', url),
  loadToneTab: () => ipcRenderer.send('tab:tone'),
});
```

- [x] **Step 9: tab and counter panels in `app/src/renderer/index.html`**

Before the line `<script type="module" src="app.js"></script>` insert:

```html
  <fieldset><legend>Tab</legend>
    <input type="url" id="url" value="https://www.youtube.com">
    <button id="open">Open</button>
    <button id="tone-tab">Tone page</button>
    <button id="capture-tab">Capture tab audio</button>
  </fieldset>
  <fieldset><legend>Clicks (1 kHz tone)</legend><pre id="glitches">-</pre></fieldset>
```

- [x] **Step 10: detector and tab capture in `app/src/renderer/app.js`**

Right after `const engine = createEngine(ctx);` insert:

```js
await ctx.audioWorklet.addModule(new URL('./worklets/glitch-detector.js', import.meta.url));
const glitchReport = {};

// The detector listens to the source before the graph; its output goes to zero so the graph processes it.
function attachDetector(node, label) {
  const detector = new AudioWorkletNode(ctx, 'glitch-detector', { processorOptions: { frequency: 1000 } });
  node.connect(detector).connect(new GainNode(ctx, { gain: 0 })).connect(ctx.destination);
  detector.port.onmessage = ({ data }) => {
    glitchReport[label] = `${data.glitches} in ${Math.round(data.seconds)} s`;
    $('glitches').textContent = Object.entries(glitchReport).map(([k, v]) => `${k}: ${v}`).join('\n');
  };
}
```

At the end of the file add:

```js
$('open').onclick = () => window.aux.loadTab($('url').value);
$('tone-tab').onclick = () => window.aux.loadToneTab();

$('capture-tab').onclick = async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { suppressLocalAudioPlayback: true },
  });
  stream.getVideoTracks().forEach((track) => track.stop()); // only the audio is needed
  const source = ctx.createMediaStreamSource(stream);
  source.connect(engine.input);
  attachDetector(source, 'tab');
};
```

- [ ] ~~**Step 11: manual check of the tab capture**~~ — cancelled

`cd app && npm start` (with `fake_shm.py` or ATS).
1. "Tone page" → a button on the right → press "Start the 1 kHz tone".
2. "Capture tab audio": the tone comes from the virtual speakers and turns with the pose. There must be no dry, static tone on top; if there is, the tab's local output is not muted — write that into the results.
3. "Clicks": `tab: 0 in N s`, the counter grows every second.
4. "Open" YouTube, play a video, "Capture tab audio" again: music from the speakers.

- [ ] ~~**Step 12: measure the "tab" path (10 minutes)**~~ — cancelled

Tone page, capture, ATS running, drive through a city for 10 minutes with the tab audio captured all the time.
Record: `tab: X in 600 s` and the headphone sample rate at the time.

- [x] **Step 13: show the user the changes**

---

### Task 5: the "CABLE Output" path

**Files:**
- Modify: `app/src/main/main.js` (permissions in `whenReady`), `app/src/renderer/index.html`, `app/src/renderer/app.js`

**Interfaces:**
- Consumes: `engine.input` (task 3), `attachDetector` (task 4).
- Produces: the "Listen to CABLE Output" and "Tone into CABLE Input" buttons.

- [x] **Step 1: permissions in `app/src/main/main.js`**

Replace the line `app.whenReady().then(createWindow);` with:

```js
app.whenReady().then(() => {
  // The window needs an input (CABLE Output) and output selection (tone into CABLE Input).
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
});
```

- [x] **Step 2: cable panel in `app/src/renderer/index.html`**

Before `<fieldset><legend>Clicks (1 kHz tone)</legend>` insert:

```html
  <fieldset><legend>Cable</legend>
    <button id="capture-cable">Listen to CABLE Output</button>
    <button id="tone-cable">Tone into CABLE Input</button>
  </fieldset>
```

- [x] **Step 3: cable capture and the tone into the cable in `app/src/renderer/app.js`**

At the end of the file add:

```js
// Device names are only visible after microphone permission.
async function findDevice(kind, labelPart) {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
  probe.getTracks().forEach((track) => track.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  const device = devices.find((d) => d.kind === kind && d.label.includes(labelPart));
  if (!device) throw new Error(`device "${labelPart}" not found`);
  return device;
}

$('capture-cable').onclick = async () => {
  const input = await findDevice('audioinput', 'CABLE Output');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: input.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
  });
  const source = ctx.createMediaStreamSource(stream);
  source.connect(engine.input);
  attachDetector(source, 'cable');
};

// A separate context plays the tone straight into CABLE Input: a loop without third-party programs.
$('tone-cable').onclick = async () => {
  const output = await findDevice('audiooutput', 'CABLE Input');
  const toneCtx = new AudioContext({ sinkId: output.deviceId });
  const osc = new OscillatorNode(toneCtx, { frequency: 1000 });
  osc.connect(new GainNode(toneCtx, { gain: 0.5 })).connect(toneCtx.destination);
  osc.start();
};
```

- [ ] **Step 4: manual check of the loop**

Pause the player that writes to `CABLE Input`. `npm start`.
1. "Tone into CABLE Input", then "Listen to CABLE Output": the tone from the virtual speakers, turning with the pose.
2. "Clicks": a `cable: 0 in N s` line appeared.
3. Stop the tone (restart the window), start Spotify writing to `CABLE Input`, "Listen to CABLE Output": music from the speakers.

- [ ] **Step 5: measure the "cable" path (10 minutes, rates as they are)**

Tone into the cable, capture, ATS, 10 minutes of driving. Record `cable: X in 600 s` and the rates: `CABLE Input` 48000, `CABLE Output` 44100, headphones 44100.

- [ ] **Step 6: measure the "cable" path with aligned rates**

Ask the user to set `CABLE Output` to 48000 Hz (`control mmsys.cpl` → "Recording" → `CABLE Output` → "Properties" → "Advanced"; the user changes system settings). Restart the app, repeat step 5. Only the cable rate changes.

- [ ] **Step 7: show the user the changes**

---

### Task 6: listening comparison and E0 results

**Files:**
- Modify: `docs/findings.md` (new section at the end)

**Interfaces:**
- Consumes: the whole E0 app, the A0 rig (Light Host + SPARTA + `tools/shm_to_osc.py`).
- Produces: decisions for E1 in `docs/findings.md`.

- [ ] **Step 1: A/B of Chromium's HRTF against SPARTA**

The same track, the same volume, 2 minutes each, ATS running:
- A: Light Host + SPARTA Binauraliser, speakers at ±67°, elevation −28° (the directions of `DEFAULT_SPEAKERS`), bridge `py tools/shm_to_osc.py`.
- B: Trucker AUX, source — the same track through `CABLE Output` or a file.
Ask the user: where is the sound more "outside the head", where are directions clearer when turning, where is the timbre nicer, how is the channel separation.

- [ ] **Step 2: turning latency**

Turn the camera sharply left and right with the mouse. Ask the user whether the sound noticeably lags behind the picture (yes / borderline / no). If it lags, write a proposal for E1 into the results: lower `SMOOTH` to 0.01 and the polling period to 5 ms.

- [ ] **Step 3: write the results into `docs/findings.md`**

Append a section with the actual numbers from tasks 4–5 and the user's answers:

```markdown
## E0: Electron prototype

Date, versions: Electron 44, device sample rates at the time of the measurements.

| Path | Conditions | Clicks in 600 s |
|---|---|---|
| cable | CABLE Output 44100 | … |
| cable | CABLE Output 48000 | … |

- Chromium HRTF vs SPARTA: …
- Turning latency: …

### Decisions for E1
- Drift compensation for the cable: needed if any "cable" path has more than 0 clicks.
- HRTF: keep the built-in one or add a task "own SOFA in an AudioWorklet".
```

Replace "…" with real values; if something was not checked, write "not checked" and why.

- [ ] **Step 4: update `PLAN.md`**

Mark the closed items in "Open questions" with a link to `docs/findings.md`; mark milestone E0 ✓; keep or drop drift compensation in E1 based on the results.

- [ ] **Step 5: show the user the changes**
