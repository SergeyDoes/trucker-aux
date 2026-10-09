# What is Trucker AUX

Trucker AUX allows to simulate spatial 3D speakers of the vehicle in ETS2/ATS and route any audio stream through virtual speakers according to in-game head position.

<br>
<br>

## Notes

**Is this AI slop?**

Short answer: YES.

Long answer: No, I mean the *slop* one. I never wrote a single line of code here; my part was iterating with the AI over and over until the thing was actually usable. Sure, I "just" played truck sims for 50 hours this week, which is hardly work. I could have set up the presets much faster by purely switching trucks with cheats or something, but instead I played on my main profile, doing quick jobs with different trucks and tuning the speakers truck by truck. I wanted to bring some *vibes* into the game, and I think it worked. I found building Trucker AUX pretty *vibey* too.

AI is impressive at this kind of stuff, but it still needs a dev's duct-tape ideas, workarounds and so on. Also, have you seen Claude's first [UI attempts](./MEMES.md)?

Have fun!
<br>
<br>
## Features

- **Real head position:** The virtual speaker surround is synched with the in-game head position.
- **Play any audio you want.** Anything that can play audio to selected device (Windows Mixer setting per application, Audio device per browser tab extensions, etc.)
- **Works with ETS2 Local Radio:** the local stations of wherever you drive play from your cab speakers, see [Works with ETS2 Local Radio](#works-with-ets2-local-radio)
- **Visual editor:** Drag speakers on a Top View and a Side View projections.
- **Speaker types,** with Linkwitz–Riley crossovers that sum flat where two types meet:

  | type | band |
  |---|---|
  | full range | no filter |
  | small full range | from 120 Hz |
  | tweeter | from 2.5 kHz |
  | midrange | 500 Hz – 2.5 kHz |
  | midbass | 60 – 500 Hz |
  | subwoofer | up to 120 Hz |


- **Presets per vehicle:** Create your presets per vehicle
  - Presets can auto switch on car change
  - Preset can be assigned to a model, to one of its chassis (told apart by the fifth-wheel position), or to a single vehicle by its plate (owned vehicles only)
  - Presets can be shared and imported

- **Loudness matching:** An option to adjust the current preset volume to stay nearly the same when switching between presets with different speaker counts
- **Like a car radio:** "Mute when" option mutes the music while the engine or the electrics are off;

- **No crap:**
  - the shared memory is only opened for reading, never created;
  - the app does not read or change the game's files;
  - no sign-ins, no network.
  - app's data stored within it's folder

<br>
<br>

## How it works

```
ATS/ETS2 ─► scs-telemetry.dll (RenCloud) ─► shared memory Local\SCSTelemetry
                                                   │ read at ~100 Hz (koffi)
┌──────────────────── Trucker AUX (Electron) ──────┼──────────────────────────┐
│ main: head pose, data folder, IPC                ▼                          │
│ input device ─(getUserMedia)─► AudioContext → M/S width                     │
│                                 → per speaker: filter → level → HRTF ─────────► Main Output Device
│                                 AudioListener ← head pose                   │
│ panel: devices, presets, speakers                                           │
└─────────────────────────────────────────────────────────────────────────────┘
Player ─► Virtual Audio Input.                   Game Audio ────────────────────► Main Output Device
```

- Any content player (browser, Spotify, VLC) plays into a virtual cable. Trucker AUX records the cable's other end.
- Each virtual speaker is a Web Audio HRTF panner placed according to the vehicle interior. The listener turns and moves with the driver's head, read from the game's telemetry (`head.offset`).
- The game's own sound goes straight to the headphones, outside this chain.

<br>
<br>

## Setup and Requirements

- **Prerequisites**:
  - Windows 10 or 11 (Tested with it, but older ones may probably work too)
  - American Truck Simulator or Euro Truck Simulator 2.
  - Virtual Audio Device, any of the following will work:
    - \[Free\] [VB-Audio Virtual Cable](https://vb-audio.com/Cable/)
    - \[Paid\] [Virtual Audio Cable](https://vac.muzychenko.net/en/)
    - \[Free\] Steam Streaming Microphone&Speakers (Installs automatically when trying to start a Remote Play stream)
  
  - Plain stereo headphones. Virtual surround (DTS Headphone:X, Windows Sonic, Dolby Atmos) would virtualize the binaural output a second time and may sound weird
- **Setup**:
  - Make sure you set up the Virtual Audio Device and both Input and Output device appear in your system
  - Download the [latest version](../../releases/latest) and *Extract* the archive
  - Place the **scs-telemetry.dll** and **trucker_aux_camera.dll** at *[Game Folder]/bin/win_x64/plugins/*
    - Create the *plugins* folder if needed
   - Run the *Trucker AUX* application
     - Set your *Virtual Output Device* into **Input** field
     - Set your *Headset (or Default) Device* into **Output** field
     - Optionally fill in the *Game camera* settings to match in-game ones (the fieldset shows up only once the app has seen the game without *trucker_aux_camera.dll* reading its camera)
   - Set your audio *content* **Output** device to *Virtual Input Device*
     - Open Windows Audio Mixer, locate your audio playing application and assign a device
   - Done!
     - Launch the game, it should warn you about the SDK enabled
     - Enjoy!
     - Don't forget to set the *content* Output device back to your *Headset (or Default) Device* after you finished playing the game

<br>
<br>

## Works with ETS2 Local Radio

[ETS2/ATS Local Radio](https://github.com/Koenvh1/ets2-local-radio) plays the local stations of wherever you drive, in a browser tab. Trucker AUX takes any sound from the cable, so the radio plays from your cab speakers too:
  - Set up Local Radio according to its README
  - Route the browser with Local Radio tab to your *Virtual Input Device* (Windows Audio Mixer → the browser → Output device)
    - Windows sends the whole browser there, other tabs too: open the radio tab in a different browser, or use an extension that picks the audio device per tab, if you want the other tabs' sound not to be affected by Trucker AUX spatial

<br>
<br>

## Editing Presets

- **Coordinates:**
  - X goes right from the vehicle's center line;
  - Y goes up and Z goes back, from the driver's default head;
  - There is no consistency in cabin positions, so it end up being the most handy way
- **Bounds** only frame the views for placing speakers and don't affect the sound.
- **Free camera (ingame developer option)** can be used to (kind of) precisely position speakers. New speakers are created at the current camera position if free camera is active.
- **Shortcuts,** outside text fields:
  - Arrows for moving selected speakers, Shift+arrows by 10 cm, no Y movement yet;
  - Ctrl+A, Ctrl+C, Ctrl+V and Ctrl+D select all, copy, paste and duplicate;
  - Undo/Redo supported;
  - F2 to rename an unused preset.
- **Data** is kept within the app folder, `%APPDATA%` is not being bloated:
  - `data/layouts.json`: your presets;
  - `data/settings.json`: devices and options;
  - `data/profile/`: Chromium's profile;
  - `presets/`: the shared preset collection, read only: drop preset files (or folders of them) here to use them. Export (in the Presets panel) ticks presets in a tree and saves them, by default here;
  - `presets/default/`: the presets that come with the app, the bottom layer under yours and others' files. To update them for a build: Export the presets into `app/presets/default/` (and remove the old files); `npm run dist` ships it as it is.
  - When run from source, these folders are in `app/`.

<br>
<br>

## Workarounds and Limitations

- The game telemetry doesn't report the truck upgrades, so Day Cabs and Sleepers are distinguished by the fifth-wheel position. Ambiguities may appear on certain chassis.
- **Fallback method** (when *trucker_aux_camera.dll* doesn't read the game's camera, see below): The Camera Accessibility settings offsets are not counted towards Telemetry-reported head position, so I recommend to manually copy these settings in Trucker AUX app. 
  - Currently *supported* settings are **Steering camera rotation**, and **Blinker camera rotation**. 
  - Other camera-related parameters, like **Camera Shake**, are probably behave the same, but they are *not simulated* in Trucker AUX yet.
  - The **current camera mode** is not reported by the game either, the head position is just defaulted when not in FPV. The above-mentioned behavior is processed directly from the trucks steer and turn signal states, and *it keep affect the head's position even in third person camera modes.*
- **trucker_aux_camera.dll** (comes with the app) reads the game's own camera instead, so the steering and blinker camera rotation are taken as they are and outside cameras leave the sound alone; the status line then says *camera: game*. In the game's free camera (developer mode, key 0) the sound is heard from where the camera is (*camera: free*), and *+ Speaker* / *+ Pair* put new speakers at the camera. It reads the camera from the game's memory (the way ETS2LA does), so a game update may switch it off until it is updated: the *Game camera* settings above are the fallback.
- In the game's free camera the cab interior is the low-detail model

<br>
<br>

## [Repo Memes](./MEMES.md)

<br>
<br>

## My other mods (co-authored by Claude)

Lately, I've started modding games I play just as an experiment to see how far I can go with *complete AI-slop*. Just resting from my main activity that actually requires a brain. This mod encouraged me to start this repo so we could share presets and shit. You can check out my other little mods and tweaks for some random games here:
 [Vibe O'Drone Boosty](https://boosty.to/vibeodrone)

<br>
<br>

## License

MIT, see [LICENSE](LICENSE). Third-party parts keep their own licenses:

| part                                                                                      | license |
| ----------------------------------------------------------------------------------------- | ------- |
| scs-sdk-plugin and the SCS SDK headers in it                                              | MIT     |
| ETS2LA game plugin (the camera pattern and offsets borrowed for `trucker_aux_camera.dll`) | MIT     |
| Electron                                                                                  | MIT     |
| three.js                                                                                  | MIT     |
| koffi                                                                                     | MIT     |
