import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptPicked, allPresetKey, autoPreset, bindPreset, boundAt, createPreset, deletePreset, editLayout, exportPreset, levelOf,
  ownPreset, parseSelection, plateKey, presetOptions, rememberVehicle, resolvePlaying, scopeLabel, scopesOf, selectionValue,
  truckStatus, unbind, variantKey,
} from '../src/shared/presets.js';
import { defaultLayout, normalizeStore, setWidth } from '../src/shared/layout.js';
import { parsePresetFile } from '../src/shared/collection.js';

const TRUCK = { key: 'vehicle.international.9900i', name: 'International 9900i', game: 'ats', brand: 'international', brandName: 'International' };
const OTHER = { key: 'vehicle.peterbilt.579', name: 'Peterbilt 579', game: 'ats', brand: 'peterbilt', brandName: 'Peterbilt' };
// Two chassis of one truck model, told apart by the fifth-wheel position (hook Z, metres),
// and single trucks told apart by their plates.
const SHORT = { ...TRUCK, variant: '2.1' };
const SLEEPER = { ...TRUCK, variant: '3.2' };
const OWNED = { ...SLEEPER, plate: 'WP-83695', quickJob: false };
const LENT = { ...SLEEPER, plate: 'FP50556', quickJob: true };
const AUTO = { mode: 'auto' };
const PICK = (key) => ({ mode: 'truck', key });
const widen = (layout) => setWidth(layout, 1.5);

// A store with the default layout for all vehicles (p.1) and a preset for each scope given.
function storeWith(scoped = {}, unassigned = []) {
  const presets = { 'p.1': defaultLayout() };
  const assignments = { all: 'p.1' };
  for (const [scope, layout] of Object.entries(scoped)) {
    const key = `p.${Object.keys(presets).length + 1}`;
    presets[key] = layout;
    assignments[scope] = key;
  }
  for (const layout of unassigned) presets[`p.${Object.keys(presets).length + 1}`] = layout;
  return normalizeStore({ version: 3, presets, assignments });
}
const withPreset = () => storeWith({ [TRUCK.key]: { name: TRUCK.name, width: 0.5 } }); // p.2: the model's
const at = (store, scope) => store.presets[store.assignments[scope]];

test('scopes: keys and levels', () => {
  assert.equal(variantKey(SLEEPER), 'vehicle.international.9900i@3.2');
  assert.equal(variantKey(TRUCK), TRUCK.key);
  assert.equal(plateKey(OWNED), 'vehicle.international.9900i#WP-83695');
  assert.equal(plateKey(SLEEPER), null);
  assert.deepEqual(['x#A-1', 'x@2.1', 'x', 'brand:ats/x', 'game:ats', 'all'].map(levelOf), ['vehicle', 'chassis', 'model', 'brand', 'game', 'all']);
});

test('resolvePlaying: the truck preset in Auto, else all vehicles; a pick plays what is picked', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, AUTO, TRUCK).layout.width, 0.5);
  assert.deepEqual(resolvePlaying(store, AUTO, OTHER), { kind: 'preset', key: 'p.1', layout: store.presets['p.1'] });
  assert.equal(resolvePlaying(store, AUTO, null).key, 'p.1');
  assert.equal(resolvePlaying(store, PICK('p.2'), OTHER).key, 'p.2');
  assert.equal(resolvePlaying(store, PICK('gone'), null).key, 'p.1');
});

test('edit, auto: the preset of this vehicle; a vehicle without one gets a copy of what plays', () => {
  const edited = editLayout(withPreset(), AUTO, TRUCK, widen);
  assert.equal(at(edited, TRUCK.key).width, 1.5);
  assert.equal(at(edited, 'all').width, 1);
  const fresh = editLayout(storeWith(), AUTO, OTHER, widen);
  assert.equal(at(fresh, OTHER.key).name, 'Peterbilt 579');
  assert.equal(at(fresh, OTHER.key).width, 1.5);
  assert.deepEqual(at(fresh, OTHER.key).speakers, defaultLayout().speakers);
  assert.equal(at(fresh, 'all').width, 1);
});

test('edit: without a game the preset of all vehicles; a picked preset from any truck', () => {
  const store = editLayout(storeWith(), AUTO, null, widen);
  assert.equal(at(store, 'all').width, 1.5);
  assert.deepEqual(Object.keys(store.presets), ['p.1']);
  const picked = editLayout(withPreset(), PICK('p.2'), OTHER, widen);
  assert.equal(picked.presets['p.2'].width, 1.5);
  assert.equal(picked.assignments[OTHER.key], undefined);
  const before = storeWith();
  const snapshot = structuredClone(before);
  editLayout(before, AUTO, OTHER, widen);
  assert.deepEqual(before, snapshot); // the input is not changed
});

test('chassis: the model preset plays on every chassis until one gets its own', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, AUTO, SLEEPER).key, 'p.2');
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  const own = at(edited, variantKey(SLEEPER));
  assert.equal(own.width, 1.5);
  assert.equal(own.name, 'International 9900i, hook 3.2 m');
  assert.equal(at(edited, TRUCK.key).width, 0.5); // the model preset stays
  assert.equal(resolvePlaying(edited, AUTO, SHORT).key, 'p.2');
  assert.equal(presetOptions(edited, SHORT)[0].label, 'Auto — International 9900i (all chassis)');
  assert.equal(presetOptions(edited, SLEEPER)[0].label, 'Auto — International 9900i, hook 3.2 m');
});

test('chassis: without a model preset another chassis plays before the brand', () => {
  const store = editLayout(storeWith({ 'brand:ats/international': { name: 'Brand' } }), AUTO, SLEEPER, widen);
  assert.equal(autoPreset(store, SHORT).how, 'sibling');
  assert.equal(presetOptions(store, SHORT)[0].label, 'Auto — International 9900i, hook 3.2 m (other chassis)');
  const both = editLayout(store, AUTO, SHORT, (l) => setWidth(l, 0.3));
  assert.equal(at(both, variantKey(SHORT)).width, 0.3);
  assert.equal(at(both, variantKey(SLEEPER)).width, 1.5);
});

test('the ladder: model, brand, game, all vehicles; a vehicle without a game id skips brand and game', () => {
  const store = storeWith({
    'brand:ats/international': { name: 'International trucks' },
    'game:ats': { name: 'ATS trucks' },
  });
  assert.deepEqual(autoPreset(store, TRUCK), { key: 'p.2', how: 'brand', scope: 'brand:ats/international' });
  assert.deepEqual(autoPreset(store, OTHER), { key: 'p.3', how: 'game', scope: 'game:ats' });
  assert.deepEqual(autoPreset(store, { ...OTHER, game: 'ets2' }), { key: 'p.1', how: 'all', scope: 'all' });
  assert.equal(autoPreset(store, { ...TRUCK, game: null, brand: null }).how, 'all');
  // Something wider than the chassis plays: the first edit makes a copy for this chassis.
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  assert.equal(at(edited, variantKey(SLEEPER)).name, 'International 9900i, hook 3.2 m');
  assert.equal(at(edited, 'brand:ats/international').width, 1);
});

test('this vehicle only: a copy for the plate wins over the chassis and takes the edits', () => {
  const store = ownPreset(ownPreset(withPreset(), OWNED, 'chassis'), OWNED, 'truck');
  const key = plateKey(OWNED);
  assert.equal(at(store, key).name, 'International 9900i, WP-83695');
  assert.equal(resolvePlaying(store, AUTO, OWNED).key, store.assignments[key]);
  assert.equal(resolvePlaying(store, AUTO, { ...OWNED, plate: 'OTHER-1' }).key, store.assignments[variantKey(SLEEPER)]);
  assert.equal(presetOptions(store, OWNED)[0].label, 'Auto — International 9900i, WP-83695 (this vehicle)');
  const edited = editLayout(store, AUTO, OWNED, widen);
  assert.equal(at(edited, key).width, 1.5);
  assert.equal(at(edited, variantKey(SLEEPER)).width, 0.5);
  assert.equal(ownPreset(store, OWNED, 'truck'), store); // already there
  assert.equal(ownPreset(store, SLEEPER, 'truck'), store); // no plate
});

test('binding: a preset applies to this vehicle or chassis; the one it replaces stays, unassigned', () => {
  const created = createPreset(withPreset(), defaultLayout());
  assert.equal(created.key, 'p.3');
  assert.deepEqual(scopesOf(created.store, 'p.3'), []);
  const chassis = bindPreset(created.store, OWNED, 'chassis', 'p.3');
  assert.equal(chassis.assignments[variantKey(SLEEPER)], 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SLEEPER).key, 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SHORT).key, 'p.2');
  const edited = editLayout(chassis, AUTO, SLEEPER, widen);
  assert.equal(edited.presets['p.3'].width, 1.5);
  // Taking a scope from another preset: that preset stays, without that scope.
  const own = ownPreset(created.store, OWNED, 'chassis');
  const ownKey = own.assignments[variantKey(SLEEPER)];
  assert.equal(boundAt(own, OWNED, 'chassis'), ownKey);
  const replaced = bindPreset(own, OWNED, 'chassis', 'p.3');
  assert.ok(replaced.presets[ownKey]);
  assert.deepEqual(scopesOf(replaced, ownKey), []);
  // Unbind frees the narrowest scope; the preset stays.
  const truck = bindPreset(chassis, OWNED, 'truck', 'p.2');
  assert.equal(autoPreset(truck, OWNED).how, 'vehicle');
  assert.equal(resolvePlaying(unbind(truck, OWNED), AUTO, OWNED).key, 'p.3');
  assert.equal(resolvePlaying(unbind(chassis, OWNED), AUTO, OWNED).key, 'p.2');
  assert.ok(unbind(chassis, OWNED).presets['p.3']);
  assert.equal(boundAt(created.store, SLEEPER, 'truck'), null);
});

test('deletePreset removes a preset and its scopes, never the preset of all vehicles', () => {
  const store = bindPreset(withPreset(), OWNED, 'truck', 'p.2');
  const deleted = deletePreset(store, 'p.2');
  assert.deepEqual(Object.keys(deleted.presets), ['p.1']);
  assert.deepEqual(deleted.assignments, { all: 'p.1' });
  assert.equal(deletePreset(store, 'p.1'), store);
  assert.equal(allPresetKey(store), 'p.1');
});

test('createPreset copies a layout into an unassigned preset with a free key and name', () => {
  const store = withPreset();
  const first = createPreset(store, store.presets['p.2']);
  assert.equal(first.key, 'p.3');
  assert.equal(first.store.presets['p.3'].name, 'International 9900i copy');
  assert.deepEqual(first.store.presets['p.3'].speakers, store.presets['p.2'].speakers);
  assert.notEqual(first.store.presets['p.3'].speakers, store.presets['p.2'].speakers);
  assert.deepEqual(Object.keys(store.presets), ['p.1', 'p.2']); // the input is not changed
  assert.equal(createPreset(first.store, store.presets['p.2']).store.presets['p.4'].name, 'International 9900i copy 2');
});

test('rememberVehicle keeps the name, game and brand of a model; scopes are named from them', () => {
  const store = rememberVehicle(storeWith(), TRUCK);
  assert.deepEqual(store.vehicles[TRUCK.key], { name: 'International 9900i', game: 'ats', brand: 'international', brandName: 'International' });
  assert.equal(rememberVehicle(store, TRUCK), store); // nothing new
  assert.equal(rememberVehicle(store, { ...TRUCK, game: null }).vehicles[TRUCK.key].game, 'ats'); // an older plugin forgets nothing
  assert.equal(scopeLabel(store, 'all'), 'all vehicles');
  assert.equal(scopeLabel(store, 'game:ats'), 'all ATS vehicles');
  assert.equal(scopeLabel(store, 'brand:ats/international'), 'all International');
  assert.equal(scopeLabel(store, 'brand:ats/peterbilt'), 'all peterbilt'); // never driven: its id
  assert.equal(scopeLabel(store, 'brand:ats/peterbilt', OTHER), 'all Peterbilt');
  assert.equal(scopeLabel(store, TRUCK.key), 'International 9900i');
  assert.equal(scopeLabel(store, variantKey(SLEEPER)), 'International 9900i, hook 3.2 m');
  assert.equal(scopeLabel(store, plateKey(OWNED)), 'International 9900i, WP-83695');
  assert.equal(scopeLabel(store, OTHER.key), 'peterbilt 579'); // never driven: its id, readable
});

const card = (status, ...fields) => Object.fromEntries(fields.map((f) => [f, status[f]]));

test('truckStatus: what plays, what it applies to, and what can be done, in each situation', () => {
  const store = withPreset(); // the model preset "International 9900i"
  assert.deepEqual(truckStatus(store, AUTO, OWNED), {
    truck: 'International 9900i · hook 3.2 m · WP-83695',
    plays: 'International 9900i',
    appliesTo: 'all chassis of International 9900i',
    note: 'Editing makes a copy for this chassis first.',
    buttonsLabel: '',
    buttons: [{ action: 'own-chassis', label: 'Own preset for this chassis' }, { action: 'own-truck', label: 'Only this vehicle' }],
  });
  const chassis = ownPreset(store, OWNED, 'chassis');
  assert.deepEqual(card(truckStatus(chassis, AUTO, OWNED), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'International 9900i, hook 3.2 m',
    appliesTo: 'all International 9900i on this chassis',
    note: null,
    buttons: [{ action: 'own-truck', label: 'Only this vehicle' }, { action: 'unbind', label: 'Unbind' }],
  });
  const truck = ownPreset(chassis, OWNED, 'truck');
  assert.deepEqual(card(truckStatus(truck, AUTO, OWNED), 'plays', 'appliesTo', 'buttons'), {
    plays: 'International 9900i, WP-83695',
    appliesTo: 'only this vehicle (WP-83695)',
    buttons: [{ action: 'unbind', label: 'Unbind' }],
  });
  assert.equal(truckStatus(unbind(withPreset(), SLEEPER), AUTO, SHORT).appliesTo, 'all chassis of International 9900i');
  const sibling = editLayout(storeWith(), AUTO, SLEEPER, widen);
  assert.equal(truckStatus(sibling, AUTO, { ...SHORT, plate: 'X-1' }).appliesTo, 'another chassis of International 9900i');
  // A quick-job truck: its plate is random, so nothing is offered for "this truck".
  assert.deepEqual(card(truckStatus(store, AUTO, LENT), 'truck', 'note', 'buttons'), {
    truck: 'International 9900i · hook 3.2 m · FP50556',
    note: 'Editing makes a copy for this chassis first. This quick-job vehicle has a random plate, so "this vehicle only" is not offered.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for this chassis' }],
  });
  // A preset picked in the list can be put to use here.
  const custom = createPreset(store, store.presets['p.1']);
  assert.deepEqual(card(truckStatus(custom.store, PICK(custom.key), OWNED), 'plays', 'appliesTo', 'note', 'buttonsLabel', 'buttons'), {
    plays: 'Default layout copy (picked in the list)',
    appliesTo: 'only where it is chosen',
    note: 'Editing changes this preset.',
    buttonsLabel: 'Use it in',
    buttons: [
      { action: 'bind-truck', label: 'this vehicle only' },
      { action: 'bind-chassis', label: 'all International 9900i on this chassis' },
    ],
  });
  assert.equal(truckStatus(store, PICK('p.2'), null).appliesTo, 'International 9900i');
  assert.equal(truckStatus(store, PICK('p.1'), null).appliesTo, 'every vehicle without its own preset');
  assert.deepEqual(truckStatus(store, PICK('p.2'), null).buttons, []);
  // A model without chassis variants (no fifth wheel reported), the brand, all vehicles, no game.
  const noVariant = { ...OTHER };
  assert.deepEqual(card(truckStatus(storeWith(), AUTO, noVariant), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Default layout — all vehicles',
    appliesTo: 'every vehicle without its own preset',
    note: 'Editing makes a preset for Peterbilt 579 first.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for Peterbilt 579' }],
  });
  assert.equal(truckStatus(storeWith({ 'brand:ats/peterbilt': { name: 'P' } }), AUTO, noVariant).appliesTo, 'all Peterbilt');
  assert.equal(truckStatus(storeWith({ 'game:ats': { name: 'A' } }), AUTO, noVariant).appliesTo, 'all ATS vehicles');
  assert.deepEqual(card(truckStatus(store, AUTO, TRUCK), 'appliesTo', 'note', 'buttons'), {
    appliesTo: 'all International 9900i', note: null, buttons: [{ action: 'unbind', label: 'Unbind' }],
  });
  assert.deepEqual(truckStatus(store, AUTO, null), {
    truck: 'no vehicle in the game',
    plays: 'Default layout — all vehicles',
    appliesTo: 'every vehicle without its own preset',
    note: null,
    buttonsLabel: '',
    buttons: [],
  });
});

test('the preset list: Auto, your presets with where they apply, Unassigned, Collection', () => {
  let store = rememberVehicle(withPreset(), TRUCK);
  store = editLayout(store, AUTO, SLEEPER, widen);
  store = ownPreset(store, OWNED, 'truck');
  store = createPreset(store, store.presets['p.1']).store; // "Default layout copy", unassigned
  store = { ...store, presets: { ...store.presets, 'p.3': { ...store.presets['p.3'], name: 'Sleeper' } } };
  store = bindPreset(store, { ...SHORT }, 'chassis', 'p.3'); // the sleeper's preset on the day cab too
  assert.deepEqual(presetOptions(store, null), [
    { value: 'auto', label: 'Auto — no game' },
    { value: 'truck:p.1', label: 'Default layout — all vehicles' },
    { value: 'truck:p.2', label: 'International 9900i' },
    { value: 'truck:p.4', label: 'International 9900i, WP-83695' },
    { value: 'truck:p.3', label: 'Sleeper — International 9900i, hook 2.1 m +1' },
    { group: 'Unassigned', options: [{ value: 'truck:p.5', label: 'Default layout copy' }] },
  ]);
  assert.equal(presetOptions(withPreset(), OTHER)[0].label, 'Auto — Default layout — all vehicles');
  for (const selection of [AUTO, PICK('p.2'), PICK('file:a/b.json')]) {
    assert.deepEqual(parseSelection(selectionValue(selection)), selection);
  }
  assert.deepEqual(parseSelection('default'), AUTO); // the old "Default layout" entry
});

// The preset collection: shared files in presets/ (collection.js), kept in store.collection.
const shared = (file, vehicle, extra = {}) => parsePresetFile({
  truckerAuxPreset: 1, name: file.replace('.json', ''), vehicle, layout: { width: 0.8 }, ...extra,
}, file).entry;
const withCollection = (store, ...entries) => ({ ...store, collection: Object.fromEntries(entries.map((e) => [e.key, e])) });
const SLEEPER_FILE = shared('sleeper.json', 'vehicle.international.9900i@3.2');
const MODEL_FILE = shared('model.json', 'vehicle.international.9900i');

test('collection: Auto plays it after your own chassis and model presets, before wider ones', () => {
  const store = withCollection(storeWith(), SLEEPER_FILE, MODEL_FILE);
  assert.deepEqual(autoPreset(store, SLEEPER), { key: 'file:sleeper.json', how: 'collectionChassis', scope: variantKey(SLEEPER) });
  assert.equal(autoPreset(store, SHORT).how, 'collectionModel');
  assert.deepEqual(resolvePlaying(store, AUTO, SLEEPER), { kind: 'collection', key: 'file:sleeper.json', layout: SLEEPER_FILE.layout });
  assert.equal(autoPreset(withCollection(storeWith(), SLEEPER_FILE), SHORT).how, 'collectionSibling');
  // Your own presets come first, even the model's for all chassis: a file dropped into
  // presets/ never takes over a truck you have set up.
  assert.equal(autoPreset(withCollection(withPreset(), SLEEPER_FILE), SLEEPER).how, 'model');
  // Yours for another chassis beats the collection's for another chassis; the brand comes after both.
  const ownShort = editLayout(storeWith({ 'brand:ats/international': { name: 'B' } }), AUTO, SHORT, widen);
  assert.equal(autoPreset(withCollection(ownShort, shared('long.json', 'vehicle.international.9900i@4.0')), SLEEPER).how, 'sibling');
  // Several files for one chassis: the first by path; another vehicle's files never play.
  const two = withCollection(storeWith(), shared('b.json', variantKey(SLEEPER)), shared('a.json', variantKey(SLEEPER)));
  assert.equal(autoPreset(two, SLEEPER).key, 'file:a.json');
  assert.equal(autoPreset(store, OTHER).how, 'all');
  assert.equal(resolvePlaying(store, PICK('file:model.json'), null).kind, 'collection');
  assert.equal(resolvePlaying(store, PICK('file:gone.json'), null).key, 'p.1');
});

test('collection: editing never changes a file', () => {
  const store = withCollection(storeWith(), SLEEPER_FILE);
  // Auto: the first edit makes this chassis's own copy, which plays from then on.
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  assert.equal(at(edited, variantKey(SLEEPER)).width, 1.5);
  assert.equal(at(edited, variantKey(SLEEPER)).name, 'International 9900i, hook 3.2 m');
  assert.equal(edited.collection['file:sleeper.json'].layout.width, 0.8);
  assert.equal(autoPreset(edited, SLEEPER).how, 'chassis');
  // Picked in the list: an unassigned copy, chosen instead.
  const adopted = adoptPicked(store, PICK('file:sleeper.json'));
  assert.equal(adopted.selection.key, 'p.2');
  assert.equal(adopted.store.presets['p.2'].name, 'sleeper copy');
  assert.equal(adopted.store.presets['p.2'].width, 0.8);
  assert.deepEqual(adoptPicked(store, AUTO), { store, selection: AUTO });
  assert.equal(editLayout(store, PICK('file:sleeper.json'), SLEEPER, widen), store); // dropped
});

test('collection: a binding may point at a file and is kept while the file is missing', () => {
  const bound = bindPreset(withCollection(storeWith(), MODEL_FILE), OWNED, 'truck', 'file:model.json');
  assert.deepEqual(autoPreset(bound, OWNED), { key: 'file:model.json', how: 'vehicle', scope: plateKey(OWNED) });
  const reloaded = normalizeStore({ version: 3, presets: bound.presets, assignments: bound.assignments });
  assert.equal(reloaded.assignments[plateKey(OWNED)], 'file:model.json');
  assert.equal(autoPreset(reloaded, OWNED).how, 'all');
});

test('collection: the card and the list', () => {
  const store = withCollection(storeWith(), shared('t.json', variantKey(SLEEPER), { name: 'Sleeper cab', author: 'Alex' }), MODEL_FILE);
  assert.deepEqual(card(truckStatus(store, AUTO, SLEEPER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Sleeper cab — Alex',
    appliesTo: 'all International 9900i on this chassis, from the collection',
    note: 'From the collection: t.json. Editing makes your own copy for this chassis first.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for this chassis' }],
  });
  assert.equal(truckStatus(store, AUTO, SHORT).appliesTo, 'all chassis of International 9900i, from the collection');
  assert.deepEqual(card(truckStatus(store, PICK('file:t.json'), SLEEPER), 'plays', 'appliesTo', 'note', 'buttonsLabel'), {
    plays: 'Sleeper cab — Alex (picked in the list)',
    appliesTo: 'International 9900i on the hook 3.2 m chassis',
    note: 'From the collection: t.json. Editing makes your own copy first.',
    buttonsLabel: 'Use it in',
  });
  const options = presetOptions(store, SLEEPER);
  assert.equal(options[0].label, 'Auto — Sleeper cab — Alex (collection)');
  assert.deepEqual(options.at(-1), {
    group: 'Collection',
    options: [{ value: 'truck:file:model.json', label: 'model' }, { value: 'truck:file:t.json', label: 'Sleeper cab — Alex' }],
  });
});

test('exportPreset: the preset that plays as a file to share', () => {
  const store = editLayout(rememberVehicle(withPreset(), TRUCK), AUTO, SLEEPER, widen); // p.2 the model's, p.3 the sleeper's
  const chassis = exportPreset(store, 'p.3', SLEEPER);
  assert.equal(chassis.fileName, 'International 9900i, hook 3.2 m.json');
  assert.deepEqual({ ...chassis.data, layout: null }, {
    truckerAuxPreset: 1, name: 'International 9900i, hook 3.2 m', vehicle: 'vehicle.international.9900i@3.2', vehicleName: 'International 9900i', layout: null,
  });
  assert.equal(chassis.data.layout.width, 1.5);
  assert.equal(exportPreset(store, 'p.2', null).data.vehicle, TRUCK.key);
  // This vehicle's own preset is shared for its chassis: the plate stays private.
  const plated = ownPreset(store, OWNED, 'truck');
  const plateOwn = plated.assignments[plateKey(OWNED)];
  assert.equal(exportPreset(plated, plateOwn, OWNED).data.vehicle, variantKey(OWNED));
  assert.equal(exportPreset(plated, plateOwn, null).data.vehicle, TRUCK.key);
  // Unassigned, all vehicles and wider presets are for no vehicle; a file is a file already.
  const custom = createPreset(store, store.presets['p.1']);
  assert.equal('vehicle' in exportPreset(custom.store, custom.key, SLEEPER).data, false);
  assert.equal(exportPreset(store, 'p.1', SLEEPER).data.name, 'Default layout');
  assert.equal('vehicle' in exportPreset(store, 'p.1', SLEEPER).data, false);
  assert.equal(exportPreset(withCollection(store, MODEL_FILE), 'file:model.json', SLEEPER), null);
  // A model never driven is named after your preset for it; a chassis-only one has no name.
  assert.equal(exportPreset(withPreset(), 'p.2', null).data.vehicleName, 'International 9900i');
  const chassisOnly = storeWith({ [variantKey(SLEEPER)]: { name: 'Sleeper' } });
  assert.equal('vehicleName' in exportPreset(chassisOnly, 'p.2', null).data, false);
});
