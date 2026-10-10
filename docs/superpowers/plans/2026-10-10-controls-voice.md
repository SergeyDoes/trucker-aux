# Controls and voice: implementation plan

Spec: `docs/superpowers/specs/2026-10-10-controls-voice-design.md`. After the model variants
(`2026-10-10-model-variants.md`). TDD for the pure parts; the poller and the voice checked by
hand (the user's Xbox 360 pad is seen by `winmm`).

1. `shared/controls.js`: ids, `normalizeBinding`, `bindingWatch` (last input down fires, the
   longest wins, held extras ignored), key names, `bindingText`; `settings.js` `controls` and
   `voice`; tests.
2. `presets.js cycleVariant(store, truck, from, step)`: the model's variants without a vehicle's
   own; `{ key, index, count }` or null; tests.
3. `main/controls.js`: koffi poller (keys, joysticks scanned every 2 s), names from the registry,
   capture (Escape cancels), `controls:action`; `preload.cjs` and `main.js` wiring.
4. `main/voice.js`: the PowerShell System.Speech helper (lazy, killed on quit), `voice:speak`.
5. `engine.js` `voice` input before Volume; `app.js` actions (next, previous, auto), the cycled
   pick ending on another vehicle, speaking; `panel.js` Controls fieldset (bind, ×, Voice).
6. Sandbox check (bind a key and a pad button, cycle, Auto, voice on the output device);
   PLAN, README_CLAUDEGENERATED, README.
