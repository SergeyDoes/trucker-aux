# Variants on a key: implementation plan

Spec: `docs/superpowers/specs/2026-10-08-key-variants-design.md`. TDD for the pure parts
(`npm test`), the UI checked in a sandbox (a copy of the user's data with the W900 sleeper and
studio).

1. `layout.js normalizeStore`: keep `alternates` (existing presets, not the playing one, once
   each, empty lists dropped); test in `layout.test.js`.
2. `presets.js`: `alternatesOf`, `pickAlternate`, `addAlternate`, `dropAlternate`,
   `newAlternate`, `variantChoice`, `chooseVariant`; `deletePreset` and `presetTree`
   (`alternates` per node, unused without the waiting ones); tests.
3. `importPresets`: a clash keeps both on the key (ticked: the file's plays, yours waits;
   unticked: the file's waits); `exportFiles`: variants of one key are no clash; tests.
4. `editLayout`: the label "new" goes at the first edit that is not the label itself; test.
5. UI: the card's Variant row (`app.js` view, `panel.js`), the tree's "+N" and menu
   (`key-tree.js`), "Add as a variant" in the drop dialog (`app.js carryOut`), the export
   window's items (`export-dialog.js`), the import dialog's wording.
6. The user's data: the W900 sleeper from the unused presets onto `vehicle.kenworth.w900@3.6`
   as a variant (a backup first, with the app closed).
7. PLAN, README_CLAUDEGENERATED.
