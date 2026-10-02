// The preset collection: presets shared between people, one JSON file per preset in
// presets/ next to the data folder (main/collection.js reads it). The app only reads
// these files; edits go to your own presets in layouts.json (presets.js).
//
//   { "truckerAuxPreset": 1, "name": "...", "vehicle": "<truck id>[@<hook>]",
//     "vehicleName": "...", "author": "...", "layout": { width, bounds, speakers } }
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
      name,
      vehicle: vehicle && !vehicle.includes('#') ? vehicle : null,
      vehicleName: optionalText(raw.vehicleName),
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
export function presetFile({ name, vehicle, vehicleName, layout }) {
  return {
    truckerAuxPreset: PRESET_FORMAT,
    name,
    ...(vehicle ? { vehicle } : {}),
    ...(vehicleName ? { vehicleName } : {}),
    layout: { width: layout.width, bounds: layout.bounds, speakers: layout.speakers },
  };
}

// A file name Windows accepts, from a preset's name.
export function presetFileName(name) {
  const safe = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .replace(/[. ]+$/, '')
    .trim();
  return `${safe || 'preset'}.json`;
}
