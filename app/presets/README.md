# Preset collection

Presets shared between people, one JSON file per preset. Trucker AUX reads every `.json`
file here, in subfolders too, and lists them under **Collection**. It never changes these
files: edits go to your own presets in `data/layouts.json`.

- **Add a preset:** drop its file here. The app picks it up without a restart.
- **Share yours:** press **Export** in the Layout panel. The preset that plays is saved
  here, and Explorer shows the file.
- **Auto** plays your own presets first. Then it plays a file for this chassis, then one
  for the model, then one for another chassis of the model.

```json
{
  "truckerAuxPreset": 1,
  "name": "Kenworth T680 2014, sleeper",
  "vehicle": "vehicle.kenworth.t680@2.7",
  "vehicleName": "Kenworth T680 2014",
  "author": "Your name",
  "layout": { "width": 1, "bounds": { "min": [-1.15, -1, -1], "max": [1.15, 1, 1] }, "speakers": [] }
}
```

- `vehicle` is the game's truck id. Add `@` and the fifth-wheel position in metres for
  one chassis, as the app shows it ("hook 2.7 m"). Without `vehicle` the preset is only
  picked by hand.
- `vehicleName` and `author` are optional. Export leaves `author` out: add it by hand.
- Coordinates are in metres:
  - X goes right from the vehicle's centre line;
  - Y goes up and Z goes back, from the driver's default head.
