# Preset collection

Presets shared between people, one JSON file per preset. Trucker AUX reads every `.json`
file here, in subfolders too, and lists them under **Collection**. It never changes these
files: edits go to your own presets in `data/layouts.json`.

- **Add a preset:** drop its file here. The app picks it up without a restart and lists it
  as a shared file: it plays, but stays the file's.
- **Make presets yours:** press **Import…** in the Presets panel and pick the files. A file for
  a model becomes one of its variants, on the hooks it names that play nothing of yours; where
  one of yours plays, the app asks which should.
- **Share yours:** press **Export…** in the Presets panel (or in a key's right-click menu,
  or on the preset card), tick the presets in the tree and save them: one preset as a file,
  more as a folder. It is offered here first; zip a folder to share it.
- **Defaults:** the presets that come with the app are inside it, in this same format (in the
  source: `app/presets/default/`). They are the bottom layer: Auto plays your presets first,
  then a file from others (here), then the default. The tree marks them "default". Editing one
  makes a copy of yours in its place; the file is never changed, so a newer build's defaults
  reach every model you have not set up. A `default/` folder here, left by an older version
  unpacked over, is not read: it can be deleted.
- **Auto** plays your own presets first: what your vehicle (by plate) or the hook remembers,
  then the model's current variant. Then a file for this hook, one for the model, one for
  another hook of the model.

```json
{
  "truckerAuxPreset": 1,
  "name": "Kenworth T680 2014, sleeper",
  "vehicle": "vehicle.kenworth.t680@2.7",
  "vehicleName": "Kenworth T680 2014",
  "game": "ats",
  "author": "Your name",
  "layout": { "width": 1, "bounds": { "min": [-1.15, -1, -1], "max": [1.15, 1, 1] }, "speakers": [] }
}
```

- `vehicle` is the game's truck id: the file is a variant of that model. Add `@` and the
  fifth-wheel position in metres for the hook it plays on, as the app shows it ("hook 2.7 m");
  `"hooks": ["2.7", "3.6"]` names more hooks. Without `vehicle` the preset is only picked
  by hand.
- `vehicle` may also be a whole brand of a game (`brand:ats/kenworth`) or a game (`game:ats`): such a preset plays for every vehicle of it without a preset of its own.
- `vehicle` may be `all`: the preset for all vehicles. You always have your own for all vehicles, so such a file only plays when picked by hand; the one in `default/` is what a new install starts with.
- A preset for one of your vehicles (by plate) is exported for its hook: the plate stays private.
- `vehicleName` and `author` are optional. Export leaves `author` out for your own presets (add it by hand) and keeps a shared file's.
- `layout.label` (optional): a short tag, up to 32 characters, shown beside the keys that use the preset in the preset map; `layout.labelColor`: `gray`, `orange`, `green` or `red` (blue when left out).
- `game` (`ats` or `ets2`), `brand` (the game's brand id) and `brandName` are optional: they place the vehicle under its game and brand in the preset map before you have driven it. Export writes them when the game has told them, or a file it came from did.
- Coordinates are in metres:
  - X goes right from the vehicle's centre line;
  - Y goes up and Z goes back, from the driver's default head.
