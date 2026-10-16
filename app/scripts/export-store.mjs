// Exports every key of a data folder's preset tree as preset files, as Export… with the whole
// tree ticked does: a key's own preset, else its shared file or default, and your variants on
// it (a model's for the hooks that play them). For making a build's defaults from the presets
// you use:
//   node scripts/export-store.mjs <data folder> <out folder> [--loose "<preset name>"]...
// (the data folder's layouts.json is only read; the collection is this app's presets/).
// --loose: a preset of yours on no key goes too, for no vehicle: a loose default, under "Unused
// presets" for everyone to put on a key (the Hitchhiker). Loose defaults there are go on as they are.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeStore } from '../src/shared/layout.js';
import { readCollection } from '../src/main/collection.js';
import { byHook, presetFileName } from '../src/shared/collection.js';
import { exportFiles, foldChassis, keyPath, presetTree } from '../src/shared/presets.js';

const [dataDir, outDir, ...rest] = process.argv.slice(2);
const looseNames = rest.flatMap((arg, i) => (rest[i - 1] === '--loose' ? [arg] : []));
if (!dataDir || !outDir || rest.length !== looseNames.length * 2) {
  console.error('usage: node scripts/export-store.mjs <data folder> <out folder> [--loose "<preset name>"]...');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'layouts.json'), 'utf8'));
const shared = readCollection(path.join(import.meta.dirname, '..', 'presets'));
const store = { ...foldChassis(normalizeStore(raw)), collection: shared.collection };

const picks = [];
(function walk(node) {
  if (node.own && !node.pseudo) picks.push({ scope: node.scope, key: node.own.key });
  // The key's other variants go too, a file each (a model's files for the hooks they play on).
  for (const v of node.alternates ?? []) picks.push({ scope: node.scope, key: v.key });
  node.children.forEach(walk);
})(presetTree(store, null).root);

// Loose ones, for no vehicle: the defaults that are (as they are), and presets of yours named.
for (const entry of Object.values(store.collection)) {
  if (entry.default && !entry.vehicle && !picks.some((p) => p.key === entry.key)) picks.push({ scope: null, key: entry.key });
}
for (const name of looseNames) {
  const found = Object.entries(store.presets).filter(([, layout]) => layout.name === name);
  if (found.length !== 1) {
    console.error(`--loose "${name}": ${found.length ? 'more than one preset' : 'no preset'} of that name`);
    process.exit(1);
  }
  picks.push({ scope: null, key: found[0][0] });
}

// A preset of yours named by a key's path gets the path as it reads now: older copies may say
// the game and brand twice, or lack the year that tells twin models apart.
const renamed = picks
  .filter(({ key }) => store.presets[key]?.name.includes(' › '))
  .map(({ scope, key }) => [key, keyPath(store, scope)]);
for (const [key, name] of renamed) store.presets[key] = { ...store.presets[key], name };

// A default keeps its file name: exported as it is, or as your copy of it (copyOf; an unchanged
// copy before an edited one; a preset of yours sounding exactly as a default of its model, as the
// presets the defaults were made from do), so a hook or a vehicle that remembers a default by its file finds
// the same cab after an update. Other presets get names no default had: a remembered file is
// then the same preset, or gone (Auto passes it by). Variants of one model share its path: their
// files are told apart by the label, else a number.
const DEFAULT = 'file:default/';
const defaultName = (key) => (key?.startsWith(DEFAULT) ? key.slice(DEFAULT.length) : null);
const oldNames = new Set(Object.keys(store.collection).map(defaultName).filter(Boolean));
const sound = (layout) => JSON.stringify([layout.width, layout.bounds, layout.speakers]);
const modelOfVehicle = (vehicle) => (vehicle ?? '').replace(/[@#].*$/, '');
const twins = new Map(); // "<model> <sound>" -> the defaults' names
for (const [key, entry] of Object.entries(store.collection)) {
  const name = defaultName(key);
  const id = `${modelOfVehicle(entry.vehicle)} ${sound(entry.layout)}`;
  if (name) twins.set(id, [...(twins.get(id) ?? []), name]);
}
// A default exported as it is keeps where it applies: a model's file stays the model's (a hook
// that only remembers it, as a hook new to you does on its own, never narrows it to that hook);
// a hook's file gets the hooks that remember it besides its own.
function keepPlace(data, entry) {
  const model = modelOfVehicle(entry.vehicle);
  let hooks = [];
  if (entry.vehicle.includes('@')) {
    const remembered = data.hooks ?? (data.vehicle?.includes('@') ? [data.vehicle.split('@')[1]] : []);
    hooks = [...new Set([...entry.hooks, ...remembered])].sort(byHook);
  }
  const { truckerAuxPreset, name, author, vehicle: _vehicle, hooks: _hooks, ...rest } = data;
  return {
    truckerAuxPreset, name, ...(author ? { author } : {}),
    vehicle: hooks.length ? `${model}@${hooks[0]}` : model, ...(hooks.length > 1 ? { hooks } : {}), ...rest,
  };
}
const items = picks.map((pick) => {
  const exported = exportFiles(store, [pick], null).files[0];
  const { fileName } = exported;
  const entry = defaultName(pick.key) && store.collection[pick.key];
  const data = entry?.vehicle?.startsWith('vehicle.') ? keepPlace(exported.data, entry) : exported.data;
  const own = store.presets[pick.key];
  const copied = own && defaultName(own.copyOf) && store.collection[own.copyOf];
  // An exact twin first (the default made from it), then the default it was copied from.
  const twin = own ? twins.get(`${modelOfVehicle(data.vehicle)} ${sound(own)}`) ?? [] : [];
  let claims = [defaultName(pick.key)];
  if (own) claims = [...twin, ...(copied ? [defaultName(own.copyOf)] : [])];
  const strong = !own || twin.length > 0 || sound(own) === sound(copied?.layout ?? {});
  return { fileName, data, claims: claims.filter(Boolean), strong, name: null };
});
const taken = new Set();
for (const strong of [true, false]) {
  for (const item of items.filter((i) => i.claims.length && i.strong === strong)) {
    const name = item.claims.find((n) => !taken.has(n));
    if (!name) continue;
    item.name = name;
    taken.add(name);
  }
}
for (const item of items.filter((i) => !i.name)) {
  const { fileName, data } = item;
  const base = fileName.replace(/\.json$/i, '');
  const free = (name) => !taken.has(name) && !oldNames.has(name);
  let name = !free(fileName) && data.layout.label ? presetFileName(`${base}, ${data.layout.label}`) : fileName;
  for (let n = 2; !free(name); n++) name = `${base} (${n}).json`;
  item.name = name;
  taken.add(name);
}
fs.mkdirSync(outDir, { recursive: true });
for (const { name, data } of items) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`${data.vehicle ?? '-'}${data.hooks ? ` +${data.hooks.length - 1}` : ''}\t${name}`);
}
