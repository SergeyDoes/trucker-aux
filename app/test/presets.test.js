import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptNewModel, adoptPicked, allPresetKey, scopePreset, applyScope, autoPreset, createPreset, currentScope, deletePreset, editLayout, exportFiles, dropImportedDefaults, importClashes, importPresets, seedAll,
  levelOf, ownPreset, parseSelection, planAssign, planMove, planScope, plateKey, presetOptions, presetTree, rememberVehicle, resolvePlaying, scopeLabel,
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

test('chassis: the model preset plays on every chassis until one gets its own', () => {
  const store = withPreset();
  assert.equal(resolvePlaying(store, AUTO, SLEEPER).key, 'p.2');
  const edited = editLayout(store, AUTO, SLEEPER, widen);
  const own = at(edited, variantKey(SLEEPER));
  assert.equal(own.width, 1.5);
  assert.equal(own.name, 'ATS › International › International 9900i › hook 3.2 m');
  assert.equal(at(edited, TRUCK.key).width, 0.5); // the model preset stays
  assert.equal(resolvePlaying(edited, AUTO, SHORT).key, 'p.2');
  assert.equal(presetOptions(edited, SHORT)[0].label, 'Auto — International 9900i (all chassis)');
  assert.equal(presetOptions(edited, SLEEPER)[0].label, 'Auto — ATS › International › International 9900i › hook 3.2 m');
});

test('chassis: without a model preset another chassis plays before the brand', () => {
  const store = editLayout(storeWith({ 'brand:ats/international': { name: 'Brand' } }), AUTO, SLEEPER, widen);
  assert.equal(autoPreset(store, SHORT).how, 'sibling');
  assert.equal(presetOptions(store, SHORT)[0].label, 'Auto — ATS › International › International 9900i › hook 3.2 m (other chassis)');
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
  assert.equal(at(edited, variantKey(SLEEPER)).name, 'ATS › International › International 9900i › hook 3.2 m');
  assert.equal(at(edited, 'brand:ats/international').width, 1);
});

test('this vehicle only: a copy for the plate wins over the chassis and takes the edits', () => {
  const store = ownPreset(ownPreset(withPreset(), OWNED, 'chassis'), OWNED, 'truck');
  const key = plateKey(OWNED);
  assert.equal(at(store, key).name, 'ATS › International › International 9900i › hook 3.2 m › WP-83695');
  assert.equal(resolvePlaying(store, AUTO, OWNED).key, store.assignments[key]);
  assert.equal(resolvePlaying(store, AUTO, { ...OWNED, plate: 'OTHER-1' }).key, store.assignments[variantKey(SLEEPER)]);
  assert.equal(presetOptions(store, OWNED)[0].label, 'Auto — ATS › International › International 9900i › hook 3.2 m › WP-83695 (this vehicle)');
  const edited = editLayout(store, AUTO, OWNED, widen);
  assert.equal(at(edited, key).width, 1.5);
  assert.equal(at(edited, variantKey(SLEEPER)).width, 0.5);
  assert.equal(ownPreset(store, OWNED, 'truck'), store); // already there
  assert.equal(ownPreset(store, SLEEPER, 'truck'), store); // no plate
});

test('assignments: a preset may apply to several scopes; unassign frees one and keeps the preset', () => {
  const created = createPreset(withPreset(), defaultLayout());
  assert.equal(created.key, 'p.3');
  assert.deepEqual(scopesOf(created.store, 'p.3'), []);
  const chassis = assign(created.store, variantKey(SLEEPER), 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SLEEPER).key, 'p.3');
  assert.equal(resolvePlaying(chassis, AUTO, SHORT).key, 'p.2');
  assert.equal(editLayout(chassis, AUTO, SLEEPER, widen).presets['p.3'].width, 1.5);
  const truck = assign(chassis, plateKey(OWNED), 'p.2');
  assert.deepEqual(scopesOf(truck, 'p.2'), [plateKey(OWNED), TRUCK.key]);
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


test('scopeLadder: this vehicle\'s scopes and what holds them; currentScope: where what plays sits', () => {
  const store = rememberVehicle(withPreset(), TRUCK);
  assert.deepEqual(scopeLadder(store, OWNED).map((r) => [r.level, r.label, r.holder]), [
    ['vehicle', 'this vehicle (WP-83695)', null],
    ['chassis', 'this chassis (hook 3.2 m)', null],
    ['model', 'all chassis of International 9900i', 'p.2'],
    ['brand', 'all International', null],
    ['game', 'all ATS vehicles', null],
    ['all', 'all vehicles', 'p.1'],
  ]);
  assert.deepEqual(scopeLadder(store, LENT).map((r) => r.level), ['chassis', 'model', 'brand', 'game', 'all']); // a random plate
  assert.deepEqual(scopeLadder(store, { ...OTHER, game: null }).map((r) => r.level), ['model', 'all']);
  assert.equal(currentScope(store, AUTO, OWNED), TRUCK.key);
  assert.equal(currentScope(store, AUTO, OTHER), 'all');
  assert.equal(currentScope(store, PICK('p.2'), OWNED), null);
  assert.equal(currentScope(editLayout(storeWith(), AUTO, SHORT, widen), AUTO, SLEEPER), null); // another chassis's
  assert.equal(currentScope(withCollection(storeWith(), MODEL_FILE), AUTO, SLEEPER), null); // a file
});

test('moving up: the old scope is freed; a taken target and narrower presets are named', () => {
  // The sleeper's own preset goes to the brand, where another one is; the model has its own too.
  let store = storeWith({
    [TRUCK.key]: { name: 'Model' },                     // p.2
    [variantKey(SLEEPER)]: { name: 'Sleeper' },          // p.3
    'brand:ats/international': { name: 'Old brand' },    // p.4
  });
  const plan = planScope(store, AUTO, SLEEPER, 'brand:ats/international');
  assert.deepEqual(plan, {
    mode: 'move', key: 'p.3', from: variantKey(SLEEPER), to: 'brand:ats/international', direction: 'up', mustCopy: false,
    taken: { key: 'p.4', name: 'Old brand', keeps: false },
    shadow: [{ scope: TRUCK.key, label: 'all chassis of International 9900i', name: 'Model' }],
    fallback: null,
    outplayed: null,
  });
  // Without clearing the model, the model keeps playing here; with it, the moved one plays.
  const kept = applyScope(store, plan, SLEEPER);
  assert.equal(kept.assignments[variantKey(SLEEPER)], undefined);
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
  // A shared file for this chassis would keep playing: it cannot be unassigned, so it is named.
  const files = withCollection(storeWith({ [plateKey(OWNED)]: { name: 'Mine' } }), SLEEPER_FILE);
  assert.deepEqual(planScope(files, AUTO, OWNED, 'brand:ats/international').outplayed, { name: 'sleeper', file: true });
});

test('moving down: move frees the wider scope, copy keeps it; all vehicles always keeps its preset', () => {
  const store = rememberVehicle(storeWith({ 'game:ats': { name: 'ATS' } }), TRUCK); // p.2 for all ATS
  const plan = planScope(store, AUTO, SLEEPER, variantKey(SLEEPER));
  assert.equal(plan.direction, 'down');
  assert.deepEqual(plan.fallback, { label: 'all vehicles', name: 'Default layout' });
  const moved = applyScope(store, plan, SLEEPER);
  assert.equal(moved.assignments['game:ats'], undefined);
  assert.equal(moved.assignments[variantKey(SLEEPER)], 'p.2');
  assert.equal(resolvePlaying(moved, AUTO, OTHER).key, 'p.1');
  const copied = applyScope(store, plan, SLEEPER, { copy: true });
  assert.equal(copied.assignments['game:ats'], 'p.2');
  assert.equal(at(copied, variantKey(SLEEPER)).name, 'ATS › International › International 9900i › hook 3.2 m');
  assert.deepEqual(at(copied, variantKey(SLEEPER)).speakers, store.presets['p.2'].speakers);
  // From all vehicles: always a copy.
  const fromAll = planScope(storeWith(), AUTO, OWNED, plateKey(OWNED));
  assert.equal(fromAll.mustCopy, true);
  const done = applyScope(storeWith(), fromAll, OWNED);
  assert.equal(done.assignments.all, 'p.1');
  assert.equal(at(done, plateKey(OWNED)).name, 'ATS › International › International 9900i › hook 3.2 m › WP-83695');
  // A preset picked in the list, put to use for the model while this vehicle has its own:
  // the vehicle's keeps playing here, so it is named, to be cleared.
  const plated = assign(store, plateKey(OWNED), 'p.1');
  assert.deepEqual(planScope(plated, PICK('p.2'), OWNED, TRUCK.key).shadow, [
    { scope: plateKey(OWNED), label: 'this vehicle (WP-83695)', name: 'Default layout' },
  ]);
});

test('copy and use: a preset from another chassis or a file is copied; a picked one is used here too', () => {
  // Another chassis's preset plays: a copy takes the scope, the other chassis keeps its own.
  const sibling = editLayout(storeWith(), AUTO, SHORT, widen);
  const plan = planScope(sibling, AUTO, SLEEPER, variantKey(SLEEPER));
  assert.equal(plan.mode, 'copy');
  const copied = applyScope(sibling, plan, SLEEPER);
  assert.equal(at(copied, variantKey(SLEEPER)).width, 1.5);
  assert.notEqual(copied.assignments[variantKey(SLEEPER)], copied.assignments[variantKey(SHORT)]);
  // A shared file: your own copy.
  const files = withCollection(storeWith(), MODEL_FILE);
  const fromFile = applyScope(files, planScope(files, AUTO, SLEEPER, 'game:ats'), SLEEPER);
  assert.equal(at(fromFile, 'game:ats').name, 'ATS'); // named by its key
  assert.equal(at(fromFile, 'game:ats').width, 0.8);
  // Picked in the list: it gets the scope as well and keeps its others.
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
  const store = withPreset(); // the model preset "International 9900i"
  const status = truckStatus(store, AUTO, OWNED);
  assert.deepEqual(card(status, 'truck', 'plays', 'appliesTo', 'note', 'useIn', 'buttons'), {
    truck: 'International 9900i · hook 3.2 m · WP-83695',
    plays: 'International 9900i',
    appliesTo: 'all chassis of International 9900i',
    note: 'Editing makes a copy for this chassis first.',
    useIn: null,
    buttons: [{ action: 'unbind', label: 'Unbind' }],
  });
  assert.equal(status.scope.value, TRUCK.key);
  assert.deepEqual(status.scope.options.map((o) => o.label), [
    'this vehicle (WP-83695)', 'this chassis (hook 3.2 m)', 'all chassis of International 9900i', 'all International',
    'all ATS vehicles', 'all vehicles — "Default layout"',
  ]);
  const chassis = ownPreset(store, OWNED, 'chassis');
  assert.deepEqual(card(truckStatus(chassis, AUTO, OWNED), 'plays', 'appliesTo', 'note'), {
    plays: 'ATS › International › International 9900i › hook 3.2 m', appliesTo: 'this chassis (hook 3.2 m)', note: null,
  });
  assert.equal(truckStatus(chassis, AUTO, OWNED).scope.options[2].label, 'all chassis of International 9900i — "International 9900i"');
  // Not on this vehicle's ladder: another chassis's, a file's. The first option says where it comes from.
  const sibling = truckStatus(editLayout(storeWith(), AUTO, SLEEPER, widen), AUTO, { ...SHORT, plate: 'X-1' });
  assert.equal(sibling.appliesTo, 'another chassis of International 9900i');
  assert.deepEqual(sibling.scope.options[0], { value: '', label: 'another chassis of International 9900i' });
  assert.equal(sibling.scope.value, '');
  assert.deepEqual(sibling.buttons, []);
  // A quick-job truck: its plate is random, so "this vehicle" is not offered.
  const lent = truckStatus(store, AUTO, LENT);
  assert.equal(lent.note, 'Editing makes a copy for this chassis first. This quick-job vehicle has a random plate, so "this vehicle" is not offered.');
  assert.equal(lent.scope.options.some((o) => o.label.startsWith('this vehicle')), false);
  // All vehicles plays: no Unbind (something must play).
  assert.deepEqual(card(truckStatus(storeWith(), AUTO, OTHER), 'plays', 'appliesTo', 'note', 'buttons'), {
    plays: 'Default layout — all vehicles',
    appliesTo: 'every vehicle without its own preset',
    note: 'Editing makes a preset for Peterbilt 579 first.',
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
  let store = rememberVehicle(withPreset(), OWNED); // its plate and chassis are known, as after driving it
  store = editLayout(store, AUTO, SLEEPER, widen);
  store = ownPreset(store, OWNED, 'truck');
  store = createPreset(store, store.presets['p.1']).store; // "Default layout copy", unassigned
  store = { ...store, presets: { ...store.presets, 'p.3': { ...store.presets['p.3'], name: 'Sleeper' } } };
  store = assign(store, variantKey(SHORT), 'p.3'); // the sleeper's preset on the day cab too
  assert.deepEqual(presetOptions(store, null), [
    { value: 'auto', label: 'Auto — no game' },
    { value: 'truck:p.4', label: 'ATS › International › International 9900i › hook 3.2 m › WP-83695' },
    { value: 'truck:p.1', label: 'Default layout — all vehicles' },
    { value: 'truck:p.2', label: 'International 9900i' },
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
  assert.equal(at(edited, variantKey(SLEEPER)).name, 'ATS › International › International 9900i › hook 3.2 m');
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
    appliesTo: 'all International 9900i on this chassis, from the collection',
    note: 'From the collection: t.json. Editing makes your own copy for this chassis first.',
    buttons: [],
  });
  assert.equal(truckStatus(store, AUTO, SHORT).appliesTo, 'all chassis of International 9900i, from the collection');
  const pickedFile = truckStatus(store, PICK('file:t.json'), SLEEPER);
  assert.deepEqual(card(pickedFile, 'plays', 'appliesTo', 'note'), {
    plays: 'Sleeper cab — Alex (picked in the list)',
    appliesTo: 'International 9900i on the hook 3.2 m chassis',
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
  const store = editLayout(rememberVehicle(withPreset(), TRUCK), AUTO, SLEEPER, widen); // p.2 the model's, p.3 the sleeper's
  const chassis = exportPreset(store, 'p.3', SLEEPER);
  assert.equal(chassis.fileName, 'ATS, International, International 9900i, hook 3.2 m.json');
  assert.deepEqual({ ...chassis.data, layout: null }, {
    truckerAuxPreset: 1, name: 'ATS › International › International 9900i › hook 3.2 m', vehicle: 'vehicle.international.9900i@3.2', vehicleName: 'International 9900i',
    game: 'ats', brand: 'international', brandName: 'International', layout: null,
  });
  assert.equal(chassis.data.layout.width, 1.5);
  assert.equal(exportPreset(store, 'p.2', null).data.vehicle, TRUCK.key);
  // This vehicle's own preset is shared for its chassis: the plate stays private.
  const plated = ownPreset(store, OWNED, 'truck');
  const plateOwn = plated.assignments[plateKey(OWNED)];
  assert.equal(exportPreset(plated, plateOwn, OWNED).data.vehicle, variantKey(OWNED));
  assert.equal(exportPreset(plated, plateOwn, null).data.vehicle, TRUCK.key);
  // An unassigned preset is for no vehicle, all vehicles' for "all"; a shared file can go again.
  const custom = createPreset(store, store.presets['p.1']);
  assert.equal('vehicle' in exportPreset(custom.store, custom.key, SLEEPER).data, false);
  assert.equal(exportPreset(store, 'p.1', SLEEPER).data.name, 'Default layout');
  assert.equal(exportPreset(store, 'p.1', SLEEPER).data.vehicle, 'all');
  assert.equal(exportFiles(withCollection(store, MODEL_FILE), [{ scope: TRUCK.key, key: 'file:model.json' }], SLEEPER).files[0].data.vehicle, TRUCK.key);
  // A model never driven is named after your preset for it; a chassis-only one has no name.
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

test('presetTree: registry-like keys for every vehicle driven, scopes with presets and the vehicle in the game', () => {
  let store = storeWith({
    [variantKey(SLEEPER)]: { name: 'Sleeper' },
    'brand:ats/peterbilt': { name: 'Petes' },
    'vehicle.scania.r#AB-1': { name: 'My Scania' },
    'vehicle.mack.anthem': { name: 'Anthem' }, // a model not driven since presets got scopes
  }, [{ name: 'Spare' }]);
  store = rememberVehicle(store, OWNED); // driven before: the sleeper with its plate
  store = rememberVehicle(store, OTHER); // a Peterbilt 579, no preset of its own
  store = rememberVehicle(store, { key: 'vehicle.scania.r', name: 'Scania R', game: 'ets2', brand: 'scania', brandName: 'Scania' });
  store = withCollection(store, MODEL_FILE, shared('loose.json', null));
  const map = presetTree(store, { ...SHORT, plate: 'X-1' });
  assert.deepEqual(lines(map.root), [
    '● All vehicles = Default layout',
    '  ● ATS (Default layout)',
    '    ● International (Default layout)',
    '      ▶ International 9900i = model (file)',
    '        ● hook 2.1 m (model)',
    '          ● X-1 (model)',
    '        hook 3.2 m = Sleeper',
    '          WP-83695 (Sleeper)',
    '    Peterbilt = Petes',
    '      Peterbilt 579 (Petes)',
    '  ETS2 (Default layout)',
    '    Scania (Default layout)',
    '      Scania R (Default layout)',
    '        AB-1 = My Scania',
    '  Game not known yet (drive a vehicle once) (Default layout)',
    '    Anthem = Anthem',
  ]);
  const sleeper = map.root.children[0].children[0].children[0].children[1];
  assert.deepEqual(sleeper.children[0].inherited, { key: 'p.2', name: 'Sleeper', from: 'hook 3.2 m' });
  assert.deepEqual(sleeper.moveTo.map((o) => o.value), [TRUCK.key, 'brand:ats/international', 'game:ats', 'all', plateKey(OWNED)]);
  assert.equal(map.root.children.at(-1).pseudo, true); // that folder is no scope
  assert.deepEqual(map.unassigned, [{ key: 'p.6', name: 'Spare', label: null, labelColor: 'blue' }]);
  assert.deepEqual(map.files, [{ key: 'file:loose.json', name: 'loose', default: false, label: null, labelColor: 'blue' }]);
  // A model not driven goes up only to all vehicles: its game is not known.
  const anthem = map.root.children.at(-1).children[0];
  assert.deepEqual(anthem.moveTo.map((o) => o.value), ['all']);
});

test('planAssign: one of your presets put at a key of the map', () => {
  const store = withPreset();
  const plan = planAssign(store, 'p.1', TRUCK.key);
  assert.deepEqual(plan.taken, { key: 'p.2', name: 'International 9900i', keeps: false });
  const done = applyScope(store, plan, null);
  assert.equal(done.assignments[TRUCK.key], 'p.1');
  assert.deepEqual(scopesOf(done, 'p.1'), [TRUCK.key, 'all']);
  assert.equal(planAssign(done, 'p.1', TRUCK.key), null);
  assert.equal(planAssign(done, 'p.1', '?unknown'), null);
});

test('planMove: moving a preset in the map, up its chain or down to a narrower scope', () => {
  const store = rememberVehicle(storeWith({
    [TRUCK.key]: { name: 'Model' },                   // p.2
    [variantKey(SLEEPER)]: { name: 'Sleeper' },        // p.3
    'game:ats': { name: 'ATS' },                       // p.4
  }), TRUCK);
  // Up from the chassis to the game: the model in between keeps playing on this chassis.
  const up = planMove(store, variantKey(SLEEPER), 'game:ats');
  assert.deepEqual({ ...up, shadow: up.shadow.map((s) => s.scope) }, {
    mode: 'move', key: 'p.3', from: variantKey(SLEEPER), to: 'game:ats', direction: 'up', mustCopy: false,
    taken: { key: 'p.4', name: 'ATS', keeps: false }, shadow: [TRUCK.key], fallback: null, outplayed: null,
  });
  const moved = applyScope(store, up, null, { clear: [TRUCK.key] });
  assert.equal(moved.assignments['game:ats'], 'p.3');
  assert.equal(moved.assignments[TRUCK.key], undefined);
  assert.ok(moved.presets['p.2'] && moved.presets['p.4']); // unassigned, not deleted
  // Down from the game to the chassis: what plays there afterwards is named.
  const down = planMove(store, 'game:ats', variantKey(SLEEPER));
  assert.equal(down.direction, 'down');
  assert.deepEqual(down.fallback, { label: 'all vehicles', name: 'Default layout' });
  const copied = applyScope(store, down, null, { copy: true });
  assert.equal(copied.assignments['game:ats'], 'p.4');
  assert.equal(at(copied, variantKey(SLEEPER)).name, 'ATS › International › International 9900i › hook 3.2 m');
  // Across, to a key on another chain (dragging): the old key is freed, what it plays next is named.
  const across = planMove(store, variantKey(SLEEPER), variantKey(SHORT));
  assert.equal(across.direction, 'across');
  assert.deepEqual(across.fallback, { label: 'International 9900i', name: 'Model' });
  const acrossDone = applyScope(store, across, null);
  assert.equal(acrossDone.assignments[variantKey(SHORT)], 'p.3');
  assert.equal(acrossDone.assignments[variantKey(SLEEPER)], undefined);
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
    '      Mack Anthem (Default layout)',
    '        hook 2.4 m = anthem (file)',
  ]);
  // Exported again, the file keeps saying where the vehicle is from.
  const own = assign(withCollection(storeWith(), file), 'vehicle.mack.anthem@2.4', 'p.1');
  assert.equal(exportPreset(own, 'p.1', null).data.game, 'ats');
});

test('adoptNewModel: a model seen without a key of its own gets a copy of what it would inherit', () => {
  const store = storeWith({ 'brand:ats/international': { name: 'Brand', width: 0.4 } });
  const adopted = adoptNewModel(store, SLEEPER);
  assert.equal(adopted.assignments[TRUCK.key], 'p.3');
  assert.equal(at(adopted, TRUCK.key).name, 'ATS › International › International 9900i');
  assert.equal(at(adopted, TRUCK.key).width, 0.4); // the brand's, copied
  assert.equal(at(adopted, TRUCK.key).label, 'new'); // stands out in the tree until labelled
  assert.equal(at(adopted, TRUCK.key).labelColor, 'green');
  assert.notEqual(at(adopted, TRUCK.key).speakers, store.presets['p.2'].speakers);
  assert.equal(adoptNewModel(adopted, SHORT), adopted); // the model has a key now
  assert.equal(at(adoptNewModel(storeWith(), OTHER), OTHER.key).name, 'ATS › Peterbilt › Peterbilt 579'); // all vehicles' copied
  // A key for a chassis or a vehicle of the model, or a shared file for it: nothing new.
  const chassis = storeWith({ [variantKey(SHORT)]: { name: 'Day cab' } });
  assert.equal(adoptNewModel(chassis, SLEEPER), chassis);
  const plate = storeWith({ [plateKey(OWNED)]: { name: 'Mine' } });
  assert.equal(adoptNewModel(plate, SHORT), plate);
  const file = withCollection(storeWith(), SLEEPER_FILE);
  assert.equal(adoptNewModel(file, SHORT), file);
  assert.equal(adoptNewModel(store, null), store);
});

test('a key picked in the map: it plays what it has or inherits; editing gives it its own first', () => {
  const store = rememberVehicle(storeWith({ 'brand:ats/international': { name: 'Brand', width: 0.4 } }), OWNED);
  const KEY = { mode: 'scope', scope: variantKey(SLEEPER) };
  assert.deepEqual(scopePreset(store, KEY.scope), { key: 'p.2', at: 'brand:ats/international' });
  assert.equal(resolvePlaying(store, KEY, null).key, 'p.2');
  assert.equal(truckStatus(store, KEY, null).note,
    'It inherits this from all International: editing gives International 9900i, hook 3.2 m a preset of its own first.');
  const edited = editLayout(store, KEY, null, widen);
  assert.equal(at(edited, KEY.scope).width, 1.5);
  assert.equal(at(edited, KEY.scope).name, 'ATS › International › International 9900i › hook 3.2 m');
  assert.equal(at(edited, 'brand:ats/international').width, 0.4); // the brand's stays
  assert.equal(truckStatus(edited, KEY, null).note, 'Editing changes the preset of International 9900i, hook 3.2 m.');
  const again = editLayout(edited, KEY, null, (l) => setWidth(l, 0.2));
  assert.equal(Object.keys(again.presets).length, Object.keys(edited.presets).length); // no second copy
  // A plate's key inherits through its chassis; a shared file counts on the way.
  assert.equal(scopePreset(edited, plateKey(OWNED)).at, KEY.scope);
  assert.equal(scopePreset(withCollection(store, MODEL_FILE), plateKey(OWNED)).key, 'file:model.json');
  // The list shows the key; values round-trip.
  assert.equal(presetOptions(store, null, KEY)[1].label, 'Key: International 9900i, hook 3.2 m');
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

test('exportFiles: each ticked preset goes for its key; plates go for their chassis; clashes are told', () => {
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
  assert.deepEqual([set.clashes, set.plates], [[], 0]);
  // A vehicle's own goes for its chassis: with the chassis' own, two files for one key.
  const both = exportFiles(store, [variantKey(SLEEPER), plateKey(OWNED)].map((scope) => ({ scope, key: store.assignments[scope] })), null);
  assert.deepEqual(both.files.map((f) => f.data.vehicle), [variantKey(OWNED), variantKey(OWNED)]);
  assert.deepEqual([both.clashes, both.plates], [['International 9900i, hook 3.2 m'], 1]);
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

test('importPresets: files on their keys; a key of yours is replaced only when asked', () => {
  const file = (name, vehicle, width) => ({ ...shared(`${name}.json`, vehicle), key: null, name, layout: { ...defaultLayout(), name, width } });
  const store = rememberVehicle(storeWith({ [TRUCK.key]: { name: 'Mine', width: 0.5 } }), TRUCK);
  const model = file('Theirs', TRUCK.key, 0.8);
  const chassis = file('Sleeper', variantKey(SLEEPER), 0.6);
  assert.deepEqual(importClashes(store, [model, chassis]), [{ scope: TRUCK.key, label: 'International 9900i', yours: 'Mine', theirs: 'Theirs' }]);
  const kept = importPresets(store, [model, chassis]);
  assert.deepEqual([kept.placed, kept.unused, kept.same], [1, 1, 0]);
  assert.equal(at(kept.store, TRUCK.key).name, 'Mine');
  assert.equal(at(kept.store, variantKey(SLEEPER)).name, 'Sleeper');
  assert.deepEqual(presetTree(kept.store, null).unassigned.map((p) => p.name), ['Theirs']);
  const replaced = importPresets(store, [model], new Set([TRUCK.key]));
  assert.equal(at(replaced.store, TRUCK.key).name, 'Theirs');
  assert.deepEqual(presetTree(replaced.store, null).unassigned.map((p) => p.name), ['Mine']); // yours stays, unused
  // The same layout as yours: no copy, no clash.
  const again = importPresets(kept.store, [chassis]);
  assert.deepEqual([again.same, Object.keys(again.store.presets).length], [1, Object.keys(kept.store.presets).length]);
  assert.deepEqual(importClashes(kept.store, [chassis]), []);
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
