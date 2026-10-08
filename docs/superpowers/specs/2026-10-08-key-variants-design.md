# Variants on a key: two cabs on one chassis

## Why

The game tells cabs apart only by where the fifth wheel sits (`docs/findings.md`, "Cab variants
of one truck"). Some chassis carry two cabs on the same hook: the Kenworth W900 on 3.6 m comes
with a sleeper and a studio sleeper, each needing its own speakers. A key holds one preset, so the
second one waited among the unused presets, picked by hand each time. Telling the cabs apart by
other telemetry is for later.

## Decisions

- **A key may hold variants:** one plays (the key's preset, `assignments[scope]` as now), the
  others wait on the key (`store.alternates[scope]`: your presets, in order). Shared files and
  defaults for one key are variants of each other too: several files with the same `vehicle`.
- **Which variant plays** is remembered on the key; for your own vehicle (a plate, not a quick
  job) the choice goes on "this vehicle" instead, so your W900 keeps its cab while quick-job ones
  follow the chassis.
- **The card** shows "Variant [▾]" when the vehicle's chassis (the model without one) has two or
  more; picking one plays it at once.
- **The key tree** shows the playing variant's badge and "+N" for the others; its menu lists the
  variants to play, makes a new one (a copy of what plays, named by the key's path, labelled
  "new"), and takes the playing one off (the next one plays; the preset stays, among the unused
  when on no other key).
- **Dropping a preset on a key with one of yours** offers "Add as a variant" beside moving or
  copying it there: the dropped one plays, the other waits as a variant.
- **Import** never pushes a preset of yours to the unused ones: a file for a key that has yours
  either plays there (ticked) with yours kept as a variant, or waits there as a variant.
- **Export** of a key gives every variant of yours a file of its own, for the same key; that is
  no clash.
- **Edits** go to what plays. A preset labelled "new" (one the app made) loses the label at its
  first edit, so the tree shows what is still untouched.
- **Store:** version 3 stays; `alternates` is optional, kept only for presets that exist, are not
  the key's playing one, once each. An older build drops it, and the variants show among the
  unused presets there.

## The pure parts (`shared/presets.js`)

- `alternatesOf(store, scope)`: `[{ key, name, label, labelColor, file, default, active }]`, the
  playing one first, then yours waiting, then the files for the key not playing.
- `pickAlternate(store, scope, key)`: the key's playing variant; the one that played waits (a
  file needs no place: it is the key's by its `vehicle`).
- `addAlternate(store, scope, key)`, `dropAlternate(store, scope, key)`, `newAlternate(store,
  scope, truck)`.
- `variantChoice(store, truck)`: `{ scope, value, options }` for the card, or null under two;
  `chooseVariant(store, truck, key)`: on the plate key for your own vehicle, else on the key.
- `presetTree`: a node's `alternates` (the variants not playing); the unused presets leave out
  those waiting on a key. `deletePreset` takes a preset off every key's variants.
