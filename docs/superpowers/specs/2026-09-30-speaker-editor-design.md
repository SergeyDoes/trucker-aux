# Speaker Layout Editor — Design

Date: 2026-09-30. Status: approved in chat section by section; the user delegated the rest ("do it yourself").

## Context

Trucker AUX is an Electron app. A music player writes to a virtual cable (VB-Cable `CABLE Input`); the app captures `CABLE Output`, renders it binaurally through virtual speakers with HRTF, and turns the listener with the driver's head from ATS/ETS2 (`Local\SCSTelemetry`, written by the RenCloud `scs-telemetry.dll`). The E0 spike proved the chain: pose from shared memory, a two-speaker HRTF graph, no clicks once the whole chain runs at one sample rate and the headphones are plain stereo (`docs/findings.md`).

Today the speakers are two hard-coded points (`app/src/shared/layout.js`, `DEFAULT_SPEAKERS`). This design turns them into editable layouts with per-truck presets, adds device selection, and switches the project to English.

## Goals

1. Any number of speakers per layout; each has a position, channel (L / R / mono), level, type (full range / small full range / tweeter / midrange / midbass / subwoofer), optional mirrored partner, and session-only solo / mute (cleared when the truck or the chosen preset changes: speaker ids repeat across presets).
2. A default layout plus per-truck presets. The playing layout follows the current truck automatically and falls back to the default; the first edit in a truck without a preset creates one.
3. Graphical editing in 2D top and side views (SVG), plus a read-only 3D overview (three.js).
4. Input and output device selection with warnings about sample-rate mismatch and virtual surround.
5. All data in the application folder.
6. English everywhere in the project (UI, code comments, docs). Chat with the user stays in Russian.

## Non-goals

- Custom HRTF (SOFA files), per-speaker EQ beyond one filter, editing in the 3D view, cab models from game files, built-in browser or any sign-in.

## Data and storage

**Data folder.**
- Development (`app.isPackaged === false`): `app/data/`.
- Packaged: `data/` next to the executable (`PORTABLE_EXECUTABLE_DIR` for electron-builder portable builds, otherwise the folder of `process.execPath`).
- Contents:
  - `layouts.json` — layouts;
  - `settings.json` — devices, source and when to mute;
  - `profile/` — Chromium user data, set via `app.setPath('userData', …)` before `ready`, so nothing is written to `%APPDATA%`.
- `profile/` is git-ignored; `layouts.json` and `settings.json` may be committed.

**`layouts.json`**
```jsonc
{
  "version": 2,                            // 1: X measured from the driver's head
  "default": Layout,
  "trucks": { "<truck key>": Layout }
}
```
```jsonc
Layout = {
  "name": "International 9900i",           // display name
  "width": 1.0,                            // M/S stereo width, 0..2
  "bounds": { "min": [x, y, z], "max": [x, y, z] },  // metres from the zero point; symmetric in X (older files: "field", "cabin")
  "speakers": [Speaker]
}
Speaker = {
  "id": "s1",                              // unique within the layout
  "name": "Door L",
  "position": [x, y, z],                   // metres, SCS axes: X right, Y up, Z back
  "channel": "L",                          // "L" | "R" | "M" (mono, (L+R)/2)
  "gainDb": 0,
  "type": "full",                          // "full" | "small" | "tweeter" | "mid" | "midbass" | "sub"
  "pair": "s2"                             // id of the mirrored partner, or null
}
```

**Coordinates.** The zero point is on the truck's axis, at the driver's default eye level and seat line: X is measured from the cab's centre line, Y and Z from the default head position (`head.position`). The game's own cabin origin (`cabinPosition`) is not used for Y and Z: it read the same for a truck and a car, and in the car it was 1.9 m above the head. One layout therefore fits every truck, and mirrored pairs are mirror images about X = 0.

The driver's head sits at X = `−truck.centerX` (`headRestX`): −47.7 cm in the International 9900i, −45.9 cm in a Ford F150 2023, −38.5 cm in a Ford Mustang 1967, −40 cm without the game. `head.offset` (looking around, and the seat setting, up to 10 cm each way, checked in the F150) moves the listener from there; the zero point and the speakers stay.

**Default layout** (a cab 2.3 m wide):
- bounds: min `[-1.15, -1.15, -1.30]`, max `[1.15, 0.95, 0.60]`;
- "Door L": `[-1.12, -0.60, -0.35]`, channel L, full range;
- "Door R": its mirror image, `[1.12, -0.60, -0.35]`, channel R, paired with Door L.

The right door is farther from the driver, as in a real cab, so it sounds quieter and narrower.

**Normalization on load.**
- Missing fields get defaults.
- Unknown `channel` falls back to `"L"`, unknown `type` to `"full"`.
- Coordinates are clamped to ±5 m, `gainDb` to −60…+12, `width` to 0…2.
- At most 16 speakers per layout.
- Duplicate ids are renumbered.
- A `pair` pointing to a missing speaker becomes `null`; pairs are made symmetric.
- Bounds with `min > max` on any axis are swapped.
- A file older than version 2 is converted: every layout is shifted sideways so the centre of its bounds (the old mirror line) is X = 0. The original is kept once as `layouts.v1.json`.

**Truck key.** `truckId` from shared memory (`config_s.truckId` @2428, 64 bytes); if empty, `truckBrandId` @2300 + `/` + `truckName`. Display name: `truckBrand` + `truckName`.

**Chassis and truck.** Chassis variants of one model (a day cab and a sleeper sit on different chassis) share the truck id and the head position; the game reports neither the cab nor the chassis. The fifth wheel sits further back on a longer chassis (9900i: 2.118 vs 3.184 m, `config_fv.truckHookPositionZ` @1672), so `truck.variant` is that position to 10 cm ("2.1"), or null when none is reported. Some chassis share a fifth-wheel position (the LoneStar with a lift axle, medium and long); for them a preset can be bound to the truck itself. `truck.plate` (`config_s.truckLicensePlate` @3212, trimmed) names a truck you own; a quick-job truck (`config_s.jobMarket` @3404 = "quick_job", `truck.quickJob`) gets a random plate.

**Scopes.** Preset keys: `<truck key>#<plate>` (this truck), `<truck key>@<variant>` (this chassis, `variantKey`), `<truck key>` (the model, all its chassis), `custom.N` (made by hand). `assignments` binds a plate key or a chassis key to any preset.

**Writing.**
- Debounced 500 ms after the last edit.
- Atomic: write `*.tmp`, then rename.
- A file that fails to parse is renamed to `layouts.json.broken-<timestamp>`, and the app starts with defaults and a warning.
- If the folder is not writable, edits stay in memory and a warning says `Cannot save to <path>`.

**`settings.json`**
```jsonc
{ "version": 1, "source": "input", "input": { "id": "...", "label": "..." }, "output": { "id": "...", "label": "..." }, "muteWhen": "never", "pauseBehavior": "vehicle", "matchLoudness": true, "turnLook": { "on": false, "percent": 100, "reverse": "off", "blinkers": false } }
```
`source` is `"input"` or `"file"`; `input` / `output` may be `null` (system default). `muteWhen` is `"never"`, `"engine"` or `"electric"`: mute the music, like a car radio, while the game reports the engine (`truck_b.engineEnabled` @1576) or the electrics (`truck_b.electricEnabled` @1575) off. Without the game, before a truck is loaded, and outside the game world the music plays as usual (`musicSilenced(pose, mode, inWorld, pauseBehavior)`, unit-tested). Outside the world means `renderTime` (@24) unchanged for 1 s (`createFrameWatch`): the main menu, loading or a hung game, where the plugin still keeps the last truck's flags; the pause menu still has frames. `pauseBehavior` says what the music does there, while the game is paused in the world: `"active"` plays, `"muted"` mutes, `"vehicle"` (default) goes by `muteWhen` as when driving. `matchLoudness` (default `true`) turns on loudness matching across presets. `turnLook` repeats the game's Accessibility options "look into turns" and "look toward the blinker" (below), set by the user as in the game: `on` (default `false`), `percent` (0..200, default 100; 100 % = 45° at full lock), `reverse`: `"off"` (default), `"on"` or `"inverted"`, the game's option for the reverse gear; `blinkers` (default `false`). The app does not read the game's config files. The first version saved `degrees` at full lock instead of `percent` (read as `degrees / 45`), and `reverse: true` reads as `"on"`.

## Audio engine

```
input (stereo) → M/S width ─┬─ L' ─┐
                            ├─ R' ─┤   per speaker: source (L'/R'/M') → type filter → level → HRTF panner
                            └─ M' ─┘   all speakers → master → gate (parked truck) → output
```

- `M' = (L' + R') / 2`.
- Filters: every band edge is a 4th-order Linkwitz-Riley filter (two 2nd-order Butterworth biquads), so bands sharing an edge sum flat. `BiquadFilterNode` lowpass / highpass take Q in dB: Butterworth is −3.01 dB.
  - `small` (small full range) — highpass 120 Hz, meeting the sub;
  - `tweeter` — highpass 2500 Hz;
  - `mid` — highpass 500 Hz, lowpass 2500 Hz;
  - `midbass` — highpass 60 Hz, lowpass 500 Hz (keeps the low end, since a layout may have no sub);
  - `sub` — lowpass 120 Hz;
  - `full` — no filter.
- Level: `dB → linear × (muted ? 0 : 1) × (solo && solo !== id ? 0 : 1)`.
- Panner: HRTF, `inverse` distance model, ref distance 0.5 m, rolloff 1. Master makeup gain stays 1.7.
- **Loudness matching** (setting "Match loudness across presets"): more speakers play louder, so the master gets a trim that brings every preset to the loudness of the default two doors. The loudness is measured, not modelled: `measureLoudness` renders 0.5 s of pink noise through the engine offline (speakers at 0 dB, head at rest) and takes the K-weighted power (ITU-R BS.1770, as in LUFS). A formula on speaker count, band and distance was tried first and missed by 1.9 dB, because the HRTF makes side and rear sources louder than front ones. The trim is measured 250 ms after the layout stops changing, is at most +6 dB, and speaker levels still apply on top. Four doors measure 5.3 dB louder than two; after the trim they match within 0.1 dB (and within 0.5 dB with white noise).
- Listener: pose from telemetry. The game's "look into turns" (Accessibility) turns the camera with the steering, even standing still, but `head.offset` does not include it (a 90 s drive: heading 0.0° throughout with the steering at ±1, `docs/findings.md`). Neither does "look toward the blinker". The app adds both to the heading itself (`turnLook`, `withTurnLook`, pose.js), as the game does them with the options set in `turnLook` (`docs/findings.md`):
  - into turns: `gameSteer × 45° × percent` (`gameSteer` @972, −1..1, positive = left, is what the wheels get, so it follows the game's own steering smoothing); in reverse gear (`truck_i.gear` @504 < 0) nothing, the same turn, or the turn the other way, by `reverse`;
  - a blinker lever on (`truck_b.blinkerLeftActive` @1578, `blinkerRightActive` @1579): at least 30° left or 45° right, whatever the percent; the same in reverse, even inverted (the game does that too); both at once (hazard lights) nothing;
  - the blinker's step is eased in (`createEase`, time constant 0.25 s), the steering part is not;
  - off while paused.
  - The views, the 3D view and the status line show the same heading ("yaw 19° (turn look 19°)").

**API.**
- `createEngine(ctx)`.
- `sync(layout)`: idempotent; the app calls it with the playing layout after every change.
  - Positions, levels and width glide (`setTargetAtTime`, 20 ms).
  - A speaker that was added fades in; one that was removed, or changed channel or type, fades out and is rebuilt. A preset switch is therefore a per-speaker cross-fade, without clicks.
- `setSolo(id | null)`, `setMuted(id, bool)`.
- `setPose(pose)`.
- `setSilent(bool)`: fades all music out or back in (time constant 0.1 s, −60 dB in ~0.7 s).
- `setTrim(gain)`: the loudness-matching gain on the master. `createEngine(ctx, output)` can feed a meter instead of the speakers.

The Web-Audio-free logic is pure and unit-tested:
- `filtersFor(type)` (list of biquads) and `bandText(type)` (for the type list);
- `speakerGain(speaker, solo, mutedIds)`;
- `widthGains(width)`.

## Presets

- **Selection:** `{ mode: "auto" }` | `{ mode: "default" }` | `{ mode: "truck", key }`. Not persisted; every start is `auto`.
- **Playing layout** (`resolvePlaying`):
  - `auto` (`autoPreset`) — the narrowest that exists: a preset bound to this truck, this truck's own, a preset bound to this chassis, this chassis's own, the model's, another chassis's of the model, else the default. The Auto entry says which: "(this truck)", "(assigned)", "(all chassis)", "(other chassis)" or "(default layout)";
  - `default` — the default;
  - `truck` — that preset.

  What you edit is what you hear.
- **Edit routing** (`routeEdit` returns the store to write and the target):

| Selection | Situation | Target |
|---|---|---|
| auto | a preset for this truck or this chassis plays (own or bound), or the model's on a model without chassis variants | that preset |
| auto | the model's preset (all chassis), another chassis's or the default plays | new preset for this chassis = copy of what plays ("International 9900i, hook 3.2 m") |
| auto | no game / no truck | the default |
| default | — | the default |
| truck | — | that preset |

- **The list** (`presetOptions`): Auto, Default layout, then the models by name. A model with one preset is one entry; with several it is a group: "All chassis", each chassis ("Hook 2.1 m"; a renamed one "Sleeper (hook 3.2 m)"), each single vehicle ("Vehicle WP-83695"). Generated names are known by their ending, so a renamed model keeps the short entries. Presets made with "New preset" are grouped under Custom. A closed list hides the group, so the selected entry of a group reads in full ("Kenworth T680 2014 · hook 2.7 m").
- **The vehicle card** (`truckStatus`), under the preset list: **Vehicle** (model · chassis · plate), **Plays** (the preset), **Applies to** (its scope: "only this vehicle (WP-83695)", "all Kenworth T680 2014 on this chassis", "all chassis of …", "another chassis of …", "every vehicle without its own preset"; "…, chosen by hand" for a binding), a note when editing would first make a copy, and buttons:
  - something wider plays: "Own preset for this chassis" (a copy, `ownPreset(…, 'chassis')`) and "Only this vehicle" (a copy for the plate);
  - this chassis's or the model's own preset plays: "Only this vehicle";
  - a preset for this vehicle plays: "Unbind" (deletes that copy after a confirmation, or forgets a binding);
  - a preset picked in the list: "Use it in: this vehicle only / all … on this chassis" (`bindPreset`), back to Auto.
  On a quick-job truck the plate buttons are left out, and the note says why. The UI says "vehicle" (DLCs add cars); the code and the data keep `truck`.
- **Bindings** (`bindPreset`, `unbind`) are stored in `layouts.json` as `assignments: { "<plate or chassis key>": "<preset key>" }`. Deleting a preset drops its bindings; loading drops bindings to missing presets. Changing the plate, the chassis or the model counts as another truck (solo, mute and the selection reset).
- **New preset:** copies the playing layout into a preset with the key `custom.N` (stored with the truck presets), named "<source> copy" ("copy 2"…), and selects it. Auto never picks it, since game truck ids are `vehicle.*`; it is chosen in the list. Good for trying things without touching a truck's preset.
- **Name:** the selected preset can be renamed in the panel; the default layout keeps its name.
- **Delete:** truck and custom presets, with a confirmation. `auto` then falls back to the default.
- **Truck changes while in `auto`:** `setLayout` with the new playing layout.

## Devices

- **Input list:** all audio inputs. Default: the first whose label contains `CABLE Output`, otherwise the system default.
- **Output list:** all audio outputs. Default: the system default.
- **Matching a saved device:** by id, then by label, then the default with a warning (`Saved input "…" not found — using …`).
- **Context sample rate = input track sample rate.** The context is recreated when it changes. Output via `AudioContext.setSinkId(id)`.
- **Warnings:**
  - output sample rate ≠ input (`Sample rates differ (48000 vs 44100 Hz) — clicks are likely`), measured with a probe context on the chosen sink;
  - output with more than 2 channels (`Output has N channels. Fine for headphones if virtual surround (DTS Headphone:X, Windows Sonic, Dolby Atmos) is off; check that it is.`): some headsets open as 7.1 with virtual surround off too (`docs/findings.md`).
- **`devicechange`:** refresh the lists; if the active device disappeared, warn and fall back to the default.

## Editor UI

Window 1280×800, resizable, English strings.

```
┌ Trucker AUX ─────────────────────────────────────────────────────────────┐
│ Status: International 9900i · yaw +12°   │ Top view          │ 3D view   │
│ Input  [CABLE Output ▾] Output [Default ▾]│ (SVG)             │ (three.js)│
│ Source ◉ Input ○ Test file                │                   │           │
│ Preset [Auto — International 9900i ▾] [🗑]│                   ├───────────┤
│ Width ━━●━━ 1.00                          │ Side view (left)  │ Bounds, cm│
│ Speakers                        [+][+pair]│ (SVG)             │ W H D     │
│  ● Door L    S M                          │                   │ offset    │
│ Door L: channel [L▾] type [Full▾]         │                   │           │
│  level ━━●━ −3 dB  pair ⛓  X Y Z (cm) [×] │                   │           │
│ ⚠ warnings                                │                   │           │
└──────────────────────────────────────────┴───────────────────┴───────────┘
```

**Panel:**
- status (truck, yaw / pitch, or `Game not running`);
- device lists, source, "Mute when", "Pause behavior" (Always active / Always muted / Active vehicle); a "Game camera" fieldset set as in the game: Into turns [x] [100] %, In reverse [Off / On / Inverted], Blinkers [x] Look toward them; preset selector with a delete button, stereo width slider with a hint (0 mono, 1 as recorded, 2 extra wide; mono speakers are not affected);
- speaker list with S (solo) and M (mute);
- selected speaker properties: name, channel, type, level, pair link / unlink, X / Y / Z in cm (editable), delete;
- warnings.

**Top view (SVG).** X to the right, forward (−Z) up.
**Side view (SVG).** Seen from the left, the driver's side: forward to the left, up (+Y) up.

Both views:
- grid 10 cm, stronger lines every 50 cm;
- the bounds rectangle, the zero point marked "0", and in the top view the truck's axis (X = 0) as a dashed line;
- current head position (from telemetry) with a gaze arrow;
- speakers: colour by channel (L blue, R red, M green), grey while silent (muted, or another speaker soloed; `isSilenced`, also in the list and the 3D view), shape by type (diamond tweeter, triangle midrange, circle full range, smaller circle small full range, hexagon midbass, square sub; the speaker list shows the same glyphs), name labels with a background-coloured halo; speakers on one spot share a label;
- orientation: a Front / Up / Right arrow marker in the bottom-left corner, and wall names (Left, Right, Bottom, Top, Front, Back, as in the Bounds panel) outside the bounds at the middle of each wall.

**Interactions.**
- Drag a speaker: top view changes X/Z, side view changes Z/Y, snapped to 1 cm. A mirrored partner follows (X mirrored about X = 0, Y/Z equal).
- Drag the walls of the bounds to resize them; the side walls move together, symmetric about X = 0. The Bounds panel has Width, Bottom, Top, Front, Back and shows where the driver's head is; it says the bounds do not change the sound, they only frame the views. In the top view the "Vehicle axis" label sits just inside the front wall, clear of the wall's name.
- The truck's axis comes from the game: `truck.centerX = −(cabinPosition.x + headPosition.x)` (@1640, @1652), the head's offset from the vehicle's centre line. Width, height and depth stay manual: the game does not give them.
- Wheel zooms both views together; `Fit` button.
- Selection (`selection.js`, unit-tested) is shared between the list, both views and the 3D view; it holds several speakers and a primary one (the last clicked):
  - list: click, Ctrl+click toggles, Shift+click selects a range; views: click, Ctrl+click toggles, a box dragged on empty space selects (Ctrl adds); Ctrl+A all, Esc none;
  - dragging a selected speaker moves the whole selection by the same step; arrow keys nudge it by 1 cm (Shift: 10 cm) in the top view's plane; Delete removes it;
  - mirrored pairs stay mirrored: when both halves are selected, the grabbed (or primary) one moves and the other mirrors it;
  - the form edits the whole selection: channel and type are set for all ("Mixed" when they differ), the level slider moves every level by the same step, a coordinate sets that coordinate for all ("mixed" when it differs); name and mirror link need a single speaker.
- Copy / paste (Ctrl+C / Ctrl+V, also into another preset) and duplicate (Ctrl+D): copies get new ids, a name already taken gets " copy" (" copy 2"…), a pair link is kept only when both halves are copied; where the copies would land on existing speakers they go 10 cm further back. Nothing is pasted beyond 16 speakers.

**3D view (three.js, read-only).** Translucent bounds box with edges, head sphere with a gaze cone from telemetry, speakers coloured by channel and shaped by type as in 2D (octahedron, triangular pyramid, sphere, smaller sphere, hexagonal prism, cube) with the selected ones highlighted, a Front / Up / Right marker that turns with the camera; OrbitControls for rotate / zoom. three.js is loaded from `node_modules` through an import map.

**Adding.**
- `+` adds a mono full-range speaker in front of the head.
- `+ pair` adds a linked L/R pair at the sides of the bounds.

## Errors

Shown as a warning bar in the panel; the app never crashes on them:
- broken `layouts.json` or `settings.json`;
- data folder not writable;
- device missing or failing to open;
- sample-rate mismatch;
- virtual surround on the output;
- game not running (status only, not a warning).

## Testing

- **Unit (`node --test`):**
  - layout normalization and defaults;
  - mirror math;
  - snap and nudge;
  - `resolvePlaying` and every row of the edit-routing table;
  - `filtersFor`, `bandText`, `speakerGain`, `widthGains`;
  - view transforms (metres ↔ pixels for both views, zoom);
  - device matching;
  - store read / write, atomic write, broken-file handling (temporary folders);
  - data-folder resolution;
  - telemetry parsing of the truck key, plate, steering and gear;
  - `musicSilenced` (including the pause behaviours); `turnLook` (paused, the percent, reverse off / on / inverted, blinkers, hazard lights), `createEase`, `withTurnLook`.
- **Engine test (`npm run test:engine`):** Electron runs an `OfflineAudioContext` in a hidden window and exits 0 / 1:
  - L / R separation and head rotation in dB;
  - small full range / tweeter / midrange / midbass / sub filtering;
  - midrange + tweeter and small full range + sub on one spot sum flat at their shared edge;
  - the parked-truck gate fades out and back in;
  - layout switch produces no NaN or silence.
- **Manual checklist:** dragging, mirrored pairs, auto-created preset on a truck change, device switching, listening in the game.

## Delivery

Two implementation plans; each leaves a working app.

1. **Foundation:**
   - English translation of existing docs and code;
   - data folder and store;
   - telemetry truck key;
   - engine with N speakers;
   - presets logic;
   - devices;
   - panel with speaker list and numeric editing;
   - engine test.
2. **Graphical editor:** SVG top and side views with dragging and cabin editing, three.js 3D overview (asks before `npm install three`).
