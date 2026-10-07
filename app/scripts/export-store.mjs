// Exports every key of a data folder's preset tree as preset files, as Export… with the whole
// tree ticked does: a key's own preset, else its shared file or default. For making a build's
// defaults from the presets you use: node scripts/export-store.mjs <data folder> <out folder>
// (the data folder's layouts.json is only read; the collection is this app's presets/).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeStore } from '../src/shared/layout.js';
import { readCollection } from '../src/main/collection.js';
import { exportFiles, keyPath, presetTree } from '../src/shared/presets.js';

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error('usage: node scripts/export-store.mjs <data folder> <out folder>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'layouts.json'), 'utf8'));
const shared = readCollection(path.join(import.meta.dirname, '..', 'presets'));
const store = { ...normalizeStore(raw), collection: shared.collection };

const picks = [];
(function walk(node) {
  if (node.own && !node.pseudo) picks.push({ scope: node.scope, key: node.own.key });
  node.children.forEach(walk);
})(presetTree(store, null).root);

// A preset of yours named by a key's path gets the path as it reads now: older copies may say
// the game and brand twice, or lack the year that tells twin models apart.
const renamed = picks
  .filter(({ key }) => store.presets[key]?.name.includes(' › '))
  .map(({ scope, key }) => [key, keyPath(store, scope)]);
for (const [key, name] of renamed) store.presets[key] = { ...store.presets[key], name };

const { files, clashes } = exportFiles(store, picks, null);
fs.mkdirSync(outDir, { recursive: true });
for (const { fileName, data } of files) {
  fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`${data.vehicle ?? '-'}\t${fileName}`);
}
if (clashes.length) console.log('clashes:', clashes.join('; '));
