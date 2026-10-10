import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAlternate, adoptVehicle, adoptPicked, cycleVariant, allPresetKey, alternatesOf, chooseVariant, dropAlternate, newAlternate, pickAlternate, variantChoice, scopePreset, applyScope, autoPreset, createPreset, currentScope, deletePreset, editLayout, exportFiles, dropImportedDefaults, importClashes, importPresets, seedAll,
  foldChassis, levelOf, parseSelection, personalOf, planAssign, planMove, planScope, plateKey, presetOptions, presetTree, rememberVehicle, resolvePlaying, scopeLabel,
  scopeLadder, scopesOf, selectionValue, truckStatus, unassign, variantKey,
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
const assign = (store, scope, key) => ({ ...store, assignments: { ...store.assignments, [scope]: key } });

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
  assert.equal(at(fresh, OTHER.key).name, 'ATS › Peterbilt › Peterbilt 579');
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

test('hooks: every hook plays the model\'s variant; an edit changes it for all of them', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, AUTO, SLEEPER).key, 'p.2');
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  assert.deepEqual(Object.keys(edited.presets), ['p.1', 'p.2']); // no copy
  assert.equal(edited.presets['p.2'].width, 1.5);
  assert.equal(resolvePlaying(edited, AUTO, SHORT).key, 'p.2');
  assert.equal(presetOptions(edited, SHORT)[0].label, 'Auto — International 9900i');
});

test('a model without variants: the first edit makes its first variant, which its hooks play', () => {
  const store = editLayout(storeWith({ 'brand:ats/international': { name: 'Brand' } }), AUTO, SLEEPER, widen);
  assert.equal(store.assignments[TRUCK.key], 'p.3');
  assert.deepEqual([at(store, TRUCK.key).name, at(store, TRUCK.key).width], ['ATS › International › International 9900i', 1.5]);
  assert.equal(store.assignments[variantKey(SLEEPER)], 'p.3'); // the hook remembers it
  assert.equal(autoPreset(store, SHORT).how, 'model'); // another hook plays it too
  assert.equal(at(store, 'brand:ats/international').width, 1);
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
  // Something wider than the model plays: the first edit makes the model's first variant.
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  assert.equal(at(edited, TRUCK.key).name, 'ATS › International › International 9900i');
  assert.equal(at(edited, 'brand:ats/international').width, 1);
});

test('this vehicle only: a preset of its own on the plate wins over the hook, takes the edits, is no variant', () => {
  const store = assign(createPreset(withPreset(), { ...defaultLayout(), name: 'Mine', width: 0.7 }).store, plateKey(OWNED), 'p.3');
  assert.equal(resolvePlaying(store, AUTO, OWNED).key, 'p.3');
  assert.equal(resolvePlaying(store, AUTO, { ...OWNED, plate: 'OTHER-1' }).key, 'p.2');
  assert.equal(presetOptions(store, OWNED)[0].label, 'Auto — Mine — International 9900i, WP-83695 (this vehicle)');
  const edited = editLayout(store, AUTO, OWNED, widen);
  assert.equal(edited.presets['p.3'].width, 1.5);
  assert.equal(edited.presets['p.2'].width, 0.5);
  assert.deepEqual(alternatesOf(store, TRUCK.key).map((v) => v.key), ['p.2']);
  assert.deepEqual(personalOf(store, TRUCK.key).map((p) => [p.key, p.plate]), [['p.3', 'WP-83695']]);
  assert.deepEqual(scopesOf(store, 'p.3'), [plateKey(OWNED)]);
});

test('assignments: a preset may apply to several scopes; unassign frees one and keeps the preset', () => {
  const created = createPreset(withPreset(), defaultLayout());
  assert.equal(created.key, 'p.3');
  assert.deepEqual(scopesOf(created.store, 'p.3'), []);
  const chassis = assign(created.store, variantKey(SLEEPER), 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SLEEPER).key, 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SHORT).key, 'p.2');
  assert.equal(editLayout(chassis, AUTO, SLEEPER, widen).presets['p.3'].width, 1.5);
  assert.deepEqual(scopesOf(chassis, 'p.3'), [TRUCK.key]); // a hook remembers a variant of the model
  const truck = assign(chassis, plateKey(OWNED), 'p.2');
  assert.deepEqual(scopesOf(truck, 'p.2'), [TRUCK.key]); // your vehicle remembers a variant: no place of its own
  assert.equal(autoPreset(truck, OWNED).how, 'vehicle');
  const freed = unassign(truck, plateKey(OWNED));
  assert.equal(resolvePlaying(freed, AUTO, OWNED).key, 'p.3');
  assert.ok(unassign(chassis, variantKey(SLEEPER)).presets['p.3']);
  assert.equal(unassign(chassis, 'all'), chassis); // all vehicles always keeps one
});

test('deletePreset removes a preset and its scopes, never the preset of all vehicles', () => {
  const store = assign(withPreset(), plateKey(OWNED), 'p.2');
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
  assert.deepEqual(store.vehicles[TRUCK.key], {
    name: 'International 9900i', game: 'ats', brand: 'international', brandName: 'International', chassis: [], plates: {},
  });
  assert.equal(rememberVehicle(store, TRUCK), store); // nothing new
  // The chassis seen, and your own vehicles with their chassis; a quick job's plate is not yours.
  const driven = rememberVehicle(rememberVehicle(rememberVehicle(store, OWNED), SHORT), LENT);
  assert.deepEqual(driven.vehicles[TRUCK.key].chassis, ['2.1', '3.2']);
  assert.deepEqual(driven.vehicles[TRUCK.key].plates, { 'WP-83695': '3.2' });
  assert.equal(rememberVehicle(driven, OWNED), driven);
  assert.equal(rememberVehicle(store, { ...TRUCK, game: null }).vehicles[TRUCK.key].game, 'ats'); // an older plugin forgets nothing
  assert.equal(scopeLabel(store, 'all'), 'all vehicles');
  assert.equal(scopeLabel(store, 'game:ats'), 'all ATS vehicles');
  assert.equal(scopeLabel(store, 'brand:ats/international'), 'all International');
  assert.equal(scopeLabel(store, 'brand:ats/peterbilt'), 'all Peterbilt'); // never driven: its id
  assert.equal(scopeLabel(store, 'brand:ats/peterbilt', OTHER), 'all Peterbilt');
  assert.equal(scopeLabel(store, TRUCK.key), 'International 9900i');
  assert.equal(scopeLabel(store, variantKey(SLEEPER)), 'International 9900i, hook 3.2 m');
  assert.equal(scopeLabel(store, plateKey(OWNED)), 'International 9900i, WP-83695');
  assert.equal(scopeLabel(store, OTHER.key), 'peterbilt 579'); // never driven: its id, readable
});


test('scopeLadder: this vehicle\'s scopes and what plays from them; currentScope: where what plays sits', () => {
  const store = rememberVehicle(withPreset(), TRUCK);
  assert.deepEqual(scopeLadder(store, OWNED).map((r) => [r.level, r.label, r.holder]), [
    ['vehicle', 'this vehicle (WP-83695)', null],
    ['model', 'International 9900i', 'p.2'],
    ['brand', 'all International', null],
    ['game', 'all ATS vehicles', null],
    ['all', 'all vehicles', 'p.1'],
  ]);
  assert.deepEqual(scopeLadder(store, LENT).map((r) => r.level), ['model', 'brand', 'game', 'all']); // a random plate
  assert.deepEqual(scopeLadder(store, { ...OTHER, game: null }).map((r) => r.level), ['model', 'all']);
  assert.equal(currentScope(store, AUTO, OWNED), TRUCK.key);
  assert.equal(currentScope(store, AUTO, OTHER), 'all');
  assert.equal(currentScope(store, PICK('p.2'), OWNED), null);
  // The variant another hook made plays on this one too: the model's.
  assert.equal(currentScope(editLayout(storeWith(), AUTO, SHORT, widen), AUTO, SLEEPER), TRUCK.key);
  assert.equal(currentScope(withCollection(storeWith(), MODEL_FILE), AUTO, SLEEPER), null); // a file
  // Your vehicle's own preset sits on it.
  assert.equal(currentScope(assign(store, plateKey(OWNED), 'p.1'), AUTO, OWNED), plateKey(OWNED));
});

test('moving up: off the model, what its hooks remember too; a taken target and the other variants are named', () => {
  // The sleeper variant (its 3.2 m hook remembers it) goes to the brand, where another one is;
  // the model has another variant.
  let store = foldChassis(storeWith({
    [TRUCK.key]: { name: 'Model' },                     // p.2
    [variantKey(SLEEPER)]: { name: 'Sleeper' },          // p.3
    'brand:ats/international': { name: 'Old brand' },    // p.4
  }));
  assert.deepEqual([store.assignments[TRUCK.key], store.alternates], ['p.2', { [TRUCK.key]: ['p.3'] }]);
  const plan = planScope(store, AUTO, SLEEPER, 'brand:ats/international');
  assert.deepEqual(plan, {
    mode: 'move', key: 'p.3', from: TRUCK.key, to: 'brand:ats/international', direction: 'up', mustCopy: false,
    taken: { key: 'p.4', name: 'Old brand', keeps: false },
    shadow: [{ scope: TRUCK.key, label: 'International 9900i', name: 'Model' }],
    fallback: null,
    outplayed: null,
  });
  // Without clearing the model, its other variant plays here; with it, the moved one plays.
  const kept = applyScope(store, plan, SLEEPER);
  assert.equal(kept.assignments[variantKey(SLEEPER)], undefined); // the hook forgot it
  assert.equal(kept.alternates, undefined);
  assert.equal(kept.assignments['brand:ats/international'], 'p.3');
  assert.deepEqual(scopesOf(kept, 'p.4'), []); // the old brand preset stays, unassigned
  assert.ok(kept.presets['p.4']);
  assert.equal(resolvePlaying(kept, AUTO, SLEEPER).key, 'p.2');
  store = applyScope(store, plan, SLEEPER, { clear: [TRUCK.key] });
  assert.equal(resolvePlaying(store, AUTO, SLEEPER).key, 'p.3');
  assert.equal(resolvePlaying(store, AUTO, OTHER).key, 'p.1'); // another brand
  // Nothing to change: already there.
  assert.equal(planScope(store, AUTO, SLEEPER, 'brand:ats/international'), null);
  assert.equal(planScope(store, AUTO, SLEEPER, 'not on the ladder'), null);
  assert.equal(planScope(store, AUTO, null, 'all'), null);
  // A shared file for this hook would keep playing: it cannot be unassigned, so it is named.
  const files = withCollection(storeWith({ [plateKey(OWNED)]: { name: 'Mine' } }), SLEEPER_FILE);
  assert.deepEqual(planScope(files, AUTO, OWNED, 'brand:ats/international').outplayed, { name: 'sleeper', file: true });
});

test('moving down: move frees the wider scope, copy keeps it; all vehicles always keeps its preset', () => {
  const store = rememberVehicle(storeWith({ 'game:ats': { name: 'ATS' } }), TRUCK); // p.2 for all ATS
  const plan = planScope(store, AUTO, SLEEPER, TRUCK.key);
  assert.equal(plan.direction, 'down');
  assert.deepEqual(plan.fallback, { label: 'all vehicles', name: 'Default layout' });
  const moved = applyScope(store, plan, SLEEPER);
  assert.equal(moved.assignments['game:ats'], undefined);
  assert.equal(moved.assignments[TRUCK.key], 'p.2');
  assert.equal(moved.assignments[variantKey(SLEEPER)], 'p.2'); // the hook plays it
  assert.equal(resolvePlaying(moved, AUTO, OTHER).key, 'p.1');
  const copied = applyScope(store, plan, SLEEPER, { copy: true });
  assert.equal(copied.assignments['game:ats'], 'p.2');
  assert.equal(at(copied, TRUCK.key).name, 'ATS › International › International 9900i');
  assert.deepEqual(at(copied, TRUCK.key).speakers, store.presets['p.2'].speakers);
  // From all vehicles: always a copy, here your vehicle's own.
  const fromAll = planScope(storeWith(), AUTO, OWNED, plateKey(OWNED));
  assert.equal(fromAll.mustCopy, true);
  const done = applyScope(storeWith(), fromAll, OWNED);
  assert.equal(done.assignments.all, 'p.1');
  assert.equal(at(done, plateKey(OWNED)).name, 'ATS › International › International 9900i › hook 3.2 m › WP-83695');
  assert.deepEqual(personalOf(done, TRUCK.key).map((p) => p.plate), ['WP-83695']);
  // A preset picked in the list, put to use for the model while this vehicle has its own:
  // the vehicle's keeps playing here, so it is named, to be cleared.
  const plated = assign(store, plateKey(OWNED), 'p.1');
  assert.deepEqual(planScope(plated, PICK('p.2'), OWNED, TRUCK.key).shadow, [
    { scope: plateKey(OWNED), label: 'this vehicle (WP-83695)', name: 'Default layout' },
  ]);
});

test('copy and use: a file is copied; a picked one is used here too', () => {
  // A shared file: your own copy.
  const files = withCollection(storeWith(), MODEL_FILE);
  const fromFile = applyScope(files, planScope(files, AUTO, SLEEPER, 'game:ats'), SLEEPER);
  assert.equal(at(fromFile, 'game:ats').name, 'ATS'); // named by its key
  assert.equal(at(fromFile, 'game:ats').width, 0.8);
  // Picked in the list: a variant of the model, which plays it here; it keeps its others.
  const picked = withPreset();
  const use = planScope(picked, PICK('p.2'), OTHER, OTHER.key);
  assert.equal(use.mode, 'use');
  const used = applyScope(picked, use, OTHER);
  assert.deepEqual(scopesOf(used, 'p.2'), [TRUCK.key, OTHER.key]);
  assert.equal(planScope(used, PICK('p.2'), OTHER, OTHER.key), null); // already there
  // Taking all vehicles: the old one stays, unassigned.
  const all = applyScope(picked, planScope(picked, PICK('p.2'), OTHER, 'all'), OTHER);
  assert.equal(all.assignments.all, 'p.2');
  assert.ok(all.presets['p.1']);
});

const card = (status, ...fields) => Object.fromEntries(fields.map((f) => [f, status[f]]));

test('truckStatus: what plays, where it applies, and the scope choices', () => {
  const store = withPreset(); // the model's variant "International 9900i"
  const status = truckStatus(store, AUTO, OWNED);
  assert.deepEqual(card(status, 'truck', 'plays', 'appliesTo', 'note', 'useIn', 'buttons'), {
    truck: 'International 9900i · hook 3.2 m · WP-83695',
    plays: 'International 9900i',
    appliesTo: 'International 9900i',
    note: null,
    useIn: null,
    buttons: [{ action: 'unbind', label: 'Unbind' }],
  });
  assert.equal(status.scope.value, TRUCK.key);
  assert.deepEqual(status.scope.options.map((o) => o.label), [
    'this vehicle (WP-83695)', 'International 9900i', 'all International', 'all ATS vehicles', 'all vehicles — "Default layout"',
  ]);
  // A variant other hooks remember: edits change it there too.
  const both = assign(assign(store, variantKey(SLEEPER), 'p.2'), variantKey(SHORT), 'p.2');
  assert.equal(truckStatus(both, AUTO, SLEEPER).note, 'Edits also change it on hook 2.1 m.');
  // Your vehicle's own preset sits on "this vehicle".
  const own = assign(createPreset(store, store.presets['p.1']).store, plateKey(OWNED), 'p.3');
  assert.deepEqual(card(truckStatus(own, AUTO, OWNED), 'plays', 'appliesTo', 'note'), {
    plays: 'Default layout copy — International 9900i, WP-83695', appliesTo: 'this vehicle (WP-83695)', note: null,
  });
  assert.equal(truckStatus(own, AUTO, OWNED).scope.options[1].label, 'International 9900i — "International 9900i"');
  // A file of the model: the first option says where it comes from.
  const file = truckStatus(withCollection(storeWith(), MODEL_FILE), AUTO, { ...SHORT, plate: 'X-1' });
  assert.equal(file.appliesTo, 'International 9900i, from the collection');
  assert.deepEqual(file.scope.options[0], { value: '', label: 'International 9900i, from the collection' });
  assert.equal(file.scope.value, '');
  assert.deepEqual(file.buttons, []);
  // A quick-job truck: its plate is random, so "this vehicle" is not offered.
  const lent = truckStatus(storeWith(), AUTO, LENT);
  assert.equal(lent.note, 'Editing makes a variant of International 9900i first. This quick-job vehicle has a random plate, so "this vehicle" is not offered.');
  assert.equal(lent.scope.options.some((o) => o.label.startsWith('this vehicle')), false);
  // All vehicles plays: no Unbind (something must play).
  assert.deepEqual(card(truckStatus(storeWith(), AUTO, OTHER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Default layout — all vehicles',
    appliesTo: 'every vehicle without its own preset',
    note: 'Editing makes a variant of Peterbilt 579 first.',
    buttons: [],
  });
  assert.equal(truckStatus(storeWith({ 'brand:ats/peterbilt': { name: 'P' } }), AUTO, OTHER).appliesTo, 'all Peterbilt');
  assert.equal(truckStatus(storeWith({ 'game:ats': { name: 'A' } }), AUTO, OTHER).appliesTo, 'all ATS vehicles');
  assert.equal(truckStatus(store, AUTO, TRUCK).note, null);
  // A preset picked in the list can be put to use here.
  const custom = createPreset(store, store.presets['p.1']);
  const picked = truckStatus(custom.store, PICK(custom.key), OWNED);
  assert.deepEqual(card(picked, 'plays', 'appliesTo', 'note', 'scope'), {
    plays: 'Default layout copy (picked in the list)',
    appliesTo: 'only where it is chosen',
    note: 'Editing changes this preset.',
    scope: null,
  });
  assert.deepEqual(picked.useIn.options.slice(0, 2), [{ value: '', label: 'Use it in…' }, { value: plateKey(OWNED), label: 'this vehicle (WP-83695)' }]);
  assert.equal(truckStatus(store, PICK('p.2'), null).appliesTo, 'International 9900i');
  assert.equal(truckStatus(store, PICK('p.1'), null).appliesTo, 'every vehicle without its own preset');
  assert.equal(truckStatus(store, PICK('p.2'), null).useIn, null);
  assert.deepEqual(truckStatus(store, AUTO, null), {
    truck: 'no vehicle in the game',
    plays: 'Default layout — all vehicles',
    appliesTo: 'every vehicle without its own preset',
    note: null,
    scope: null,
    useIn: null,
    buttons: [],
  });
});

test('the preset list: Auto, your presets with where they apply, Unassigned, Collection', () => {
  let store = rememberVehicle(withPreset(), OWNED); // its plate and hook are known, as after driving it
  store = createPreset(store, store.presets['p.1']).store; // p.3 "Default layout copy"
  store = assign(store, plateKey(OWNED), 'p.3'); // this vehicle's own
  store = createPreset(store, { ...store.presets['p.2'], name: 'Sleeper', label: 'sleeper' }).store; // p.4
  store = addAlternate(store, TRUCK.key, 'p.4'); // a variant of the model
  store = createPreset(store, store.presets['p.1']).store; // p.5, unassigned
  const options = presetOptions(store, null);
  assert.deepEqual(options[0], { value: 'auto', label: 'Auto — no game' });
  assert.deepEqual(options.slice(1, -1).map((o) => o.label).sort(), [
    'Default layout — all vehicles',
    'Default layout copy — International 9900i, WP-83695',
    'International 9900i',
    'Sleeper · sleeper — International 9900i',
  ].sort());
  assert.deepEqual(options.at(-1), { group: 'Unassigned', options: [{ value: 'truck:p.5', label: 'Default layout copy 2' }] });
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

test('collection: a file for the hook, then the model\'s variant, then the model\'s files, before wider ones', () => {
  const store = withCollection(storeWith(), SLEEPER_FILE, MODEL_FILE);
  assert.deepEqual(autoPreset(store, SLEEPER), { key: 'file:sleeper.json', how: 'collectionChassis', scope: variantKey(SLEEPER) });
  assert.equal(autoPreset(store, SHORT).how, 'collectionModel');
  assert.deepEqual(resolvePlaying(store, AUTO, SLEEPER), { kind: 'collection', key: 'file:sleeper.json', layout: SLEEPER_FILE.layout });
  assert.equal(autoPreset(withCollection(storeWith(), SLEEPER_FILE), SHORT).how, 'collectionSibling');
  // A file for this very hook plays before the model's variant on a hook new to you; a hook
  // you have set up plays what it remembers: a file dropped into presets/ never takes it over.
  assert.equal(autoPreset(withCollection(withPreset(), SLEEPER_FILE), SLEEPER).how, 'collectionChassis');
  assert.equal(autoPreset(withCollection(withPreset(), SLEEPER_FILE), SHORT).how, 'model');
  assert.equal(autoPreset(withCollection(assign(withPreset(), variantKey(SLEEPER), 'p.2'), SLEEPER_FILE), SLEEPER).how, 'chassis');
  // Several files for one hook: the first by path; another vehicle's files never play.
  const two = withCollection(storeWith(), shared('b.json', variantKey(SLEEPER)), shared('a.json', variantKey(SLEEPER)));
  assert.equal(autoPreset(two, SLEEPER).key, 'file:a.json');
  assert.equal(autoPreset(store, OTHER).how, 'all');
  assert.equal(resolvePlaying(store, PICK('file:model.json'), null).kind, 'collection');
  assert.equal(resolvePlaying(store, PICK('file:gone.json'), null).key, 'p.1');
});

test('collection: editing never changes a file', () => {
  const store = withCollection(storeWith(), SLEEPER_FILE);
  // Auto: the first edit makes your copy, a variant of the model in the file's place.
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  const key = edited.assignments[TRUCK.key];
  assert.deepEqual([at(edited, TRUCK.key).width, at(edited, TRUCK.key).name], [1.5, 'ATS › International › International 9900i']);
  assert.equal(at(edited, TRUCK.key).copyOf, 'file:sleeper.json');
  assert.equal(edited.assignments[variantKey(SLEEPER)], key);
  assert.equal(edited.collection['file:sleeper.json'].layout.width, 0.8);
  assert.equal(autoPreset(edited, SLEEPER).how, 'chassis');
  assert.deepEqual(alternatesOf(edited, TRUCK.key).map((v) => v.key), [key]); // yours stands for the file
  // Picked in the list: an unassigned copy, chosen instead.
  const adopted = adoptPicked(store, PICK('file:sleeper.json'));
  assert.equal(adopted.selection.key, 'p.2');
  assert.equal(adopted.store.presets['p.2'].name, 'sleeper copy');
  assert.equal(adopted.store.presets['p.2'].width, 0.8);
  assert.deepEqual(adoptPicked(store, AUTO), { store, selection: AUTO });
  assert.equal(editLayout(store, PICK('file:sleeper.json'), SLEEPER, widen), store); // dropped
});

test('collection: a binding may point at a file and is kept while the file is missing', () => {
  const bound = assign(withCollection(storeWith(), MODEL_FILE), plateKey(OWNED), 'file:model.json');
  assert.deepEqual(autoPreset(bound, OWNED), { key: 'file:model.json', how: 'vehicle', scope: plateKey(OWNED) });
  const reloaded = normalizeStore({ version: 3, presets: bound.presets, assignments: bound.assignments });
  assert.equal(reloaded.assignments[plateKey(OWNED)], 'file:model.json');
  assert.equal(autoPreset(reloaded, OWNED).how, 'all');
});

test('collection: the card and the list', () => {
  const store = withCollection(storeWith(), shared('t.json', variantKey(SLEEPER), { name: 'Sleeper cab', author: 'Alex' }), MODEL_FILE);
  assert.deepEqual(card(truckStatus(store, AUTO, SLEEPER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Sleeper cab — Alex',
    appliesTo: 'International 9900i, from the collection',
    note: 'From the collection: t.json. Editing makes it your own variant of International 9900i first.',
    buttons: [],
  });
  assert.equal(truckStatus(store, AUTO, SHORT).appliesTo, 'International 9900i, from the collection');
  const pickedFile = truckStatus(store, PICK('file:t.json'), SLEEPER);
  assert.deepEqual(card(pickedFile, 'plays', 'appliesTo', 'note'), {
    plays: 'Sleeper cab — Alex (picked in the list)',
    appliesTo: 'International 9900i, a variant for hook 3.2 m',
    note: 'From the collection: t.json. Editing makes your own copy first.',
  });
  assert.equal(pickedFile.useIn.options[0].label, 'Use it in…');
  const options = presetOptions(store, SLEEPER);
  assert.equal(options[0].label, 'Auto — Sleeper cab — Alex (collection)');
  assert.deepEqual(options.at(-1), {
    group: 'Collection',
    options: [{ value: 'truck:file:model.json', label: 'model' }, { value: 'truck:file:t.json', label: 'Sleeper cab — Alex' }],
  });
});

// One preset as the export window gives it: for the narrowest key it is on.
const exportPreset = (store, key, truck) => exportFiles(store, [{ scope: scopesOf(store, key)[0] ?? null, key }], truck).files[0];

test('exportFiles: a preset as a file for the key it is on', () => {
  // p.2 the model's variant, p.3 another its 3.2 m hook remembers.
  const store = rememberVehicle(foldChassis(storeWith({
    [TRUCK.key]: { name: TRUCK.name },
    [variantKey(SLEEPER)]: { name: 'ATS › International › International 9900i', width: 1.5 },
  })), TRUCK);
  const sleeper = exportPreset(store, 'p.3', SLEEPER);
  assert.equal(sleeper.fileName, 'ATS, International, International 9900i.json');
  assert.deepEqual({ ...sleeper.data, layout: null }, {
    truckerAuxPreset: 1, name: 'ATS › International › International 9900i', vehicle: 'vehicle.international.9900i@3.2', vehicleName: 'International 9900i',
    game: 'ats', brand: 'international', brandName: 'International', layout: null,
  });
  assert.equal(sleeper.data.layout.width, 1.5);
  assert.equal(exportPreset(store, 'p.2', null).data.vehicle, TRUCK.key);
  // A variant several hooks remember: the first in vehicle, all of them in hooks.
  const two = assign(store, variantKey(SHORT), 'p.3');
  assert.deepEqual([exportPreset(two, 'p.3', null).data.vehicle, exportPreset(two, 'p.3', null).data.hooks], [variantKey(SHORT), ['2.1', '3.2']]);
  // This vehicle's own preset is shared for its hook: the plate stays private.
  const own = createPreset(store, store.presets['p.1']);
  const plated = assign(own.store, plateKey(OWNED), own.key);
  assert.equal(exportPreset(plated, own.key, OWNED).data.vehicle, variantKey(OWNED));
  assert.equal(exportPreset(plated, own.key, null).data.vehicle, TRUCK.key);
  // An unassigned preset is for no vehicle, all vehicles' for "all"; a shared file can go again.
  const custom = createPreset(store, store.presets['p.1']);
  assert.equal('vehicle' in exportPreset(custom.store, custom.key, SLEEPER).data, false);
  assert.equal(exportPreset(store, 'p.1', SLEEPER).data.name, 'Default layout');
  assert.equal(exportPreset(store, 'p.1', SLEEPER).data.vehicle, 'all');
  assert.equal(exportFiles(withCollection(store, MODEL_FILE), [{ scope: TRUCK.key, key: 'file:model.json' }], SLEEPER).files[0].data.vehicle, TRUCK.key);
  // A model never driven is named after your preset for it; a hook-only one has no name.
  assert.equal(exportPreset(withPreset(), 'p.2', null).data.vehicleName, 'International 9900i');
  const chassisOnly = storeWith({ [variantKey(SLEEPER)]: { name: 'Sleeper' } });
  assert.equal('vehicleName' in exportPreset(chassisOnly, 'p.2', null).data, false);
});

// The map, as text: "label = own" (bold in the app) or "label (inherited)", ● on the
// vehicle's chain, ▶ what plays.
const lines = (node, depth = 0) => [
  `${'  '.repeat(depth)}${node.plays ? '▶ ' : node.current ? '● ' : ''}${node.label}${node.own ? ` = ${node.own.name}${node.own.file ? ' (file)' : ''}` : ` (${node.inherited?.name})`}`,
  ...node.children.flatMap((c) => lines(c, depth + 1)),
];

test('presetTree: registry-like keys for every model driven, keys with presets and the vehicle in the game', () => {
  let store = foldChassis(storeWith({
    [variantKey(SLEEPER)]: { name: 'Sleeper' },
    'brand:ats/peterbilt': { name: 'Petes' },
    'vehicle.scania.r#AB-1': { name: 'My Scania' },
    'vehicle.mack.anthem': { name: 'Anthem' }, // a model not driven since presets got scopes
  }, [{ name: 'Spare' }]));
  store = rememberVehicle(store, OWNED); // driven before: the sleeper with its plate
  store = rememberVehicle(store, OTHER); // a Peterbilt 579, no preset of its own
  store = rememberVehicle(store, { key: 'vehicle.scania.r', name: 'Scania R', game: 'ets2', brand: 'scania', brandName: 'Scania' });
  store = withCollection(store, MODEL_FILE, shared('loose.json', null));
  const map = presetTree(store, { ...SHORT, plate: 'X-1' });
  assert.deepEqual(lines(map.root), [
    '● All vehicles = Default layout',
    '  ● ATS (Default layout)',
    '    ● International (Default layout)',
    '      ▶ International 9900i = Sleeper',
    '    Peterbilt = Petes',
    '      Peterbilt 579 (Petes)',
    '  ETS2 (Default layout)',
    '    Scania (Default layout)',
    '      Scania R (Default layout)',
    '  Game not known yet (drive a vehicle once) (Default layout)',
    '    Anthem = Anthem',
  ]);
  const find = (n, scope) => (n.scope === scope ? n : n.children.map((c) => find(c, scope)).find(Boolean));
  assert.deepEqual(find(map.root, TRUCK.key).alternates.map((v) => v.key), ['file:model.json']);
  assert.deepEqual(find(map.root, TRUCK.key).own.hooks, ['3.2']);
  // A vehicle's own preset shows among its model's, with its plate.
  assert.deepEqual(find(map.root, 'vehicle.scania.r').alternates.map((v) => [v.key, v.plate]), [['p.4', 'AB-1']]);
  assert.equal(map.root.children.at(-1).pseudo, true); // that folder is no scope
  assert.deepEqual(map.unassigned, [{ key: 'p.6', name: 'Spare', label: null, labelColor: 'blue' }]);
  assert.deepEqual(map.files, [{ key: 'file:loose.json', name: 'loose', default: false, label: null, labelColor: 'blue' }]);
});

test('presetTree: the model in the game shows what plays in it, others their current one; ▶ only in Auto', () => {
  const store = foldChassis(storeWith({ [variantKey(SLEEPER)]: { name: 'Sleeper' }, [variantKey(SHORT)]: { name: 'Day' } }));
  assert.equal(store.assignments[TRUCK.key], 'p.3'); // the first by hook: the 2.1 m day cab
  const find = (n, scope) => (n.scope === scope ? n : n.children.map((c) => find(c, scope)).find(Boolean));
  const model = find(presetTree(store, SLEEPER).root, TRUCK.key);
  assert.deepEqual([model.own.key, model.plays, model.alternates.map((v) => v.key)], ['p.2', true, ['p.3']]);
  assert.deepEqual([model.own.hooks, model.own.plates], [['3.2'], []]);
  assert.equal(find(presetTree(store, OTHER).root, TRUCK.key).own.key, 'p.3');
  // Not in Auto: no ▶.
  const picked = presetTree(store, SHORT, { mode: 'scope', scope: 'all' });
  assert.ok(!lines(picked.root).some((l) => l.includes('▶')));
});

test('model names: models of a brand the game names alike get the year from their id', () => {
  const C19 = { key: 'vehicle.freightliner.cascadia2019', name: 'Freightliner Cascadia', game: 'ats', brand: 'freightliner', brandName: 'Freightliner', variant: '2.0' };
  const C24 = { ...C19, key: 'vehicle.freightliner.cascadia2024', variant: '2.7' };
  const store = rememberVehicle(rememberVehicle(storeWith(), C19), C24);
  assert.equal(scopeLabel(store, C19.key), 'Freightliner Cascadia 2019');
  assert.equal(scopeLabel(store, variantKey(C24)), 'Freightliner Cascadia 2024, hook 2.7 m');
  assert.equal(truckStatus(store, AUTO, C24).truck, 'Freightliner Cascadia 2024 · hook 2.7 m');
  const tree = lines(presetTree(store, C24).root);
  assert.ok(tree.includes('      ● Freightliner Cascadia 2024 (Default layout)'));
  assert.ok(tree.includes('      Freightliner Cascadia 2019 (Default layout)'));
  // A new model's first variant is named with it.
  const adopted = adoptVehicle(store, C24);
  assert.equal(at(adopted, C24.key).name, 'ATS › Freightliner › Freightliner Cascadia 2024');
  assert.equal(adopted.assignments[variantKey(C24)], adopted.assignments[C24.key]);
  // A file keeps the game's name: the app tells the twins apart when it shows them.
  const picks = [{ scope: C24.key, key: adopted.assignments[C24.key] }];
  assert.equal(exportFiles(adopted, picks).files[0].data.vehicleName, 'Freightliner Cascadia');
  // Alone, a model keeps the game's name; one already ending with the year is not given it twice.
  assert.equal(scopeLabel(rememberVehicle(storeWith(), C24), C24.key), 'Freightliner Cascadia');
  const named = rememberVehicle(rememberVehicle(storeWith(), { ...C19, name: 'Cascadia 2019' }), { ...C24, name: 'Cascadia 2019' });
  assert.equal(scopeLabel(named, C19.key), 'Cascadia 2019');
});

test('model names: a shared file\'s vehicleName before your preset\'s name, never a key path', () => {
  const PINNACLE = 'vehicle.mack.pinnacle';
  // Never driven here: your preset on its key named the way the app names them.
  const store = storeWith({ [PINNACLE]: { name: 'ATS › Mack › Mack Pinnacle' } });
  assert.equal(scopeLabel(store, PINNACLE), 'Mack Pinnacle');
  // Copies are named by the path, so the path does not grow ("ATS › Mack › ATS › Mack › …").
  assert.equal(scopeLabel(storeWith({ [PINNACLE]: { name: 'My Mack' } }), PINNACLE), 'My Mack');
  const file = withCollection(storeWith({ [PINNACLE]: { name: 'My Mack' } }), shared('pin.json', `${PINNACLE}@2.6`, { vehicleName: 'Mack Pinnacle' }));
  assert.equal(scopeLabel(file, PINNACLE), 'Mack Pinnacle');
});

test('planAssign: one of your presets put at a key of the map', () => {
  const store = withPreset();
  // On a model: a variant more, its current one; nothing is taken.
  const plan = planAssign(store, 'p.1', TRUCK.key);
  assert.equal(plan.taken, null);
  const done = applyScope(store, plan, null);
  assert.equal(done.assignments[TRUCK.key], 'p.1');
  assert.deepEqual(done.alternates, { [TRUCK.key]: ['p.2'] });
  assert.deepEqual(scopesOf(done, 'p.1'), [TRUCK.key, 'all']);
  assert.equal(planAssign(done, 'p.1', TRUCK.key), null);
  assert.equal(planAssign(done, 'p.1', '?unknown'), null);
  // On a brand's key: the one there is taken.
  const brand = storeWith({ 'brand:ats/international': { name: 'B' } });
  assert.deepEqual(planAssign(brand, 'p.1', 'brand:ats/international').taken, { key: 'p.2', name: 'B', keeps: false });
});

test('planMove: moving a preset in the map, up its chain, down or across', () => {
  const store = rememberVehicle(foldChassis(storeWith({
    [TRUCK.key]: { name: 'Model' },                   // p.2
    [variantKey(SLEEPER)]: { name: 'Sleeper' },        // p.3, a variant its 3.2 m hook remembers
    'game:ats': { name: 'ATS' },                       // p.4
  })), TRUCK);
  // Up from the model to the game: the sleeper variant leaves the model; its hook forgets it.
  const up = planMove(store, TRUCK.key, 'game:ats', null, 'p.3');
  assert.deepEqual({ ...up, shadow: up.shadow.map((s) => s.scope) }, {
    mode: 'move', key: 'p.3', from: TRUCK.key, to: 'game:ats', direction: 'up', mustCopy: false,
    taken: { key: 'p.4', name: 'ATS', keeps: false }, shadow: [], fallback: null, outplayed: null,
  });
  const moved = applyScope(store, up, null);
  assert.equal(moved.assignments['game:ats'], 'p.3');
  assert.equal(moved.assignments[variantKey(SLEEPER)], undefined);
  assert.equal(moved.assignments[TRUCK.key], 'p.2');
  assert.ok(moved.presets['p.4']); // unassigned, not deleted
  // Down from the game to the model: a variant more there; what plays where it was is named.
  const down = planMove(store, 'game:ats', TRUCK.key);
  assert.equal(down.direction, 'down');
  assert.equal(down.taken, null);
  assert.deepEqual(down.fallback, { label: 'all vehicles', name: 'Default layout' });
  const copied = applyScope(store, down, null, { copy: true });
  assert.equal(copied.assignments['game:ats'], 'p.4');
  assert.equal(at(copied, TRUCK.key).name, 'ATS › International › International 9900i');
  // Across, to another model (dragging): it leaves this one.
  const across = planMove(store, TRUCK.key, OTHER.key, null, 'p.3');
  assert.equal(across.direction, 'across');
  const acrossDone = applyScope(store, across, null);
  assert.equal(acrossDone.assignments[OTHER.key], 'p.3');
  assert.equal(acrossDone.alternates, undefined);
  assert.equal(planMove(store, TRUCK.key, 'brand:ats/peterbilt').direction, 'across');
  assert.equal(planMove(store, TRUCK.key, '?unknown'), null); // a folder
  // A file, nothing there: no plan.
  assert.equal(planMove(store, 'vehicle.nothing', 'all'), null);
  assert.equal(planMove(assign(store, 'game:ets2', 'file:a.json'), 'game:ets2', 'all'), null);
  // From all vehicles: always a copy.
  assert.equal(planMove(store, 'all', 'game:ets2').mustCopy, true);
});

test('a shared file may say the game and brand of its vehicle: the map places it before it is driven', () => {
  const file = shared('anthem.json', 'vehicle.mack.anthem@2.4', { game: 'ats', brand: 'mack', brandName: 'Mack', vehicleName: 'Mack Anthem' });
  assert.deepEqual([file.game, file.brand, file.brandName], ['ats', 'mack', 'Mack']);
  assert.equal(shared('x.json', 'vehicle.x', { game: 'gta' }).game, null);
  const map = presetTree(withCollection(storeWith(), file), null);
  assert.deepEqual(lines(map.root), [
    '● All vehicles = Default layout',
    '  ATS (Default layout)',
    '    Mack (Default layout)',
    '      Mack Anthem = anthem (file)',
  ]);
  // Exported again, the file keeps saying where the vehicle is from.
  const own = assign(withCollection(storeWith(), file), 'vehicle.mack.anthem@2.4', 'p.1');
  assert.equal(exportPreset(own, 'p.1', null).data.game, 'ats');
});

test('adoptVehicle: a new model gets its first variant; a new hook remembers what it plays', () => {
  const store = storeWith({ 'brand:ats/international': { name: 'Brand', width: 0.4 } });
  // A model new to the app: a copy of what it would inherit, its hook remembering it.
  const adopted = adoptVehicle(store, SLEEPER);
  assert.deepEqual([adopted.assignments[TRUCK.key], adopted.assignments[variantKey(SLEEPER)]], ['p.3', 'p.3']);
  assert.equal(at(adopted, TRUCK.key).name, 'ATS › International › International 9900i');
  assert.equal(at(adopted, TRUCK.key).width, 0.4); // the brand's, copied
  assert.deepEqual([at(adopted, TRUCK.key).label, at(adopted, TRUCK.key).labelColor], ['new', 'green']); // stands out until labelled
  assert.notEqual(at(adopted, TRUCK.key).speakers, store.presets['p.2'].speakers);
  // Another hook: it remembers the model's current variant, no copy.
  const second = adoptVehicle(adopted, SHORT);
  assert.deepEqual(Object.keys(second.presets), Object.keys(adopted.presets));
  assert.equal(second.assignments[variantKey(SHORT)], 'p.3');
  assert.equal(adoptVehicle(second, SHORT), second); // remembered now
  // A variant made later on another hook does not move it.
  const two = newAlternate(second, TRUCK.key, SLEEPER);
  assert.equal(two.assignments[variantKey(SLEEPER)], 'p.4');
  assert.equal(autoPreset(two, SHORT).key, 'p.3');
  // A file for the model: a new hook remembers it; a file for that very hook plays without a memory.
  const fromFile = adoptVehicle(withCollection(storeWith(), MODEL_FILE), SHORT);
  assert.equal(fromFile.assignments[variantKey(SHORT)], 'file:model.json');
  const hookFile = withCollection(storeWith(), SLEEPER_FILE);
  assert.equal(adoptVehicle(hookFile, SLEEPER), hookFile);
  assert.equal(adoptVehicle(hookFile, SHORT).assignments[variantKey(SHORT)], 'file:sleeper.json'); // another hook's file
  // The game reports no hook: the model gets it.
  assert.equal(at(adoptVehicle(storeWith(), OTHER), OTHER.key).name, 'ATS › Peterbilt › Peterbilt 579'); // all vehicles' copied
  // Your vehicle remembering a preset: nothing new.
  const plate = storeWith({ [plateKey(OWNED)]: { name: 'Mine' } });
  assert.equal(adoptVehicle(plate, OWNED), plate);
  assert.equal(adoptVehicle(store, null), store);
});

test('a key picked in the map: it plays what it has or inherits; editing gives it its own first', () => {
  const store = rememberVehicle(storeWith({ 'brand:ats/international': { name: 'Brand', width: 0.4 } }), OWNED);
  const KEY = { mode: 'scope', scope: TRUCK.key };
  assert.deepEqual(scopePreset(store, KEY.scope), { key: 'p.2', at: 'brand:ats/international' });
  assert.equal(resolvePlaying(store, KEY, null).key, 'p.2');
  assert.equal(truckStatus(store, KEY, null).note,
    'It inherits this from all International: editing gives International 9900i a preset of its own first.');
  const edited = editLayout(store, KEY, null, widen);
  assert.equal(at(edited, KEY.scope).width, 1.5);
  assert.equal(at(edited, KEY.scope).name, 'ATS › International › International 9900i');
  assert.equal(at(edited, 'brand:ats/international').width, 0.4); // the brand's stays
  assert.equal(truckStatus(edited, KEY, null).note, 'Editing changes the preset of International 9900i.');
  const again = editLayout(edited, KEY, null, (l) => setWidth(l, 0.2));
  assert.equal(Object.keys(again.presets).length, Object.keys(edited.presets).length); // no second copy
  // A model's file plays on its key; editing it makes your copy in its place.
  const files = withCollection(store, SLEEPER_FILE);
  assert.equal(scopePreset(files, TRUCK.key).key, 'file:sleeper.json');
  assert.equal(truckStatus(files, KEY, null).note, 'A shared file of International 9900i: editing makes your own copy in its place first.');
  const copied = editLayout(files, KEY, null, widen);
  assert.deepEqual([at(copied, TRUCK.key).copyOf, copied.assignments[variantKey(SLEEPER)]], ['file:sleeper.json', copied.assignments[TRUCK.key]]);
  // The list shows the key; values round-trip.
  assert.equal(presetOptions(store, null, KEY)[1].label, 'Key: International 9900i');
  assert.deepEqual(parseSelection(selectionValue(KEY)), KEY);
});

test('the map shows a preset\'s label beside its keys', () => {
  const store = storeWith({ [TRUCK.key]: { name: 'International 9900i', label: 'Day cab' } }, [{ name: 'Spare', label: 'Test' }]);
  const map = presetTree(store, null);
  const model = (function find(n) { return n.scope === TRUCK.key ? n : n.children.map(find).find(Boolean); })(map.root);
  assert.equal(model.own.label, 'Day cab');
  assert.equal(map.root.own.label, null);
  assert.deepEqual(map.unassigned, [{ key: 'p.3', name: 'Spare', label: 'Test', labelColor: 'blue' }]);
  assert.equal(model.own.labelColor, 'blue');
  // A shared file on no key shows its label among the unused too.
  const loose = withCollection(store, { ...shared('loose.json', null), layout: { ...defaultLayout(), name: 'loose', label: 'Spare', labelColor: 'red' } });
  assert.deepEqual([presetTree(loose, null).files[0].label, presetTree(loose, null).files[0].labelColor], ['Spare', 'red']);
  // A shared file carries its label too, and Export writes it.
  assert.equal(exportPreset(store, 'p.2', null).data.layout.label, 'Day cab');
});

test('the card offers Back to Auto when a key or a preset is picked', () => {
  const store = withPreset();
  const back = { action: 'auto', label: 'Back to Auto' };
  assert.deepEqual(truckStatus(store, PICK('p.2'), OWNED).buttons, [back]);
  assert.deepEqual(truckStatus(store, { mode: 'scope', scope: TRUCK.key }, OWNED).buttons, [back]);
  assert.equal(truckStatus(store, AUTO, OWNED).buttons.some((b) => b.action === 'auto'), false);
});

test('exportFiles: each ticked preset goes for its key; a vehicle\'s own goes for its hook', () => {
  let store = storeWith({
    'game:ats': { name: 'ATS' },
    'brand:ats/international': { name: 'International' },
    [variantKey(SLEEPER)]: { name: 'Sleeper' },
    [plateKey(OWNED)]: { name: 'Mine' },
  });
  store = rememberVehicle(store, OWNED);
  const picks = ['brand:ats/international', 'game:ats', 'all'].map((scope) => ({ scope, key: store.assignments[scope] }));
  const set = exportFiles(store, picks, null);
  assert.deepEqual(set.files.map((f) => [f.data.name, f.data.vehicle ?? null]), [
    ['International', 'brand:ats/international'], ['ATS', 'game:ats'], ['Default layout', 'all'],
  ]);
  assert.deepEqual(
    { game: set.files[0].data.game, brand: set.files[0].data.brand, brandName: set.files[0].data.brandName },
    { game: 'ats', brand: 'international', brandName: 'International' },
  );
  assert.equal(set.plates, 0);
  // A vehicle's own goes for its hook, beside the variant the hook remembers: variants, no clash.
  const both = exportFiles(store, [
    { scope: TRUCK.key, key: store.assignments[variantKey(SLEEPER)] },
    { scope: plateKey(OWNED), key: store.assignments[plateKey(OWNED)] },
  ], null);
  assert.deepEqual(both.files.map((f) => f.data.vehicle), [variantKey(OWNED), variantKey(OWNED)]);
  assert.equal(both.plates, 1);
  // A shared file keeps its author; one on no key goes for none.
  const file = withCollection(store, { ...MODEL_FILE, author: 'Alex' });
  const loose = exportFiles(file, [{ scope: null, key: 'file:model.json' }], null).files[0].data;
  assert.equal(loose.author, 'Alex');
  assert.equal('vehicle' in loose, false);
});

test('defaults (presets/default/): the bottom layer, under yours and others\' files', () => {
  const file = (path, vehicle, width) => ({ ...shared(path, vehicle), layout: { ...defaultLayout(), name: path, width } });
  const def = file('default/model.json', TRUCK.key, 0.8);
  const theirs = file('z-theirs.json', TRUCK.key, 0.6);
  assert.equal(def.default, true);
  assert.equal(theirs.default, false);
  // Another file for the model plays before the default, though "default/" sorts first by path.
  assert.equal(autoPreset(withCollection(storeWith(), def, theirs), SHORT).key, 'file:z-theirs.json');
  assert.equal(autoPreset(withCollection(storeWith(), def), SHORT).key, 'file:default/model.json');
  // Yours plays before it; the tree marks it a default.
  const mine = withCollection(storeWith({ [TRUCK.key]: { name: 'Mine' } }), def);
  assert.equal(autoPreset(mine, SHORT).how, 'model');
  const node = (function find(n) { return n.scope === TRUCK.key ? n : n.children.map(find).find(Boolean); })(presetTree(withCollection(storeWith(), def), null).root);
  assert.deepEqual([node.own.file, node.own.default], [true, true]);
  // Editing the key it plays on gives the key a copy of yours; the file stays.
  const KEY = { mode: 'scope', scope: TRUCK.key };
  const edited = editLayout(withCollection(storeWith(), def), KEY, null, widen);
  assert.equal(at(edited, TRUCK.key).width, 1.5);
  assert.equal(edited.collection['file:default/model.json'].layout.width, 0.8);
  // A new store starts with the default for all vehicles.
  const all = file('default/all.json', 'all', 0.7);
  const seeded = seedAll(storeWith(), { [all.key]: all });
  assert.equal(at(seeded, 'all').width, 0.7);
  const empty = storeWith();
  assert.equal(seedAll(empty, {}), empty); // no default for all vehicles: the built-in layout
});

test('dropImportedDefaults: 0.1.1\'s copies of the defaults give way to them; changed ones stay', () => {
  const def = (path, vehicle, width) => ({ ...shared(path, vehicle), default: true, layout: { ...defaultLayout(), name: path, width } });
  const model = def('default/model.json', TRUCK.key, 0.8);
  const chassis = def('default/chassis.json', variantKey(SLEEPER), 0.6);
  const collection = { [model.key]: model, [chassis.key]: chassis };
  let store = storeWith({ [TRUCK.key]: { name: 'default/model.json', width: 0.8 }, [variantKey(SLEEPER)]: { name: 'default/chassis.json', width: 0.9 } }, [{ name: 'default/model.json', width: 0.8 }]);
  store = { ...store, defaultsImported: true };
  const done = dropImportedDefaults(store, collection);
  assert.equal('defaultsImported' in done, false);
  assert.equal(done.assignments[TRUCK.key], undefined); // the same as the default: it plays again
  assert.equal(at(done, variantKey(SLEEPER)).width, 0.9); // changed: yours
  assert.equal(Object.keys(done.presets).length, 2); // the unused copy went too
  assert.equal(dropImportedDefaults(done, collection), done);
  assert.equal(normalizeStore(store).defaultsImported, true);
});

const CHASSIS = variantKey(SLEEPER);
const MODEL = TRUCK.key;
// p.2 the studio is the model's current variant, p.3 the sleeper waits.
const twoCabs = () => addAlternate(storeWith({ [MODEL]: { name: 'Studio', label: 'studio' } }, [{ name: 'Sleeper' }]), MODEL, 'p.3');
const nodeAt = (root, scope) => (function find(n) { return n.scope === scope ? n : n.children.map(find).find(Boolean); })(root);

test('variants: a model holds a current one and others that wait; picking one swaps them', () => {
  const store = twoCabs();
  assert.deepEqual(store.alternates, { [MODEL]: ['p.3'] });
  assert.deepEqual(alternatesOf(store, MODEL).map((a) => [a.key, a.name, a.label, a.active]), [['p.2', 'Studio', 'studio', true], ['p.3', 'Sleeper', null, false]]);
  assert.deepEqual(presetTree(store, null).unassigned, []); // it waits on the model, not among the unused
  assert.deepEqual(nodeAt(presetTree(store, SLEEPER).root, MODEL).alternates.map((a) => a.key), ['p.3']);
  const picked = pickAlternate(store, MODEL, 'p.3');
  assert.equal(picked.assignments[MODEL], 'p.3');
  assert.deepEqual(picked.alternates, { [MODEL]: ['p.2'] });
  assert.equal(autoPreset(picked, SLEEPER).key, 'p.3');
  assert.equal(pickAlternate(picked, MODEL, 'p.3'), picked); // it plays already
  // The current one, or one waiting already, is not added again.
  assert.equal(addAlternate(store, MODEL, 'p.2'), store);
  assert.equal(addAlternate(store, MODEL, 'p.3'), store);
  // A deleted preset leaves the model's variants.
  assert.equal(deletePreset(store, 'p.3').alternates, undefined);
});

test('variants: taking one off the model; the next one plays, its hooks forget it, the preset stays', () => {
  const store = assign(twoCabs(), CHASSIS, 'p.2'); // the 3.2 m hook remembers the studio
  const off = dropAlternate(store, MODEL, 'p.2');
  assert.deepEqual([off.assignments[MODEL], off.assignments[CHASSIS], off.alternates], ['p.3', undefined, undefined]);
  assert.equal(autoPreset(off, SLEEPER).key, 'p.3');
  assert.deepEqual(presetTree(off, null).unassigned.map((p) => p.key), ['p.2']);
  const waiting = dropAlternate(store, MODEL, 'p.3');
  assert.deepEqual([waiting.assignments[MODEL], waiting.alternates], ['p.2', undefined]);
  assert.equal(dropAlternate(off, MODEL, 'p.3').assignments[MODEL], undefined); // the last one: the model is free
});

test('variants: a new one is a copy of the model\'s, named by it, labelled new; it plays in the vehicle', () => {
  const store = assign(storeWith({ [MODEL]: { name: 'Studio', label: 'studio', width: 0.7 } }), CHASSIS, 'p.2');
  const next = newAlternate(store, MODEL, SLEEPER);
  const key = next.assignments[MODEL];
  assert.notEqual(key, 'p.2');
  assert.equal(next.presets[key].name, 'ATS › International › International 9900i');
  assert.deepEqual([next.presets[key].label, next.presets[key].labelColor, next.presets[key].width], ['new', 'green', 0.7]);
  assert.deepEqual(next.alternates, { [MODEL]: ['p.2'] });
  assert.equal(next.assignments[CHASSIS], key); // the vehicle in the game plays it
  assert.equal(newAlternate(store, MODEL, SHORT).assignments[CHASSIS], 'p.2'); // another hook keeps its own
  // A model with nothing of its own: a copy of what it inherits, and nothing waits.
  const fresh = newAlternate(storeWith(), MODEL, SLEEPER);
  assert.equal(at(fresh, MODEL).label, 'new');
  assert.equal(fresh.alternates, undefined);
  // A copy of another preset (the menu's "copy current": what plays now).
  const fromAll = newAlternate(store, MODEL, SLEEPER, 'p.1');
  assert.deepEqual([at(fromAll, MODEL).width, at(fromAll, MODEL).speakers.length], [1, 2]);
  assert.deepEqual(fromAll.alternates, { [MODEL]: ['p.2'] });
});

test('variants: the files for a model and its hooks are variants too; picking one makes it current', () => {
  const studio = shared('studio.json', CHASSIS);
  const files = withCollection(storeWith(), SLEEPER_FILE, studio);
  assert.deepEqual(alternatesOf(files, MODEL).map((a) => [a.key, a.file, a.active, a.hooks]), [['file:sleeper.json', true, true, ['3.2']], ['file:studio.json', true, false, ['3.2']]]);
  const picked = pickAlternate(files, MODEL, 'file:studio.json');
  assert.equal(picked.assignments[MODEL], 'file:studio.json');
  assert.equal(picked.alternates, undefined); // a file needs no place: it is the model's by its vehicle
  assert.equal(autoPreset(picked, SHORT).key, 'file:studio.json'); // a hook without a file of its own
  assert.equal(autoPreset(picked, SLEEPER).key, 'file:sleeper.json'); // the hook's files, first by path
  assert.deepEqual(alternatesOf(picked, MODEL).map((a) => [a.key, a.active]), [['file:studio.json', true], ['file:sleeper.json', false]]);
  // Yours plays before the files; picking a file keeps yours waiting.
  const own = withCollection(storeWith({ [MODEL]: { name: 'Mine' } }), SLEEPER_FILE);
  assert.deepEqual(alternatesOf(own, MODEL).map((a) => [a.key, a.active]), [['p.2', true], ['file:sleeper.json', false]]);
  const toFile = pickAlternate(own, MODEL, 'file:sleeper.json');
  assert.deepEqual([toFile.assignments[MODEL], toFile.alternates], ['file:sleeper.json', { [MODEL]: ['p.2'] }]);
  assert.deepEqual(pickAlternate(toFile, MODEL, 'p.2').assignments[MODEL], 'p.2');
  // A file one of yours was copied from, or has the same speakers as, is no variant of its own;
  // nor is all vehicles' file, which plays only when picked by hand.
  const copied = withCollection(storeWith({ [MODEL]: { ...SLEEPER_FILE.layout, name: 'My copy' } }), SLEEPER_FILE);
  assert.deepEqual(alternatesOf(copied, MODEL).map((a) => a.key), ['p.2']);
  const edited = withCollection(storeWith({ [MODEL]: { name: 'Edited', copyOf: 'file:sleeper.json' } }), SLEEPER_FILE);
  assert.deepEqual(alternatesOf(edited, MODEL).map((a) => a.key), ['p.2']);
  assert.equal(autoPreset(edited, SLEEPER).key, 'p.2'); // yours stands for it on its hook too
  const allFile = withCollection(storeWith(), shared('everything.json', 'all'));
  assert.deepEqual(alternatesOf(allFile, 'all').map((a) => a.key), ['p.1']);
});

test('variants: the card picks one; your own vehicle keeps it by its plate, another by its hook', () => {
  const store = twoCabs();
  assert.deepEqual(variantChoice(store, SLEEPER), { scope: MODEL, value: 'p.2', options: [{ value: 'p.2', label: 'studio' }, { value: 'p.3', label: 'Sleeper' }] });
  assert.equal(variantChoice(storeWith({ [MODEL]: { name: 'Studio' } }), SLEEPER), null); // one is no choice
  // A quick-job vehicle: its hook remembers it, and it is the model's current one now.
  const lent = chooseVariant(store, LENT, 'p.3');
  assert.deepEqual([lent.assignments[CHASSIS], lent.assignments[plateKey(LENT)], lent.assignments[MODEL]], ['p.3', undefined, 'p.3']);
  // Your own vehicle: on its plate; the hook keeps playing the studio for the others.
  const own = chooseVariant(assign(store, CHASSIS, 'p.2'), OWNED, 'p.3');
  assert.deepEqual([own.assignments[plateKey(OWNED)], own.assignments[CHASSIS]], ['p.3', 'p.2']);
  assert.equal(variantChoice(own, OWNED).value, 'p.3');
  assert.equal(variantChoice(own, SLEEPER).value, 'p.2');
  assert.equal(autoPreset(own, OWNED).key, 'p.3');
  // Your vehicle with a preset of its own: offered beside the variants, with its plate.
  const mine = assign(store, plateKey(OWNED), 'p.1');
  assert.deepEqual(variantChoice(mine, OWNED).options.map((o) => o.label), ['studio', 'Sleeper', 'Default layout (WP-83695 only)']);
  assert.equal(variantChoice(mine, OWNED).value, 'p.1');
});

test('applyScope: "Add as a variant" on a brand keeps the one there waiting; a model takes a variant more', () => {
  const BRAND = 'brand:ats/international';
  const store = addAlternate(storeWith({ [BRAND]: { name: 'Studio' } }, [{ name: 'Sleeper' }]), BRAND, 'p.3');
  const spare = applyScope(store, planAssign(store, 'p.1', BRAND), SLEEPER, { variant: true });
  assert.equal(spare.assignments[BRAND], 'p.1');
  assert.deepEqual(spare.alternates[BRAND], ['p.3', 'p.2']);
  const replaced = applyScope(store, planAssign(store, 'p.1', BRAND), SLEEPER);
  assert.deepEqual(replaced.alternates[BRAND], ['p.3']);
  // Put on the model: a variant more, which the vehicle in the game plays; nothing is taken.
  const cabs = twoCabs();
  const plan = planAssign(cabs, 'p.1', MODEL);
  assert.equal(plan.taken, null);
  const added = applyScope(cabs, plan, SLEEPER);
  assert.deepEqual([added.assignments[MODEL], added.alternates[MODEL], added.assignments[CHASSIS]], ['p.1', ['p.2', 'p.3'], 'p.1']);
  // The studio moved up to the brand: the model plays the sleeper.
  const moved = applyScope(cabs, planMove(cabs, MODEL, BRAND, SLEEPER), SLEEPER);
  assert.deepEqual([moved.assignments[BRAND], moved.assignments[MODEL], moved.alternates], ['p.2', 'p.3', undefined]);
});

test('exportFiles: the variants of a model are a file each, for the hooks remembering them', () => {
  const store = assign(twoCabs(), CHASSIS, 'p.3');
  const { files } = exportFiles(store, [{ scope: MODEL, key: 'p.2' }, { scope: MODEL, key: 'p.3' }]);
  assert.deepEqual(files.map((f) => [f.data.name, f.data.vehicle]), [['Studio', MODEL], ['Sleeper', CHASSIS]]);
});

test('editLayout: a preset labelled "new" loses the label at its first edit, not at a label edit', () => {
  const store = storeWith({ [variantKey(SHORT)]: { name: 'Fresh', label: 'new', labelColor: 'green' } });
  const edited = at(editLayout(store, AUTO, SHORT, widen), variantKey(SHORT));
  assert.deepEqual([edited.label, edited.labelColor, edited.width], [undefined, undefined, 1.5]);
  assert.equal(at(editLayout(store, AUTO, SHORT, (l) => ({ ...l, label: 'day cab' })), variantKey(SHORT)).label, 'day cab');
  assert.equal(at(editLayout(store, AUTO, SHORT, (l) => ({ ...l, labelColor: 'red' })), variantKey(SHORT)).label, 'new');
  assert.equal(at(editLayout(store, AUTO, SHORT, (l) => ({ ...l })), variantKey(SHORT)).label, 'new'); // nothing changed
});

test('importPresets: a file becomes a variant of its model; what yours play changes only when asked', () => {
  const file = (name, vehicle, width) => ({ ...shared(`${name}.json`, vehicle), key: null, name, layout: { ...defaultLayout(), name, width } });
  const store = assign(rememberVehicle(storeWith({ [TRUCK.key]: { name: 'Mine', width: 0.5 } }), TRUCK), CHASSIS, 'p.2');
  const model = file('Theirs', TRUCK.key, 0.8);
  const chassis = file('Sleeper', CHASSIS, 0.6);
  const day = file('Day', variantKey(SHORT), 0.4);
  assert.deepEqual(importClashes(store, [model, chassis, day]), [
    { scope: TRUCK.key, label: 'International 9900i', yours: 'Mine', theirs: 'Theirs' },
    { scope: CHASSIS, label: 'International 9900i, hook 3.2 m', yours: 'Mine', theirs: 'Sleeper' },
  ]);
  const kept = importPresets(store, [model, chassis, day]);
  assert.deepEqual([kept.placed, kept.variants, kept.unused, kept.same], [1, 2, 0, 0]);
  assert.equal(at(kept.store, TRUCK.key).name, 'Mine');
  assert.equal(at(kept.store, CHASSIS).name, 'Mine');
  assert.equal(at(kept.store, variantKey(SHORT)).name, 'Day'); // a hook that remembered nothing
  assert.deepEqual(kept.store.alternates[TRUCK.key].map((k) => kept.store.presets[k].name), ['Day', 'Sleeper', 'Theirs']);
  assert.deepEqual(presetTree(kept.store, null).unassigned, []);
  const replaced = importPresets(store, [model, chassis], new Set([TRUCK.key, CHASSIS]));
  assert.equal(at(replaced.store, TRUCK.key).name, 'Theirs');
  assert.equal(at(replaced.store, CHASSIS).name, 'Sleeper');
  assert.deepEqual(replaced.store.alternates[TRUCK.key].map((k) => replaced.store.presets[k].name), ['Mine', 'Sleeper']);
  // The same layout as yours: no copy, no clash.
  const again = importPresets(kept.store, [day]);
  assert.deepEqual([again.same, Object.keys(again.store.presets).length], [1, Object.keys(kept.store.presets).length]);
  assert.deepEqual(importClashes(kept.store, [day]), []);
});

test('importPresets: a file keeps its name and label; only the very same preset of yours is reused', () => {
  const file = (name, extra) => ({ ...shared(`${name}.json`, variantKey(SLEEPER)), key: null, name, layout: { ...defaultLayout(), name, ...extra } });
  // The same speakers as all vehicles' "Default layout", but a name and a label of its own.
  const tagged = file('Kenworth T680', { label: 'SLEEPER', labelColor: 'green' });
  const done = importPresets(storeWith(), [tagged]);
  assert.equal(done.same, 0);
  const placed = at(done.store, variantKey(SLEEPER));
  assert.deepEqual([placed.name, placed.label, placed.labelColor], ['Kenworth T680', 'SLEEPER', 'green']);
  assert.equal(at(done.store, 'all').name, 'Default layout');
  // Imported again: the very same preset, so no copy and no clash.
  const again = importPresets(done.store, [tagged]);
  assert.deepEqual([again.same, Object.keys(again.store.presets).length], [1, Object.keys(done.store.presets).length]);
  assert.deepEqual(importClashes(done.store, [tagged]), []);
  // Your key with the same speakers but another label: a clash, replaced only when asked.
  const relabelled = file('Kenworth T680', { label: 'DAY CAB' });
  assert.equal(importClashes(done.store, [relabelled]).length, 1);
  assert.equal(at(importPresets(done.store, [relabelled], new Set([variantKey(SLEEPER)])).store, variantKey(SLEEPER)).label, 'DAY CAB');
});

test('shared files for a brand or a game play after yours there, before wider ones', () => {
  const brandFile = shared('b.json', 'brand:ats/international');
  const gameFile = shared('g.json', 'game:ats');
  assert.deepEqual(autoPreset(withCollection(storeWith(), brandFile, gameFile), TRUCK), { key: 'file:b.json', how: 'collectionBrand', scope: 'brand:ats/international' });
  assert.equal(autoPreset(withCollection(storeWith(), gameFile), TRUCK).how, 'collectionGame');
  assert.equal(autoPreset(withCollection(storeWith({ 'brand:ats/international': { name: 'Mine' } }), brandFile), TRUCK).how, 'brand');
  assert.equal(autoPreset(withCollection(storeWith(), gameFile), { ...TRUCK, game: 'ets2' }).how, 'all');
  assert.equal(truckStatus(withCollection(storeWith(), brandFile), AUTO, TRUCK).appliesTo, 'all International, from the collection');
});

test('foldChassis: presets on chassis keys become variants of their model; the hooks remember them', () => {
  const store = addAlternate(storeWith({
    [CHASSIS]: { name: 'Sleeper' },        // p.2
    [variantKey(SHORT)]: { name: 'Day' },  // p.3
  }, [{ name: 'Studio' }]), CHASSIS, 'p.4'); // the studio waits on the 3.2 m chassis key
  const folded = foldChassis(store);
  assert.equal(folded.assignments[MODEL], 'p.3'); // the first by hook
  assert.deepEqual(folded.alternates, { [MODEL]: ['p.2', 'p.4'] });
  assert.deepEqual([folded.assignments[CHASSIS], folded.assignments[variantKey(SHORT)]], ['p.2', 'p.3']);
  assert.equal(autoPreset(folded, SLEEPER).key, 'p.2');
  assert.equal(autoPreset(folded, { ...TRUCK, variant: '2.6' }).key, 'p.3'); // a hook new to you: the current one
  assert.deepEqual(scopesOf(folded, 'p.4'), [MODEL]); // waiting on the model: a variant of it
  assert.equal(foldChassis(folded), folded); // nothing more to fold
  // The model's own preset stays its current one.
  const withModel = foldChassis(storeWith({ [MODEL]: { name: 'Model' }, [CHASSIS]: { name: 'Sleeper' } }));
  assert.deepEqual([withModel.assignments[MODEL], withModel.alternates[MODEL]], ['p.2', ['p.3']]);
});

test('a file for several hooks plays on each; an import, or your copy of it, is remembered on them', () => {
  const both = shared('both.json', CHASSIS, { hooks: ['2.1'] });
  assert.deepEqual(both.hooks, ['2.1', '3.2']);
  const files = withCollection(storeWith(), both);
  assert.equal(autoPreset(files, SHORT).how, 'collectionChassis');
  assert.equal(autoPreset(files, SLEEPER).how, 'collectionChassis');
  const imported = importPresets(storeWith(), [{ ...both, key: null }]).store;
  assert.deepEqual([imported.assignments[CHASSIS], imported.assignments[variantKey(SHORT)], imported.assignments[MODEL]], ['p.2', 'p.2', 'p.2']);
  const edited = editLayout(files, AUTO, SHORT, widen);
  assert.deepEqual([edited.assignments[CHASSIS], edited.assignments[variantKey(SHORT)], edited.assignments[MODEL]], ['p.2', 'p.2', 'p.2']);
  assert.deepEqual(exportFiles(edited, [{ scope: MODEL, key: 'p.2' }]).files[0].data.hooks, ['2.1', '3.2']);
});

test('variants: a shared file taken off a model is hidden from its variants; the file stays', () => {
  const files = withCollection(storeWith({ [MODEL]: { name: 'Mine' } }), SLEEPER_FILE, MODEL_FILE);
  assert.deepEqual(alternatesOf(files, MODEL).map((v) => v.key), ['p.2', 'file:model.json', 'file:sleeper.json']); // files by path
  const off = dropAlternate(assign(files, CHASSIS, 'file:sleeper.json'), MODEL, 'file:sleeper.json');
  assert.deepEqual(off.hiddenFiles, { [MODEL]: ['file:sleeper.json'] });
  assert.equal(off.assignments[CHASSIS], undefined); // the hook forgot it
  assert.deepEqual(alternatesOf(off, MODEL).map((v) => v.key), ['p.2', 'file:model.json']);
  assert.equal(autoPreset(off, SLEEPER).key, 'p.2'); // no longer the hook's file
  assert.ok(off.collection['file:sleeper.json']);
  assert.deepEqual(normalizeStore(off).hiddenFiles, { [MODEL]: ['file:sleeper.json'] });
  // The model's current one: the next variant plays.
  const current = dropAlternate(pickAlternate(files, MODEL, 'file:model.json'), MODEL, 'file:model.json');
  assert.equal(current.assignments[MODEL], 'p.2');
});

test('cycleVariant: the next or previous of the model\'s variants, round; a vehicle\'s own is skipped', () => {
  const store = assign(withCollection(twoCabs(), SLEEPER_FILE), plateKey(OWNED), 'p.1'); // p.1 your vehicle's own
  assert.deepEqual(alternatesOf(store, MODEL).map((v) => v.key), ['p.2', 'p.3', 'file:sleeper.json']);
  assert.deepEqual(cycleVariant(store, OWNED, 'p.2', 1), { key: 'p.3', index: 1, count: 3, label: null });
  assert.deepEqual(cycleVariant(store, OWNED, 'file:sleeper.json', 1), { key: 'p.2', index: 0, count: 3, label: 'studio' });
  assert.equal(cycleVariant(store, OWNED, 'p.2', -1).key, 'file:sleeper.json');
  assert.equal(cycleVariant(store, OWNED, 'p.1', 1).key, 'p.2'); // from the vehicle's own: the first
  assert.equal(cycleVariant(store, OWNED, 'p.1', -1).key, 'file:sleeper.json');
  assert.equal(cycleVariant(store, null, 'p.2', 1), null);
  assert.equal(cycleVariant(storeWith(), OTHER, 'p.1', 1), null); // no variant
});

test('the card: a variant tried with the controls says the cab keeps it on getting out', () => {
  const store = twoCabs();
  const tried = truckStatus(store, { mode: 'truck', key: 'p.3', cycled: true }, SLEEPER);
  assert.equal(tried.plays, 'Sleeper — International 9900i (tried with the controls)');
  assert.equal(tried.note, 'Tried with the controls: this cab keeps it when you get out, unless Auto goes back first. Editing changes this preset.');
  assert.deepEqual(tried.buttons, [{ action: 'auto', label: 'Back to Auto' }]);
  // Getting out keeps it as a pick on the card would (app.js): the hook remembers it.
  assert.equal(autoPreset(chooseVariant(store, SLEEPER, 'p.3'), SLEEPER).key, 'p.3');
  // A tried file edited becomes your copy, still tried.
  const files = withCollection(store, SLEEPER_FILE);
  const adopted = adoptPicked(files, { mode: 'truck', key: 'file:sleeper.json', cycled: true });
  assert.deepEqual(adopted.selection, { mode: 'truck', key: 'p.4', cycled: true });
});
