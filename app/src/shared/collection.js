// The preset collection: presets shared between people, one JSON file per preset in
// presets/ next to the data folder (main/collection.js reads it). The app only reads
// these files; edits go to your own presets in layouts.json (presets.js).
//
//   { "truckerAuxPreset": 1, "name": "...", "vehicle": "<truck id>[@<hook>]",
//     "vehicleName": "...", "game": "ats" | "ets2", "brand": "<brand id>", "brandName": "...",
//     "author": "...", "layout": { width, bounds, speakers } }
//
// game and brand (optional) place the vehicle in the preset map before it is driven; the game
// reports both, so Export writes them when it knows the vehicle.
//
// vehicle is a model or chassis key as in layouts.json, never a plate: plates are
// personal (and random in quick jobs). Without it the preset is only picked by hand.
import { normalizeLayout } from './layout.js';

export const PRESET_FORMAT = 1; // coordinates as in store version 2
const PREFIX = 'file:';

// Collection keys: "file:<path inside presets/, with />".
export const isCollectionKey = (key) => typeof key === 'string' && key.startsWith(PREFIX);

const optionalText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// raw: the parsed JSON of presets/<file>. Gives { entry } or { warning }.
export function parsePresetFile(raw, file) {
  const where = `presets/${file}`;
  const format = raw && typeof raw === 'object' ? raw.truckerAuxPreset : undefined;
  if (typeof format === 'number' && format > PRESET_FORMAT) {
    return { warning: `${where} is made by a newer Trucker AUX (format ${format}).` };
  }
  if (format !== PRESET_FORMAT) return { warning: `${where} is not a Trucker AUX preset.` };
  if (!raw.layout || typeof raw.layout !== 'object') return { warning: `${where} has no layout.` };
  const name = optionalText(raw.name) ?? file.split('/').pop().replace(/\.json$/i, '');
  const vehicle = optionalText(raw.vehicle);
  return {
    entry: {
      key: `${PREFIX}${file}`,
      file,
      default: file.startsWith('default/'), // shipped with the app: the bottom layer
      name,
      vehicle: vehicle && !vehicle.includes('#') ? vehicle : null,
      vehicleName: optionalText(raw.vehicleName),
      game: raw.game === 'ats' || raw.game === 'ets2' ? raw.game : null,
      brand: optionalText(raw.brand),
      brandName: optionalText(raw.brandName),
      author: optionalText(raw.author),
      layout: normalizeLayout({ ...raw.layout, name }, name),
    },
  };
}

// How the list shows a collection preset.
export function collectionLabel(entry) {
  return entry.author ? `${entry.name} — ${entry.author}` : entry.name;
}

// The file to share a layout; fields without a value are left out.
export function presetFile({ name, author, vehicle, vehicleName, game, brand, brandName, layout }) {
  return {
    truckerAuxPreset: PRESET_FORMAT,
    name,
    ...(author ? { author } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(vehicleName ? { vehicleName } : {}),
    ...(game ? { game } : {}),
    ...(brand ? { brand } : {}),
    ...(brandName ? { brandName } : {}),
    layout: {
      ...(layout.label ? { label: layout.label } : {}),
      ...(layout.labelColor ? { labelColor: layout.labelColor } : {}),
      width: layout.width, bounds: layout.bounds, speakers: layout.speakers },
  };
}

// A file name Windows accepts, from a preset's name.
export function presetFileName(name) {
  const safe = name
    .replace(/ › /g, ', ') // a key's path ("ATS › Kenworth › …") reads better so in a file name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .replace(/[. ]+$/, '')
    .trim();
  return `${safe || 'preset'}.json`;
}
