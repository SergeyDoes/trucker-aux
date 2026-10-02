# E1: Speaker Editor Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editable speaker layouts with per-truck presets, device selection, an N-speaker engine and a panel for numeric editing, with the whole project in English.

**Architecture:** Pure logic lives in `app/src/shared` (layouts, presets, DSP helpers, settings, device matching) and is covered by `node --test`. The main process resolves the data folder next to the app, reads and writes JSON atomically and serves it over IPC. The renderer owns the audio graph (`engine.sync(layout)` diffs layouts, so edits glide and structural changes cross-fade per speaker) and a vanilla-DOM panel. An Electron-hosted `OfflineAudioContext` check verifies the engine in dB.

**Tech Stack:** Electron 44, Web Audio (PannerNode HRTF, BiquadFilterNode, OfflineAudioContext), koffi 3, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-speaker-editor-design.md` (this plan is its "Delivery 1: Foundation"). Background: `PLAN.md`, `docs/findings.md`.

## Global Constraints

- Everything in the project is English: UI strings, code comments, docs. (Chat with the user stays Russian.)
- The user commits; never run `git commit` / `git push`. At the end of each task, show the changed files.
- No new npm dependencies in this plan. Downloads or installs only with the user's explicit permission.
- Code is ESM (`"type": "module"`), except preload scripts (`.cjs`).
- Data folder: `app/data/` in development; `data/` next to the executable when packaged (`PORTABLE_EXECUTABLE_DIR` first, then the folder of `process.execPath`). Chromium profile in `<data>/profile` via `app.setPath('userData', …)` before `ready`.
- Shared memory `Local\SCSTelemetry` is opened read-only and never created by the app.
- Axes: SCS = Web Audio, X right, Y up, Z back (forward is −Z); metres from the default head position.
- Limits: at most 16 speakers; coordinates ±5 m; `gainDb` −60…+12; `width` 0…2.
- Filters: tweeter highpass 2500 Hz, sub lowpass 120 Hz, Q 0.7071. Panner: HRTF, inverse, ref 0.5 m, rolloff 1, master makeup 1.7.
- `npm start` may be broken between Task 2 and Task 9; unit tests must pass after every task.

## File map

| File | Responsibility |
|---|---|
| `PLAN.md`, `docs/findings.md`, `docs/superpowers/plans/2026-09-30-e0-electron-spike.md` | translated to English (Task 1) |
| `tools/*.py`, `app/scripts/pose-dump.js`, `app/src/shared/pose.js`, `app/src/shared/glitch.js`, `app/src/renderer/worklets/glitch-detector.js`, `app/test/pose.test.js`, `app/test/glitch.test.js` | translated to English (Task 1) |
| `app/src/shared/dsp.js` | width gains, filter per type, dB, speaker gain with solo/mute |
| `app/src/shared/layout.js` | default layout, normalization, mirror, pure edit helpers |
| `app/src/shared/presets.js` | playing layout, edit routing, preset list |
| `app/src/shared/settings.js` | settings normalization |
| `app/src/shared/devices.js` | device matching and warnings |
| `app/src/main/telemetry.js` | shared-memory parsing incl. truck key |
| `app/src/main/paths.js` | data folder resolution |
| `app/src/main/store.js` | JSON read / atomic write, load and save of layouts and settings |
| `app/src/main/main.js`, `app/src/main/preload.cjs` | window, IPC, pose feed, permissions |
| `app/src/renderer/engine.js` | N-speaker graph with `sync(layout)` |
| `app/src/renderer/audio-io.js` | device list, input capture, output probe |
| `app/src/renderer/panel.js`, `index.html`, `style.css` | control panel |
| `app/src/renderer/app.js` | state, wiring, saving |
| `app/scripts/engine-check.js` (+ `-preload.cjs`, `.html`, `-page.js`) | `npm run test:engine` |
| `app/test/*.test.js` | unit tests incl. the English guard |

---

### Task 1: English everywhere (existing files)

**Files:**
- Modify: `PLAN.md` (rewrite), `docs/findings.md`, `docs/superpowers/plans/2026-09-30-e0-electron-spike.md`, `tools/shm_probe.py`, `tools/shm_to_osc.py`, `tools/fake_shm.py`, `tools/cable_tone.py`, `tools/cable_check.py`, `app/scripts/pose-dump.js`, `app/src/shared/pose.js`, `app/src/shared/glitch.js`, `app/src/renderer/worklets/glitch-detector.js`, `app/test/pose.test.js`, `app/test/glitch.test.js`, `app/test/telemetry.test.js`, `app/test/layout.test.js`

**Interfaces:**
- Consumes: —
- Produces: English text only; no behaviour changes. Files rewritten later in this plan (`layout.js`, `telemetry.js`, `engine.js`, `main.js`, `preload.cjs`, `app.js`, `index.html`) are written in English there.

- [x] **Step 1: Rewrite `PLAN.md` in English with the current state**

Replace the whole file with:

````markdown
# Trucker AUX — plan

Trucker AUX (Electron) takes audio from a virtual cable (any player routed to `CABLE Input`) and plays it in the headphones from virtual speakers placed in the truck cab, turning the scene with the driver's head in ATS/ETS2. The game's own audio goes straight to the headphones.

> For Claude Code: I commit and push myself. Don't commit; only edit files and show diffs.

## Architecture

```
ATS/ETS2 ─► scs-telemetry.dll (RenCloud) ─► shared memory Local\SCSTelemetry
                                                   │ polled at ~100 Hz (koffi)
┌──────────────────── Trucker AUX (Electron) ──────┼──────────────────────────┐
│ main: head pose, data folder, IPC                ▼                          │
│ input device ─(getUserMedia)─► AudioContext → M/S width                     │
│                                 → per speaker: filter → level → HRTF ─────────► headphones
│                                 AudioListener ← head pose                   │
│ panel: devices, presets, speakers                                           │
└─────────────────────────────────────────────────────────────────────────────┘
Player ─► CABLE Input (VB-Cable)                 Game audio ────────────────────► headphones
```

- **Cable only.** No built-in browser and no sign-ins: an app offering logins looks suspicious.
- **One graph.** A speaker is a `PannerNode` (HRTF) at its position in the cab; the listener is the head (position and rotation from head.offset). SCS and Web Audio axes match (X right, Y up, Z back); the origin is the default head position.
- **Head pose** comes straight from the RenCloud plugin's shared memory. No own DLL, no OSC.
- **No game** (no memory or `sdkActive` = 0) or pause: the listener is neutral and music plays from the speakers as usual.

## Known facts

- **head.offset** (`fplacement`): head offset and rotation from the default position, in cab axes. Angles are in turns: heading in [0,1), 0.25 = left; pitch in [−0.25, 0.25], up is positive; roll in [−0.5, 0.5]. Heading must be normalized to −180..180: a slight right turn arrives as 0.99.
- **R0 (`docs/findings.md`):**
  - the mouse changes heading and pitch, roll is always 0;
  - looking around, the game moves the head by up to 0.8 m;
  - external cameras can't be detected: the value freezes and snaps back to "straight" on return to the cab;
  - pause is visible through its flag; frames keep coming while paused.
- **`third_party/scs-sdk-plugin`** (RenCloud, MIT) builds in VS2022 (`scs-telemetry/vs2012/scs-telemetry.vcxproj`, Release x64; the `.sln` has no x64 configuration, build the project directly). The DLL is in the ATS plugins folder. Shared memory `Local\SCSTelemetry` (32 KB):
  - `sdkActive` @0, `paused` @4;
  - head.offset @2024 (6 floats: x y z heading pitch roll);
  - cabin.offset @2000;
  - `truckBrandId` @2300, `truckBrand` @2364, `truckId` @2428, `truckName` @2492 (64 bytes each).
  - When a value disappears, the last one stays in memory.
- **Audio setup:**
  - VB-Audio Virtual Cable: the player writes to `CABLE Input`, the app reads `CABLE Output`;
  - headphones: `Headphones (Logitech PRO X Gaming Headset)`, USB;
  - **one sample rate across the chain:** headphones, `CABLE Input`, `CABLE Output` and VB-Cable's Internal SR — 44100 here. Every mismatch added dropouts;
  - **VB-Cable settings are required:** Max Latency 7168 and Internal SR = the common rate (`VBCABLE_ControlPanel.exe`). With the former 2048 / 96000 the cable itself dropped audio, up to 5 times a second (`docs/findings.md`); `tools/cable_tone.py` + `tools/cable_check.py` check the cable (second argument is the rate);
  - the cable and the headphones have different clocks, but Chromium reconciled them without clicks over 3 minutes;
  - **headphones must be plain stereo, without virtual surround** (DTS Headphone:X in G HUB, Windows Sonic, Dolby Atmos). Otherwise our binaural output goes through a second virtualizer and the channels blur; the Logitech PRO X had DTS on (a 7.1 device).
- **E0 results:** the Electron graph with HRTF speakers turns with the camera in ATS; pose from shared memory via koffi works; the engine's offline render shows proper channel separation and rotation.
- **Electron 44** / Chromium: `AudioContext({ sinkId })`; `PannerNode` HRTF (built-in head, no custom SOFA).

## Milestones

### R0 — in-game reconnaissance ✓
`tools/shm_probe.py`; findings in `docs/findings.md`.

### A0 — listening test ✓
Light Host + SPARTA + `tools/shm_to_osc.py`. The idea works.

### E0 — Electron prototype ✓
Plan: `docs/superpowers/plans/2026-09-30-e0-electron-spike.md`. Cable path clean once VB-Cable settings, sample rates and stereo headphones are right (`docs/findings.md`).

### E1 — speaker editor foundation
Spec: `docs/superpowers/specs/2026-09-30-speaker-editor-design.md`. Plan: `docs/superpowers/plans/2026-09-30-e1-editor-foundation.md`.
- English everywhere; data folder next to the app; atomic JSON store.
- Layouts with any number of speakers (channel, level, type, mirrored pairs, solo/mute), per-truck presets with automatic switching and a default fallback.
- Input/output device selection with warnings (sample-rate mismatch, virtual surround).
- Engine with N speakers; offline engine check `npm run test:engine`.
- Panel with speaker list and numeric editing.

### E2 — graphical editor
- SVG top and side views with dragging, mirrored partners and cabin editing; three.js 3D overview (read-only).

### E3 — polish
- Tray, autostart, the window can be closed while audio keeps playing.
- Built-in cable check (tone + `glitch.js` detector).
- Optional: cabin reverb (`ConvolverNode`), muting by speed.

### E4 — packaging
- electron-builder portable build (data folder next to the exe).
- `docs/audio-setup.md`: VB-Cable (Max Latency 7168; Internal SR, both cable sides and the headphones at one rate), stereo headphones without virtual surround, player routed to `CABLE Input`, `scs-telemetry.dll` in `<game>\bin\win_x64\plugins\`.

## Repository layout

```
app/                       Electron app (ESM, except preload)
  src/main/                window, IPC, data folder, JSON store, shared-memory reader
  src/shared/              pure logic: pose, layouts, presets, DSP, settings, devices, glitch detector
  src/renderer/            audio graph, devices, panel
  test/                    node --test
  scripts/                 engine check, pose-dump
  data/                    layouts.json, settings.json, profile/ (Chromium, git-ignored)
third_party/scs-sdk-plugin SDK headers + shared-memory plugin
tools/
  shm_probe.py             R0: reads head.offset
  shm_to_osc.py            A0: head.offset → OSC /ypr for SPARTA
  fake_shm.py              fake shared memory for work without the game
  cable_tone.py            1 kHz tone into CABLE Input via MME
  cable_check.py           captures CABLE Output via MME and counts dropouts
docs/
  findings.md
  superpowers/specs/, superpowers/plans/
```

## Rules

- No sign-ins or embedded browsers: the app only deals with audio.
- Shared memory is opened read-only and never created by the app; otherwise the plugin may not get write access.
- No allocations in `AudioWorkletProcessor.process()` except rare once-a-second reports.
- Pure logic is covered by `node --test`; the engine by `npm run test:engine`; the UI and listening by manual checklists.
- `npm install` and any downloads only with the user's permission.

## Later / ideas

- Custom HRTF (SOFA) via convolution in an AudioWorklet if Chromium's HRTF falls short.
- Own minimal DLL instead of RenCloud if the third-party plugin gets in the way.
- Muting by speed, open window, engine masking.
````

- [x] **Step 2: Translate `docs/findings.md` to English**

Translate every heading, sentence, table cell and list item. Keep all numbers, file names, offsets, code spans and table structure exactly. Device names that Windows shows in Russian become their English equivalents in prose (`Headphones (Logitech PRO X Gaming Headset)`).

- [x] **Step 3: Translate `docs/superpowers/plans/2026-09-30-e0-electron-spike.md` to English**

Same rules as Step 2: prose, comments inside code blocks and UI strings inside code blocks become English; code, numbers and checkbox states stay.

- [x] **Step 4: Translate the tools**

In `tools/shm_probe.py`, `tools/shm_to_osc.py`, `tools/fake_shm.py`, `tools/cable_tone.py`, `tools/cable_check.py`: docstrings, comments and every printed or raised message become English, meaning unchanged. Example from `cable_check.py`:

```python
    print(f"{name}: {counter.glitches} dropouts in {counter.samples / RATE:.1f} s, "
          f"peak {max(map(abs, left)):.3f}, queue overruns {missed}", flush=True)
```

- [x] **Step 5: Translate the untouched app files**

`app/scripts/pose-dump.js`, `app/src/shared/pose.js`, `app/src/shared/glitch.js`, `app/src/renderer/worklets/glitch-detector.js`, `app/test/pose.test.js`, `app/test/glitch.test.js`, `app/test/telemetry.test.js`, `app/test/layout.test.js`: comments, test names and messages become English. `pose.js` becomes:

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

- [x] **Step 6: Run the unit tests**

Run: `cd app && npm test`
Expected: `pass 14`, `fail 0` (only names and comments changed).

- [x] **Step 7: Show the user the changed files (they commit)**

---

### Task 2: DSP helpers

**Files:**
- Create: `app/src/shared/dsp.js`
- Test: `app/test/dsp.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `widthGains(width: number): { direct: number, cross: number }`;
  - `filterFor(type: 'full' | 'tweeter' | 'sub'): { type, frequency, Q } | null` (a fresh object);
  - `dbToGain(db: number): number`;
  - `speakerGain(speaker: { id, gainDb }, soloId: string | null, mutedIds: Set<string>): number`.

- [x] **Step 1: Write the failing test `app/test/dsp.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbToGain, filterFor, speakerGain, widthGains } from '../src/shared/dsp.js';

test('width 1 leaves the signal as is, 0 is mono', () => {
  assert.deepEqual(widthGains(1), { direct: 1, cross: 0 });
  assert.deepEqual(widthGains(0), { direct: 0.5, cross: 0.5 });
});

test('widening keeps a mono signal unchanged', () => {
  const { direct, cross } = widthGains(1.5);
  assert.equal(direct + cross, 1);
  assert.ok(cross < 0);
});

test('filterFor gives one biquad per speaker type', () => {
  assert.deepEqual(filterFor('tweeter'), { type: 'highpass', frequency: 2500, Q: Math.SQRT1_2 });
  assert.deepEqual(filterFor('sub'), { type: 'lowpass', frequency: 120, Q: Math.SQRT1_2 });
  assert.equal(filterFor('full'), null);
  assert.equal(filterFor('horn'), null);
  const a = filterFor('sub');
  a.frequency = 1;
  assert.equal(filterFor('sub').frequency, 120);
});

test('dbToGain', () => {
  assert.equal(dbToGain(0), 1);
  assert.equal(dbToGain(20), 10);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001);
});

test('speakerGain applies mute and solo', () => {
  const speaker = { id: 'a', gainDb: -6 };
  assert.ok(Math.abs(speakerGain(speaker, null, new Set()) - 0.501) < 0.001);
  assert.equal(speakerGain(speaker, null, new Set(['a'])), 0);
  assert.equal(speakerGain(speaker, 'b', new Set()), 0);
  assert.ok(speakerGain(speaker, 'a', new Set()) > 0);
});
```

- [x] **Step 2: Run it to see it fail**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/shared/dsp.js`.

- [x] **Step 3: Implement `app/src/shared/dsp.js`**

```js
// Audio math that does not need Web Audio, shared by the engine and the tests.

// Stereo width via M/S: 1 = unchanged, 0 = mono, above 1 = wider.
// L' = direct * L + cross * R, R' = cross * L + direct * R.
export function widthGains(width) {
  return { direct: (1 + width) / 2, cross: (1 - width) / 2 };
}

// One biquad per speaker type; full-range speakers have no filter.
const FILTERS = {
  tweeter: { type: 'highpass', frequency: 2500, Q: Math.SQRT1_2 },
  sub: { type: 'lowpass', frequency: 120, Q: Math.SQRT1_2 },
};

export function filterFor(type) {
  return FILTERS[type] ? { ...FILTERS[type] } : null;
}

export function dbToGain(db) {
  return 10 ** (db / 20);
}

// Linear level of a speaker with the session-only solo and mute applied.
export function speakerGain(speaker, soloId, mutedIds) {
  if (mutedIds.has(speaker.id)) return 0;
  if (soloId !== null && soloId !== speaker.id) return 0;
  return dbToGain(speaker.gainDb);
}
```

- [x] **Step 4: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 5: Show the user the changed files**

---

### Task 3: Layout model

**Files:**
- Modify: `app/src/shared/layout.js` (rewrite)
- Test: `app/test/layout.test.js` (rewrite)

**Interfaces:**
- Consumes: —
- Produces:
  - constants `MAX_SPEAKERS` (16), `CHANNELS` (`['L','R','M']`), `TYPES` (`['full','tweeter','sub']`);
  - `Layout = { name: string, width: number, cabin: { min: [x,y,z], max: [x,y,z] }, speakers: Speaker[] }`;
  - `Speaker = { id: string, name: string, position: [x,y,z], channel: 'L'|'R'|'M', gainDb: number, type: 'full'|'tweeter'|'sub', pair: string | null }`;
  - `Store = { version: 1, default: Layout, trucks: { [key: string]: Layout } }`;
  - `snap(metres)`, `defaultLayout()`, `cabinCenterX(cabin)`, `mirrorPosition(position, cabin)`;
  - `normalizeLayout(raw, fallbackName = 'Default layout'): Layout`, `normalizeStore(raw): Store`;
  - edit helpers, all pure and returning new objects: `updateSpeaker(layout, id, patch)`, `addSpeaker(layout): { layout, id | null }`, `addPair(layout): { layout, ids: string[] }`, `removeSpeaker(layout, id)`, `linkPair(layout, a, b)`, `unlinkPair(layout, id)`, `setWidth(layout, width)`.

- [x] **Step 1: Write the failing test (replace `app/test/layout.test.js`)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SPEAKERS, addPair, addSpeaker, cabinCenterX, defaultLayout, linkPair, mirrorPosition,
  normalizeLayout, normalizeStore, removeSpeaker, setWidth, snap, unlinkPair, updateSpeaker,
} from '../src/shared/layout.js';

function close(actual, expected) {
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < 1e-9, `[${i}] ${actual[i]} != ${e}`));
}

test('default layout: door R mirrors door L about the cabin centre line', () => {
  const layout = defaultLayout();
  const [l, r] = layout.speakers;
  assert.ok(Math.abs(cabinCenterX(layout.cabin) - 0.4) < 1e-9);
  close(mirrorPosition(l.position, layout.cabin), r.position);
  assert.equal(l.pair, r.id);
  assert.equal(r.pair, l.id);
});

test('defaultLayout returns a fresh copy every time', () => {
  defaultLayout().speakers[0].position[0] = 9;
  assert.equal(defaultLayout().speakers[0].position[0], -0.72);
});

test('normalizeLayout: nothing gives the default layout', () => {
  assert.deepEqual(normalizeLayout(undefined), defaultLayout());
});

test('normalizeLayout: bad values fall back or are clamped', () => {
  const layout = normalizeLayout({
    name: '  ',
    width: 7,
    cabin: { min: [1, 1, 1], max: [-1, -1, -1] },
    speakers: [{ id: 'x', position: [9, 'a', -9], channel: 'Q', gainDb: 99, type: 'horn' }],
  }, 'Fallback');
  assert.equal(layout.name, 'Fallback');
  assert.equal(layout.width, 2);
  assert.deepEqual(layout.cabin, { min: [-1, -1, -1], max: [1, 1, 1] });
  assert.deepEqual(layout.speakers[0], {
    id: 'x', name: 'Speaker 1', position: [5, 0, -5], channel: 'L', gainDb: 12, type: 'full', pair: null,
  });
});

test('normalizeLayout: duplicate ids are renumbered and pairs made mutual', () => {
  const layout = normalizeLayout({ speakers: [
    { id: 'a', pair: 'b' }, { id: 'b' }, { id: 'a' }, { id: 'c', pair: 'zzz' },
  ] });
  assert.deepEqual(layout.speakers.map((s) => s.id), ['a', 'b', 's1', 'c']);
  assert.deepEqual(layout.speakers.map((s) => s.pair), ['b', 'a', null, null]);
});

test('normalizeLayout: a speaker paired elsewhere loses the link', () => {
  const layout = normalizeLayout({ speakers: [
    { id: 'a', pair: 'b' }, { id: 'b', pair: 'c' }, { id: 'c', pair: 'b' },
  ] });
  assert.deepEqual(layout.speakers.map((s) => s.pair), [null, 'c', 'b']);
});

test('normalizeLayout: at most 16 speakers', () => {
  const layout = normalizeLayout({ speakers: Array.from({ length: 20 }, () => ({})) });
  assert.equal(layout.speakers.length, MAX_SPEAKERS);
});

test('normalizeStore keeps and normalizes truck presets', () => {
  const store = normalizeStore({ trucks: { 'vehicle.x': { name: 'X 1', width: 0.5 }, '': {} } });
  assert.equal(store.version, 1);
  assert.deepEqual(store.default, defaultLayout());
  assert.deepEqual(Object.keys(store.trucks), ['vehicle.x']);
  assert.equal(store.trucks['vehicle.x'].name, 'X 1');
  assert.equal(store.trucks['vehicle.x'].width, 0.5);
});

test('updateSpeaker moves the mirrored partner and clamps values', () => {
  const layout = updateSpeaker(defaultLayout(), 's1', { position: [-0.7, -0.5, -0.4], gainDb: -99 });
  const [l, r] = layout.speakers;
  assert.deepEqual(l.position, [-0.7, -0.5, -0.4]);
  assert.equal(l.gainDb, -60);
  assert.equal(l.pair, 's2');
  close(r.position, [1.5, -0.5, -0.4]);
});

test('updateSpeaker without a position change leaves the partner alone', () => {
  const layout = updateSpeaker(defaultLayout(), 's1', { name: 'Front L' });
  assert.equal(layout.speakers[0].name, 'Front L');
  assert.deepEqual(layout.speakers[1], defaultLayout().speakers[1]);
});

test('addSpeaker adds a mono speaker with a free id, up to the limit', () => {
  const { layout, id } = addSpeaker(defaultLayout());
  assert.equal(id, 's3');
  assert.equal(layout.speakers.at(-1).channel, 'M');
  const full = normalizeLayout({ speakers: Array.from({ length: MAX_SPEAKERS }, () => ({})) });
  assert.equal(addSpeaker(full).id, null);
});

test('addPair adds linked L/R speakers at the cabin sides', () => {
  const { layout, ids } = addPair(defaultLayout());
  assert.deepEqual(ids, ['s3', 's4']);
  const [l, r] = layout.speakers.slice(-2);
  assert.equal(l.channel, 'L');
  assert.equal(r.channel, 'R');
  assert.equal(l.pair, 's4');
  assert.equal(r.pair, 's3');
  close(mirrorPosition(l.position, layout.cabin), r.position);
});

test('removeSpeaker unlinks the partner', () => {
  const layout = removeSpeaker(defaultLayout(), 's1');
  assert.deepEqual(layout.speakers.map((s) => [s.id, s.pair]), [['s2', null]]);
});

test('linkPair mirrors the second speaker; unlinkPair breaks both sides', () => {
  let layout = addSpeaker(unlinkPair(defaultLayout(), 's1')).layout;
  layout = linkPair(layout, 's1', 's3');
  const s3 = layout.speakers.find((s) => s.id === 's3');
  assert.equal(s3.pair, 's1');
  close(s3.position, mirrorPosition(layout.speakers[0].position, layout.cabin));
  assert.equal(layout.speakers.find((s) => s.id === 's2').pair, null);
  layout = unlinkPair(layout, 's3');
  assert.equal(layout.speakers[0].pair, null);
  assert.equal(layout.speakers.find((s) => s.id === 's3').pair, null);
});

test('setWidth clamps to 0..2; snap rounds to centimetres', () => {
  assert.equal(setWidth(defaultLayout(), 3).width, 2);
  assert.equal(setWidth(defaultLayout(), 0.25).width, 0.25);
  assert.equal(snap(0.12345), 0.12);
  assert.equal(snap(0.126), 0.13);
});
```

- [x] **Step 2: Run it to see it fail**

Run: `cd app && npm test`
Expected: FAIL, missing exports such as `defaultLayout`.

- [x] **Step 3: Implement `app/src/shared/layout.js` (replace the file)**

```js
// Speaker layouts: defaults, normalization of loaded data and pure edit helpers.
// Positions are metres from the default head position in SCS cab axes:
// X right, Y up, Z back (forward is -Z).

export const MAX_SPEAKERS = 16;
export const CHANNELS = ['L', 'R', 'M'];
export const TYPES = ['full', 'tweeter', 'sub'];
const COORD_LIMIT = 5;
const GAIN_MIN = -60;
const GAIN_MAX = 12;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

function vec3(value, fallback) {
  return Array.isArray(value) && value.length === 3
    ? value.map((c, i) => clamp(isNum(c) ? c : fallback[i], -COORD_LIMIT, COORD_LIMIT))
    : [...fallback];
}

// Rounds metres to whole centimetres.
export function snap(metres) {
  return Math.round(metres * 100) / 100;
}

// Left-hand drive cab: the driver's head sits near the left door.
export function defaultLayout() {
  return {
    name: 'Default layout',
    width: 1,
    cabin: { min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] },
    speakers: [
      { id: 's1', name: 'Door L', position: [-0.72, -0.6, -0.35], channel: 'L', gainDb: 0, type: 'full', pair: 's2' },
      { id: 's2', name: 'Door R', position: [1.52, -0.6, -0.35], channel: 'R', gainDb: 0, type: 'full', pair: 's1' },
    ],
  };
}

export function cabinCenterX(cabin) {
  return (cabin.min[0] + cabin.max[0]) / 2;
}

// Mirror image across the cab's centre line: doors are symmetric about the cab,
// not about the driver's head.
export function mirrorPosition(position, cabin) {
  return [snap(2 * cabinCenterX(cabin) - position[0]), position[1], position[2]];
}

function freeId(used) {
  for (let n = 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`;
}

function cleanSpeaker(raw, id, fallbackName) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    id,
    name: text(src.name) || fallbackName,
    position: vec3(src.position, [0, 0, -0.5]),
    channel: CHANNELS.includes(src.channel) ? src.channel : 'L',
    gainDb: clamp(isNum(src.gainDb) ? src.gainDb : 0, GAIN_MIN, GAIN_MAX),
    type: TYPES.includes(src.type) ? src.type : 'full',
    pair: text(src.pair) || null,
  };
}

// Keeps only mutual pairs; a speaker whose partner is paired elsewhere loses the link.
function fixPairs(speakers) {
  const byId = new Map(speakers.map((s) => [s.id, s]));
  for (const s of speakers) {
    if (s.pair === null) continue;
    const other = byId.get(s.pair);
    if (!other || other === s || (other.pair !== null && other.pair !== s.id)) s.pair = null;
    else other.pair = s.id;
  }
  return speakers;
}

export function normalizeLayout(raw, fallbackName = 'Default layout') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = defaultLayout();
  const cabinSrc = src.cabin && typeof src.cabin === 'object' ? src.cabin : {};
  const a = vec3(cabinSrc.min, base.cabin.min);
  const b = vec3(cabinSrc.max, base.cabin.max);
  const cabin = { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) };
  const list = Array.isArray(src.speakers) ? src.speakers.slice(0, MAX_SPEAKERS) : base.speakers;
  const requested = new Set(list.map((s) => (s && typeof s.id === 'string' ? s.id : null)));
  const used = new Set();
  const speakers = list.map((s, i) => {
    const wanted = s && typeof s.id === 'string' && s.id ? s.id : null;
    const id = wanted && !used.has(wanted) ? wanted : freeId(new Set([...used, ...requested]));
    used.add(id);
    return cleanSpeaker(s, id, `Speaker ${i + 1}`);
  });
  return {
    name: text(src.name) || fallbackName,
    width: clamp(isNum(src.width) ? src.width : 1, 0, 2),
    cabin,
    speakers: fixPairs(speakers),
  };
}

export function normalizeStore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const trucks = {};
  if (src.trucks && typeof src.trucks === 'object') {
    for (const [key, layout] of Object.entries(src.trucks)) {
      if (key) trucks[key] = normalizeLayout(layout, key);
    }
  }
  return { version: 1, default: normalizeLayout(src.default), trucks };
}

const withSpeakers = (layout, speakers) => ({ ...layout, speakers });

export function setWidth(layout, width) {
  return { ...layout, width: clamp(isNum(width) ? width : 1, 0, 2) };
}

// Applies a patch to one speaker; a moved speaker drags its mirrored partner along.
export function updateSpeaker(layout, id, patch) {
  const current = layout.speakers.find((s) => s.id === id);
  if (!current) return layout;
  const next = cleanSpeaker({ ...current, ...patch, pair: current.pair }, id, current.name);
  const moved = patch.position !== undefined;
  return withSpeakers(layout, layout.speakers.map((s) => {
    if (s.id === id) return next;
    if (moved && s.id === current.pair) return { ...s, position: mirrorPosition(next.position, layout.cabin) };
    return s;
  }));
}

export function addSpeaker(layout) {
  if (layout.speakers.length >= MAX_SPEAKERS) return { layout, id: null };
  const id = freeId(new Set(layout.speakers.map((s) => s.id)));
  const speaker = cleanSpeaker(
    { name: `Speaker ${layout.speakers.length + 1}`, position: [0, -0.35, -0.9], channel: 'M' },
    id,
    'Speaker',
  );
  return { layout: withSpeakers(layout, [...layout.speakers, speaker]), id };
}

export function addPair(layout) {
  if (layout.speakers.length + 2 > MAX_SPEAKERS) return { layout, ids: [] };
  const used = new Set(layout.speakers.map((s) => s.id));
  const left = freeId(used);
  used.add(left);
  const right = freeId(used);
  const n = layout.speakers.length + 1;
  const leftPosition = [snap(layout.cabin.min[0] + 0.03), -0.6, -0.35];
  return {
    layout: withSpeakers(layout, [
      ...layout.speakers,
      cleanSpeaker({ name: `Speaker ${n} L`, position: leftPosition, channel: 'L', pair: right }, left, 'Speaker L'),
      cleanSpeaker(
        { name: `Speaker ${n} R`, position: mirrorPosition(leftPosition, layout.cabin), channel: 'R', pair: left },
        right,
        'Speaker R',
      ),
    ]),
    ids: [left, right],
  };
}

export function removeSpeaker(layout, id) {
  return withSpeakers(layout, layout.speakers
    .filter((s) => s.id !== id)
    .map((s) => (s.pair === id ? { ...s, pair: null } : s)));
}

export function unlinkPair(layout, id) {
  const partner = layout.speakers.find((s) => s.id === id)?.pair ?? null;
  if (!partner) return layout;
  return withSpeakers(layout, layout.speakers.map((s) => (s.id === id || s.id === partner ? { ...s, pair: null } : s)));
}

// Links two speakers as a mirrored pair; b jumps to the mirror image of a.
export function linkPair(layout, a, b) {
  const source = layout.speakers.find((s) => s.id === a);
  if (a === b || !source || !layout.speakers.some((s) => s.id === b)) return layout;
  const unlinked = unlinkPair(unlinkPair(layout, a), b);
  return withSpeakers(unlinked, unlinked.speakers.map((s) => {
    if (s.id === a) return { ...s, pair: b };
    if (s.id === b) return { ...s, pair: a, position: mirrorPosition(source.position, unlinked.cabin) };
    return s;
  }));
}
```

- [x] **Step 4: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 5: Show the user the changed files**

---

### Task 4: Presets

**Files:**
- Create: `app/src/shared/presets.js`
- Test: `app/test/presets.test.js`

**Interfaces:**
- Consumes: `Store`, `Layout` (Task 3).
- Produces:
  - `Selection = { mode: 'auto' } | { mode: 'default' } | { mode: 'truck', key: string }`; `Truck = { key: string, name: string } | null`;
  - `resolvePlaying(store, selection, truck): { kind: 'default' | 'truck', key: string | null, layout: Layout }`;
  - `routeEdit(store, selection, truck): { store, target: { kind, key } }`;
  - `editLayout(store, selection, truck, edit: (Layout) => Layout): Store`;
  - `deletePreset(store, key): Store`;
  - `presetOptions(store, truck): { value: string, label: string }[]`;
  - `selectionValue(selection): string`, `parseSelection(value): Selection`.

- [x] **Step 1: Write the failing test `app/test/presets.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deletePreset, editLayout, parseSelection, presetOptions, resolvePlaying, selectionValue,
} from '../src/shared/presets.js';
import { defaultLayout, normalizeStore, setWidth } from '../src/shared/layout.js';

const TRUCK = { key: 'vehicle.international.9900i', name: 'International 9900i' };
const OTHER = { key: 'vehicle.peterbilt.579', name: 'Peterbilt 579' };
const withPreset = () => normalizeStore({ trucks: { [TRUCK.key]: { name: TRUCK.name, width: 0.5 } } });
const widen = (layout) => setWidth(layout, 1.5);

test('resolvePlaying, auto: the truck preset or the default', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, { mode: 'auto' }, TRUCK).layout.width, 0.5);
  assert.deepEqual(resolvePlaying(store, { mode: 'auto' }, OTHER), { kind: 'default', key: null, layout: store.default });
  assert.equal(resolvePlaying(store, { mode: 'auto' }, null).kind, 'default');
});

test('resolvePlaying, explicit selections play what is selected', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, { mode: 'default' }, TRUCK).kind, 'default');
  assert.equal(resolvePlaying(store, { mode: 'truck', key: TRUCK.key }, OTHER).key, TRUCK.key);
  assert.equal(resolvePlaying(store, { mode: 'truck', key: 'gone' }, TRUCK).kind, 'default');
});

test('edit, auto, truck with a preset: that preset', () => {
  const store = editLayout(withPreset(), { mode: 'auto' }, TRUCK, widen);
  assert.equal(store.trucks[TRUCK.key].width, 1.5);
  assert.equal(store.default.width, 1);
});

test('edit, auto, truck without a preset: a new preset copied from the default', () => {
  const store = editLayout(normalizeStore({}), { mode: 'auto' }, OTHER, widen);
  assert.equal(store.trucks[OTHER.key].name, 'Peterbilt 579');
  assert.equal(store.trucks[OTHER.key].width, 1.5);
  assert.deepEqual(store.trucks[OTHER.key].speakers, defaultLayout().speakers);
  assert.equal(store.default.width, 1);
});

test('edit, auto, no game: the default', () => {
  const store = editLayout(normalizeStore({}), { mode: 'auto' }, null, widen);
  assert.equal(store.default.width, 1.5);
  assert.deepEqual(store.trucks, {});
});

test('edit, default selected: the default even in a truck', () => {
  const store = editLayout(withPreset(), { mode: 'default' }, TRUCK, widen);
  assert.equal(store.default.width, 1.5);
  assert.equal(store.trucks[TRUCK.key].width, 0.5);
});

test('edit, truck selected: that preset from any truck', () => {
  const store = editLayout(withPreset(), { mode: 'truck', key: TRUCK.key }, OTHER, widen);
  assert.equal(store.trucks[TRUCK.key].width, 1.5);
  assert.equal(store.trucks[OTHER.key], undefined);
});

test('editLayout does not mutate its input', () => {
  const before = normalizeStore({});
  const snapshot = structuredClone(before);
  editLayout(before, { mode: 'auto' }, OTHER, widen);
  assert.deepEqual(before, snapshot);
});

test('deletePreset removes only that truck', () => {
  assert.deepEqual(deletePreset(withPreset(), TRUCK.key).trucks, {});
});

test('preset options and selection values', () => {
  const store = withPreset();
  assert.deepEqual(presetOptions(store, OTHER).map((o) => o.label), [
    'Auto — Peterbilt 579 (default layout)', 'Default layout', 'International 9900i',
  ]);
  assert.equal(presetOptions(store, TRUCK)[0].label, 'Auto — International 9900i');
  assert.equal(presetOptions(store, null)[0].label, 'Auto — no game');
  for (const selection of [{ mode: 'auto' }, { mode: 'default' }, { mode: 'truck', key: TRUCK.key }]) {
    assert.deepEqual(parseSelection(selectionValue(selection)), selection);
  }
});
```

- [x] **Step 2: Run it to see it fail**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `src/shared/presets.js`.

- [x] **Step 3: Implement `app/src/shared/presets.js`**

```js
// Which layout plays and which one an edit goes to.
// Selection: { mode: 'auto' } | { mode: 'default' } | { mode: 'truck', key }.
// Truck: { key, name } from telemetry, or null when the game is not running.

export function resolvePlaying(store, selection, truck) {
  if (selection.mode === 'truck' && store.trucks[selection.key]) {
    return { kind: 'truck', key: selection.key, layout: store.trucks[selection.key] };
  }
  if (selection.mode === 'auto' && truck && store.trucks[truck.key]) {
    return { kind: 'truck', key: truck.key, layout: store.trucks[truck.key] };
  }
  return { kind: 'default', key: null, layout: store.default };
}

// In auto mode the first edit in a truck without a preset creates one from the default.
export function routeEdit(store, selection, truck) {
  if (selection.mode === 'default') return { store, target: { kind: 'default', key: null } };
  if (selection.mode === 'truck') return { store, target: { kind: 'truck', key: selection.key } };
  if (!truck) return { store, target: { kind: 'default', key: null } };
  if (store.trucks[truck.key]) return { store, target: { kind: 'truck', key: truck.key } };
  const preset = { ...structuredClone(store.default), name: truck.name };
  return {
    store: { ...store, trucks: { ...store.trucks, [truck.key]: preset } },
    target: { kind: 'truck', key: truck.key },
  };
}

export function editLayout(store, selection, truck, edit) {
  const routed = routeEdit(store, selection, truck);
  const { key, kind } = routed.target;
  const current = kind === 'truck' ? routed.store.trucks[key] : routed.store.default;
  const next = edit(current);
  return kind === 'truck'
    ? { ...routed.store, trucks: { ...routed.store.trucks, [key]: next } }
    : { ...routed.store, default: next };
}

export function deletePreset(store, key) {
  const trucks = { ...store.trucks };
  delete trucks[key];
  return { ...store, trucks };
}

export function presetOptions(store, truck) {
  const auto = truck
    ? `Auto — ${truck.name}${store.trucks[truck.key] ? '' : ' (default layout)'}`
    : 'Auto — no game';
  const trucks = Object.entries(store.trucks)
    .map(([key, layout]) => ({ value: `truck:${key}`, label: layout.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: 'auto', label: auto }, { value: 'default', label: 'Default layout' }, ...trucks];
}

export function selectionValue(selection) {
  return selection.mode === 'truck' ? `truck:${selection.key}` : selection.mode;
}

export function parseSelection(value) {
  if (value.startsWith('truck:')) return { mode: 'truck', key: value.slice('truck:'.length) };
  return { mode: value === 'default' ? 'default' : 'auto' };
}
```

- [x] **Step 4: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 5: Show the user the changed files**

---

### Task 5: Settings and device matching

**Files:**
- Create: `app/src/shared/settings.js`, `app/src/shared/devices.js`
- Test: `app/test/settings.test.js`, `app/test/devices.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `Settings = { version: 1, source: 'input' | 'file', input: { id, label } | null, output: { id, label } | null }`;
  - `normalizeSettings(raw): Settings`;
  - `pickDevice(devices, kind: 'audioinput' | 'audiooutput', saved: { id, label } | null, preferLabel: string | null): { device: MediaDeviceInfo | null, warning: string | null }`;
  - `rateWarning(inputRate, outputRate): string | null`, `channelsWarning(channels): string | null`.

- [x] **Step 1: Write the failing tests**

`app/test/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/shared/settings.js';

test('normalizeSettings: defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), { version: 1, source: 'input', input: null, output: null });
});

test('normalizeSettings keeps valid devices and drops junk', () => {
  const settings = normalizeSettings({
    source: 'file',
    input: { id: 'cable', label: 'CABLE Output' },
    output: { id: '', label: 'x' },
  });
  assert.deepEqual(settings, {
    version: 1, source: 'file', input: { id: 'cable', label: 'CABLE Output' }, output: null,
  });
  assert.equal(normalizeSettings({ source: 'radio' }).source, 'input');
});
```

`app/test/devices.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsWarning, pickDevice, rateWarning } from '../src/shared/devices.js';

const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'mic', label: 'Microphone (Headset)' },
  { kind: 'audioinput', deviceId: 'cable', label: 'CABLE Output (VB-Audio Virtual Cable)' },
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - Headphones (Headset)' },
  { kind: 'audiooutput', deviceId: 'phones', label: 'Headphones (Headset)' },
];

test('pickDevice: the saved id wins', () => {
  const { device, warning } = pickDevice(DEVICES, 'audioinput', { id: 'mic', label: 'x' }, 'CABLE Output');
  assert.equal(device.deviceId, 'mic');
  assert.equal(warning, null);
});

test('pickDevice: by label when the id changed', () => {
  const saved = { id: 'old', label: 'CABLE Output (VB-Audio Virtual Cable)' };
  assert.equal(pickDevice(DEVICES, 'audioinput', saved, null).device.deviceId, 'cable');
});

test('pickDevice: nothing saved -> preferred label, then the system default', () => {
  assert.equal(pickDevice(DEVICES, 'audioinput', null, 'CABLE Output').device.deviceId, 'cable');
  assert.equal(pickDevice(DEVICES, 'audiooutput', null, null).device.deviceId, 'default');
  assert.equal(pickDevice(DEVICES, 'audioinput', null, 'Line 1').device.deviceId, 'default');
});

test('pickDevice: a missing saved device falls back with a warning', () => {
  const saved = { id: 'gone', label: 'Line 1 (Virtual Audio Cable)' };
  const { device, warning } = pickDevice(DEVICES, 'audioinput', saved, 'CABLE Output');
  assert.equal(device.deviceId, 'cable');
  assert.equal(warning, 'Saved input "Line 1 (Virtual Audio Cable)" not found — using "CABLE Output (VB-Audio Virtual Cable)".');
});

test('pickDevice: no devices of that kind', () => {
  assert.deepEqual(pickDevice([], 'audioinput', null, 'CABLE Output'), { device: null, warning: null });
});

test('rate and channel warnings', () => {
  assert.match(rateWarning(48000, 44100), /48000 vs 44100 Hz/);
  assert.equal(rateWarning(44100, 44100), null);
  assert.equal(rateWarning(undefined, 44100), null);
  assert.match(channelsWarning(8), /8 channels/);
  assert.equal(channelsWarning(2), null);
});
```

- [x] **Step 2: Run them to see them fail**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `settings.js` and `devices.js`.

- [x] **Step 3: Implement `app/src/shared/settings.js`**

```js
// settings.json: which devices to use and where the audio comes from.

function deviceRef(raw) {
  return raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id
    ? { id: raw.id, label: typeof raw.label === 'string' ? raw.label : '' }
    : null;
}

export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    source: src.source === 'file' ? 'file' : 'input',
    input: deviceRef(src.input),
    output: deviceRef(src.output),
  };
}
```

- [x] **Step 4: Implement `app/src/shared/devices.js`**

```js
// Matching saved devices against what the system offers now, and setup warnings.

const KIND_NAMES = { audioinput: 'input', audiooutput: 'output' };

// Order: saved id, saved label, a device whose label contains preferLabel,
// the system default, the first device of that kind.
export function pickDevice(devices, kind, saved, preferLabel) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
  if (saved) {
    const found = list.find((d) => d.deviceId === saved.id) ?? list.find((d) => d.label === saved.label);
    if (found) return { device: found, warning: null };
  }
  const preferred = preferLabel
    ? list.find((d) => d.deviceId !== 'default' && d.label.includes(preferLabel))
    : null;
  const device = preferred ?? list.find((d) => d.deviceId === 'default') ?? list[0] ?? null;
  const warning = saved
    ? `Saved ${KIND_NAMES[kind]} "${saved.label}" not found — using ${device ? `"${device.label}"` : 'nothing'}.`
    : null;
  return { device, warning };
}

export function rateWarning(inputRate, outputRate) {
  return inputRate && outputRate && inputRate !== outputRate
    ? `Sample rates differ (${inputRate} vs ${outputRate} Hz) — clicks are likely. Set the cable and the output to one rate.`
    : null;
}

export function channelsWarning(channels) {
  return channels > 2
    ? `Output has ${channels} channels — turn off virtual surround (DTS, Windows Sonic, Dolby Atmos).`
    : null;
}
```

- [x] **Step 5: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 6: Show the user the changed files**

---

### Task 6: Truck key from telemetry

**Files:**
- Modify: `app/src/main/telemetry.js`, `app/scripts/pose-dump.js`, `tools/fake_shm.py`
- Test: `app/test/telemetry.test.js`

**Interfaces:**
- Consumes: —
- Produces: `truckKey({ brandId, id, name }): string | null`; `parsePose(view)` now returns `truck: { key, name } | null` instead of a string. `SNAPSHOT_SIZE` stays 2556.

- [x] **Step 1: Update the tests in `app/test/telemetry.test.js` (replace the file)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePose, SNAPSHOT_SIZE, truckKey } from '../src/main/telemetry.js';

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

  const pose = parsePose(view);

  assert.equal(pose.sdkActive, true);
  assert.equal(pose.paused, true);
  assert.ok(Math.abs(pose.head.y - -0.05) < 1e-6);
  assert.ok(Math.abs(pose.head.heading - 0.99) < 1e-6);
  assert.ok(Math.abs(pose.head.pitch - -0.0083) < 1e-6);
  assert.deepEqual(pose.truck, { key: 'vehicle.international.9900i', name: 'International 9900i' });
});

test('empty memory: game inactive, no truck', () => {
  const pose = parsePose(new DataView(new ArrayBuffer(SNAPSHOT_SIZE)));
  assert.equal(pose.sdkActive, false);
  assert.equal(pose.truck, null);
});

test('truckKey falls back to brand id and model name', () => {
  assert.equal(truckKey({ brandId: 'kenworth', id: '', name: 'W900' }), 'kenworth/W900');
  assert.equal(truckKey({ brandId: '', id: '', name: '' }), null);
  assert.equal(truckKey({ brandId: 'x', id: 'vehicle.x', name: 'y' }), 'vehicle.x');
});
```

- [x] **Step 2: Run it to see it fail**

Run: `cd app && npm test`
Expected: FAIL (`truckKey` is not exported; `truck` is a string).

- [x] **Step 3: Update `app/src/main/telemetry.js`**

Replace the offsets block and `parsePose` with:

```js
// Offsets from third_party/scs-sdk-plugin/scs-telemetry/inc/scs-telemetry-common.hpp
// (offsetof, MSVC x64), the same as in tools/shm_probe.py.
const OFF_SDK_ACTIVE = 0;
const OFF_PAUSED = 4;
const OFF_HEAD_OFFSET = 2024; // 6 floats: x y z heading pitch roll, angles in turns
const OFF_TRUCK_BRAND_ID = 2300;
const OFF_TRUCK_BRAND = 2364;
const OFF_TRUCK_ID = 2428;
const OFF_TRUCK_NAME = 2492;
const STR_SIZE = 64;
export const SNAPSHOT_SIZE = OFF_TRUCK_NAME + STR_SIZE; // only the start of the structure is copied
```

```js
// Preset key: the game's truck id; if it is empty, brand id + model name.
export function truckKey({ brandId, id, name }) {
  if (id) return id;
  if (brandId || name) return `${brandId}/${name}`;
  return null;
}

export function parsePose(view) {
  const f = (i) => view.getFloat32(OFF_HEAD_OFFSET + 4 * i, true);
  const brandId = readString(view, OFF_TRUCK_BRAND_ID);
  const brand = readString(view, OFF_TRUCK_BRAND);
  const id = readString(view, OFF_TRUCK_ID);
  const name = readString(view, OFF_TRUCK_NAME);
  const key = truckKey({ brandId, id, name });
  return {
    sdkActive: view.getUint8(OFF_SDK_ACTIVE) !== 0,
    paused: view.getUint8(OFF_PAUSED) !== 0,
    head: { x: f(0), y: f(1), z: f(2), heading: f(3), pitch: f(4), roll: f(5) },
    truck: key ? { key, name: `${brand} ${name}`.trim() || key } : null,
  };
}
```

The remaining comments in the file (`openTelemetry`, `api`) are translated:

```js
// Only opens existing memory: if the app created it before the game,
// the plugin might not get write access.
```

- [x] **Step 4: Update `app/scripts/pose-dump.js`**

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
  console.log(`${p.sdkActive ? ' ' : 'X'}${p.paused ? 'P' : ' '} ${p.truck ? `${p.truck.name} [${p.truck.key}]` : '-'}`
    + `  yaw ${turnsToDeg(p.head.heading).toFixed(1)}°  pitch ${turnsToDeg(p.head.pitch).toFixed(1)}°`);
}, 200);
```

- [x] **Step 5: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 6: Give the fake memory a truck id**

In `tools/fake_shm.py`, write all four truck strings (so leftovers from a real game session never leak into the key):

```python
    for offset, value in ((2300, b"fake"), (2364, b"Fake"), (2428, b"vehicle.fake.truck"), (2492, b"Truck")):
        mem[offset:offset + 64] = value.ljust(64, b"\0")
```

- [x] **Step 7: Manual check with the fake memory (game closed)**

`py tools/fake_shm.py` and `cd app && node scripts/pose-dump.js`.
Expected: lines like `   Fake Truck [vehicle.fake.truck]  yaw 42.0°  pitch 0.0°`, yaw sweeping ±90.

- [x] **Step 8: Show the user the changed files**

---

### Task 7: Data folder and JSON store

**Files:**
- Create: `app/src/main/paths.js`, `app/src/main/store.js`
- Modify: `app/.gitignore`
- Test: `app/test/paths.test.js`, `app/test/store.test.js`

**Interfaces:**
- Consumes: `normalizeStore` (Task 3), `normalizeSettings` (Task 5).
- Produces:
  - `resolveDataDir({ isPackaged, appPath, execPath, portableDir }): string`;
  - `readJson(file, now = new Date()): { value, warning: string | null }`;
  - `writeJsonAtomic(file, value): string | null` (a warning or null);
  - `loadData(dataDir): { dataDir, store: Store, settings: Settings, warnings: string[] }`;
  - `saveLayouts(dataDir, store): string | null`, `saveSettings(dataDir, settings): string | null`.

- [x] **Step 1: Write the failing tests**

`app/test/paths.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDataDir } from '../src/main/paths.js';

test('development: data folder inside the app folder', () => {
  const dir = resolveDataDir({ isPackaged: false, appPath: 'E:/Repos/x/app', execPath: 'C:/electron.exe' });
  assert.equal(dir, path.join('E:/Repos/x/app', 'data'));
});

test('packaged portable build: next to the portable exe', () => {
  const dir = resolveDataDir({ isPackaged: true, appPath: 'C:/tmp/app.asar', execPath: 'C:/tmp/x.exe', portableDir: 'D:/Tools/Trucker AUX' });
  assert.equal(dir, path.join('D:/Tools/Trucker AUX', 'data'));
});

test('packaged unpacked build: next to the executable', () => {
  const dir = resolveDataDir({ isPackaged: true, appPath: 'D:/T/resources/app.asar', execPath: 'D:/T/Trucker AUX.exe' });
  assert.equal(dir, path.join('D:/T', 'data'));
});
```

`app/test/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadData, readJson, saveLayouts, writeJsonAtomic } from '../src/main/store.js';
import { defaultLayout, normalizeStore } from '../src/shared/layout.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trucker-aux-'));

test('readJson: a missing file is not an error', () => {
  assert.deepEqual(readJson(path.join(tempDir(), 'nope.json')), { value: null, warning: null });
});

test('writeJsonAtomic + readJson round trip, creating folders', () => {
  const file = path.join(tempDir(), 'deep', 'a.json');
  assert.equal(writeJsonAtomic(file, { a: 1 }), null);
  assert.deepEqual(readJson(file), { value: { a: 1 }, warning: null });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('readJson: a broken file is moved aside with a warning', () => {
  const dir = tempDir();
  const file = path.join(dir, 'layouts.json');
  fs.writeFileSync(file, '{ not json');
  const result = readJson(file, new Date('2026-09-30T12:00:00Z'));
  assert.equal(result.value, null);
  assert.match(result.warning, /layouts\.json was invalid and was moved to .*layouts\.json\.broken-2026-09-30T12-00-00-000Z/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('writeJsonAtomic: an unwritable path gives a warning', () => {
  const dir = tempDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  assert.match(writeJsonAtomic(path.join(blocker, 'a.json'), {}), /^Cannot save to /);
});

test('loadData: a fresh folder gives defaults without warnings', () => {
  const data = loadData(tempDir());
  assert.deepEqual(data.store.default, defaultLayout());
  assert.deepEqual(data.settings, { version: 1, source: 'input', input: null, output: null });
  assert.deepEqual(data.warnings, []);
});

test('saveLayouts then loadData returns the same store', () => {
  const dir = tempDir();
  const store = normalizeStore({ trucks: { k: { name: 'K', width: 0.3 } } });
  assert.equal(saveLayouts(dir, store), null);
  assert.deepEqual(loadData(dir).store, store);
});

test('loadData: a broken layouts file gives defaults and a warning', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'layouts.json'), '[1,');
  const data = loadData(dir);
  assert.deepEqual(data.store.default, defaultLayout());
  assert.equal(data.warnings.length, 1);
});
```

- [x] **Step 2: Run them to see them fail**

Run: `cd app && npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `paths.js` and `store.js`.

- [x] **Step 3: Implement `app/src/main/paths.js`**

```js
import path from 'node:path';

// Where Trucker AUX keeps layouts, settings and the Chromium profile.
// Development: app/data. Packaged: data/ next to the executable
// (electron-builder portable builds report their folder in PORTABLE_EXECUTABLE_DIR).
export function resolveDataDir({ isPackaged, appPath, execPath, portableDir }) {
  if (!isPackaged) return path.join(appPath, 'data');
  return path.join(portableDir || path.dirname(execPath), 'data');
}
```

- [x] **Step 4: Implement `app/src/main/store.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { normalizeStore } from '../shared/layout.js';
import { normalizeSettings } from '../shared/settings.js';

const LAYOUTS = 'layouts.json';
const SETTINGS = 'settings.json';

// A missing file is not an error. A broken one is moved aside so the user keeps a copy.
export function readJson(file, now = new Date()) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { value: null, warning: null };
    return { value: null, warning: `Cannot read ${file}: ${err.message}` };
  }
  try {
    return { value: JSON.parse(content), warning: null };
  } catch {
    const backup = `${file}.broken-${now.toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(file, backup);
    } catch {
      return { value: null, warning: `${path.basename(file)} is invalid and could not be moved aside.` };
    }
    return { value: null, warning: `${path.basename(file)} was invalid and was moved to ${backup}` };
  }
}

// Writes a temporary file and renames it, so a crash never leaves half a file behind.
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return null;
  } catch (err) {
    return `Cannot save to ${file}: ${err.message}`;
  }
}

export function loadData(dataDir) {
  const layouts = readJson(path.join(dataDir, LAYOUTS));
  const settings = readJson(path.join(dataDir, SETTINGS));
  return {
    dataDir,
    store: normalizeStore(layouts.value),
    settings: normalizeSettings(settings.value),
    warnings: [layouts.warning, settings.warning].filter(Boolean),
  };
}

export function saveLayouts(dataDir, store) {
  return writeJsonAtomic(path.join(dataDir, LAYOUTS), store);
}

export function saveSettings(dataDir, settings) {
  return writeJsonAtomic(path.join(dataDir, SETTINGS), settings);
}
```

- [x] **Step 5: Ignore the Chromium profile in `app/.gitignore`**

```gitignore
node_modules/
out/
data/profile/
data/*.tmp
```

- [x] **Step 6: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 7: Show the user the changed files**

---

### Task 8: Engine with N speakers and the offline engine check

**Files:**
- Modify: `app/src/renderer/engine.js` (rewrite), `app/package.json` (script)
- Create: `app/scripts/engine-check.js`, `app/scripts/engine-check-preload.cjs`, `app/scripts/engine-check.html`, `app/scripts/engine-check-page.js`

**Interfaces:**
- Consumes: `widthGains`, `filterFor`, `speakerGain` (Task 2); `listenerVectors` (`shared/pose.js`); `Layout` (Task 3).
- Produces: `createEngine(ctx): { input: GainNode, sync(layout: Layout): void, setSolo(id: string | null): void, setMuted(id: string, on: boolean): void, setPose(pose | null): void }`. `input` takes stereo. `npm run test:engine` exits 0 when all checks pass.

- [x] **Step 1: Write the check harness first**

`app/scripts/engine-check.js`:

```js
// npm run test:engine: renders the engine offline in a hidden window and checks it in dB.
import { app, BrowserWindow, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', path.join(os.tmpdir(), 'trucker-aux-engine-check'));

app.whenReady().then(() => {
  const timer = setTimeout(() => {
    console.error('Engine check timed out (the page probably failed to load).');
    app.exit(2);
  }, 60000);
  ipcMain.once('engine-check:done', (_event, result) => {
    clearTimeout(timer);
    console.log(result.report);
    app.exit(result.ok ? 0 : 1);
  });
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(here, 'engine-check-preload.cjs') } });
  win.loadFile(path.join(here, 'engine-check.html'));
});
```

`app/scripts/engine-check-preload.cjs`:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engineCheck', {
  done: (result) => ipcRenderer.send('engine-check:done', result),
});
```

`app/scripts/engine-check.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Engine check</title></head>
<body><script type="module" src="engine-check-page.js"></script></body>
</html>
```

`app/scripts/engine-check-page.js`:

```js
import { createEngine } from '../src/renderer/engine.js';

const RATE = 44100;
const db = (a, b) => 10 * Math.log10(a / b);

// Power of frequency f in x (Goertzel).
function power(x, f) {
  const k = 2 * Math.cos((2 * Math.PI * f) / RATE);
  let s1 = 0, s2 = 0;
  for (const v of x) {
    const s = v + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - k * s1 * s2) / (x.length * x.length) + 1e-20;
}

const speaker = (id, channel, position, type = 'full') => ({ id, name: id, position, channel, gainDb: 0, type, pair: null });
const PAIR = {
  name: 'pair', width: 1, cabin: { min: [-1, -1, -1], max: [1, 1, 1] },
  speakers: [speaker('a', 'L', [-0.7, -0.4, -0.3]), speaker('b', 'R', [0.7, -0.4, -0.3])],
};
const single = (type) => ({ ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], type)] });

// Renders 1 s; left/right are the frequencies fed into each input channel.
async function render({ layout, left, right, yawDeg = 0, setup, change }) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: RATE, sampleRate: RATE });
  const engine = createEngine(ctx);
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  for (const [channel, freqs] of [[0, left], [1, right]]) {
    for (const frequency of freqs) {
      const osc = new OscillatorNode(ctx, { frequency });
      osc.connect(merger, 0, channel);
      osc.start();
    }
  }
  merger.connect(engine.input);
  engine.sync(layout);
  engine.setPose({ sdkActive: true, paused: false, head: { x: 0, y: 0, z: 0, heading: yawDeg / 360, pitch: 0, roll: 0 }, truck: null });
  setup?.(engine);
  if (change) {
    ctx.suspend(change.at).then(() => {
      change.run(engine);
      ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  return { left: out.getChannelData(0), right: out.getChannelData(1) };
}

const tail = (x) => x.subarray(RATE / 2); // parameters have settled by then
const both = (r, f) => power(tail(r.left), f) + power(tail(r.right), f);

const checks = [
  ['separation, head straight', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500] });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l >= 3 && rr <= -3, `L tone ${l.toFixed(1)} dB left-right, R tone ${rr.toFixed(1)} dB`];
  }],
  ['head turned left 90°: both tones move right', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500], yawDeg: 90 });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l < 0 && rr < 0, `L tone ${l.toFixed(1)} dB, R tone ${rr.toFixed(1)} dB`];
  }],
  ['head turned right 90°: both tones move left', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500], yawDeg: -90 });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l > 0 && rr > 0, `L tone ${l.toFixed(1)} dB, R tone ${rr.toFixed(1)} dB`];
  }],
  ['tweeter cuts lows', async () => {
    const r = await render({ layout: single('tweeter'), left: [200, 5000], right: [200, 5000] });
    const d = db(both(r, 5000), both(r, 200));
    return [d >= 20, `5 kHz is ${d.toFixed(1)} dB above 200 Hz`];
  }],
  ['sub cuts highs', async () => {
    const r = await render({ layout: single('sub'), left: [200, 5000], right: [200, 5000] });
    const d = db(both(r, 200), both(r, 5000));
    return [d >= 20, `200 Hz is ${d.toFixed(1)} dB above 5 kHz`];
  }],
  ['solo silences the other speaker', async () => {
    const base = await render({ layout: PAIR, left: [500], right: [1500] });
    const solo = await render({ layout: PAIR, left: [500], right: [1500], setup: (e) => e.setSolo('a') });
    const d = db(both(base, 1500), both(solo, 1500));
    return [d >= 30, `R tone dropped by ${d.toFixed(1)} dB`];
  }],
  ['mute silences that speaker', async () => {
    const base = await render({ layout: PAIR, left: [500], right: [1500] });
    const muted = await render({ layout: PAIR, left: [500], right: [1500], setup: (e) => e.setMuted('a', true) });
    const d = db(both(base, 500), both(muted, 500));
    return [d >= 30, `L tone dropped by ${d.toFixed(1)} dB`];
  }],
  ['switching layouts mid-stream: no NaN, not silent', async () => {
    const next = { ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], 'tweeter'), speaker('d', 'M', [0, -0.5, 0], 'sub')] };
    const r = await render({ layout: PAIR, left: [200, 5000], right: [200, 5000], change: { at: 0.5, run: (e) => e.sync(next) } });
    const finite = [...r.left, ...r.right].every(Number.isFinite);
    const end = r.left.subarray(RATE - RATE / 5);
    const rms = Math.sqrt(end.reduce((sum, v) => sum + v * v, 0) / end.length);
    return [finite && rms > 1e-3, `finite ${finite}, RMS of the last 0.2 s ${rms.toExponential(2)}`];
  }],
];

const lines = [];
let ok = true;
for (const [name, run] of checks) {
  try {
    const [pass, detail] = await run();
    ok &&= pass;
    lines.push(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  } catch (err) {
    ok = false;
    lines.push(`FAIL ${name}: ${err.stack}`);
  }
}
window.engineCheck.done({ ok, report: lines.join('\n') });
```

Add to `app/package.json` scripts:

```json
    "test:engine": "electron scripts/engine-check.js"
```

- [x] **Step 2: Run the check against the old engine to see it fail**

Run: `cd app && npm run test:engine`
Expected: exit code 1 or 2: the old engine has no `sync` (`TypeError: engine.sync is not a function` in every check).

- [x] **Step 3: Rewrite `app/src/renderer/engine.js`**

```js
import { filterFor, speakerGain, widthGains } from '../shared/dsp.js';
import { listenerVectors } from '../shared/pose.js';

const SMOOTH = 0.02;      // time constant for pose and parameter changes, s
const RETIRE_MS = 200;    // a removed speaker fades out before it is disconnected
const REF_DISTANCE = 0.5; // closer than this the level stops growing
const MAKEUP = 1.7;       // restores the level of speakers ~0.86 m away with REF_DISTANCE 0.5

const monoBus = (ctx) => new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit' });

export function createEngine(ctx) {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  input.connect(split);

  // Width matrix: L' and R' each mix both input channels; M' = (L' + R') / 2.
  const bus = { L: monoBus(ctx), R: monoBus(ctx), M: monoBus(ctx) };
  const matrix = [0, 1].map((from) => [0, 1].map((to) => {
    const gain = new GainNode(ctx, { gain: from === to ? 1 : 0 });
    split.connect(gain, from);
    gain.connect(to === 0 ? bus.L : bus.R);
    return gain;
  }));
  for (const side of [bus.L, bus.R]) side.connect(new GainNode(ctx, { gain: 0.5 })).connect(bus.M);

  const master = new GainNode(ctx, { gain: MAKEUP });
  master.connect(ctx.destination);

  const chains = new Map(); // speaker id -> { speaker, entry, nodes, level, panner }
  const muted = new Set();
  let solo = null;
  let width = 1;

  function build(speaker) {
    const params = filterFor(speaker.type);
    const filter = params ? new BiquadFilterNode(ctx, params) : null;
    const level = new GainNode(ctx, { gain: 0 });
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
    const entry = filter ?? level;
    bus[speaker.channel].connect(entry);
    if (filter) filter.connect(level);
    level.connect(panner).connect(master);
    // New speakers fade in, so adding one does not click.
    level.gain.setTargetAtTime(speakerGain(speaker, solo, muted), ctx.currentTime, SMOOTH);
    return { speaker, entry, nodes: [filter, level, panner].filter(Boolean), level, panner };
  }

  function retire(chain) {
    chain.level.gain.cancelScheduledValues(ctx.currentTime);
    chain.level.gain.setTargetAtTime(0, ctx.currentTime, SMOOTH);
    setTimeout(() => {
      bus[chain.speaker.channel].disconnect(chain.entry);
      for (const node of chain.nodes) node.disconnect();
    }, RETIRE_MS);
  }

  function update(chain, speaker) {
    const t = ctx.currentTime;
    chain.speaker = speaker;
    [chain.panner.positionX, chain.panner.positionY, chain.panner.positionZ]
      .forEach((param, i) => param.setTargetAtTime(speaker.position[i], t, SMOOTH));
    chain.level.gain.setTargetAtTime(speakerGain(speaker, solo, muted), t, SMOOTH);
  }

  function setWidth(value) {
    if (value === width) return;
    width = value;
    const { direct, cross } = widthGains(value);
    const t = ctx.currentTime;
    matrix[0][0].gain.setTargetAtTime(direct, t, SMOOTH);
    matrix[1][1].gain.setTargetAtTime(direct, t, SMOOTH);
    matrix[0][1].gain.setTargetAtTime(cross, t, SMOOTH);
    matrix[1][0].gain.setTargetAtTime(cross, t, SMOOTH);
  }

  // Brings the graph in line with a layout. Positions, levels and width glide; only
  // speakers that were added, removed or changed channel or type are rebuilt, with a fade.
  function sync(layout) {
    setWidth(layout.width);
    const wanted = new Map(layout.speakers.map((s) => [s.id, s]));
    for (const [id, chain] of chains) {
      const next = wanted.get(id);
      if (!next || next.channel !== chain.speaker.channel || next.type !== chain.speaker.type) {
        retire(chain);
        chains.delete(id);
      }
    }
    for (const speaker of layout.speakers) {
      const chain = chains.get(speaker.id);
      if (chain) update(chain, speaker);
      else chains.set(speaker.id, build(speaker));
    }
  }

  function refreshLevels() {
    for (const chain of chains.values()) update(chain, chain.speaker);
  }

  function setSolo(id) {
    solo = id;
    refreshLevels();
  }

  function setMuted(id, on) {
    if (on) muted.add(id);
    else muted.delete(id);
    refreshLevels();
  }

  const listener = ctx.listener;
  const neutral = listenerVectors(0, 0, 0);

  // No game (pose = null or sdkActive = false) or pause: neutral listener.
  function setPose(pose) {
    const active = pose && pose.sdkActive && !pose.paused;
    const position = active ? [pose.head.x, pose.head.y, pose.head.z] : [0, 0, 0];
    const { forward, up } = active ? listenerVectors(pose.head.heading, pose.head.pitch, pose.head.roll) : neutral;
    const t = ctx.currentTime;
    [listener.positionX, listener.positionY, listener.positionZ].forEach((p, i) => p.setTargetAtTime(position[i], t, SMOOTH));
    [listener.forwardX, listener.forwardY, listener.forwardZ].forEach((p, i) => p.setTargetAtTime(forward[i], t, SMOOTH));
    [listener.upX, listener.upY, listener.upZ].forEach((p, i) => p.setTargetAtTime(up[i], t, SMOOTH));
  }

  setPose(null);
  return { input, sync, setSolo, setMuted, setPose };
}
```

- [x] **Step 4: Run the engine check**

Run: `cd app && npm run test:engine`
Expected: 8 `PASS` lines, exit code 0.

- [x] **Step 5: Run the unit tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 6: Show the user the changed files**

---

### Task 9: App wiring — main process, devices, panel

**Files:**
- Modify: `app/src/main/main.js` (rewrite), `app/src/main/preload.cjs` (rewrite), `app/src/renderer/index.html` (rewrite), `app/src/renderer/app.js` (rewrite)
- Create: `app/src/renderer/audio-io.js`, `app/src/renderer/panel.js`, `app/src/renderer/style.css`

**Interfaces:**
- Consumes: everything above: `resolveDataDir`, `loadData`, `saveLayouts`, `saveSettings`, `openTelemetry`; `createEngine`; layout helpers; presets; `pickDevice`, `rateWarning`, `channelsWarning`; `turnsToDeg`.
- Produces:
  - IPC: `store:load` → `{ dataDir, store, settings, warnings }`, `store:save-layouts(store)` → `string | null`, `store:save-settings(settings)` → `string | null`, event `pose` (every 10 ms) → `Pose | null` with `truck: { key, name } | null`;
  - `window.aux = { load, saveLayouts, saveSettings, onPose }`;
  - `listDevices(): Promise<MediaDeviceInfo[]>`, `openInput(deviceId): Promise<{ stream, rate }>`, `probeOutput(sinkId): Promise<{ rate, channels }>`;
  - `createPanel(root, actions): { update(view), setStatus(text) }` with the `actions` and `view` shapes used in `app.js` below.

- [x] **Step 1: Rewrite `app/src/main/main.js`**

```js
import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './paths.js';
import { loadData, saveLayouts, saveSettings } from './store.js';
import { openTelemetry } from './telemetry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POSE_PERIOD_MS = 10; // shared-memory polling, ~100 Hz
const RETRY_MS = 1000;     // how often to look for the memory while the game is not running

// Everything, including Chromium's profile, lives in the app folder, not in %APPDATA%.
const dataDir = resolveDataDir({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  execPath: process.execPath,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
});
app.setPath('userData', path.join(dataDir, 'profile'));

ipcMain.handle('store:load', () => loadData(dataDir));
ipcMain.handle('store:save-layouts', (_event, store) => saveLayouts(dataDir, store));
ipcMain.handle('store:save-settings', (_event, settings) => saveSettings(dataDir, settings));

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
    width: 1280,
    height: 800,
    title: 'Trucker AUX',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  win.loadFile(path.join(here, '../renderer/index.html'));
  startPoseFeed(win);
}

app.whenReady().then(() => {
  // The window needs an input device and output selection.
  const allowed = new Set(['media', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
```

- [x] **Step 2: Rewrite `app/src/main/preload.cjs`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aux', {
  load: () => ipcRenderer.invoke('store:load'),
  saveLayouts: (store) => ipcRenderer.invoke('store:save-layouts', store),
  saveSettings: (settings) => ipcRenderer.invoke('store:save-settings', settings),
  onPose: (listener) => ipcRenderer.on('pose', (_event, pose) => listener(pose)),
});
```

- [x] **Step 3: Create `app/src/renderer/audio-io.js`**

```js
// Device access for the renderer: lists, input capture and output probing.

let permitted = false;

// Device labels stay hidden until the page has microphone permission.
export async function listDevices() {
  if (!permitted) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());
    permitted = true;
  }
  return navigator.mediaDevices.enumerateDevices();
}

export async function openInput(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
  });
  return { stream, rate: stream.getAudioTracks()[0].getSettings().sampleRate };
}

// Native sample rate and channel count of an output device ('' is the system default).
export async function probeOutput(sinkId) {
  const ctx = new AudioContext({ sinkId });
  const result = { rate: ctx.sampleRate, channels: ctx.destination.maxChannelCount };
  await ctx.close();
  return result;
}
```

- [x] **Step 4: Create `app/src/renderer/panel.js`**

```js
// The control panel on the left. Built once; update(view) refreshes values in place
// so a field the user is typing into keeps its focus.

const CHANNEL_OPTIONS = [
  { value: 'L', label: 'Left' },
  { value: 'R', label: 'Right' },
  { value: 'M', label: 'Mono (L+R)' },
];
const TYPE_OPTIONS = [
  { value: 'full', label: 'Full range' },
  { value: 'tweeter', label: 'Tweeter' },
  { value: 'sub', label: 'Subwoofer' },
];
const TYPE_BADGE = { full: '', tweeter: 'tweeter', sub: 'sub' };

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...[].concat(children));
  return node;
}

function row(label, control) {
  return el('label', { className: 'row' }, [el('span', { textContent: label }), control]);
}

function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.replaceChildren(...options.map((o) => el('option', { value: o.value, textContent: o.label })));
    select.dataset.key = key;
  }
  select.value = value ?? '';
}

// Sets a field unless the user is editing that very field.
function setValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function toggleButton(text, action, on, title) {
  const button = el('button', { textContent: text, title, className: on ? 'on' : '' });
  button.dataset.action = action;
  return button;
}

export function createPanel(root, actions) {
  const status = el('div', { className: 'status', textContent: 'Starting…' });
  const warnings = el('ul', { className: 'warnings' });

  const input = el('select');
  const output = el('select');
  const sourceInput = el('input', { type: 'radio', name: 'source', value: 'input' });
  const sourceFile = el('input', { type: 'radio', name: 'source', value: 'file' });
  const file = el('input', { type: 'file', accept: 'audio/*' });
  const playerSlot = el('div', { className: 'player' });
  const fileRow = el('div', {}, [file, playerSlot]);

  const preset = el('select');
  const deletePreset = el('button', { textContent: 'Delete preset' });
  const width = el('input', { type: 'range', min: 0, max: 2, step: 0.05 });
  const widthValue = el('span', { className: 'value' });

  const list = el('ul', { className: 'speakers' });
  const add = el('button', { textContent: '+ Speaker' });
  const addPair = el('button', { textContent: '+ Pair' });

  const name = el('input', { type: 'text' });
  const channel = el('select');
  const type = el('select');
  const gain = el('input', { type: 'range', min: -30, max: 12, step: 0.5 });
  const gainValue = el('span', { className: 'value' });
  const pair = el('select');
  const coords = [0, 1, 2].map(() => el('input', { type: 'number', step: 1 }));
  const remove = el('button', { textContent: 'Delete speaker' });
  fillSelect(channel, CHANNEL_OPTIONS, 'L');
  fillSelect(type, TYPE_OPTIONS, 'full');

  const speakerForm = el('fieldset', {}, [
    el('legend', { textContent: 'Speaker' }),
    row('Name', name),
    row('Channel', channel),
    row('Type', type),
    row('Level', el('div', { className: 'inline' }, [gain, gainValue])),
    row('Mirror of', pair),
    row('X / Y / Z, cm', el('div', { className: 'coords' }, coords)),
    el('p', { className: 'hint', textContent: 'X right, Y up, Z back, from the default head position.' }),
    remove,
  ]);

  root.replaceChildren(
    status,
    warnings,
    el('fieldset', {}, [
      el('legend', { textContent: 'Audio' }),
      row('Input', input),
      row('Output', output),
      row('Source', el('div', { className: 'inline' }, [
        el('label', {}, [sourceInput, ' Input device']),
        el('label', {}, [sourceFile, ' Test file']),
      ])),
      fileRow,
    ]),
    el('fieldset', {}, [
      el('legend', { textContent: 'Layout' }),
      row('Preset', preset),
      deletePreset,
      row('Width', el('div', { className: 'inline' }, [width, widthValue])),
    ]),
    el('fieldset', {}, [
      el('legend', { textContent: 'Speakers' }),
      list,
      el('div', { className: 'inline' }, [add, addPair]),
    ]),
    speakerForm,
  );

  input.onchange = () => actions.selectInput(input.value);
  output.onchange = () => actions.selectOutput(output.value);
  for (const radio of [sourceInput, sourceFile]) radio.onchange = () => actions.setSource(radio.value);
  file.onchange = () => {
    if (file.files[0]) actions.pickFile(file.files[0]);
  };
  preset.onchange = () => actions.selectPreset(preset.value);
  deletePreset.onclick = () => actions.deleteCurrentPreset();
  width.oninput = () => actions.setWidth(Number(width.value));
  add.onclick = () => actions.addSpeaker();
  addPair.onclick = () => actions.addPair();
  list.onclick = (event) => {
    const item = event.target.closest('li[data-id]');
    if (!item) return;
    const { id } = item.dataset;
    const what = event.target.dataset.action;
    if (what === 'solo') actions.toggleSolo(id);
    else if (what === 'mute') actions.toggleMute(id);
    else actions.selectSpeaker(id);
  };
  name.onchange = () => actions.updateSelected({ name: name.value });
  channel.onchange = () => actions.updateSelected({ channel: channel.value });
  type.onchange = () => actions.updateSelected({ type: type.value });
  gain.oninput = () => actions.updateSelected({ gainDb: Number(gain.value) });
  pair.onchange = () => actions.setPair(pair.value || null);
  for (const coord of coords) {
    coord.onchange = () => actions.updateSelected({ position: coords.map((c) => Number(c.value) / 100) });
  }
  remove.onclick = () => actions.deleteSelected();

  function speakerItem(s, view) {
    const item = el('li', { className: s.id === view.selectedId ? 'selected' : '' }, [
      el('span', { className: `dot ${s.channel}` }),
      el('span', { textContent: s.name }),
      el('span', { className: 'badge', textContent: TYPE_BADGE[s.type] }),
      toggleButton('S', 'solo', view.solo === s.id, 'Solo'),
      toggleButton('M', 'mute', view.muted.has(s.id), 'Mute'),
    ]);
    item.dataset.id = s.id;
    return item;
  }

  function update(view) {
    warnings.replaceChildren(...view.warnings.map((text) => el('li', { textContent: text })));
    fillSelect(input, view.inputs.map((d) => ({ value: d.deviceId, label: d.label || 'Unnamed input' })), view.inputId);
    fillSelect(output, view.outputs.map((d) => ({ value: d.deviceId, label: d.label || 'Unnamed output' })), view.outputId);
    sourceInput.checked = view.source === 'input';
    sourceFile.checked = view.source === 'file';
    fileRow.hidden = view.source !== 'file';
    if (playerSlot.firstChild !== view.player) playerSlot.replaceChildren(...(view.player ? [view.player] : []));

    fillSelect(preset, view.presets, view.preset);
    deletePreset.disabled = !view.canDelete;
    setValue(width, view.width);
    widthValue.textContent = view.width.toFixed(2);

    list.replaceChildren(...view.speakers.map((s) => speakerItem(s, view)));
    add.disabled = view.speakers.length >= view.maxSpeakers;
    addPair.disabled = view.speakers.length + 2 > view.maxSpeakers;

    const s = view.selected;
    speakerForm.hidden = !s;
    if (!s) return;
    setValue(name, s.name);
    channel.value = s.channel;
    type.value = s.type;
    setValue(gain, s.gainDb);
    gainValue.textContent = `${s.gainDb.toFixed(1)} dB`;
    fillSelect(pair, [
      { value: '', label: 'None' },
      ...view.speakers.filter((o) => o.id !== s.id).map((o) => ({ value: o.id, label: o.name })),
    ], s.pair ?? '');
    coords.forEach((c, i) => setValue(c, Math.round(s.position[i] * 100)));
  }

  return {
    update,
    setStatus(text) {
      status.textContent = text;
    },
  };
}
```

- [x] **Step 5: Rewrite `app/src/renderer/index.html` and create `style.css`**

`index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Trucker AUX</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <aside id="panel"></aside>
  <main id="editor"><p class="placeholder">Top, side and 3D views arrive in the next milestone (E2).</p></main>
  <script type="module" src="app.js"></script>
</body>
</html>
```

`style.css`:

```css
:root {
  --left: #2f6fde;
  --right: #d9463b;
  --mono: #2f9e5a;
  --dim: #8a8a8a;
  color-scheme: light dark;
  font: 13px system-ui, sans-serif;
}
body { margin: 0; display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
#panel { overflow-y: auto; padding: 8px; border-right: 1px solid #8884; }
#editor { display: grid; place-items: center; color: var(--dim); }
fieldset { margin: 0 0 8px; }
.status { font-weight: 600; margin-bottom: 6px; }
.warnings { margin: 0 0 6px; padding-left: 18px; color: #c46900; }
.row { display: grid; grid-template-columns: 96px 1fr; gap: 6px; align-items: center; margin: 4px 0; }
.inline { display: flex; gap: 8px; align-items: center; }
.inline input[type=range] { flex: 1; }
.value { min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
select, input[type=text] { width: 100%; box-sizing: border-box; }
.coords { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.coords input { width: 100%; box-sizing: border-box; }
.hint { color: var(--dim); font-size: 11px; margin: 2px 0 6px; }
.player audio { width: 100%; }
.speakers { list-style: none; margin: 0 0 6px; padding: 0; }
.speakers li { display: grid; grid-template-columns: 12px 1fr auto auto auto; gap: 6px; align-items: center; padding: 3px 4px; border-radius: 4px; cursor: pointer; }
.speakers li.selected { background: #8883; }
.speakers button { min-width: 26px; }
.speakers button.on { background: #e9b20b; color: #000; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot.L { background: var(--left); }
.dot.R { background: var(--right); }
.dot.M { background: var(--mono); }
.badge { color: var(--dim); font-size: 11px; }
```

- [x] **Step 6: Rewrite `app/src/renderer/app.js`**

```js
import { createEngine } from './engine.js';
import { createPanel } from './panel.js';
import { listDevices, openInput, probeOutput } from './audio-io.js';
import {
  MAX_SPEAKERS, addPair, addSpeaker, linkPair, removeSpeaker, setWidth, unlinkPair, updateSpeaker,
} from '../shared/layout.js';
import {
  deletePreset, editLayout, parseSelection, presetOptions, resolvePlaying, selectionValue,
} from '../shared/presets.js';
import { channelsWarning, pickDevice, rateWarning } from '../shared/devices.js';
import { turnsToDeg } from '../shared/pose.js';

const SAVE_DELAY_MS = 500;
const STATUS_PERIOD_MS = 100;

const loaded = await window.aux.load();
const state = {
  store: loaded.store,
  settings: loaded.settings,
  selection: { mode: 'auto' },
  truck: null,
  pose: null,
  selectedId: null,
  solo: null,
  muted: new Set(),
  devices: [],
  inputId: null,
  outputId: null,
  fileUrl: null,
  storeWarnings: loaded.warnings,
  audioWarnings: [],
};
let audio = null; // { ctx, engine, stream, player }

const playing = () => resolvePlaying(state.store, state.selection, state.truck);

function syncEngine() {
  const { layout } = playing();
  const ids = new Set(layout.speakers.map((s) => s.id));
  if (!ids.has(state.selectedId)) state.selectedId = null;
  if (state.solo && !ids.has(state.solo)) {
    state.solo = null;
    audio?.engine.setSolo(null);
  }
  audio?.engine.sync(layout);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const warning = await window.aux.saveLayouts(state.store);
    state.storeWarnings = warning ? [warning] : [];
    render();
  }, SAVE_DELAY_MS);
}

async function saveSettings() {
  const warning = await window.aux.saveSettings(state.settings);
  if (warning) {
    state.storeWarnings = [warning];
    render();
  }
}

// Every change to a layout goes through here: routing (with auto-created truck
// presets), the engine and saving.
function edit(change) {
  state.store = editLayout(state.store, state.selection, state.truck, change);
  syncEngine();
  scheduleSave();
  render();
}

async function stopAudio() {
  if (!audio) return;
  audio.stream?.getTracks().forEach((track) => track.stop());
  audio.player?.pause();
  await audio.ctx.close();
  audio = null;
}

async function startAudio() {
  await stopAudio();
  const warnings = [];
  try {
    state.devices = await listDevices();
  } catch (err) {
    state.devices = [];
    warnings.push(`Cannot list audio devices: ${err.message}`);
  }
  const input = pickDevice(state.devices, 'audioinput', state.settings.input, 'CABLE Output');
  const output = pickDevice(state.devices, 'audiooutput', state.settings.output, null);
  warnings.push(...[input.warning, output.warning].filter(Boolean));
  state.inputId = input.device?.deviceId ?? null;
  state.outputId = output.device?.deviceId ?? null;
  const sinkId = !state.outputId || state.outputId === 'default' ? '' : state.outputId;

  let stream = null;
  let rate;
  if (state.settings.source === 'input') {
    if (!state.inputId) {
      warnings.push('No input device found.');
    } else {
      try {
        ({ stream, rate } = await openInput(state.inputId));
      } catch (err) {
        warnings.push(`Cannot open the input: ${err.message}`);
      }
    }
  }
  try {
    const out = await probeOutput(sinkId);
    warnings.push(...[rateWarning(rate, out.rate), channelsWarning(out.channels)].filter(Boolean));
    rate ??= out.rate;
  } catch (err) {
    warnings.push(`Cannot open the output: ${err.message}`);
  }

  // The graph runs at the input's rate, so the cable is not resampled on the way in.
  const ctx = new AudioContext({ sampleRate: rate, sinkId });
  const engine = createEngine(ctx);
  let player = null;
  if (stream) ctx.createMediaStreamSource(stream).connect(engine.input);
  if (state.settings.source === 'file') {
    player = new Audio();
    player.controls = true;
    player.loop = true;
    if (state.fileUrl) player.src = state.fileUrl;
    ctx.createMediaElementSource(player).connect(engine.input);
  }
  audio = { ctx, engine, stream, player };
  syncEngine();
  engine.setSolo(state.solo);
  for (const id of state.muted) engine.setMuted(id, true);
  engine.setPose(state.pose);
  state.audioWarnings = warnings;
  render();
}

let audioTask = Promise.resolve();
function restartAudio() {
  audioTask = audioTask.then(startAudio).catch((err) => {
    state.audioWarnings = [`Audio failed: ${err.message}`];
    render();
  });
}

const deviceRef = (id) => {
  const device = state.devices.find((d) => d.deviceId === id);
  return device ? { id, label: device.label } : null;
};

const actions = {
  selectInput(id) {
    state.settings = { ...state.settings, input: deviceRef(id) };
    saveSettings();
    restartAudio();
  },
  selectOutput(id) {
    state.settings = { ...state.settings, output: deviceRef(id) };
    saveSettings();
    restartAudio();
  },
  setSource(source) {
    state.settings = { ...state.settings, source };
    saveSettings();
    restartAudio();
  },
  pickFile(file) {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = URL.createObjectURL(file);
    if (audio?.player) {
      audio.player.src = state.fileUrl;
      audio.player.play();
    }
  },
  selectPreset(value) {
    state.selection = parseSelection(value);
    syncEngine();
    render();
  },
  deleteCurrentPreset() {
    const current = playing();
    if (current.kind !== 'truck') return;
    if (!confirm(`Delete the preset "${current.layout.name}"? This truck will use the default layout.`)) return;
    state.store = deletePreset(state.store, current.key);
    state.selection = { mode: 'auto' };
    syncEngine();
    scheduleSave();
    render();
  },
  setWidth(width) {
    edit((layout) => setWidth(layout, width));
  },
  addSpeaker() {
    edit((layout) => {
      const result = addSpeaker(layout);
      if (result.id) state.selectedId = result.id;
      return result.layout;
    });
  },
  addPair() {
    edit((layout) => {
      const result = addPair(layout);
      if (result.ids.length) state.selectedId = result.ids[0];
      return result.layout;
    });
  },
  selectSpeaker(id) {
    state.selectedId = id;
    render();
  },
  toggleSolo(id) {
    state.solo = state.solo === id ? null : id;
    audio?.engine.setSolo(state.solo);
    render();
  },
  toggleMute(id) {
    const on = !state.muted.has(id);
    if (on) state.muted.add(id);
    else state.muted.delete(id);
    audio?.engine.setMuted(id, on);
    render();
  },
  updateSelected(patch) {
    const id = state.selectedId;
    if (id) edit((layout) => updateSpeaker(layout, id, patch));
  },
  setPair(otherId) {
    const id = state.selectedId;
    if (id) edit((layout) => (otherId ? linkPair(layout, id, otherId) : unlinkPair(layout, id)));
  },
  deleteSelected() {
    const id = state.selectedId;
    if (!id) return;
    state.selectedId = null;
    state.muted.delete(id);
    edit((layout) => removeSpeaker(layout, id));
  },
};

const panel = createPanel(document.getElementById('panel'), actions);

function render() {
  const current = playing();
  const { layout } = current;
  panel.update({
    warnings: [...state.storeWarnings, ...state.audioWarnings],
    inputs: state.devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    outputs: state.devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications'),
    inputId: state.inputId,
    outputId: state.outputId,
    source: state.settings.source,
    player: audio?.player ?? null,
    presets: presetOptions(state.store, state.truck),
    preset: selectionValue(state.selection),
    canDelete: current.kind === 'truck',
    width: layout.width,
    speakers: layout.speakers,
    maxSpeakers: MAX_SPEAKERS,
    selectedId: state.selectedId,
    selected: layout.speakers.find((s) => s.id === state.selectedId) ?? null,
    solo: state.solo,
    muted: state.muted,
  });
}

function statusText() {
  const pose = state.pose;
  if (!pose || !pose.sdkActive) return 'Game not running';
  const name = state.truck?.name ?? 'Unknown truck';
  if (pose.paused) return `${name} · paused`;
  return `${name} · yaw ${turnsToDeg(pose.head.heading).toFixed(0)}° · pitch ${turnsToDeg(pose.head.pitch).toFixed(0)}°`;
}

let lastStatus = 0;
window.aux.onPose((pose) => {
  state.pose = pose;
  audio?.engine.setPose(pose);
  const truck = pose && pose.sdkActive ? pose.truck : null;
  if ((truck?.key ?? null) !== (state.truck?.key ?? null)) {
    state.truck = truck;
    syncEngine();
    render();
  }
  const now = performance.now();
  if (now - lastStatus >= STATUS_PERIOD_MS) {
    lastStatus = now;
    panel.setStatus(statusText());
  }
});

navigator.mediaDevices.addEventListener('devicechange', async () => {
  const active = [state.inputId, state.outputId];
  state.devices = await listDevices();
  const present = new Set(state.devices.map((d) => d.deviceId));
  if (active.some((id) => id && !present.has(id))) restartAudio();
  else render();
});

render();
restartAudio();
```

- [x] **Step 7: Syntax check and unit tests**

Run: `cd app && node --check src/main/main.js && node --check src/renderer/app.js && node --check src/renderer/panel.js && node --check src/renderer/audio-io.js && npm test`
Expected: no syntax errors, `fail 0`.

- [x] **Step 8: Smoke test through the debugging port (the user's instance closed)**

Start `electron . --remote-debugging-port=9224` from `app/`, then evaluate in the page:
- `document.querySelector('.status').textContent` — `Game not running` or a truck name;
- `document.querySelectorAll('.speakers li').length` — 2 (default layout);
- click `+ Speaker` (`[...document.querySelectorAll('button')].find(b => b.textContent === '+ Speaker').click()`), wait 1 s;
- `app/data/layouts.json` exists and contains three speakers in `default` (no game) — or in the current truck's preset when the game runs.
No uncaught errors in the Electron log. Close the instance afterwards.

- [ ] **Step 9: Manual checklist for the user**

1. Input shows `CABLE Output`, Output shows the headphones; no warnings with the current setup.
2. Music through the cable plays from two door speakers; the right door sounds farther.
3. In a truck, `Preset` shows `Auto — <truck> (default layout)`; moving `Width` creates the truck preset (the label loses "(default layout)"), and `layouts.json` gets a `trucks` entry.
4. `+ Pair`, channel / type / level changes, `S` and `M` are audible immediately, without clicks.
5. Switching `Output` to another device and back works; a warning appears when the rates differ.

- [x] **Step 10: Show the user the changed files**

---

### Task 10: English guard and final checks

**Files:**
- Create: `app/test/english.test.js`

**Interfaces:**
- Consumes: the repository files.
- Produces: a unit test that fails if Cyrillic text appears in project files.

- [x] **Step 1: Write the guard test `app/test/english.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project is English everywhere (UI, comments, docs).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TARGETS = ['PLAN.md', 'docs', 'tools', 'app/src', 'app/test', 'app/scripts'];
const SKIP_DIRS = new Set(['node_modules', 'data', '__pycache__']);
const EXTENSIONS = new Set(['.md', '.js', '.cjs', '.mjs', '.py', '.html', '.css', '.json']);
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`); // no literal Cyrillic in this file

function* files(target) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isFile()) {
    yield full;
    return;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    yield* files(path.join(target, entry.name));
  }
}

test('no Cyrillic text in project files', () => {
  const offenders = [];
  for (const target of TARGETS) {
    for (const file of files(target)) {
      if (!EXTENSIONS.has(path.extname(file))) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (CYRILLIC.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
```

- [x] **Step 2: Run all tests; fix any Cyrillic the guard finds**

Run: `cd app && npm test`
Expected: `fail 0`. If the guard lists files, translate those lines and rerun.

- [x] **Step 3: Run the engine check once more**

Run: `cd app && npm run test:engine`
Expected: 8 `PASS`, exit code 0.

- [x] **Step 4: Update `PLAN.md`**

Mark E1 done (`### E1 — speaker editor foundation ✓`) with a one-line summary, keep E2 next.

- [x] **Step 5: Show the user the changed files and the manual checklist from Task 9**
