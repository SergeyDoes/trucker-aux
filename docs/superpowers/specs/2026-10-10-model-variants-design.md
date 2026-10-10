# Variants of a model: hooks and plates remember them

## Why

Chassis keys (`<truck id>@<hook>`) were how a model's cabs got presets of their own: the game
does not report the cab, the fifth-wheel position stands in for it (`docs/findings.md`). Then
variants on a key came (`2026-10-08-key-variants-design.md`): two cabs on one hook. With both,
a cab could be a chassis key or a variant, the tree grew a level per hook, and a new chassis got
a copy that drifted from its siblings. Variants alone cover it: a model has variants, and a hook
or one of your vehicles remembers which one it plays.

## Decisions

- **A model has variants:** your presets (`assignments[model]`, the model's current one, the
  last picked; `alternates[model]`, the others) and the shared files for the model or any of its
  hooks. A file one of your variants was made from (`copyOf`) or has the same speakers as is
  left out: yours stands for it.
- **Memories:** `assignments["<model>@<hook>"]` and `assignments["<model>#<plate>"]` stay in
  `layouts.json` but are no keys of the tree any more: they say which variant a hook, or one of
  your vehicles, plays. A preset on a plate that is not a variant of the model is that vehicle's
  own ("this vehicle only"): it plays there and nowhere else.
- **Auto:** your vehicle's plate, then the hook's memory, then a file for this hook, then the
  model's current variant, then a file for the model, then a file for another hook of it, then
  brand, game, all vehicles. No "another chassis" step: all of a model's presets are its variants.
- **A hook seen for the first time** remembers what it plays from the model (its current variant,
  or a file for the model): later picks on other hooks do not move it. A file for that very hook
  plays without a memory. A model with no variant at all gets its first one, a copy of what it
  inherits, labelled "new" (as a new chassis did).
- **Picking a variant** (the card, the tree's Variants submenu on the model in the game, the
  cycle buttons of `2026-10-10-controls-voice-design.md` excepted: those are temporary) makes it
  the model's current one and remembers it on the plate for your own vehicle (not a quick job),
  else on the hook. Picking in the tree on another model only makes it current.
- **Edits** go to the variant that plays, so every hook and vehicle remembering it changes too.
  Editing a file makes your copy (`copyOf` the file), which takes the file's place in the model's
  memories and as its current one, and on the file's hooks not remembered yet.
- **The tree:** all vehicles › game › brand › model. A model shows the variant that plays in the
  vehicle in the game (other models: their current one), "+N" for the rest; the Variants
  submenu lists them all (a vehicle's own marked with its plate; a tooltip says where each is
  remembered), makes a new one (a copy of what plays, which plays at once) and takes one off (its
  memories go; the preset stays, among the unused when on no other key).
- **The card:** the Variant row lists the model's variants and this vehicle's own; Applies to is
  this vehicle (your own), the model, the brand, the game, all vehicles. "This vehicle" makes
  the preset that vehicle's own (moved off the model, or a copy); the model adds it as a variant
  that plays here. Unbind takes the variant off the model (or frees the plate).
- **Files:** `vehicle` is the model, or `<model>@<hook>`; an optional `hooks` list names more
  hooks the file is for. Export gives every variant a file: the first hook remembering it in
  `vehicle`, all of them in `hooks` when more than one; a vehicle's own goes for its hook, so the
  plate stays private. Older builds read such a file as for its first hook.
- **Import:** a file becomes a variant of its model, never a clash of keys; it takes the hooks it
  names that remember nothing yet (the model's current place when it names none and the model
  has none). Hooks (or the model) that remember a preset of yours are listed; ticked ones play
  the imported one.
- **Migration** (`foldChassis`, every load, nothing lost): presets on chassis keys become
  variants of their model (the first by hook is current when the model had none); the chassis
  keys stay as memories; variants waiting on a chassis key move to the model.
- **Store:** version 3 stays. An older build shows the hooks remembered as chassis keys holding
  the same presets, and the model's variants as before.

## The pure parts (`shared/presets.js`)

- `foldChassis(store)`; `alternatesOf(store, model)` with the model's files and memories;
  `personalOf(store, model)`: `[{ key, plate }]`.
- `autoPreset` as above (`how`: vehicle, chassis, collectionChassis, model, collectionModel,
  collectionSibling, brand, game, all and their collection forms).
- `adoptVehicle(store, truck)` (was `adoptNewChassis`); `chooseVariant(store, truck, key)`;
  `dropAlternate` forgets a variant's memories on a model; `newAlternate(store, scope, truck,
  from)` plays the new one in the vehicle in the game.
- `routeEdit` in Auto: what plays, when it is yours from the plate, the hook or the model; a file
  of the model becomes your copy in its place; a model without variants gets its first one.
- `scopesOf(store, key)`: where a preset shows (models it is a variant of, plates it is the own
  preset of, brand, game, all), memories left out.
- `scopeLadder` without the chassis; `planScope`, `planMove(store, from, to, truck, key)` and
  `applyScope` put a preset on a model as a variant (nothing taken there) and take it off one with
  its memories.
- `presetTree` without hooks and plates; `importPresets`, `importClashes`, `exportFiles` with
  hooks.
- `shared/collection.js`: `hooks` read (with the vehicle's own hook) and written; `layout.js`
  keeps `copyOf` (a "file:" key).
