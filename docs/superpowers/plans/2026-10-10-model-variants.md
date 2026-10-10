# Variants of a model: implementation plan

Spec: `docs/superpowers/specs/2026-10-10-model-variants-design.md`. TDD for the pure parts
(`npm test`), the UI checked in a sandbox (a copy of the user's data folder, the presets
folder of the build).

1. `layout.js normalizeLayout` keeps `copyOf` (a "file:" key); `collection.js` reads and writes
   `hooks` (`entry.hooks`: the vehicle's hook and the listed ones, sorted, once each); tests.
2. `presets.js`, the model's variants: `alternatesOf` for a model (its files and hook memories;
   a file copied by one of yours left out), `personalOf`, `foldChassis`, `dropAlternate` and
   `unassign` forgetting memories, `pickAlternate`; tests rewritten from the chassis ones.
3. `autoPreset` (the new ladder), `adoptVehicle`, `chooseVariant`, `newAlternate` playing in the
   vehicle, `variantChoice` with this vehicle's own, `routeEdit`/`editLayout` (what plays is
   yours; a file's copy takes its place; a model's first variant), `scopePreset` for a model;
   tests.
4. `scopesOf`, `scopeLadder`, `currentScope`, `planScope`, `planMove(…, key)`, `applyScope`
   (a model takes a variant; leaving one forgets its memories), `truckStatus`, `presetOptions`;
   tests.
5. `presetTree` (all › game › brand › model; shown variant, alternates with hooks, plates and
   personal), `importPresets`/`importClashes` and `exportFiles` with hooks; tests.
6. `main.js` folds the store at load; `app.js` (adoptVehicle, playVariant/newVariant on the model
   in the game, dropVariant, drag to the unused, export ticks without vehicles' own presets),
   `key-tree.js` (Variants submenu with where each is remembered, Take this variant off, hint),
   `export-dialog.js` (ids of variants), panel card titles.
7. Sandbox check with the user's data and the defaults (W900 3.6, International LT, a new
   hook, a new model, an edit of a default, export and import); `docs/findings.md` untouched;
   PLAN, README_CLAUDEGENERATED, README's "Presets per vehicle".
