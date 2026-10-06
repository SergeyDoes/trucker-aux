# Handoff: the last cloud session (2026-10-05/06)

What happened at the end of the cloud session, for the session that goes on from here.
The longer story is in `PLAN.md` (E2.29–E2.33, E3). The user writes in Russian; code and
docs stay in English. In the cloud session the user allowed Claude to commit and push
(say so again locally if wanted; `PLAN.md` still says not to).

## Branches (all pushed)

- `main` 50ae39c: the last merge.
- `main-2mhdqi` 3a45970: two commits ahead of `main`, not merged yet:
  - f6f659b: the shipped presets are the bottom layer in `app/presets/default/` (never imported).
  - 3a45970: shared files on no key keep their labels in Unused presets and the export window.
- `camera-probe` (from `main-2mhdqi`, which is merged in): `tools/camera_probe.py`, the user's
  recording `docs/camera.csv`, findings in `PLAN.md` (E3, "Seeing speaker positions").
- Version stays 0.1.1 (0.1.1 was never built, so no bump).

## Recovering presets from the 0.1.0 build (done)

- The user thought "a shared file loses its labels". Checked: 0.1.0's Export already wrote
  `label` / `labelColor`; the shipped vehicle presets simply never had labels (exported on
  2026-10-02, before labels; only `Default layout.json` has one). The one real loss: files on
  no key showed no label in Unused presets (and the export window). Fixed in 3a45970.
- In 0.1.0, `presets/` held the 13 shipped files at its root, the user's single exports
  (the card's old Export wrote the playing preset there), and one folder per "Export this
  branch" (`All vehicles`, `All vehicles (2)`, `ATS`, `ATS, International`). Keys could hold a
  file (`file:…`) instead of a preset, so half of the user's presets lived only in those
  files: copying `layouts.json` alone brought back half.
- Fix used: the new version, `layouts.json` copied in, then Import… on the export folders
  (and the user's own root files, not the 13 shipped ones). The user reports it worked.
- Lesson: an earlier advice here was `git clean -f -d app/presets`; that deletes for good.
  Check what is only in files before suggesting a clean.
- Idea offered, not done: Import… of a whole folder (recursive) with boxes to untick.

## Camera probe (branch `camera-probe`)

- The ETS2LA game plugin (github.com/ETS2LA/plugin, MIT; build it with CMake in Visual
  Studio, `git submodule update --init` first; game 1.61.x; DLL next to scs-telemetry.dll)
  shares `Local\ETS2LACameraProps`, 128 bytes (`src/core.hpp` CameraMemData): fov, position in
  the sector + cx/cz int16 (world = x + cx·512, z + cz·512), rotation wxyz, projection matrix
  m11..m44, truck box centre (world, `get_center_coords`) and rotation wxyz, interpolated to the
  camera's frame. `rotate` in the probe matches the plugin's `float3_t::rotate` (checked on
  1000 random cases).
- `tools/camera_probe.py`: camera in the truck's axes (X right, Y up, Z back); Ctrl+F9 in the
  game sets the origin (cab camera, head straight = the driver's default head), Ctrl+F10 puts
  a mark (beeps); `z`/Enter in the console too. `--csv` appends; each run writes a new header
  line, so a file can hold several runs. Frames before the truck is placed (NaN, thousands of
  metres, about 4 s after a load) are skipped since a9dc19e.
- Free camera: `g_developer "1"` and `g_console "1"` in config.cfg, 0 in the game, numpad to
  fly; `g_flyspeed` in the console (default about 100; 1–10 for fine moves), mouse wheel
  changes speed too. No console variable for mouse sensitivity was found; the probe needs
  the position only, so aiming does not matter.
- First recording (`docs/camera.csv`, run 2, stationary truck):
  - cab camera after the origin: within 1 cm across, 2.5 cm along while the head turns; looks
    along -Z;
  - free camera marks from the head: 1 = (-0.366, -0.639, -0.809), 2 = (+1.160, -0.160,
    -0.909) m; in app X (X − centerX) about -0.83 and +0.70;
  - outside camera 5.7–6.3 m away: distance tells the cab camera from an outside one;
  - box centre is on the truck's axis (chase camera at x = 0.004); the head is 0.46 m left of
    it = the app's centerX;
  - FOV 65 in the cab (65–66.6 looking around), 60 free/outside; projection 16:9, ~75° across.
- Open questions to the user:
  - SDK head and cabin offsets were 0 for the whole recording: was scs-telemetry loaded?
  - Which speakers were marks 1 and 2 (to compare with the user's preset for that truck)?
  - Record a short drive in the cab camera (with scs-telemetry working) to see the cab sway.
- Next steps proposed: in debug mode the app reads the ETS2LA camera; a hotkey puts the
  selected speaker where the camera is; turn look switches off when the camera is far from
  the head (the outside-camera TODO in E3); later an overlay drawing speakers over the game
  (projection matrix, borderless window).
