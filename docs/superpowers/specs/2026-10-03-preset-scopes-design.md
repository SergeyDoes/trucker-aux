# Preset Scopes and the Preset Map — Design

Date: 2026-10-03. Status: done (steps 1–3). Dragging in the map is left for later. The user agreed on the direction in chat: a preset moves up and down a ladder of scopes, with a warning when that takes a scope from another preset (which stays, unassigned), and a choice between moving and copying when it goes down; a view of all presets as a tree. Open questions are at the end.

## Context

Today a preset's key is its scope (`presets.js`): `vehicle.peterbilt.389#WP-83695` (this vehicle), `vehicle.peterbilt.389@2.6` (this chassis), `vehicle.peterbilt.389` (the model); `custom.N` belong nowhere; the default layout is separate (`store.default`). Bindings (`assignments`) point a vehicle or chassis at another preset. Auto plays the narrowest scope that exists, then the collection, then another chassis, then the default.

Two problems came up in use:
- A preset cannot change its scope. Making the Peterbilt 389 preset play in every Peterbilt, or narrowing it to one chassis, means copying and deleting by hand.
- The card shows one vehicle's chain; nothing shows what plays where across all vehicles.

## Goals

1. A ladder of scopes, narrowest first: **this vehicle** (plate) → **this chassis** (fifth wheel) → **the model** → **the brand** → **the game** (ATS / ETS2) → **all vehicles**. The default layout becomes the preset of "all vehicles".
2. The card's "Applies to" becomes a choice on that ladder: the preset that plays moves (or is copied) to another scope.
3. A preset exists on its own and may be unassigned. Taking a scope from a preset never deletes it.
4. A preset map: the scopes as a tree, with what each plays.

## Non-goals

- A list of all vehicles in the game (the telemetry has none): the map shows only scopes that hold a preset, plus the vehicle in the game.
- Telling trucks from cars (no reliable signal: config values keep the previous vehicle's, `docs/findings.md`).
- Changing collection files: they stay read-only.

## Data

`layouts.json` version 3.

```json
{
  "version": 3,
  "presets": { "p.1": { "name": "Peterbilt 389", "width": 1, "bounds": {}, "speakers": [] } },
  "assignments": {
    "all": "p.0",
    "game:ats": "p.4",
    "brand:ats/peterbilt": "p.1",
    "vehicle.peterbilt.389@2.6": "p.2",
    "vehicle.peterbilt.389#WP-83695": "p.3"
  },
  "vehicles": { "vehicle.peterbilt.389": { "name": "Peterbilt 389", "game": "ats", "brand": "peterbilt", "brandName": "Peterbilt" } }
}
```

- **`presets`**: every layout of yours, keyed `p.N`, with no meaning in the key. The default layout is one of them.
- **`assignments`**: scope → preset. One preset may hold several scopes; a scope holds at most one of your presets. A preset with none is **unassigned** (today's Custom).
- **Scope keys:** `all`; `game:<ats|ets2>`; `brand:<game>/<brand id>`; model `<truck id>`; chassis `<truck id>@<hook>`; vehicle `<truck id>#<plate>`. Brands are per game: Volvo in ATS and in ETS2 are separate scopes.
- **`vehicles`**: what the app has learned about each model it has seen in the game (name, game, brand), so the map and the list can name and place models you are not driving. Updated whenever a vehicle loads.
- **Collection files** keep format 1: `vehicle` is a model or chassis key. A file acts as an assignment of its scope that yields to yours (as now). Brand, game and all-vehicle files are left for later.

**Telemetry:** add `scs_values.game` @52 (1 ETS2, 2 ATS) to the truck, and the brand id (already read, @2300) and brand name (@2364) as separate fields.

**Migration from version 2** (once on load, the original kept as `layouts.v2.json`, as for v1):
- `default` → a preset assigned to `all`;
- each truck preset `<key>` → a preset assigned to `<key>`;
- `custom.N` → an unassigned preset;
- each binding `<scope>: <key>` → `<scope>` assigned to that preset; bindings to `file:` keys stay as they are;
- `vehicles` starts empty and fills as you drive (until then the map files such models under "Unknown game").

## Auto

The narrowest scope of the vehicle's chain that holds a preset:

1. this vehicle; 2. this chassis; 3. the model; 4. the collection's file for this chassis, then for the model (after your own of both, as now: a file dropped into `presets/` never takes over a truck you have set up); 5. **another chassis of the model**, yours then a file's (as now: a better guess than anything wider, as the cab is the same model); 6. the brand; 7. the game; 8. all vehicles.

The Auto entry and the card name the scope that plays ("(all Peterbilt)", "(all ATS)").

**Editing in Auto** stays as decided in E2.10: edits go to the preset that plays when its scope is this vehicle, this chassis, or the model on a model without chassis variants; anything wider (the model shared by all chassis, another chassis, the brand, the game, all vehicles, a file) first makes a copy for this chassis. The card's note says so.

## Moving a preset

The card's **Applies to** becomes a dropdown of the vehicle's ladder. Each entry says what holds it now:

```
Applies to: [ this chassis (hook 2.6 m) ▾ ]
              this vehicle  WP-83695
            • this chassis  hook 2.6 m
              Peterbilt 389            — "Peterbilt 389 (old)"
              all Peterbilt
              all ATS vehicles
              all vehicles             — "Default layout"
```

Picking another entry moves the preset that plays from its scope on this vehicle's chain to the picked one. A file cannot move: picking a scope for it first makes your own copy, which moves (the file is not changed).

**Up** (a wider scope):
- If the target holds another preset, a confirmation names it: "*Peterbilt 389 (old)* will no longer apply to Peterbilt 389. It stays in the list, unassigned." OK / Cancel.
- Scopes **between** the old and the new one on this vehicle's chain that hold other presets would keep playing here, as they are narrower. The same dialog lists them with a checkbox each, on by default: "Also unassign *X* from Peterbilt 389 (otherwise it keeps playing in this vehicle)". Without that the move would seem to do nothing.
- The old scope is freed.

**Down** (a narrower scope), a dialog with two choices:
- **Move**: the preset leaves the wider scope. "Other chassis of Peterbilt 389 will play: *all Peterbilt* / the default layout" (what Auto would pick for them, if known).
- **Copy for here**: the wider scope keeps the preset; a copy ("<name>, hook 2.6 m" as today) takes the narrower one.
- If the narrower target holds a preset, the confirmation from "Up" applies too.

**"All vehicles"** must always hold a preset (it is what plays when nothing else does): moving its preset away asks to copy instead, and taking it unassigns the old one with the same warning.

**Using a preset in more places** stays: a preset picked in the list gets "Use it in: <scope ▾>", which adds an assignment and takes the preset away from nobody (with the same warning if the scope is taken). Unassign (from the card or the map) removes one assignment; the preset stays.

**Delete** removes a preset and its assignments, with a confirmation that lists them. The "all vehicles" preset cannot be deleted.

## The preset list

- Auto, then **your presets by name**; a preset that holds scopes shows the narrowest ("Peterbilt 389 — all Peterbilt"); an **Unassigned** group (today's Custom); **Collection**.
- "Default layout" is no longer a separate entry: it is the preset that holds "all vehicles".

## The preset map

A button "Preset map" opens an overlay over the views (Esc or the button closes it):

```
All vehicles ............................... Default layout
├─ ATS ..................................... (all vehicles)
│  ├─ Kenworth ............................. (all vehicles)
│  │  └─ T680 2014 ......................... (all vehicles)
│  │     ├─ hook 1.3 m ..................... Kenworth T680 2014, hook 1.3 m
│  │     └─ hook 2.7 m ..................... Kenworth T680 2014, hook 2.7 m
│  └─ Peterbilt ............................ Peterbilt
│     └─ 389 ● ............................. (all Peterbilt)
│        └─ hook 2.6 m · WP-83695 ●......... "Custom 2"
└─ ETS2 .................................... (all vehicles)
Unassigned: Custom 1, Peterbilt 389 (old)
Collection: …
```

- Nodes: every scope that holds a preset (yours or a file's), their parents, and the chain of the vehicle in the game (●).
- Each node: its own preset in normal text; otherwise what it inherits, grey, in brackets.
- Click a preset: picks it in the list. Each own preset has "Unassign".
- Later (not in this step): drag a preset onto a node to move it there.

An overlay, not a second window: the state lives in the renderer, and a window would need it synced over IPC. If the map is wanted on a second monitor, it can become a window later.

## Errors

- A scope in `assignments` pointing at a missing preset is dropped on load (as now).
- Two assignments of one scope cannot exist (an object key).
- A vehicle without a game id (an old plugin) has no game and brand scopes in its ladder.

## Testing

- `presets.test.js`: Auto order on the new ladder, with files at each scope; moving up with and without a taken target, with narrower scopes in between; moving down by move and by copy; "all vehicles" never left empty; delete and unassign.
- `store.test.js`: migration v2 → v3 (default, truck presets, custom, bindings, `file:` bindings), the backup file.
- `telemetry.test.js`: game and brand fields.
- The map as a pure function (`presetTree(store, truck)` → nodes) with tests; the overlay checked by hand.

## Delivery

1. Data: version 3, migration, telemetry game and brand, `vehicles`; Auto on the new ladder; the list. No UI for moving yet; everything else works as before. **Done**, with these differences from before:
   - the list has no separate "Default layout" entry: the preset of all vehicles is listed as "Default layout — all vehicles"; it can be renamed, not deleted; custom presets are the "Unassigned" group;
   - "Unbind" frees a scope and keeps the preset (it used to delete a vehicle's own copy); a chassis's or a model's own preset can be unbound too;
   - "Use it in" asks first when the scope has another preset, which then stays unassigned;
   - a model you have not driven since the migration is named after your preset for it, else its id made readable ("peterbilt 389").
2. "Applies to" on the card with the dialogs; "Use it in" with a scope choice; unassign. **Done** (`scopeLadder`, `currentScope`, `planScope`, `applyScope`; the dialogs in `renderer/dialog.js`), with these additions:
   - "Own preset for this chassis" and "Only this vehicle" are gone: picking "this chassis" or "this vehicle" in Applies to does the same (a copy when what plays is wider, from another chassis or a file);
   - when what plays is not on this vehicle's ladder (another chassis's, a shared file), the dropdown's first entry says where it comes from, and picking a scope makes a copy there;
   - the dialog also warns when a shared file for this chassis or the model is narrower than the target and would keep playing (files cannot be unassigned);
   - debug only: `TRUCKER_AUX_FAKE_TRUCK='{"key":…,"name":…,"variant":…}'` stands for the game (`main.js`), for trying the card without it.
3. The preset map. **Done** (`presetTree`, `renderer/preset-map.js`): an overlay over the views and the 3D view, opened with "Preset map" under the preset list; Esc or Close shuts it, and while it is open the speaker keys do nothing (the views are hidden). Also:
   - the vehicle in the game sits under its chassis; other single vehicles under their model (their chassis is not known);
   - models from shared files are named by the files' `vehicleName`; a brand never driven by its id with a capital letter.

## Open questions

- **Brand scope.** Layouts depend on the cab, and one brand mixes very different ones (Ford: F-150, Mustang, Bronco, Crown Victoria). Kept for now, as it costs little; dropped if it proves useless.
- **Game scope.** Only matters if you play both games. Kept: it costs little and gives each game its own default.
- **Another chassis before the brand** (Auto step 4): today's behaviour, kept. The alternative is to treat it as weaker than the brand.
