// Exports every key of a data folder's preset tree as preset files, as Export… with the whole
// tree ticked does: a key's own preset, else its shared file or default, and your variants on
// it (a model's for the hooks that play them). For making a build's defaults from the presets
// you use:
//   node scripts/export-store.mjs <data folder> <out folder>
// (the data folder's layouts.json is only read; the collection is this app's presets/).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeStore } from '../src/shared/layout.js';
import { readCollection } from '../src/main/collection.js';
import { presetFileName } from '../src/shared/collection.js';
import { exportFiles, foldChassis, keyPath, presetTree } from '../src/shared/presets.js';

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error('usage: node scripts/export-store.mjs <data folder> <out folder>');
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

// A preset of yours named by a key's path gets the path as it reads now: older copies may say
// the game and brand twice, or lack the year that tells twin models apart.
const renamed = picks
  .filter(({ key }) => store.presets[key]?.name.includes(' › '))
  .map(({ scope, key }) => [key, keyPath(store, scope)]);
for (const [key, name] of renamed) store.presets[key] = { ...store.presets[key], name };

// A default keeps its file name: exported as it is, or as your copy of it (copyOf; an unchanged
// copy before an edited one; a preset of yours named and sounding as a default, all vehicles'
// "Default layout"), so a hook or a vehicle that remembers a default by its file finds
// the same cab after an update. Other presets get names no default had: a remembered file is
// then the same preset, or gone (Auto passes it by). Variants of one model share its path: their
// files are told apart by the label, else a number.
const DEFAULT = 'file:default/';
const defaultName = (key) => (key?.startsWith(DEFAULT) ? key.slice(DEFAULT.length) : null);
const oldNames = new Set(Object.keys(store.collection).map(defaultName).filter(Boolean));
const sound = (layout) => JSON.stringify([layout.width, layout.bounds, layout.speakers]);
const items = picks.map((pick) => {
  const { fileName, data } = exportFiles(store, [pick], null).files[0];
  const own = store.presets[pick.key];
  const copied = own && defaultName(own.copyOf) && store.collection[own.copyOf];
  const twin = own && !copied && oldNames.has(fileName) && sound(own) === sound(store.collection[DEFAULT + fileName].layout) ? fileName : null;
  const claim = own ? (copied ? defaultName(own.copyOf) : twin) : defaultName(pick.key);
  const strong = Boolean(claim) && (!own || Boolean(twin) || sound(own) === sound(copied.layout));
  return { fileName, data, claim, strong, name: null };
});
const taken = new Set();
for (const strong of [true, false]) {
  for (const item of items.filter((i) => i.claim && i.strong === strong && !taken.has(i.claim))) {
    item.name = item.claim;
    taken.add(item.name);
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
