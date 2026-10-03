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

- **Layout coordinates** (store version 2): X from the truck's axis, Y and Z from the driver's default head; the head is at X = −truck.centerX.
- **head.offset** (`fplacement`): head offset and rotation from the default position, in cab axes. The SDK notes it changes with cameras and camera presets; the seat setting goes into it too (up to 10 cm each way, checked in the F150; `head.position` does not change), so the 9900i's rest y −5 cm was the seat. Angles are in turns: heading in [0,1), 0.25 = left; pitch in [−0.25, 0.25], up is positive; roll in [−0.5, 0.5]. Heading must be normalized to −180..180: a slight right turn arrives as 0.99. The game's "look into turns" and "look toward the blinker" are not in it (E2.13).
- **R0 (`docs/findings.md`):**
  - the mouse changes heading and pitch, roll is always 0;
  - looking around, the game moves the head by up to 0.8 m;
  - external cameras can't be detected: the value freezes and snaps back to "straight" on return to the cab;
  - pause is visible through its flag; frames keep coming while paused (pause menu);
  - in the main menu frames stop (`renderTime` stands still) while the memory keeps the last truck, its engine and electrics flags (`docs/findings.md`).
- **`third_party/scs-sdk-plugin`** (RenCloud, MIT) builds in VS2022 (`scs-telemetry/vs2012/scs-telemetry.vcxproj`, Release x64; the `.sln` has no x64 configuration, build the project directly). The DLL is in the ATS plugins folder. Shared memory `Local\SCSTelemetry` (32 KB):
  - `sdkActive` @0, `paused` @4, `scs_values.game` @52 (u32: 1 ETS2, 2 ATS);
  - head.offset @2024 (6 floats: x y z heading pitch roll);
  - cabin.offset @2000;
  - `truckBrandId` @2300, `truckBrand` @2364, `truckId` @2428, `truckName` @2492 (64 bytes each);
  - `truck_b.electricEnabled` @1575, `truck_b.engineEnabled` @1576 (bool);
  - `truck_f.gameSteer` @972 (−1..1, positive = left, the steering the wheels get), `truck_i.gear` @504 (< 0 in reverse);
  - `truck_b.blinkerLeftActive` @1578, `blinkerRightActive` @1579 (the lever, not the blinking light), `lightsHazard` @1588;
  - `config_fv.truckHookPositionZ` @1672 (fifth wheel): tells cab variants of one model apart (`docs/findings.md`);
  - the plugin never clears config values: a vehicle that does not report one keeps the previous truck's.
  - `config_fv.cabinPosition` @1640 (cabin joint in vehicle space), `config_fv.headPosition` @1652 (default head position in cabin space), 3 floats each. Their x sum is the head's offset from the vehicle's centre line: measured −0.477 m (International 9900i) and −0.385 m (Ford Mustang 1967). `cabinPosition` read [0, 3, −2] for both, so only the sum is trusted; the sums' y (2.40 m, 1.07 m) look like eye heights above the ground. The game gives no cabin dimensions or floor height.
  - All offsets checked with `offsetof` against the plugin header (MSVC x64).
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
- **`BiquadFilterNode` lowpass / highpass take Q in dB**, not as a plain Q: Butterworth is −3.01 dB (`BUTTERWORTH_Q_DB`). E1 passed 0.7071 (= +0.7 dB), which left a small bump at the tweeter and sub cutoffs; the E2.1 crossover check caught it (+7.5 dB where two bands meet, −0.4 dB after the fix).

## Milestones

### R0 — in-game reconnaissance ✓
`tools/shm_probe.py`; findings in `docs/findings.md`.

### A0 — listening test ✓
Light Host + SPARTA + `tools/shm_to_osc.py`. The idea works.

### E0 — Electron prototype ✓
Plan: `docs/superpowers/plans/2026-09-30-e0-electron-spike.md`. Cable path clean once VB-Cable settings, sample rates and stereo headphones are right (`docs/findings.md`).

### E1 — speaker editor foundation ✓
Spec: `docs/superpowers/specs/2026-09-30-speaker-editor-design.md`. Plan: `docs/superpowers/plans/2026-09-30-e1-editor-foundation.md`. Done: 60 unit tests and 8 engine checks pass; the in-game listening checklist (plan, Task 9 Step 9) is up to the user.
- English everywhere; data folder next to the app; atomic JSON store.
- Layouts with any number of speakers (channel, level, type, mirrored pairs, solo/mute), per-truck presets with automatic switching and a default fallback.
- Input/output device selection with warnings (sample-rate mismatch, virtual surround).
- Engine with N speakers; offline engine check `npm run test:engine`.
- Panel with speaker list and numeric editing.

### E2 — graphical editor ✓
Plan: `docs/superpowers/plans/2026-09-30-e2-graphical-editor.md`. Done: 72 unit tests and 8 engine checks pass; the in-app checklist (plan, Task 4 Step 3) is up to the user.
- SVG top and side views with dragging, mirrored partners and cabin editing; three.js 3D overview (read-only).

### E2.1 — editor follow-ups ✓
Spec sections updated in place (types, filters, orientation). Done: 75 unit tests and 11 engine checks pass.
- Speaker types midrange (500 Hz – 2.5 kHz) and midbass (60 – 500 Hz) between tweeter (from 2.5 kHz) and sub (up to 120 Hz); every crossover edge is Linkwitz-Riley 4th order, so bands sharing an edge sum flat.
- Shapes by type in all views and the speaker list: diamond tweeter, triangle midrange, circle full range, hexagon midbass, square sub.
- Orientation: a Front / Up / Right marker in each 2D view and in the 3D view (turns with the camera); wall names outside the cabin at the middle of each wall, matching the Cabin fields; the side view is seen from the right, so forward points right.
- "Width" renamed "Stereo width" with a hint.

### E2.2 — small full range, parked-truck mute ✓
Done: 77 unit tests and 14 engine checks pass; checked end to end with `tools/fake_shm.py --engine-off`.
- Speaker type "small full range": highpass 120 Hz, meeting the sub (sums flat with it); a smaller circle / sphere.
- Setting "Mute when": never / engine is off / electrics are off (the default since E2.19; a saved choice stays). The music fades out in ~0.7 s and back in; without the game it always plays. The status line shows `muted, engine off`.
- In the pause menu the flags keep the truck's real state and "Mute when" applies. In the main menu the plugin keeps the last truck's flags; see E2.9.

### E2.3 — cabin centred on the truck ✓
Done: 82 unit tests and 14 engine checks pass; checked against the running game (9900i).
- Telemetry gives `truck.centerX`, the truck's centre line relative to the default head (−(cabinPosition.x + headPosition.x)).
- In Auto, a truck without a preset plays the default layout shifted onto its axis (the stored default is unchanged), and the first edit there saves that centred copy as the truck's preset, so nothing jumps.
- "Center on truck" in the Cabin panel shifts the cabin and all speakers sideways onto the axis; the width stays. The top view shows the axis as a dashed line.
- Three or more speakers on one spot share a label "name +N".

### E2.4 — group editing, copy / paste, "field" ✓
Done: 94 unit tests and 14 engine checks pass; checked end to end in the app (solo / mute after a preset switch, Ctrl+A, box select, group drag, duplicate, copy into another preset).
- Fix: solo, mute and the selection are cleared when the truck or the chosen preset changes (speaker ids repeat across presets, so the flags landed on other speakers). The first edit that creates a truck preset keeps them.
- Multi-selection: Ctrl+click, Shift+click (list), a box on empty space (views), Ctrl+A, Esc. The selection moves together (mirrored pairs stay mirrored), and the form edits all of it: channel, type, coordinates; levels move by the same step.
- Copy / paste / duplicate (Ctrl+C / V / D), also between presets.
- "Cabin" is now the "field": a box in coordinates relative to the head, a placement guide and the centre line of mirrored pairs. Walls: Left, Right, Bottom, Top, Front, Back. Stored as `field`; older files with `cabin` still load.

### E2.5 — explicit presets ✓
Done: 95 unit tests pass; checked in the app (create, rename by typing, solo cleared on the switch, delete with confirmation).
- "New preset" copies the playing layout into a custom preset (`custom.N`, not tied to a truck, never picked by Auto) and switches to it; the Name field gets the focus for renaming.
- Any truck or custom preset can be renamed; the default layout keeps its name.

### E2.6 — "bounds" and the zero point ✓
- The box is now called "Bounds" (it was "Field", before that "Cabin"); stored as `bounds`, files with `field` or `cabin` still load.
- No "from the head" in the UI: coordinates and walls start at the zero point, marked "0" in both views; the truck axis reads "X 48 cm".
- Speakers you do not hear (muted, or another one soloed) are grey in both views, the list and the 3D view. 96 unit tests, 14 engine checks.

### E2.7 — coordinates from the truck's axis ✓
Done: 97 unit tests and 15 engine checks pass; checked on a copy of the real `layouts.json` in a sandbox data folder (the user's app was running).
- Zero point: X on the truck's axis, Y and Z at the driver's default head (eye level, seat line). The game's cabin origin is not used for Y/Z: it read [0, 3, −2] for a truck and a car alike.
- The head sits at X = −truck.centerX (−40 cm without the game); head.offset moves the listener from there. Engine, views and 3D take this head X.
- Mirrored pairs are mirror images about X = 0; the bounds are symmetric (one Width); "Center on truck" is gone, as X = 0 is the axis in every truck.
- `layouts.json` version 2. Version 1 files are converted on load (each layout shifted so its old mirror line is X = 0) and the original is kept once as `layouts.v1.json`.
- Checked in the game (F150): the seat setting changes `head.offset` (−10 cm left, −10 cm down, +10 cm back at the end of travel), not `head.position`, so the speakers stay and the listener moves with the seat (`docs/findings.md`).

### E2.8 — loudness matching across presets ✓
Done: 100 unit tests and 17 engine checks pass; checked on a copy of the real presets in a sandbox data folder.
- "Match loudness across presets" (on by default): each preset gets a master trim to the loudness of the default two doors; speaker levels still apply on top. The panel shows the trim ("would be" when off).
- Measured by rendering pink noise through the engine offline with K-weighting (LUFS-like), so count, band, distance and HRTF all count; a formula missed by 1.9 dB. At most +6 dB.
- The user's presets: F-150 −2.6 dB (6 speakers), Mustang −8.0 dB (5 speakers close to the head), 9900i +5.9 dB (only two midranges, so little energy).

### E2.9 — "Mute when" only with a truck in the game world ✓
Done: 102 unit tests pass; checked against ATS in the main menu (status "Game in the menu or loading", no muting with the engine flag 0).
- No muting before a truck is loaded (no truck in the memory).
- No muting outside the game world: memory dumps of cab, pause menu and main menu showed that only frames tell them apart; `renderTime` still for 1 s means the main menu, loading or a hung game. The pause menu keeps "Mute when".
- `tools/fake_shm.py` advances `renderTime`.

### E2.10 — cab variants of one truck ✓
Done: 108 unit tests pass; checked against ATS in the 9900i day cab (sandbox copy of the data).
- A day cab and a sleeper share the truck id and the head position; the fifth wheel (`config_fv.truckHookPositionZ` @1672) is 2.118 vs 3.184 m. The truck's variant is that position to 10 cm; presets are keyed `<truck id>@<variant>`.
- Auto plays: a preset assigned by hand to the variant, else the variant's own, else the truck's shared preset (older ones, keyed by the bare id), else another variant's, else the default. In a variant playing a shared preset, the first edit makes its own copy ("<name>, hook 3.2 m").
- "Use for this truck" assigns the preset picked in the list to the current variant (stored in `layouts.json` `assignments`); in Auto it turns into "Unassign". The status line shows the variant.
- The preset list keeps it tidy: a truck with one preset is one entry; a truck with several is a group ("All cabs", "Hook 2.1 m", "Hook 3.2 m"); hand-made presets go under Custom. 109 unit tests.

### E2.11 — the cab card ✓
Done: 110 unit tests pass; checked with `tools/fake_shm.py --truck vehicle.intnational.9900i --hook 3.184` in a sandbox.
- After a session of setting up trucks the user could not tell what played where. The Layout panel now has a card: "In the game", "Playing" (and why) and "Edits go to", plus "Separate preset for this cab" when the cab plays someone else's preset.
- The user's two cab presets that had been made with "New preset" and assigned (Kenworth T680 2.7 m, Western Star 49X 2.5 m) were filed under their trucks as cab presets, with their assignments dropped; the file before is `app/data/layouts.backup-2026-10-02.json`.
- The side view is seen from the left again (the driver's side), as first designed; the user asked for it after trying the right.
- `tools/fake_shm.py` takes `--truck` and `--hook` and writes a head position, to try cab variants without the game.
- A cab preset picked in the list showed only "Hook 2.7 m" in the closed list (it hides the group); the selected entry now reads "Kenworth T680 2014 · hook 2.7 m", the others stay short.

### E2.12 — scopes: this truck, this chassis, the model ✓
Done: 112 unit tests pass; the card's flows checked with `tools/fake_shm.py --truck vehicle.intnational.9900i --hook 3.184 --plate WP-83695` in a sandbox.
- Some chassis share a fifth-wheel position (the LoneStar with a lift axle, medium and long), so a preset can now be tied to the truck itself, by its plate (`config_s.truckLicensePlate` @3212). Quick-job trucks (`config_s.jobMarket` @3404 = "quick_job") get random plates, so plate actions are not offered for them. The telemetry snapshot grew to 3436 bytes.
- The hook position names a chassis, not a cab: the UI says "chassis" ("All chassis", "Own preset for this chassis", "(other chassis)").
- Auto plays the narrowest scope that exists: bound to this truck, this truck's own (`<id>#<plate>`), bound to this chassis, this chassis's own (`<id>@<hook>`), the model's (`<id>`), another chassis's, the default.
- The truck card: Truck / Plays / Applies to, a note when editing first makes a copy, and buttons: "Own preset for this chassis", "Only this truck", "Unbind", and for a preset picked in the list "Use it in: this truck only / all … on this chassis". The "Use for this truck / Unassign" button is gone.
- `tools/fake_shm.py` takes `--plate` and `--quick-job`.

### E2.13 — following the game's camera: into turns and toward the blinker ✓
Done: 121 unit tests and 17 engine checks pass; the panel checked in a sandbox against the running game.
- The game's "look into turns" (Accessibility) turns the camera with the steering, even standing still, and "look toward the blinker" turns it while a blinker is on; the telemetry tells neither: a 90 s drive recorded `head.offset` heading 0.0° throughout while the steering went to ±1 and the truck turned at up to 73 °/s (`docs/findings.md`).
- The app adds them to the heading (`turnLook`, `withTurnLook`), so the sound, the views, the 3D view and the status line ("yaw 19° (turn look 19°)") turn with the camera, as the game does it: `gameSteer × 45° × percent`, in reverse off / the same / inverted; a blinker lever on: at least 30° left or 45° right, the same in reverse even inverted (as in the game), not with the hazard lights; the blinker's step eased in over ~0.25 s. Off while paused.
- A "Game camera" fieldset repeats the game's options, set by the user as in the game: Into turns [x] [75] %, In reverse [Off / On / Inverted], Blinkers [x] Look toward them. Reading them from the game's profile files worked (`docs/findings.md`), but was dropped: the app does not touch the game's configs.
- Telemetry reads `gameSteer` @972, `gear` @504, the blinker levers @1578/@1579. Settings: `turnLook { on, percent 0..200, reverse: 'off' | 'on' | 'inverted', blinkers }`, off by default; the first version's `degrees` at full lock is converted (33.75° → 75 %). `tools/fake_shm.py` takes `--blinker left|right`.

### E2.14 — pause behaviour, "vehicle", a note on the bounds ✓
Done: 121 unit tests and 17 engine checks pass; checked in a sandbox against the running game.
- "Pause behavior" under "Mute when": Always active (the music plays while the game is paused), Always muted, Active vehicle (default: as when driving, by "Mute when"). Only the pause in the game world counts; the main menu and loading still play. Settings: `pauseBehavior: 'active' | 'muted' | 'vehicle'`; the status line says "paused · muted".
- DLCs add cars, so the UI says "vehicle": the card's "Vehicle", "Only this vehicle", "this vehicle only", "every vehicle without its own preset", "Vehicle WP-83695" in the list, "Vehicle axis", "Unknown vehicle". The code and `layouts.json` keep `truck`.
- The Bounds panel says the bounds do not change the sound, they only frame the views; "Vehicle axis" moved just inside the front wall, clear of the wall's name.

### E2.15 — preset collection ✓
Done: 136 unit tests pass; checked in a sandbox with `tools/fake_shm.py --truck vehicle.mack.anthem --hook 2.4`: a shared file played in Auto, "Own preset for this chassis" made a copy, Export wrote `Mack anthem, hook 2.4 m.json` (no plate) and it appeared under Collection, a picked file became "… copy" under Custom on the first edit while the file stayed as it was, a dropped-in file showed up without a restart, `layouts.json` got no collection.
- The author's 13 vehicle presets are exported to `app/presets/` and ship from there; `app/data/` is git-ignored as a whole, so the example `layouts.json` left the repository. Before that, the speakers' standard names were changed to their types (E2.16), and the Cascadia preset shared by the 2019 and the 2024 lost its year ("Freightliner Cascadia").

Presets shared between people as files in `presets/` (spec: "Preset collection"). Tasks:
1. `shared/collection.js`: parse a preset file, the export data and file name; tests.
2. `main/collection.js`: read the folder (subfolders, warnings for bad files), watch it, write an exported file under a free name; tests in temporary folders.
3. `shared/presets.js`: collection keys in `resolvePlaying`, Auto (own first, then the collection's chassis, model, sibling), edits making own copies (`adoptPicked` for a picked file), the card, the "Collection" group in the list; `normalizeStore` keeps `file:` assignments; tests.
4. Main / preload / renderer: the collection in `store:load` and a `collection` event, never saved to `layouts.json`; an Export button that shows the file in Explorer; collection warnings in the panel.
5. Sandbox check: export, the file appears in the list, Auto plays it in a vehicle without its own preset; README and spec.

### E2.16 — speakers named after their type ✓
Done: 137 unit tests pass; checked in a sandbox (a type change renames, "+ Pair" names by type).
- Speakers were "Door L/R" and "Speaker N L/R" wherever they were, and most were not in the doors. The app now names them after their type (`TYPE_NAMES` moved from the panel to layout.js): "Full range L/R" in the default layout and for "+ Pair", "Full range" for "+ Speaker", numbered when taken, with one number for both sides of a pair.
- A standard name (a type's name, "Door L", "Speaker 3 R", "Speaker 5") follows the type when it changes (`nameForType` in `updateSpeaker`); a name typed by hand stays.
- The author's presets were renamed the same way, 76 speakers in all ("Midbass L", "Tweeter R", "Subwoofer", "Small full range L 2" for the Mustang's second small pair); copies of `layouts.json` from before are in `app/data/layouts.backup-2026-10-02-before-renames.json` and `…-before-type-names.json`.

### E2.17 — presets apart from their scopes (step 1 of `docs/superpowers/specs/2026-10-03-preset-scopes-design.md`) ✓
Done: 133 unit tests pass; a version 2 `layouts.json` checked in the app (converted, `layouts.v2.json` kept, an edit saved as version 3).
- `layouts.json` version 3: presets `p.N` apart from `assignments` (scope → preset or shared file) and `vehicles` (name, game, brand of each model driven). The default layout is the preset of the scope `all`, which always has one.
- The ladder: this vehicle, this chassis, the model, (shared files for the chassis and the model), another chassis, the brand (`brand:<game>/<brand id>`), the game (`game:ats|ets2`), all vehicles. Telemetry reads `scs_values.game` @52 and gives the brand id and name; `tools/fake_shm.py --game`.
- Version 2 is converted on load: each preset keyed by its scope becomes `p.N` assigned to it; `custom.N` ones are unassigned; a binding wins over the scope's own preset, which stays unassigned; model names from the presets' names.
- Unbind keeps the preset; "Use it in" asks before taking a scope from another preset. Steps 2 (moving on the card) and 3 (the preset map) are next.

### E2.18 — moving a preset on the card (step 2 of the preset scopes spec) ✓
Done: 137 unit tests pass; the card driven in the app with a fake truck (`TRUCKER_AUX_FAKE_TRUCK`, debug only): a copy from all vehicles to the game, down with Move and with Copy, up, a picked preset put to use.
- The card's "Applies to" is the vehicle's ladder (this vehicle, this chassis, the model, the brand, the game, all vehicles), each scope saying which other preset holds it. Picking one moves the preset that plays; a dialog (`renderer/dialog.js`) asks first when the target is taken (that preset stays, unassigned), lists narrower presets that would keep playing (cleared by default), warns about a narrower shared file, and on the way down offers Move or Copy for here. All vehicles always keeps a preset: moving from it copies.
- A preset picked in the list: "Use it in" with the same ladder adds a scope. "Unbind" frees the scope of what plays. The old "Own preset for this chassis" / "Only this vehicle" buttons are now entries of the ladder.

### E2.19 — the preset map (step 3 of the preset scopes spec) ✓
Done: 138 unit tests pass; the map checked in the app with a fake truck and the shipped collection (open, pick, Unassign, Esc).
- "Preset map" under the preset list opens a tree over the views: all vehicles > game > brand > model > chassis > vehicle, every scope that holds a preset or a shared file, their parents and the chain of the vehicle in the game (●, ▶ what plays). A scope without its own shows what it inherits, grey. Clicking a preset picks it in the list; Unassign frees a scope. Below: Unassigned presets and files for no vehicle.
- Reworked on the user's request like the registry editor: a tree of keys (folders, expand / collapse) and the selected key's pane. Bold: a preset set on the key (an override, as in Unity); italic: a shared file; grey: inherited. Every model driven gets its key with the chassis and your vehicles seen (`vehicles[id].chassis`, `.plates`). The pane: Pick in the list, Set preset (`planAssign`), Move this preset up or down (`planMove`), Unassign; works without the game.
- Preset files may say `game`, `brand`, `brandName` of their vehicle (Export writes them when known); the 13 shipped files say `"game": "ats"`, so they sit under ATS before they are driven (brand ids left out: the game's may differ from the vehicle id, e.g. International).
- No guesses about games: a model not driven since the migration is under "Game not known yet (drive a vehicle once)" until it is driven.
- Drag and drop: a preset dragged from its key onto another moves there (up, down, or across to another chain; down and across ask Move or Copy for here); Ctrl, or a preset or file from "Not on any key", sets it there as well. Closed folders open while something is held over them.

### E2.20 — new models get a key; no preset names in the map ✓
Done: 142 unit tests pass; checked in the app with a fake truck (a new model got its key, the map shows marks).
- A model seen for the first time without a key of its own (none for the model, its chassis or vehicles, no shared file for it) gets one at once: a copy of what it would inherit (the brand's, the game's or all vehicles' preset), named after it (`adoptNewModel`). Wider presets act as templates; each model has its own preset to tune.
- The map's tree shows a "preset" or "shared file" mark beside a key instead of the preset's name; names are in the right pane only. The list, the Name field, Export and Unassigned stay as they were (the user's choice).

### E2.21 — the key tree as a standing panel; undo ✓
Done: 143 unit tests pass; checked in the app with a fake truck (pick a key, edit it, undo / redo with keys and buttons, the right-click menu, set the current preset on a vehicle and undo it).
- The preset map is a standing panel on the left (`renderer/key-tree.js`; the overlay and its "Preset map" button are gone; the window opens 1600 px wide). Click a key: it plays what it has or inherits (selection `{ mode: 'scope', scope }`, "Key: …" in the list); editing a key that inherits gives it a preset of its own first (a copy of what it inherited). The tree opens to the vehicle in the game whenever another one comes.
- Right-click a key: "Set the current preset here" (shared), "Copy the current preset here", "Unassign", Expand / Collapse. Dragging works as before.
- Undo / redo (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, and ↶ ↷ above the tree) for every change to your presets and keys: speaker edits, scopes, new / deleted presets. Up to 100 steps; changes of one kind within 0.8 s (a drag) make one step. Text fields keep their own undo. Learning vehicles and keys made for new models are not steps.

### E2.22 — presets the app makes are named by their key's path ✓
Done: 143 unit tests pass.
- A preset the app makes for a key (the first edit of a key that inherits, Copy here, a copy when moving, a new model's key, "this chassis" / "this vehicle" on the card) is named by the key's path as the tree shows it, without "All vehicles": "ATS › Kenworth › Kenworth T680 2014 › hook 2.7 m" (`keyPath`); "All vehicles" for that key. Parts not known yet are left out. Existing presets keep their names. Such a name is not repeated by "— where it applies" in the list; an exported file name has ", " for " › ".

### E2.23 — unused presets under the key tree ✓
Done: 143 unit tests pass; checked in the app (drag a key's preset down, rename in place, undo, drag an unused preset onto a vehicle).
- The left panel is split (a splitter sets the height): keys above, "Unused presets" below (presets on no key, and shared files for no vehicle, in italics).
- A key's preset dropped among them leaves that key and stays (Ctrl, from all vehicles, or a shared file: a copy). Click plays one; double-click or F2 renames it in place; right-click: Play it, Rename, Duplicate, Delete; drag one onto a key to use it there. All of it can be undone.

### E3 — polish
- Tray, autostart, the window can be closed while audio keeps playing.
- Any virtual cable, not only VB-Cable (VAC, Steam Streaming Speakers work too). On first run the input is picked by the label `'CABLE Output'` (`renderer/app.js`, `pickDevice` in `shared/devices.js`); without VB-Cable it falls back to the default recording device, usually the microphone, so the user hears themselves through the HRTF. To do: look for a list of known cable labels (`CABLE Output`, VAC `Line 1` / `Virtual Audio Cable`, `Steam Streaming …`; exact labels to be read on the user's PC); if none is found, open no input and ask the user to pick the cable's output; a `pickDevice` test.
- Built-in cable check (tone + `glitch.js` detector).
- Stale telemetry: when the game crashes (or another process keeps the memory alive), `sdkActive` can stay 1 with a frozen pose. The frame watch from E2.9 (`createFrameWatch`, renderTime still for 1 s) already tells it; still to do: a neutral listener in that case.
- Optional: cabin reverb (`ConvolverNode`), muting by speed.

### E4 — packaging
- electron-builder build, `npm run dist` → `out/Trucker AUX-<version>-win-x64.zip` (a folder, not the self-extracting "portable" exe: `presets/` ships next to `Trucker AUX.exe` and `data/` is created there). First build done from Linux; the packaged UI checked in a Linux build of the same config.
  - Electron-builder drops `examples/` folders from `node_modules`, so `three/examples/jsm/controls/OrbitControls.js` is added as a file set; without it the 3D view fails in the build only.
  - Building on Linux or a Mac: koffi's Windows binary is an optional package installed only on Windows; first `npm install --no-save --force @koromix/koffi-win32-x64@<koffi version>`. Other platforms' koffi binaries are excluded from the package.
  - The zip ships the telemetry plugin: `plugin/scs-telemetry.dll` (built in Visual Studio and copied to `app/plugin/`, git-ignored; `npm run dist` stops without it) and `plugin/LICENSE.txt` (scs-sdk-plugin and SCS SDK notices); the app's `LICENSE.txt` sits next to the exe.
  - Debug tools are hidden in a build: the "Source / Test file" row (a build always plays the input device, whatever `settings.json` says) and the default menu with DevTools and reload. From source, or a build started with `--dev-tools`, they are there (`--debug` is taken by Electron as an old Node flag and the app exits). The Python tools are not in the build.
  - Still to do: an icon and exe metadata (`signAndEditExecutable: false` for now, as rcedit needs Wine on Linux; a build on Windows can turn it on), code signing (SmartScreen warns on unsigned exes), a build on Windows or in CI.
- `docs/audio-setup.md`: a virtual audio device (VB-Cable, VAC, Steam Streaming Speakers); both cable sides and the headphones at one rate; VB-Cable: Max Latency 7168, Internal SR at that rate; VAC trial mixes a "trial" voice in; Steam may reinstall or hold its driver (Remote Play); stereo headphones without virtual surround, player routed to the cable's input, `scs-telemetry.dll` in `<game>\bin\win_x64\plugins\`.

## Repository layout

```
app/                       Electron app (ESM, except preload)
  src/main/                window, IPC, data folder, JSON store, shared-memory reader
  src/shared/              pure logic: pose, layouts, presets, DSP, settings, devices, glitch detector
  src/renderer/            audio graph, devices, panel
  test/                    node --test
  scripts/                 engine check, pose-dump
  data/                    layouts.json, settings.json, profile/ (Chromium); all git-ignored
  presets/                 the shared preset collection, one JSON file each
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
