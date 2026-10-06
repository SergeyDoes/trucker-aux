# The game camera for the sound: a camera plugin and a revision check

## Why

The game turns its cab camera into turns and toward the blinker, but the SDK's head offset leaves that out; the app emulates it from settings copied by hand (E2.13), and the emulation is off by several degrees (`docs/findings.md`, 2026-10-06: 26.2° at full lock at 75 %, blinkers 20° / 40°). It also turns the sound on outside cameras, where the game does not (E3). The ETS2LA game plugin showed that the camera the game renders with can be read from its memory, and that in the cab it sits exactly where the SDK puts the head.

## Decisions

- **A separate DLL of ours, `trucker_aux_camera.dll`,** next to RenCloud's `scs-telemetry.dll`, not a fork of it: players may run other mods that need RenCloud's plugin (perhaps a newer revision); one file name and one shared memory each, no clash.
- **Only reads the camera.** The camera manager is found by one byte pattern (from ETS2LA, MIT, Dario Wouters); the current camera's FOV, world position and rotation are copied each frame. Nothing is written into the game and no game function is called (ETS2LA calls one for the truck's interpolated placement; the SDK's placement does instead).
- **Never crashes the game:** every read of game memory is inside a structured exception handler; a fault disables the reader for the session. Values are checked (finite, FOV 10–170°, a unit quaternion) before they are published. No list of allowed game versions: after a patch it keeps working as long as the pattern and the fields hold, and switches itself off otherwise.
- **The app treats the camera as optional.** In the cab camera it takes the view's rotation from the game (turn look, blinkers and mouse included) and keeps the SDK's head position. On an outside camera the head stays at rest and gets no turn look. The game's free (developer) camera takes the listener where it is, in the cab or out of it, and a speaker added then goes there (below). Without the plugin, or when its data stops, everything works as before (the SDK and the emulated turn look).
- **The app checks RenCloud's plugin revision** (`scs_values.telemetry_plugin_revision` @40, 12 now) and warns when it is not one it knows, as all offsets depend on it.

## The shared memory `Local\TruckerAuxCamera`

Created by the DLL (read and write), opened read only by the app, 64 bytes, little endian:

| offset | type | field |
|---|---|---|
| 0 | u32 | `layout`: 1 |
| 4 | u32 | `sequence`: odd while the DLL writes, even when the record is whole; +2 per frame |
| 8 | u32 | `state`: 0 looking for the camera, 1 reading, 2 off after a fault |
| 12 | u32 | `camera`: the camera manager's current camera index |
| 16 | f32 | `fov` (degrees) |
| 20 | f32 | reserved |
| 24 | f64 ×3 | world position (sector added: x + cx·512, z + cz·512) |
| 48 | f32 ×4 | rotation w, x, y, z (the camera looks along its -Z) |

The app copies the block, and uses it only when `sequence` is even and the same before and after the copy (else it keeps the previous record). A record whose `sequence` has not changed for 1 s while the game's frames go on counts as stale.

## The DLL

- `native/camera-plugin/`: one C++ source and a header with the block's layout; `build.cmd` (finds Visual Studio 2022 with vswhere, `cl` x64, Release, the C runtime linked in) writes `trucker_aux_camera.dll`. SDK headers from `third_party/scs-sdk-plugin/scs_sdk/include`.
- `scs_telemetry_init`: SDK telemetry 1.00 / 1.01; creates the mapping, registers for `frame_end`, and starts one scan of the game's code sections for the pattern on a thread of its own (the pattern does not change within a session, and the game's thread is not held up). `scs_telemetry_shutdown`: waits for the scan, unmaps. The game's log gets one line: found, or not found.
- Each `frame_end`: once the pattern is found, reads `camera_manager → cameras[current]`: `fov` @0x20, placement @0x40 (position, cx, cz @0x4C/0x4E, rotation wxyz @0x50); publishes it, or the state "looking" when there is no camera (menus, loading) or the values fail the checks.
- Structure offsets as in ETS2LA (game 1.60–1.61, Windows): manager: current camera @0x10, cameras array @0x30 (data pointer @0x38, size @0x40).
- The release zip ships it in `plugin/` with the notices of RenCloud's plugin, the SCS SDK and ETS2LA in `plugin/LICENSE.txt`.

## The app

- **Telemetry** (`main/telemetry.js`): the plugin revision; the truck's world placement (`truck_dp` @2200: position x y z, heading pitch roll in turns, doubles); the cabin offset (@2000: position, heading pitch roll); the head offset with its rotation; `cabinPosition`, `headPosition` (all three axes). The camera block is opened like the telemetry (read only, retried each second) and copied with each pose.
- **The view** (`shared/camera.js`, pure, unit-tested): the cab's world rotation is the truck's (Ry(heading)·Rx(pitch)·Rz(roll)) times the cabin offset's; the head's expected world position is truck + R_truck·(cabinPosition + cabin offset + R_cabin·(headPosition + head offset)). The camera is the cab camera when the camera manager's index is the cab's (`CAB_CAMERA` = 2 in ATS 1.61; the camera leaning out of the window is 0.9 m from the head, so distance alone does not tell them apart) and it is within 1.5 m of it (an outside camera is 6 m away; physics against render timing moves it by up to about 0.5 m at speed). Its rotation in the cab, conj(cab)·camera, gives heading, pitch and roll, as the SDK's head offset does. Result: `{ source: 'game' | 'free' | 'outside' | null, heading, pitch, roll, distance }`, for `free` also `x y z`.
- **The free camera** (`g_developer "1"` in the game's `config.cfg`, then 0) is told apart by the camera manager's index (`FREE_CAMERA` = 0 in ATS 1.61, measured with `tools/camera_block.py`; the cab camera is 2), not by distance: in the cab it is 1–1.5 m from the head, as close as the cab camera may be. Its position is turned back into the cab's axes (`headOffset`: the inverse of the expected head) as an offset from the default head, the way the SDK's head offset is, and its rotation as the cab camera's. While the truck moves the free camera stays in the world, so the truck drives away from it; the SDK's placement and the rendered frame may differ by up to about 0.5 m at speed.
- **The listener:** source `game`: the SDK's head position with the camera's heading, pitch, roll; no emulated turn look. `free`: the head where the camera is and turned as it is; the views and the 3D overview show the head there. `outside`: the head at rest, straight ahead, no turn look. `null`: as now.
- **New speakers at the free camera:** in the free camera "+ Speaker" puts the speaker where the camera is (`cameraPoint`: layout X from the truck's axis, snapped to centimetres, within the 5 m limit), and "+ Pair" puts the half on the camera's side there and the other mirrored. The buttons' tooltips say so.
- **The panel:** the status line says when the view comes from the game's camera ("camera: game", "camera: free", "camera: outside"; nothing when it comes from the telemetry as before); the Game camera fieldset shows only once the app has seen that the camera is not there (`createFallbackWatch`: the game world up with a vehicle for 3 s on end while the camera gave nothing: no plugin, a game version it does not know, a fault); that holds through the menus and goes off as soon as the camera works. With the camera the settings are not used. An unknown plugin revision adds a warning: "scs-telemetry.dll revision N is not one Trucker AUX knows (12): the values it reads may be wrong."
- **Tests:** the revision, the new telemetry fields, the camera block parsing (sequence rules), the view maths (a turned and pitched truck, a cab camera, an outside one, a stale block). `tools/fake_shm.py --camera cab|outside|free` writes a fake camera block (only with the game closed): at the fake head, turning ahead of it; 6 m behind; or by the right door.

## Not in this step

- Placing speakers by the camera (a hotkey putting the selected speaker where the free camera is), an overlay drawing the speakers over the game.
- Linux / Proton builds of the DLL.
