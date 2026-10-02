import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptPicked, autoPreset, bindPreset, createPreset, deletePreset, editLayout, exportPreset, isCustomKey, ownPreset,
  parseSelection, plateKey, presetOptions, resolvePlaying, selectionValue, truckStatus, unbind, variantKey,
} from '../src/shared/presets.js';
import { defaultLayout, normalizeStore, setWidth } from '../src/shared/layout.js';
import { parsePresetFile } from '../src/shared/collection.js';

const TRUCK = { key: 'vehicle.international.9900i', name: 'International 9900i' };
const OTHER = { key: 'vehicle.peterbilt.579', name: 'Peterbilt 579' };
const withPreset = () => normalizeStore({ trucks: { [TRUCK.key]: { name: TRUCK.name, width: 0.5 } } });
const widen = (layout) => setWidth(layout, 1.5);

test('resolvePlaying, auto: the truck preset or the default', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, { mode: 'auto' }, TRUCK).layout.width, 0.5);
  assert.deepEqual(resolvePlaying(store, { mode: 'auto' }, OTHER), { kind: 'default', key: null, layout: store.default });
  assert.equal(resolvePlaying(store, { mode: 'auto' }, null).kind, 'default');
});

test('resolvePlaying, explicit selections play what is selected', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, { mode: 'default' }, TRUCK).kind, 'default');
  assert.equal(resolvePlaying(store, { mode: 'truck', key: TRUCK.key }, OTHER).key, TRUCK.key);
  assert.equal(resolvePlaying(store, { mode: 'truck', key: 'gone' }, TRUCK).kind, 'default');
});

test('edit, auto, truck with a preset: that preset', () => {
  const store = editLayout(withPreset(), { mode: 'auto' }, TRUCK, widen);
  assert.equal(store.trucks[TRUCK.key].width, 1.5);
  assert.equal(store.default.width, 1);
});

test('edit, auto, truck without a preset: a new preset copied from the default', () => {
  const store = editLayout(normalizeStore({}), { mode: 'auto' }, OTHER, widen);
  assert.equal(store.trucks[OTHER.key].name, 'Peterbilt 579');
  assert.equal(store.trucks[OTHER.key].width, 1.5);
  assert.deepEqual(store.trucks[OTHER.key].speakers, defaultLayout().speakers);
  assert.equal(store.default.width, 1);
});

test('a truck without a preset plays the default as stored: X = 0 is already its axis', () => {
  const truck = { ...OTHER, centerX: 0.477 };
  const store = normalizeStore({});
  assert.equal(resolvePlaying(store, { mode: 'auto' }, truck).layout, store.default);
  const edited = editLayout(store, { mode: 'auto' }, truck, widen);
  assert.deepEqual(edited.trucks[OTHER.key].speakers, defaultLayout().speakers);
});

test('edit, auto, no game: the default', () => {
  const store = editLayout(normalizeStore({}), { mode: 'auto' }, null, widen);
  assert.equal(store.default.width, 1.5);
  assert.deepEqual(store.trucks, {});
});

test('edit, default selected: the default even in a truck', () => {
  const store = editLayout(withPreset(), { mode: 'default' }, TRUCK, widen);
  assert.equal(store.default.width, 1.5);
  assert.equal(store.trucks[TRUCK.key].width, 0.5);
});

test('edit, truck selected: that preset from any truck', () => {
  const store = editLayout(withPreset(), { mode: 'truck', key: TRUCK.key }, OTHER, widen);
  assert.equal(store.trucks[TRUCK.key].width, 1.5);
  assert.equal(store.trucks[OTHER.key], undefined);
});

test('editLayout does not mutate its input', () => {
  const before = normalizeStore({});
  const snapshot = structuredClone(before);
  editLayout(before, { mode: 'auto' }, OTHER, widen);
  assert.deepEqual(before, snapshot);
});

test('createPreset copies a layout into a custom preset with a free key and name', () => {
  const store = withPreset();
  const source = store.trucks[TRUCK.key];
  const first = createPreset(store, source);
  assert.equal(first.key, 'custom.1');
  assert.equal(first.store.trucks['custom.1'].name, 'International 9900i copy');
  assert.deepEqual(first.store.trucks['custom.1'].speakers, source.speakers);
  assert.notEqual(first.store.trucks['custom.1'].speakers, source.speakers);
  assert.deepEqual(Object.keys(store.trucks), [TRUCK.key]); // the input is not changed
  const second = createPreset(first.store, first.store.default);
  assert.equal(second.key, 'custom.2');
  assert.equal(second.store.trucks['custom.2'].name, 'Default layout copy');
  assert.equal(createPreset(second.store, source).store.trucks['custom.3'].name, 'International 9900i copy 2');
  assert.equal(isCustomKey('custom.2'), true);
  assert.equal(isCustomKey(TRUCK.key), false);
});

test('deletePreset removes only that truck', () => {
  assert.deepEqual(deletePreset(withPreset(), TRUCK.key).trucks, {});
});

// Two chassis of one truck model, told apart by the fifth-wheel position (hook Z, metres),
// and single trucks told apart by their plates.
const SHORT = { ...TRUCK, variant: '2.1' };
const SLEEPER = { ...TRUCK, variant: '3.2' };
const OWNED = { ...SLEEPER, plate: 'WP-83695', quickJob: false };
const LENT = { ...SLEEPER, plate: 'FP50556', quickJob: true };
const AUTO = { mode: 'auto' };
const PICK = (key) => ({ mode: 'truck', key });

test('keys: the model, a chassis of it, one truck of it', () => {
  assert.equal(variantKey(SLEEPER), 'vehicle.international.9900i@3.2');
  assert.equal(variantKey(TRUCK), TRUCK.key);
  assert.equal(plateKey(OWNED), 'vehicle.international.9900i#WP-83695');
  assert.equal(plateKey(SLEEPER), null);
});

test('chassis: the model preset plays on every chassis until one gets its own', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, AUTO, SLEEPER).key, TRUCK.key);
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  const own = edited.trucks[variantKey(SLEEPER)];
  assert.equal(own.width, 1.5);
  assert.equal(own.name, 'International 9900i, hook 3.2 m');
  assert.equal(edited.trucks[TRUCK.key].width, 0.5); // the model preset stays
  assert.equal(resolvePlaying(edited, AUTO, SLEEPER).key, variantKey(SLEEPER));
  assert.equal(resolvePlaying(edited, AUTO, SHORT).key, TRUCK.key);
  assert.deepEqual(presetOptions(edited, SHORT)[0].label, 'Auto — International 9900i (all chassis)');
  assert.deepEqual(presetOptions(edited, SLEEPER)[0].label, 'Auto — International 9900i · hook 3.2 m');
});

test('chassis: without a model preset another chassis plays before the default', () => {
  const store = editLayout(normalizeStore({}), AUTO, SLEEPER, widen);
  assert.deepEqual(Object.keys(store.trucks), [variantKey(SLEEPER)]);
  assert.equal(resolvePlaying(store, AUTO, SHORT).key, variantKey(SLEEPER));
  assert.equal(presetOptions(store, SHORT)[0].label, 'Auto — International 9900i · hook 3.2 m (other chassis)');
  const both = editLayout(store, AUTO, SHORT, (l) => setWidth(l, 0.3));
  assert.equal(both.trucks[variantKey(SHORT)].width, 0.3);
  assert.equal(both.trucks[variantKey(SLEEPER)].width, 1.5);
});

test('this truck only: a copy for the plate wins over the chassis and takes the edits', () => {
  const chassis = ownPreset(withPreset(), OWNED, 'chassis');
  const store = ownPreset(chassis, OWNED, 'truck');
  const key = plateKey(OWNED);
  assert.equal(store.trucks[key].name, 'International 9900i, WP-83695');
  assert.equal(resolvePlaying(store, AUTO, OWNED).key, key);
  assert.equal(resolvePlaying(store, AUTO, { ...OWNED, plate: 'OTHER-1' }).key, variantKey(SLEEPER));
  assert.equal(presetOptions(store, OWNED)[0].label, 'Auto — International 9900i · vehicle WP-83695');
  const edited = editLayout(store, AUTO, OWNED, widen);
  assert.equal(edited.trucks[key].width, 1.5);
  assert.equal(edited.trucks[variantKey(SLEEPER)].width, 0.5);
  assert.equal(ownPreset(store, OWNED, 'truck'), store); // already there
  assert.equal(ownPreset(store, SLEEPER, 'truck'), store); // no plate
});

test('binding by hand: to this truck or to this chassis; unbind and delete undo it', () => {
  const created = createPreset(withPreset(), defaultLayout());
  const chassis = bindPreset(created.store, OWNED, 'chassis', created.key);
  assert.deepEqual(chassis.assignments, { [variantKey(SLEEPER)]: 'custom.1' });
  assert.equal(resolvePlaying(chassis, AUTO, SLEEPER).key, 'custom.1');
  assert.equal(resolvePlaying(chassis, AUTO, SHORT).key, TRUCK.key);
  assert.equal(presetOptions(chassis, SLEEPER)[0].label, 'Auto — Default layout copy (assigned)');
  const edited = editLayout(chassis, AUTO, SLEEPER, widen);
  assert.equal(edited.trucks['custom.1'].width, 1.5);
  assert.equal(edited.trucks[variantKey(SLEEPER)], undefined);
  const truck = bindPreset(created.store, OWNED, 'truck', created.key);
  assert.equal(resolvePlaying(truck, AUTO, OWNED).key, 'custom.1');
  assert.equal(resolvePlaying(truck, AUTO, SLEEPER).key, TRUCK.key);
  assert.equal(autoPreset(truck, OWNED).how, 'truckBound');
  assert.equal(resolvePlaying(unbind(truck, OWNED), AUTO, OWNED).key, TRUCK.key);
  assert.equal(resolvePlaying(unbind(chassis, OWNED), AUTO, OWNED).key, TRUCK.key);
  assert.deepEqual(deletePreset(chassis, 'custom.1').assignments, {});
  // An older chassis assignment of a truck without variants still works.
  assert.equal(resolvePlaying(bindPreset(created.store, OTHER, 'chassis', created.key), AUTO, OTHER).key, 'custom.1');
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
    plays: 'International 9900i · hook 3.2 m',
    appliesTo: 'all International 9900i on this chassis',
    note: null,
    buttons: [{ action: 'own-truck', label: 'Only this vehicle' }],
  });
  const truck = ownPreset(chassis, OWNED, 'truck');
  assert.deepEqual(card(truckStatus(truck, AUTO, OWNED), 'plays', 'appliesTo', 'buttons'), {
    plays: 'International 9900i · vehicle WP-83695',
    appliesTo: 'only this vehicle (WP-83695)',
    buttons: [{ action: 'drop-truck', label: 'Unbind' }],
  });
  const sibling = { ...chassis, trucks: { [variantKey(SLEEPER)]: chassis.trucks[variantKey(SLEEPER)] } };
  assert.equal(truckStatus(sibling, AUTO, { ...SHORT, plate: 'X-1' }).appliesTo, 'another chassis of International 9900i');
  // A quick-job truck: its plate is random, so nothing is offered for "this truck".
  assert.deepEqual(card(truckStatus(store, AUTO, LENT), 'truck', 'note', 'buttons'), {
    truck: 'International 9900i · hook 3.2 m · FP50556',
    note: 'Editing makes a copy for this chassis first. This quick-job vehicle has a random plate, so "this vehicle only" is not offered.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for this chassis' }],
  });
  // A preset picked in the list can be put to use here.
  const custom = createPreset(store, store.default);
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
  assert.equal(truckStatus(store, PICK(TRUCK.key), null).appliesTo, 'all International 9900i');
  assert.deepEqual(truckStatus(store, PICK(TRUCK.key), null).buttons, []);
  // Bound by hand.
  const bound = bindPreset(custom.store, OWNED, 'chassis', custom.key);
  assert.deepEqual(card(truckStatus(bound, AUTO, OWNED), 'plays', 'appliesTo', 'buttons'), {
    plays: 'Default layout copy',
    appliesTo: 'all International 9900i on this chassis, chosen by hand',
    buttons: [{ action: 'own-truck', label: 'Only this vehicle' }, { action: 'unbind', label: 'Unbind' }],
  });
  const boundTruck = bindPreset(custom.store, OWNED, 'truck', custom.key);
  assert.deepEqual(card(truckStatus(boundTruck, AUTO, OWNED), 'appliesTo', 'buttons'), {
    appliesTo: 'only this vehicle (WP-83695), chosen by hand',
    buttons: [{ action: 'unbind', label: 'Unbind' }],
  });
  // A model without chassis variants (no fifth wheel reported), the default, no game.
  assert.deepEqual(card(truckStatus(normalizeStore({}), AUTO, OTHER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Default layout',
    appliesTo: 'every vehicle without its own preset',
    note: 'Editing makes a preset for Peterbilt 579 first.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for Peterbilt 579' }],
  });
  assert.deepEqual(card(truckStatus(store, AUTO, TRUCK), 'appliesTo', 'note', 'buttons'), {
    appliesTo: 'all International 9900i', note: null, buttons: [],
  });
  assert.deepEqual(truckStatus(store, AUTO, null), {
    truck: 'no vehicle in the game',
    plays: 'Default layout',
    appliesTo: 'every vehicle without its own preset',
    note: null,
    buttonsLabel: '',
    buttons: [],
  });
});

test('the preset list groups a model: all chassis, each chassis, single trucks; hand-made under Custom', () => {
  let store = withPreset(); // the model preset "International 9900i"
  store = editLayout(store, AUTO, SLEEPER, widen);
  store = editLayout(store, AUTO, SHORT, widen);
  store = ownPreset(store, OWNED, 'truck');
  store = editLayout(store, AUTO, OTHER, widen); // Peterbilt 579, no variants
  store = createPreset(store, store.default).store; // "Default layout copy"
  store = { ...store, trucks: { ...store.trucks, [variantKey(SHORT)]: { ...store.trucks[variantKey(SHORT)], name: 'Day cab' } } };
  assert.deepEqual(presetOptions(store, null).slice(2), [
    { group: 'International 9900i', options: [
      { value: `truck:${TRUCK.key}`, label: 'All chassis', full: 'International 9900i · all chassis' },
      { value: `truck:${variantKey(SHORT)}`, label: 'Day cab (hook 2.1 m)', full: 'International 9900i · Day cab (hook 2.1 m)' },
      { value: `truck:${variantKey(SLEEPER)}`, label: 'Hook 3.2 m', full: 'International 9900i · hook 3.2 m' },
      { value: `truck:${plateKey(OWNED)}`, label: 'Vehicle WP-83695', full: 'International 9900i · vehicle WP-83695' },
    ] },
    { value: `truck:${OTHER.key}`, label: 'Peterbilt 579' },
    { group: 'Custom', options: [{ value: 'truck:custom.1', label: 'Default layout copy' }] },
  ]);
  // A model with a single preset is one entry named after the model, even for a chassis.
  const only = editLayout(normalizeStore({}), AUTO, SLEEPER, widen);
  assert.deepEqual(presetOptions(only, null)[2], { value: `truck:${variantKey(SLEEPER)}`, label: 'International 9900i' });
  // A single truck's preset alone says whose it is.
  const lone = ownPreset(normalizeStore({}), OWNED, 'truck');
  assert.deepEqual(presetOptions(lone, null)[2], { value: `truck:${plateKey(OWNED)}`, label: 'International 9900i · vehicle WP-83695' });
  // Two chassis without a model preset: a group titled from a chassis preset's name.
  const two = editLayout(only, AUTO, SHORT, widen);
  assert.deepEqual(presetOptions(two, null)[2], {
    group: 'International 9900i',
    options: [
      { value: `truck:${variantKey(SHORT)}`, label: 'Hook 2.1 m', full: 'International 9900i · hook 2.1 m' },
      { value: `truck:${variantKey(SLEEPER)}`, label: 'Hook 3.2 m', full: 'International 9900i · hook 3.2 m' },
    ],
  });
  // Generated names are known by their ending, even after the model preset is renamed.
  const renamedModel = { ...store, trucks: { ...store.trucks, [TRUCK.key]: { ...store.trucks[TRUCK.key], name: '9900i' } } };
  assert.deepEqual(presetOptions(renamedModel, null)[2].options.map((o) => o.label), [
    'All chassis', 'Day cab (hook 2.1 m)', 'Hook 3.2 m', 'Vehicle WP-83695',
  ]);
  // A renamed single chassis preset keeps its name.
  const renamed = { ...only, trucks: { [variantKey(SLEEPER)]: { ...only.trucks[variantKey(SLEEPER)], name: 'My 9900i' } } };
  assert.equal(presetOptions(renamed, null)[2].label, 'My 9900i');
});

test('preset options and selection values', () => {
  const store = withPreset();
  assert.deepEqual(presetOptions(store, OTHER).map((o) => o.label), [
    'Auto — Peterbilt 579 (default layout)', 'Default layout', 'International 9900i',
  ]);
  assert.equal(presetOptions(store, TRUCK)[0].label, 'Auto — International 9900i');
  assert.equal(presetOptions(store, null)[0].label, 'Auto — no game');
  for (const selection of [{ mode: 'auto' }, { mode: 'default' }, { mode: 'truck', key: TRUCK.key }]) {
    assert.deepEqual(parseSelection(selectionValue(selection)), selection);
  }
});

// The preset collection: shared files in presets/ (collection.js), kept in store.collection.
const shared = (file, vehicle, extra = {}) => parsePresetFile({
  truckerAuxPreset: 1, name: file.replace('.json', ''), vehicle, layout: { width: 0.8 }, ...extra,
}, file).entry;
const withCollection = (store, ...entries) => ({ ...store, collection: Object.fromEntries(entries.map((e) => [e.key, e])) });
const SLEEPER_FILE = shared('sleeper.json', 'vehicle.international.9900i@3.2');
const MODEL_FILE = shared('model.json', 'vehicle.international.9900i');

test('collection: Auto plays it after your own presets: this chassis, the model, then another chassis', () => {
  const store = withCollection(normalizeStore({}), SLEEPER_FILE, MODEL_FILE);
  assert.deepEqual(autoPreset(store, SLEEPER), { key: 'file:sleeper.json', how: 'collectionChassis' });
  assert.deepEqual(autoPreset(store, SHORT), { key: 'file:model.json', how: 'collectionModel' });
  assert.deepEqual(resolvePlaying(store, AUTO, SLEEPER), { kind: 'collection', key: 'file:sleeper.json', layout: SLEEPER_FILE.layout });
  assert.deepEqual(autoPreset(withCollection(normalizeStore({}), SLEEPER_FILE), SHORT), { key: 'file:sleeper.json', how: 'collectionSibling' });
  // Your own presets come first, even the model's for all chassis.
  assert.deepEqual(autoPreset(withCollection(withPreset(), SLEEPER_FILE), SLEEPER), { key: TRUCK.key, how: 'model' });
  // The collection's preset for this chassis beats your own for another chassis; yours beats
  // the collection's for another chassis.
  const ownShort = editLayout(normalizeStore({}), AUTO, SHORT, widen);
  assert.equal(autoPreset(withCollection(ownShort, SLEEPER_FILE), SLEEPER).how, 'collectionChassis');
  assert.deepEqual(autoPreset(withCollection(ownShort, shared('long.json', 'vehicle.international.9900i@4.0')), SLEEPER), {
    key: variantKey(SHORT), how: 'sibling',
  });
  // Several files for one chassis: the first by path; another vehicle's files never play.
  const two = withCollection(normalizeStore({}), shared('b.json', variantKey(SLEEPER)), shared('a.json', variantKey(SLEEPER)));
  assert.equal(autoPreset(two, SLEEPER).key, 'file:a.json');
  assert.equal(autoPreset(store, OTHER), null);
  // Picked in the list.
  assert.equal(resolvePlaying(store, PICK('file:model.json'), null).kind, 'collection');
  assert.equal(resolvePlaying(store, PICK('file:gone.json'), null).kind, 'default');
});

test('collection: editing never changes a file', () => {
  const store = withCollection(normalizeStore({}), SLEEPER_FILE);
  // Auto: the first edit makes this chassis's own copy, which plays from then on.
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  assert.equal(edited.trucks[variantKey(SLEEPER)].width, 1.5);
  assert.equal(edited.trucks[variantKey(SLEEPER)].name, 'International 9900i, hook 3.2 m');
  assert.equal(edited.collection['file:sleeper.json'].layout.width, 0.8);
  assert.equal(autoPreset(edited, SLEEPER).how, 'chassis');
  // Picked in the list: a Custom copy, chosen instead.
  const adopted = adoptPicked(store, PICK('file:sleeper.json'));
  assert.ok(isCustomKey(adopted.selection.key));
  assert.equal(adopted.store.trucks[adopted.selection.key].name, 'sleeper copy');
  assert.equal(adopted.store.trucks[adopted.selection.key].width, 0.8);
  assert.deepEqual(adoptPicked(store, AUTO), { store, selection: AUTO });
  assert.deepEqual(adoptPicked(store, PICK(TRUCK.key)), { store, selection: PICK(TRUCK.key) });
  // An edit routed to a file is dropped.
  assert.equal(editLayout(store, PICK('file:sleeper.json'), SLEEPER, widen), store);
});

test('collection: a binding may point at a file and is kept while the file is missing', () => {
  const bound = bindPreset(withCollection(normalizeStore({}), MODEL_FILE), OWNED, 'truck', 'file:model.json');
  assert.deepEqual(autoPreset(bound, OWNED), { key: 'file:model.json', how: 'truckBound' });
  const reloaded = normalizeStore({ assignments: bound.assignments });
  assert.deepEqual(reloaded.assignments, { [plateKey(OWNED)]: 'file:model.json' });
  assert.equal(autoPreset(reloaded, OWNED), null);
});

test('collection: the card and the list', () => {
  const store = withCollection(normalizeStore({}), shared('t.json', variantKey(SLEEPER), { name: 'Sleeper cab', author: 'Alex' }), MODEL_FILE);
  assert.deepEqual(card(truckStatus(store, AUTO, SLEEPER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Sleeper cab — Alex',
    appliesTo: 'all International 9900i on this chassis, from the collection',
    note: 'From the collection: t.json. Editing makes your own copy for this chassis first.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for this chassis' }],
  });
  assert.equal(truckStatus(store, AUTO, SHORT).appliesTo, 'all chassis of International 9900i, from the collection');
  assert.deepEqual(card(truckStatus(store, AUTO, TRUCK), 'appliesTo', 'note', 'buttons'), {
    appliesTo: 'all International 9900i, from the collection',
    note: 'From the collection: model.json. Editing makes your own preset for International 9900i first.',
    buttons: [{ action: 'own-chassis', label: 'Own preset for International 9900i' }],
  });
  assert.deepEqual(card(truckStatus(store, PICK('file:t.json'), SLEEPER), 'plays', 'appliesTo', 'note', 'buttonsLabel'), {
    plays: 'Sleeper cab — Alex (picked in the list)',
    appliesTo: 'International 9900i on the hook 3.2 m chassis',
    note: 'From the collection: t.json. Editing makes your own copy first.',
    buttonsLabel: 'Use it in',
  });
  assert.equal(truckStatus(withCollection(normalizeStore({}), shared('any.json', null)), PICK('file:any.json'), null).appliesTo, 'only where it is chosen');
  const options = presetOptions(store, SLEEPER);
  assert.equal(options[0].label, 'Auto — Sleeper cab — Alex (collection)');
  assert.deepEqual(options.at(-1), {
    group: 'Collection',
    options: [{ value: 'truck:file:model.json', label: 'model' }, { value: 'truck:file:t.json', label: 'Sleeper cab — Alex' }],
  });
  assert.deepEqual(parseSelection('truck:file:t.json'), PICK('file:t.json'));
});

test('exportPreset: the preset that plays as a file to share', () => {
  const store = editLayout(withPreset(), AUTO, SLEEPER, widen); // the model's and the sleeper's own
  const chassis = exportPreset(store, variantKey(SLEEPER), SLEEPER);
  assert.equal(chassis.fileName, 'International 9900i, hook 3.2 m.json');
  assert.deepEqual({ ...chassis.data, layout: null }, {
    truckerAuxPreset: 1, name: 'International 9900i, hook 3.2 m', vehicle: 'vehicle.international.9900i@3.2', vehicleName: 'International 9900i', layout: null,
  });
  assert.equal(chassis.data.layout.width, 1.5);
  assert.equal(exportPreset(store, TRUCK.key, null).data.vehicle, TRUCK.key);
  assert.equal(exportPreset(store, TRUCK.key, null).data.vehicleName, 'International 9900i');
  // This vehicle's own preset is shared for its chassis: the plate stays private.
  const plated = ownPreset(store, OWNED, 'truck');
  assert.equal(exportPreset(plated, plateKey(OWNED), OWNED).data.vehicle, variantKey(OWNED));
  assert.equal(exportPreset(plated, plateKey(OWNED), null).data.vehicle, TRUCK.key);
  // A custom preset and the default layout are for no vehicle; a file is a file already.
  const custom = createPreset(store, store.default);
  assert.equal('vehicle' in exportPreset(custom.store, custom.key, SLEEPER).data, false);
  assert.equal(exportPreset(store, null, SLEEPER).data.name, 'Default layout');
  assert.equal('vehicle' in exportPreset(store, null, SLEEPER).data, false);
  assert.equal(exportPreset(withCollection(store, MODEL_FILE), 'file:model.json', SLEEPER), null);
});
