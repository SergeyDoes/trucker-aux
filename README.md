# What is Trucker AUX

A helper application that allows to simulate 3D speakers of the vehicle in ETS2/ATS and route any audio stream through virtual speakers according to in-game head position.

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

## Features

- **Real head position:** The virtual speaker surround is synched with the in-game head position.
- **Play any audio you want.** Anything that can play audio to selected device (Windows Mixer setting per application, Audio device per browser tab extensions, etc.)
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

## Setup and Requirements

- **Prerequisites**:
  - Windows 10 or 11 (Tested with it, but older ones may probably work too)
  - American Truck Simulator or Euro Truck Simulator 2.
  - Virtual Audio Device, any of the following will work:
    - [Free] [VB-Audio Virtual Cable](https://vb-audio.com/Cable/)
    - [Paid] [Virtual Audio Cable](https://vac.muzychenko.net/en/)
    - [Free] Steam Streaming Microphone&Speakers (Installs automatically when trying to start a Remote Play stream)
  
  - Plain stereo headphones. Virtual surround (DTS Headphone:X, Windows Sonic, Dolby Atmos) would virtualize the binaural output a second time and may sound weird
- **Setup**:
  - Make sure you set up the Virtual Audio Device and both Input and Output device appear in your system
  - Place the **scs-telemetry.dll** at *[Game Folder]/bin/win_x64/plugins/*
    - Create the *plugins* folder if needed
   - Run the *Trucker AUX* application
     - Set your *Virtual Output Device* into **Input** field
     - Set your *Headset (or Default) Device* into **Output** field
     - Optionally fill in the *Game camera* settings to match in-game ones
   - Set your audio *content* **Output** device to *Virtual Input Device*
     - Open Windows Audio Mixer, locate your audio playing application and assign a device
   - Done!
     - Launch the game, it should warn you about the SDK enabled
     - Enjoy!
     - Don't forget to set the *content* Output device back to your *Headset (or Default) Device* after you finished playing the game

## Editing Presets

- **Coordinates:**
  - X goes right from the vehicle's centre line;
  - Y goes up and Z goes back, from the driver's default head;
  - There is no consistency in cabin positions, so it end up being the most handy way
- **Bounds** only frame the views for placing speakers and don't affect the sound.
- **Shortcuts,** outside text fields://sheeesh we have shortcuts?
  - arrows nudge the selected speakers, Shift+arrows by 10 cm;
  - Delete removes them, Esc clears the selection;
  - Ctrl+A, Ctrl+C, Ctrl+V and Ctrl+D select all, copy, paste and duplicate.
- **Data** is kept next to the app, `%APPDATA%` is not being bloated:
  - `app/data/layouts.json`: your presets;
  - `app/data/settings.json`: devices and options;
  - `app/data/profile/`: Chromium's profile;
  - `app/presets/`: the shared preset collection, read only: drop preset files (or folders of them) here to use them. Export (in the Presets panel) ticks presets in a tree and saves them, by default here;
  - `app/defaults/`: the presets that come with the app. On the first run they become your own presets, on their vehicles.
 
 - Presets included (made yours on the first run):
  

   | Vehicle | Notes
   |---|---|
   | Freightliner Cascadia
   | International 9900i | Day Cab and Sleeper
   | Kenworth T680 | Day Cab and Sleeper
   | Kenworth W900
   | Peterbilt 389
   | Volvo VNL | Sleeper
   | Western Star 49X | Day Cab and Sleeper
   | Ford F150 | Road Trip: Ford DLC
   | Ford Bronco | Road Trip: Ford DLC
   | Ford Mustang | Road Trip: Ford DLC
   | Ford Crown Victoria | Road Trip: Ford DLC

## Workarounds and Limitations

- The game telemetry doesn't report the truck upgrades, so Day Cabs and Sleepers are distinguished by the fifth-wheel position. Ambiguities may appear on certain chassis.
- The Camera Accessibility settings offsets are not counted towards Telemetry-reported head position, so I recommend to manually copy these settings in Trucker AUX app. 
  - Currently *supported* settings are **Steering camera rotation**, and **Blinker camera rotation**. 
  - Other camera-related parameters, like **Camera Shake**, are probably behave the same, but they are *not simulated* in Trucker AUX yet.


## My other mods (co-authored by Claude)

Lately, I've started modding games I play just as an experiment to see how far I can go with *complete AI-slop*. Just resting from my main activity that actually requires a brain. This mod encouraged me to start this repo so we could share presets and shit. You can check out my other little mods and tweaks for some random games here:
 [Vibe O'Drone Boosty](https://boosty.to/vibeodrone)

## License

MIT, see [LICENSE](LICENSE). Third-party parts keep their own licenses:

| part | license |
|---|---|
| scs-sdk-plugin and the SCS SDK headers in it | MIT |
| Electron | MIT |
| three.js | MIT |
| koffi | MIT |
