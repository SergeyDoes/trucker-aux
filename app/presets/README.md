# Preset collection

Presets shared between people, one JSON file per preset. Trucker AUX reads every `.json`
file here, in subfolders too, and lists them under **Collection**. It never changes these
files: edits go to your own presets in `data/layouts.json`.

- **Add a preset:** drop its file here. The app picks it up without a restart and lists it
  as a shared file: it plays, but stays the file's.
- **Make presets yours:** press **Import…** in the Presets panel and pick the files. Each goes
  on the key its file says; where you have a preset, the app asks which to replace.
- **Share yours:** press **Export…** in the Presets panel (or in a key's right-click menu,
  or on the preset card), tick the presets in the tree and save them: one preset as a file,
  more as a folder. It is offered here first; zip a folder to share it.
- **Defaults:** the presets that come with the app are in `default/`, in this same format.
  They are the bottom layer: on each key Auto plays your preset first, then a file from others
  (here, outside `default/`), then the default. The tree marks them "default". Editing one
  gives that key a copy of yours; the file is never changed, so a newer build's defaults
  reach every key you have not set up. Don't edit `default/`: a new version replaces it.
- **Auto** plays your own presets first. Then it plays a file for this chassis, then one
  for the model, then one for another chassis of the model.

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

- `vehicle` is the game's truck id. Add `@` and the fifth-wheel position in metres for
  one chassis, as the app shows it ("hook 2.7 m"). Without `vehicle` the preset is only
  picked by hand.
- `vehicle` may also be a whole brand of a game (`brand:ats/kenworth`) or a game (`game:ats`): such a preset plays for every vehicle of it without a preset of its own.
- `vehicle` may be `all`: the preset for all vehicles. You always have your own for all vehicles, so such a file only plays when picked by hand; the one in `default/` is what a new install starts with.
- A preset for one of your vehicles (by plate) is exported for its chassis: the plate stays private.
- `vehicleName` and `author` are optional. Export leaves `author` out for your own presets (add it by hand) and keeps a shared file's.
- `layout.label` (optional): a short tag, up to 16 characters, shown beside the keys that use the preset in the preset map; `layout.labelColor`: `gray`, `orange`, `green` or `red` (blue when left out).
- `game` (`ats` or `ets2`), `brand` (the game's brand id) and `brandName` are optional: they place the vehicle under its game and brand in the preset map before you have driven it. Export writes them when the game has told them, or a file it came from did.
- Coordinates are in metres:
  - X goes right from the vehicle's centre line;
  - Y goes up and Z goes back, from the driver's default head.
