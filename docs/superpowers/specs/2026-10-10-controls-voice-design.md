# Controls: cycle the variants from the cab, told by voice

## Why

A model's variants (`2026-10-10-model-variants-design.md`) are picked in the app, which sits
behind the game. In the cab a key or a button on the wheel should step through them, and a voice
should say which one plays, since the game shows nothing of ours.

## Decisions

- **Actions:** Next variant, Previous variant, Auto. Each is bound to a key, a controller button,
  or a combination of up to three of them, mixed (`LB + D-pad up`, `Ctrl + F9`).
- **Cycling** steps through the model's variants (`alternatesOf`: yours and the files; a
  vehicle's own preset is skipped) from the one that plays, and plays the next one as if picked
  in the list ("tried with the controls" on the card, which offers Back to Auto). Nothing is
  remembered while trying. One variant: nothing changes, the voice says "One variant". No
  vehicle: "No vehicle".
- **Auto** goes back to Auto: the variant that fitted the cab when you got in (plate, hook,
  model and so on), as nothing was remembered since.
- **Getting out** (another vehicle, or the game gone) after trying: the variant tried stays the
  cab's, remembered as a pick on the card is (`chooseVariant`: your vehicle's plate, else the
  hook; the model's current one), undoable. Auto before getting out keeps nothing.
- **Voice:** what plays then, its label, else "variant N" ("Auto, studio" for Auto). Offline
  Windows speech (System.Speech, an English voice), in a PowerShell helper the app starts at the
  first phrase (or at start when something is bound) and ends on quit. Three ways
  (`settings.voice`): Off; System, on the Output device over everything (no virtual speakers,
  not muted by Mute when, not at the music's volume; through the limiter); AUX, from the cab's
  speakers as the music is (the width, the speakers, muted with it, at its volume). A volume of
  its own (`settings.voiceVolume`, 0–200 % as the music's). A newer phrase cuts an older one
  short. No helper (no PowerShell, no voice installed): no voice, one warning.
- **Input** is polled in the main process at 50 Hz, whatever window has the focus: the keyboard
  with `GetAsyncKeyState` (no mouse buttons; Ctrl, Shift and Alt as one key each side), and up to
  16 controllers with the Windows joystick API (`winmm` `joyGetPosEx`: wheels, button boxes,
  pads; 32 buttons and the hat as four directions; an Xbox pad's triggers are an axis there, not
  buttons). Controllers are looked for every 2 s, so one plugged in later works.
- **Ids:** `key:<virtual key>`, `joy:<vid>:<pid>:<button 1..32>` or `joy:<vid>:<pid>:pov-up|right|down|left`
  (hex VID and PID, lower case): a binding outlives a replug and a changed joystick number; two
  identical controllers are one.
- **Firing:** a binding fires when its last input goes down while the rest are held; other inputs
  held do not matter (a key held to drive). Of the bindings that fire at once the longest wins,
  so `Ctrl + F9` does not also fire `F9`.
- **The game sees them too:** polling takes nothing from the game, so the hint says to pick keys
  and buttons it does not use.
- **Binding:** a Controls fieldset (after Audio): a button per action showing its binding ("Not
  set"); a click asks to press the combination; it is taken when everything is let go (what was
  held at the most, up to three); Escape (on any window) or a second click cancels; × clears.
  Controllers are named as Windows names them (the joystick OEM name in the registry), else
  "Controller 045E:028E".
- **Settings:** `controls: { next: [ids], previous: [ids], auto: [ids] }`, `voice: 'off' |
  'system' | 'aux'` (true from the first version: 'system'), `voiceVolume` (0..2).

## Parts

- `shared/controls.js` (pure): `normalizeBinding`, `bindingWatch(bindings)` (held sets in,
  actions out), `captureWatch()`, `bindingText(ids, names)`, key names.
- `main/controls.js`: the poller (koffi: user32, winmm, advapi32 for the names); bindings set
  from the renderer; capture; sends `controls:action`.
- `main/voice.js`: the PowerShell helper; `voice:speak(text)` gives WAV bytes.
- `renderer`: the Controls fieldset (`panel.js`: bindings, Voice, Voice volume), the actions,
  the getting-out keep and the voice in `app.js`; `engine.voice` and `engine.setVoice(mode,
  gain)` (System into the limiter, AUX into the input); `presets.js cycleVariant(store, truck,
  from, step)`.
