# R0 reconnaissance: head.offset in ATS

Recordings: `docs/probe.csv`, 2026-09-30, ATS, International 9900i (left-hand drive), truck standing still, 10 Hz, `scs-telemetry.dll` (RenCloud) + `tools/shm_probe.py`. The first recording is 43.6 s (free camera turning); the second, 18.5 s (cab → outside → pause), is appended to the same file from line 437 with its own header row. No head tracker; the camera is turned with the mouse.

## Findings

1. **The mouse changes `head.offset`: assumption 1 confirmed.** Heading and pitch follow the camera smoothly, about 120°/s with fast mouse moves. The project is viable as designed.
2. **Sign.** Heading is positive when looking left, as the SDK documents. Indirect confirmation: at yaw +90° the head moves to x = −0.41 m (left in SCS axes), at yaw −90° to x = +0.16 m (right). To be confirmed by ear in M3.
3. **The wrap through 0 shows up in live data:** a slight right turn arrives as heading 0.9865, i.e. −4.9°. Normalization to −180..180 is mandatory.
4. **Ranges with mouse look:**
   - yaw from −140° (right) to +170° (left); the asymmetry comes from the left-hand drive;
   - pitch from −44.5° to +37.5°;
   - roll is always 0: mouse look does not tilt the head; roll only comes with a tracker.
5. **The rest pose is not zero:** yaw 0°, pitch −3.0°, position (0, −0.05, 0) m. The position is the seat setting (confirmed later, see "Seat adjustment" below). 3° down does not matter for audio, but a "straight = centre" calibration should subtract the rest pitch.
6. **The head also moves.** Looking back, the game "leans out": up to 0.8 m left and 0.4 m forward (at yaw +170°), up to 0.29 m to the right. Placing speakers as points in the cab rather than only as angles gives real parallax: lean towards the left door and the left speaker is closer and louder. Idea for M4. SCS axes (`scssdk_value.h`: X right, Y up, Z back) match Steam Audio's, no conversion needed.
7. **An external camera cannot be detected through head.offset (assumption 2 closed: indistinguishable).** Second recording (18.5 s, with marks): cab 0–4.5 s, outside 4.5–11.6 s, pause 11.6–18.5 s. Outside, the values just freeze at the last ones (yaw −3.88°, pitch −9.03°); there is no sign of it. A still head in the cab looks exactly the same. The first recording (19.0–28.4 s) shows the same, and on returning to the cab the camera snapped exactly to the rest pose (0°, −3.0°). Acceptable for music: outside the sound stays as it was, in the cab it returns to the centre.
8. **Pause is detected reliably:** `paused` = 1 from the very first frame of the pause, and head.offset freezes. `renderTime` keeps growing while paused, so frames can't reveal a pause; only the flag can.
9. **cabin.offset is 0 everywhere** because the truck was standing still. Cab sway needs a recording while driving.

## Still to check

- A recording while driving: cabin.offset and head.offset jitter on the road. Not a blocker for A0–A2.

## Seat adjustment (2026-10-01)

Ford F150 2023 in ATS, read from shared memory before and after moving the seat down, back and left to the end of its travel:

| | before | after |
|---|---|---|
| `head.position` (config, @1652) | −0.459, −1.400, 1.657 | unchanged |
| `head.offset` x, y, z (@2024) | 0, 0, 0 | −0.10, −0.10, +0.10 |

The seat goes into `head.offset`, 10 cm per direction at most; `head.position` is the truck's fixed default. So in layout coordinates (X from the truck's axis, Y and Z from the default head) the zero point and the speakers stay put, and the listener moves with the seat, as in a real cab. The F150's head sits 45.9 cm left of the truck's axis.

# E0: clicks on the "VB-Cable → graph" path (2026-09-30)

Method: a 1 kHz tone into `CABLE Input`, capture from `CABLE Output`, the dropout counter from `app/src/shared/glitch.js` (residual x[n+1] + x[n−1] − 2cos(ω)x[n] above 5% of the amplitude; one dropout is not counted twice within 0.1 s). Game not running, CPU load around 4%.

| Experiment | Dropouts |
|---|---|
| Tone inside Web Audio, no devices (detector check) | 0 in 14 s |
| `CABLE Output` 44100, graph 44100 (headphone clock / no output) | 163 / 141 in 30 s |
| `CABLE Output` 48000, graph 44100 | 68 / 54 in 30 s |
| `CABLE Output` 48000, graph 48000 | 7–11 in 30 s (125 in another run) |
| Tone from Chromium, frames read from the track bypassing Web Audio | 129 in 30 s (Web Audio in the same run: 125) |
| Tone via MME (Python `waveOut`), capture in Chromium | 48 in 30 s |
| Tone via MME, capture via MME (Python `waveIn`), no Chromium | 27 in 29 s |

Conclusions:
- The detector does not lie: zero on a clean tone inside Web Audio.
- Chromium's capture loses no frames (`track.stats`: delivered = total, exactly 48000/s); the Web Audio buffer adds no clicks (reading frames directly gives the same count).
- Dropouts happen with no Chromium at either end: VB-Cable itself, together with the Windows audio engine, breaks the audio. The Light Host clicks in A0 most likely came from here too.
- Different sample rates on the cable sides and in the graph add dropouts: the graph should run at the cable's rate.
- VB-Cable's driver settings were non-default (`HKLM\SOFTWARE\VB-Audio\Cable`): Max Latency `VBAudioCableWDM` = 2048 (default 7168), Internal SR `VBAudioCableWDM_SR` = 96000 (default 48000). The tight buffer (~21 ms) is the main suspect.

## After the fix: Max Latency 7168, Internal SR 48000

The user changed both parameters at once in `VBCABLE_ControlPanel.exe`, so the contribution of each is unknown. Both cable sides at 48000 Hz, headphones at 44100.

| Experiment | Dropouts |
|---|---|
| MME tone → MME capture, no Chromium (`tools/cable_tone.py` + `tools/cable_check.py`) | 0 in 30 s |
| Tone from Chromium, graph 44100 (headphone clock / no output) | 2 / 1 in 30 s |
| Tone from Chromium, graph 48000 (headphone clock / no output) | 2 / 2 in 30 s |
| MME tone (like a player), 3 minutes: graph 48000 with output to the headphones / direct track reading | 2 / 0 in 180 s |

In the three-minute run both graph dropouts fell into the first second, before the detector's first report: a transient when the stream connects, not clicks. The capture lost no frames (`track.stats`).

Conclusions:
- The clicks came from VB-Cable's settings. With the standard ones (7168, 48000, both sides at 48000) the "player → cable → Trucker AUX" path is clean.
- Drift between the cable's and the USB headset's clocks caused no clicks in 3 minutes: Chromium reconciles input and output itself. No own drift compensation for now; final word after long listening in the game.
- The graph should run at the cable's rate (48000): mismatched rates gave more dropouts.

Later the whole chain was moved to 44100 (headphones, both cable sides, Internal SR); the clicks were gone by ear.

# Headphones: virtual 7.1 on top of our binaural output (2026-09-30)

- An offline render of `engine.js` (OfflineAudioContext, a 500 Hz tone in the left channel and 1500 Hz in the right) shows proper separation and rotation. Head straight: the left tone is 5.2 dB louder in the left ear, the right one 11.3 dB louder in the right ear. Head turned left 90°: both tones move right (−2.1 and −3.5 dB). Right 90°: left (+4.2 and +1.5 dB).
- OBS recordings (`Replay 2026-09-30 18-40-15.mp4`, `2026-09-30 18-54-08.mp4`) are almost mono: the L−R balance stays within ±0.8 dB, channel correlation 0.94–1.00, camera turns don't show even in the game's own audio.
- Cause: the headset `Headphones (Logitech PRO X Gaming Headset)` runs as 7.1 in Windows (device format 8 channels, mask 0x63F) — DTS Headphone:X virtual surround from G HUB. Our binaural signal goes through a second virtualizer: the left and right channels become "speakers" and are mixed into both ears. Hence the weak channel separation back in A0 and the mono OBS recordings (OBS downmixes the 8-channel mix back to stereo).
- Requirement: no virtual surround on the headphones (DTS Headphone:X in G HUB, Windows Sonic, Dolby Atmos for Headphones) — the device must be plain stereo.
- Later (2026-10-02): with DTS off in G HUB the headset still opens as 8 channels (device format read from the registry: 8 ch, 44100 Hz). That is the USB device's own 7.1 format; stereo then plays on the front pair. So 8 channels alone does not mean virtual surround, and the app's warning only asks to check it.

## Cab, pause menu, main menu (2026-10-01)

ATS, International 9900i, engine off, electrics on. The whole shared memory (21 600 bytes, field names from `offsetof` over the plugin header) was saved twice, 1.5 s apart, in each state and compared:

| | `paused` | `renderTime` | `time`, truck physics | truck data, engine and electrics flags |
|---|---|---|---|---|
| cab, playing | 0 | advances | advance (temperatures, suspension, tiny accelerations) | 9900i, engine 0, electrics 1 |
| pause menu | 1 | advances | stand still | unchanged |
| main menu | 1 | **stands still** | stand still | **still the 9900i**, unchanged |

The plugin does not clear the truck when the game leaves the world, so in the main menu the memory still describes the last truck. The only difference from the pause menu is that frames stop: in 1.5 s not a single byte changed. Trucker AUX therefore treats "renderTime unchanged for 1 s" as being outside the game world (main menu, loading, or a hung game), and "Mute when" does not apply there.

## Cab variants of one truck (2026-10-01)

ATS, International 9900i with a day cab and with a sleeper (a quick-job truck). Memory dumps compared field by field:

| | day cab | sleeper |
|---|---|---|
| `truckId` | `vehicle.intnational.9900i` | the same |
| `head.position` | −0.477, −0.604, 1.196 | the same |
| `cabin.position` | 0, 3, −2 | the same |
| fifth wheel Z (`config_fv.truckHookPositionZ`, @1672) | 2.118 m | 3.184 m |
| wheel positions, fuel tank, gearbox, plate | one set | another |

The game does not report the cab, and the head sits the same in both. The fifth wheel moves about a metre back behind the longer cab, so Trucker AUX names a variant by the fifth-wheel position to 10 cm ("2.1", "3.2"). A chassis change that moves the fifth wheel counts as another variant too; a preset can then be assigned by hand. The plate is no use: quick-job trucks get random ones.

## "Look into turns" is not in the telemetry (2026-10-02)

ATS, "look into turns" on in Accessibility (75 %); the game's reverse option (off / on / inverted) set to off. A 90 s drive was logged at 16 Hz: speed, `userSteer` / `gameSteer`, `truck_f.wheelSteering`, the truck's yaw rate, `head.offset` and the cabin offset.

| | range over the drive |
|---|---|
| speed | −6.1 … 8.4 m/s (forward and reverse) |
| `userSteer`, `gameSteer` | −1 … 1 |
| yaw rate | −0.204 … 0.204 turns/s (73 °/s) |
| `head.offset` heading, pitch | 0.0°, −7° the whole time |
| `head.offset` x, z; cabin offset yaw | 0 |

The camera visibly turned into every turn, and also with the wheel turned standing still, yet `head.offset` stayed at "straight". No field in the shared memory carries the look, so Trucker AUX emulates it instead: `gameSteer × angle` added to the heading. `gameSteer` is the steering after the game's own smoothing, the value the wheels get.

## The game's camera settings in its profile (2026-10-02)

Neither the SDK nor the plugin passes the game's settings, but the game keeps them in the profile's text files (`uset name "value"` lines). Trucker AUX does not read them (a decision, not a limit): the same options are set in its "Game camera" panel. For reference, in ATS, Steam profile "SergeyDoes" (folder `536572676579446F6573`, the name in hex):

| setting in the game | variable | file |
|---|---|---|
| look into turns, on / off | `g_cam_steering` 1 / 0 | `Documents\American Truck Simulator\steam_profiles\<hex>\config_local.cfg` |
| its strength, % | `g_cam_steering_value`, 0.75 = 75 % | the same |
| on the reverse gear | `g_cam_steering_reverse` | the same |
| look toward the blinker | `g_cam_blinker` 1 / 0 | the profile's `config.cfg`; for a Steam profile in `<Steam>\userdata\<account>\270880\remote\profiles\<hex>\` |

- A file watcher showed the game rewriting `config_local.cfg` (and `Documents\…\config.cfg`) at once on every change in the options. Switching the reverse option On → Inverted → Off wrote `1 → 2 → 0`. Older ETS2 profiles keep floats there ("1.0").
- With several profiles, the active one is the one whose `config_local.cfg` is newest. Local (non-Steam) profiles keep `config.cfg` next to it.
- Angles, by eye in the game: 100 % turns the camera 45° at full lock, 200 % looks straight sideways, 10 % about 5°: so `45° × percent`, and the earlier guess of 25–30° for 75 % was 34°. The game's camera showed otherwise: 26.2° at 75 %, so 35° per 100 % (next section).
- Look toward the blinker: with the left blinker the camera turns 30° left, with the right one 45° right (by eye; the game's camera showed 20° and 40°, next section), whatever the percent; while a blinker is on, the turn is at least that, and steering further that way turns it further. The hazard lights do nothing. In reverse the game keeps the same limits, even with inverted look into turns (it looks like a bug in the game; Trucker AUX repeats it).
- The telemetry gives the blinker levers (`truck_b.blinkerLeftActive` @1578, `blinkerRightActive` @1579; per the SDK the logical state, which does not blink with the light) and which game runs (`scs_values.game` @52: 1 ETS2, 2 ATS).

## The game camera from the ETS2LA plugin: the cab camera, the turn look, the blinkers (2026-10-06)

Recorded with `tools/camera_probe.py` (the ETS2LA plugin's `Local\ETS2LACameraProps` next to scs-telemetry), a Ford F150 2023 standing still, `docs/camera.csv` runs 3 and 4.

- **The cab camera is the SDK's head.** With the origin set in the cab camera (head straight), the camera sits where the origin plus `head.offset` says, within 1 mm on average and 7 mm (across) to 2 cm (along) at worst, also looking back over the shoulder (the head then 55 cm left, 14 cm down, 10 cm forward). With the head at rest the camera stays within ±7 mm across and 2 cm along (it turns about the neck). The head sits 0.459 m left of the truck's box centre, the app's `centerX`.
- **The F150 has no cab suspension:** `cabin.offset` stayed 0.
- **The game's look into turns is in the camera, not in the SDK's head** (look into turns on, 75 %, reverse "On"; the truck stood in R the whole run, speed 0): the camera's yaw follows `gameSteer` linearly, **26.2° at full lock** (26.4 per unit across the range), about 0.14 s behind it; the SDK's head yaw stayed 0. That is 35° per 100 % if it scales with the percent, not the 45° guessed by eye; other percents are not measured yet.
- **Look toward the blinker: 20° left, 40° right**, not the 30° / 45° guessed by eye. The camera turns there at a steady speed, about 80°/s (20° in 0.24 s, 40° in 0.48 s, the same coming back), not easing exponentially. A right-hand-drive cab is not measured: Trucker AUX takes its limits as mirrored, 20° toward the driver's side (right) and 40° across (left).
- **Outside cameras get no turn look:** steering full left and right on the chase camera (6.0–6.3 m from the head) left its yaw at 0. The app adds the turn look whatever the camera (E3).

## The cab camera's roll (2026-10-07)

Recorded 90 s at 10 Hz (scs-telemetry beside `trucker_aux_camera.dll`), ATS, Freightliner Cascadia 2019 at 23–28 m/s on a curvy road, the mouse still (`head.offset` heading 0, pitch −3°, roll 0 throughout); the truck's roll −2.2…+0.4°, the cab's on its suspension ±0.6°.

- **Pitch:** the camera's world pitch follows the truck's exactly (correlation 1.0): the SDK's pitch convention is the app's.
- **Roll:** the camera rolls the same way as the truck (correlation 0.997; with the truck's roll taken the other way the camera's roll in the cab comes out three times as large), so the convention is right too. But it follows only about half: camera roll = 0.51 × truck roll + 0.03 × cab roll; near 0 (|truck roll| < 0.5°) about 0.3. Against the cab the view so leans the other way by about half the truck's roll and the whole cab sway, up to 1.3° here, and less for small rolls: the sound wandered between the ears with it. The app keeps the listener's ears level in the cab (`levelHead`).
- **Heading:** the view's heading in the cab moved ±1.1° with the truck's yaw rate (0.12 s × the rate, up to 8°/s): the game's look into turns (75 % then) at the small steering of a highway curve.

## The game's cameras by index (2026-10-06)

`tools/camera_block.py` with `trucker_aux_camera.dll` in ATS 1.61, a truck standing still, the keys 1…9 and 0 pressed in turn (the camera manager's `current_camera`; the distance is from the cab camera):

| index | FOV | distance | camera (by where it is) |
|---|---|---|---|
| 2 | 65 | 0 | the cab (key 1) |
| 1 | 62 | 25.1 m | chase |
| 7 | 70 | 26.1 m | top, 25.5 m up |
| 5 | 70 | 1.70 m | 1.5 m up: on the roof |
| 4 | 70 | 0.88 m | beside the head: leaning out of the window |
| 3 | 65 | 2.25 m | low, 0.9 m down |
| 6 | 65 | 2.03 m | low, 1.4 m down |
| 9 | 57 | 18.1 m | cinematic |
| 0 | 60 | 2.87 m | the free (developer) camera, where it starts |

- The free camera is index 0: `FREE_CAMERA` in `app/src/shared/camera.js`.
- The index 4 camera is 0.88 m from the cab camera, inside the app's `CAB_RADIUS` (1.5 m): by distance alone the app took it for the cab camera. Since then the cab camera is index 2 (`CAB_CAMERA`) and within `CAB_RADIUS`; any other index but the free camera's is an outside camera.
