// The preset collection: presets shared between people, one JSON file per preset in
// presets/ next to the data folder (main/collection.js reads it). The app only reads
// these files; edits go to your own presets in layouts.json (presets.js).
//
//   { "truckerAuxPreset": 1, "name": "...", "vehicle": "<truck id>[@<hook>]", "hooks": ["<hook>"],
//     "vehicleName": "...", "game": "ats" | "ets2", "brand": "<brand id>", "brandName": "...",
//     "author": "...", "layout": { width, bounds, speakers } }
//
// game and brand (optional) place the vehicle in the preset map before it is driven; the game
// reports both, so Export writes them when it knows the vehicle.
//
// vehicle is a model or chassis key as in layouts.json, never a plate: plates are
// personal (and random in quick jobs). Without it the preset is only picked by hand.
// hooks (optional) names more hooks of the model the file plays on (a variant several chassis
// share); an older build reads the file as for the hook in vehicle.
import { normalizeLayout } from './layout.js';

export const PRESET_FORMAT = 1; // coordinates as in store version 2
const PREFIX = 'file:';

// Collection keys: "file:<path inside presets/, with />".
export const isCollectionKey = (key) => typeof key === 'string' && key.startsWith(PREFIX);

const optionalText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const isModelScope = (vehicle) => Boolean(vehicle) && vehicle !== 'all' && !vehicle.startsWith('game:') && !vehicle.startsWith('brand:');
export const byHook = (a, b) => Number(a) - Number(b) || a.localeCompare(b);

// The hooks a file for a model plays on: the one in its vehicle and those listed, sorted, once each.
function hooksOf(vehicle, listed) {
  if (!isModelScope(vehicle)) return [];
  const own = vehicle.includes('@') ? [vehicle.slice(vehicle.indexOf('@') + 1)] : [];
  const more = Array.isArray(listed) ? listed.map(optionalText).filter((h) => h && /^[\d.]+$/.test(h)) : [];
  return [...new Set([...own, ...more])].sort(byHook);
}

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
      hooks: vehicle && !vehicle.includes('#') ? hooksOf(vehicle, raw.hooks) : [],
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
// hooks: written only when more than the one in vehicle.
export function presetFile({ name, author, vehicle, hooks = [], vehicleName, game, brand, brandName, layout }) {
  return {
    truckerAuxPreset: PRESET_FORMAT,
    name,
    ...(author ? { author } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(vehicle && hooks.length > 1 ? { hooks } : {}),
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
