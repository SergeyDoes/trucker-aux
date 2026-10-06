# trucker_aux_camera.dll

An SCS telemetry plugin for ATS and ETS2 that copies the camera the game renders with into
the shared memory `Local\TruckerAuxCamera` each frame (`camera_block.h`), for Trucker AUX:
in the cab camera the sound then turns with the view, including the game's "look into
turns" and "look toward the blinker", which the SDK does not report.

- It sits next to RenCloud's `scs-telemetry.dll` in `<game>\bin\win_x64\plugins\`; it does
  not replace it and uses its own shared memory.
- It only reads the game's memory: nothing is written into the game and no game function is
  called. Every read is guarded; a fault switches it off for the session (the game's log
  says so), and Trucker AUX goes back to the telemetry.
- The camera manager is found by a byte pattern, so a game update may stop it until the
  pattern is updated. It worked with game 1.61.

Build (Visual Studio 2022 with "Desktop development with C++"): run `build.cmd`; the DLL is
written to `out\`. Copy it to `app\plugin\` for `npm run dist`.

The pattern and the structure offsets come from the ETS2LA game plugin
(https://github.com/ETS2LA/plugin), MIT, Copyright (c) 2024 Dario Wouters:
see `LICENSE-ETS2LA.txt`. The SCS SDK headers come with RenCloud's plugin (MIT).
