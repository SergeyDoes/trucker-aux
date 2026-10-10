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

// Variants of one model share its path: their files are told apart by the label, else a number.
const { files } = exportFiles(store, picks, null);
fs.mkdirSync(outDir, { recursive: true });
const taken = new Set();
for (const { fileName, data } of files) {
  const base = fileName.replace(/\.json$/i, '');
  let name = taken.has(fileName) && data.layout.label ? `${base}, ${data.layout.label}.json` : fileName;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n}).json`;
  taken.add(name);
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`${data.vehicle ?? '-'}${data.hooks ? ` +${data.hooks.length - 1}` : ''}\t${name}`);
}
