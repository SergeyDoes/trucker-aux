// Writes where each shared preset's vehicle is from (game, brand, brandName) into the files
// in presets/, from what the game told the app (data/layouts.json, "vehicles"). Only facts:
// a model never driven is left as it is. Run: npm run fill-presets [-- <data folder>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStore } from '../src/shared/layout.js';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.argv[2] ?? path.join(app, 'data');
const presetsDir = path.join(path.dirname(path.resolve(dataDir)), 'presets');
const layouts = path.join(dataDir, 'layouts.json');
if (!fs.existsSync(layouts)) {
  console.error(`${layouts} is missing: drive the vehicles once with the app running.`);
  process.exit(1);
}
const { vehicles } = normalizeStore(JSON.parse(fs.readFileSync(layouts, 'utf8')));

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return files(full);
  return e.name.toLowerCase().endsWith('.json') ? [full] : [];
});

let changed = 0;
for (const file of files(presetsDir)) {
  const text = fs.readFileSync(file, 'utf8');
  let preset;
  try {
    preset = JSON.parse(text);
  } catch {
    continue;
  }
  if (!preset?.truckerAuxPreset || typeof preset.vehicle !== 'string') continue;
  const known = vehicles[preset.vehicle.split(/[@#]/)[0]];
  if (!known?.game) {
    console.log(`not driven yet: ${path.relative(presetsDir, file)}`);
    continue;
  }
  // Keeps the order of the fields: the new ones go after vehicleName (or vehicle).
  const place = { game: known.game, brand: known.brand, brandName: known.brandName };
  const next = {};
  for (const [key, value] of Object.entries(preset)) {
    if (key in place) continue;
    next[key] = value;
    if (key === (preset.vehicleName !== undefined ? 'vehicleName' : 'vehicle')) {
      for (const [k, v] of Object.entries(place)) if (v) next[k] = v;
    }
  }
  const out = `${JSON.stringify(next, null, 2)}\n`;
  if (out !== text) {
    fs.writeFileSync(file, out);
    changed++;
    console.log(`filled: ${path.relative(presetsDir, file)} (${place.game}, ${place.brandName ?? place.brand})`);
  }
}
console.log(`${changed} file(s) changed.`);
