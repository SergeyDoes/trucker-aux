// Which layout plays and which one an edit goes to.
// Selection: { mode: 'auto' } | { mode: 'truck', key } (a preset picked in the list).
// Truck: { key, variant, plate, quickJob, name, game, brand, brandName, centerX } from
// telemetry, or null. Layouts are measured from the truck's axis, so one layout fits every truck.
//
// Presets ("p.N", store.presets) live apart from the scopes they apply to
// (store.assignments: scope -> preset or shared file). A vehicle's scopes, narrowest first:
//   this vehicle  "<truck id>#<plate>"
//   this chassis  "<truck id>@<fifth wheel>"
//   the model     "<truck id>"
//   the brand     "brand:<game>/<brand id>"
//   the game      "game:<ats|ets2>"
//   all vehicles  "all" (always assigned: it is what the default layout was)
// Auto plays the narrowest assigned one; shared files (collection.js) for this chassis or
// the model come after your own of both; another chassis of the model comes before the brand.
// The game reports neither the cab nor the chassis; the fifth wheel sits further back
// on a longer chassis, so its position (to 10 cm) names the chassis (telemetry.js).
import { ALL_SCOPE, freePresetKey, uniqueName } from './layout.js';
import { collectionLabel, isCollectionKey, presetFile, presetFileName } from './collection.js';

export const plateKey = (truck) => (truck.plate ? `${truck.key}#${truck.plate}` : null);
const chassisKey = (truck) => (truck.variant ? `${truck.key}@${truck.variant}` : null);
const brandKey = (truck) => (truck.game && truck.brand ? `brand:${truck.game}/${truck.brand}` : null);
const gameKey = (truck) => (truck.game ? `game:${truck.game}` : null);

// This chassis, or the model when the game reports no chassis.
export const variantKey = (truck) => chassisKey(truck) ?? truck.key;

// Levels of the scope ladder, narrowest first.
const LEVELS = ['vehicle', 'chassis', 'model', 'brand', 'game', 'all'];

export function levelOf(scope) {
  if (scope === ALL_SCOPE) return 'all';
  if (scope.startsWith('game:')) return 'game';
  if (scope.startsWith('brand:')) return 'brand';
  if (scope.includes('#')) return 'vehicle';
  if (scope.includes('@')) return 'chassis';
  return 'model';
}

const modelOf = (scope) => scope.split(/[@#]/)[0];
const byLevel = (a, b) => LEVELS.indexOf(levelOf(a)) - LEVELS.indexOf(levelOf(b)) || a.localeCompare(b);

// The scopes a preset applies to, narrowest first.
export function scopesOf(store, key) {
  return Object.entries(store.assignments).filter(([, k]) => k === key).map(([scope]) => scope).sort(byLevel);
}

export const allPresetKey = (store) => store.assignments[ALL_SCOPE];

// A preset's layout: your own (store.presets) or a shared file's (store.collection, from
// collection.js, never saved). Null when it is gone.
function presetLayout(store, key) {
  if (!key) return null;
  return (isCollectionKey(key) ? store.collection?.[key]?.layout : store.presets[key]) ?? null;
}

const kindOf = (key) => (isCollectionKey(key) ? 'collection' : 'preset');

// The preset Auto plays in a truck: { key, how, scope }. how: vehicle, chassis,
// collectionChassis, model, collectionModel, sibling (another chassis), collectionSibling,
// brand, game, all. Several files for one scope: the first by path.
export function autoPreset(store, truck) {
  const assigned = (scope) => {
    const key = scope && store.assignments[scope];
    return key && presetLayout(store, key) ? key : null;
  };
  const files = Object.values(store.collection ?? {}).filter((e) => e.vehicle).sort((a, b) => (a.key < b.key ? -1 : 1));
  const file = (match) => files.find((e) => match(e.vehicle))?.key ?? null;
  const steps = [
    ['vehicle', plateKey(truck), assigned],
    ['chassis', chassisKey(truck), assigned],
    ['model', truck.key, assigned],
    // Shared files after your own: a file dropped into presets/ never takes over a truck
    // you have set up.
    ['collectionChassis', chassisKey(truck), (scope) => scope && file((v) => v === scope)],
    ['collectionModel', truck.key, (scope) => file((v) => v === scope)],
  ];
  for (const [how, scope, find] of steps) {
    const key = find(scope);
    if (key) return { key, how, scope };
  }
  const isSibling = (scope) => scope.startsWith(`${truck.key}@`);
  const sibling = Object.keys(store.assignments).filter((s) => isSibling(s) && assigned(s)).sort()[0];
  if (sibling) return { key: assigned(sibling), how: 'sibling', scope: sibling };
  const ofSibling = file(isSibling);
  if (ofSibling) return { key: ofSibling, how: 'collectionSibling', scope: store.collection[ofSibling].vehicle };
  for (const [how, scope] of [['brand', brandKey(truck)], ['game', gameKey(truck)], ['all', ALL_SCOPE]]) {
    const key = assigned(scope);
    if (key) return { key, how, scope };
  }
  return null;
}

// Whether Auto's edits go to what plays: a preset for this vehicle or this chassis, or the
// model's on a model without chassis. Anything wider first gets a copy for this chassis.
function ownsEdits(auto, truck) {
  if (!auto) return false;
  return auto.how === 'vehicle' || auto.how === 'chassis' || (auto.how === 'model' && !truck.variant);
}

export function resolvePlaying(store, selection, truck) {
  if (selection.mode === 'truck' && presetLayout(store, selection.key)) {
    return { kind: kindOf(selection.key), key: selection.key, layout: presetLayout(store, selection.key) };
  }
  const auto = truck ? autoPreset(store, truck) : null;
  const key = auto?.key ?? allPresetKey(store);
  return { kind: kindOf(key), key, layout: presetLayout(store, key) };
}

// A copy of what plays as this chassis's preset (or the model's, without chassis
// variants), or as this truck's; nothing happens when that scope has one already.
export function ownPreset(store, truck, scope = 'chassis') {
  const where = scope === 'truck' ? plateKey(truck) : variantKey(truck);
  if (!where || store.assignments[where]) return store;
  let name = truck.name;
  if (scope === 'truck') name = `${truck.name}, ${truck.plate}`;
  else if (truck.variant) name = `${truck.name}, hook ${truck.variant} m`;
  const key = freePresetKey(store.presets);
  const preset = { ...structuredClone(resolvePlaying(store, { mode: 'auto' }, truck).layout), name };
  return { ...store, presets: { ...store.presets, [key]: preset }, assignments: { ...store.assignments, [where]: key } };
}

export function routeEdit(store, selection, truck) {
  if (selection.mode === 'truck') return { store, key: selection.key };
  if (!truck) return { store, key: allPresetKey(store) };
  const auto = autoPreset(store, truck);
  if (ownsEdits(auto, truck)) return { store, key: auto.key };
  const owned = ownPreset(store, truck, 'chassis');
  return { store: owned, key: owned.assignments[variantKey(truck)] };
}

export function editLayout(store, selection, truck, edit) {
  const routed = routeEdit(store, selection, truck);
  if (isCollectionKey(routed.key)) return store; // files are never changed: adoptPicked copies first
  const current = routed.store.presets[routed.key];
  if (!current) return store;
  return { ...routed.store, presets: { ...routed.store.presets, [routed.key]: edit(current) } };
}

// Frees a scope; the preset stays. All vehicles always keeps one.
export function unassign(store, scope) {
  if (scope === ALL_SCOPE || !store.assignments[scope]) return store;
  const assignments = { ...store.assignments };
  delete assignments[scope];
  return { ...store, assignments };
}

// A copy of `layout` as a new unassigned preset; its name is the source's plus " copy".
export function createPreset(store, layout) {
  const key = freePresetKey(store.presets);
  const taken = new Set([
    ...Object.values(store.presets).map((l) => l.name),
    ...Object.values(store.collection ?? {}).map((e) => e.name), // a copy of a shared file reads "… copy"
  ]);
  const preset = { ...structuredClone(layout), name: uniqueName(layout.name, taken) };
  return { store: { ...store, presets: { ...store.presets, [key]: preset } }, key };
}

// A shared file picked in the list is never changed: before the first edit it becomes an
// unassigned copy ("New preset"), chosen instead. Anything else is left as it is.
export function adoptPicked(store, selection) {
  const entry = selection.mode === 'truck' && isCollectionKey(selection.key) ? store.collection?.[selection.key] : null;
  if (!entry) return { store, selection };
  const created = createPreset(store, entry.layout);
  return { store: created.store, selection: { mode: 'truck', key: created.key } };
}

// Removes a preset and its scopes. The preset of all vehicles stays: something must play.
export function deletePreset(store, key) {
  if (key === allPresetKey(store) || !store.presets[key]) return store;
  const presets = { ...store.presets };
  delete presets[key];
  const assignments = Object.fromEntries(Object.entries(store.assignments).filter(([, k]) => k !== key));
  return { ...store, presets, assignments };
}

// Keeps what the game tells about a model (name, game, brand) for naming its scopes when
// you drive something else. The same store when nothing new was learned.
export function rememberVehicle(store, truck) {
  if (!truck) return store;
  const known = store.vehicles?.[truck.key] ?? {};
  const info = {
    name: truck.name || known.name || null,
    game: truck.game ?? known.game ?? null,
    brand: truck.brand ?? known.brand ?? null,
    brandName: truck.brandName ?? known.brandName ?? null,
  };
  if (Object.keys(info).every((k) => info[k] === (known[k] ?? null))) return store;
  return { ...store, vehicles: { ...store.vehicles, [truck.key]: info } };
}

const GAME_NAMES = { ats: 'ATS', ets2: 'ETS2' };

// A model's name: what the game said, else the name of your preset for the model, else its
// id made readable ("vehicle.peterbilt.389" -> "peterbilt 389").
function modelName(store, model, truck) {
  if (truck?.key === model) return truck.name;
  const own = store.presets[store.assignments[model]];
  return store.vehicles?.[model]?.name ?? own?.name ?? readableId(model);
}

const readableId = (model) => model.replace(/^vehicle\./, '').replace(/[._]/g, ' ');

function brandName(store, game, brand, truck) {
  if (truck?.game === game && truck?.brand === brand && truck.brandName) return truck.brandName;
  const known = Object.values(store.vehicles ?? {}).find((v) => v.game === game && v.brand === brand && v.brandName);
  return known?.brandName ?? brand;
}

// A scope as people read it: "all vehicles", "all ATS vehicles", "all Peterbilt",
// "Peterbilt 389", "Peterbilt 389, hook 2.6 m", "Peterbilt 389, WP-83695".
export function scopeLabel(store, scope, truck = null) {
  const level = levelOf(scope);
  if (level === 'all') return 'all vehicles';
  if (level === 'game') return `all ${GAME_NAMES[scope.slice(5)] ?? scope.slice(5)} vehicles`;
  if (level === 'brand') {
    const [game, brand] = scope.slice(6).split('/');
    return `all ${brandName(store, game, brand, truck)}`;
  }
  const name = modelName(store, modelOf(scope), truck);
  if (level === 'chassis') return `${name}, hook ${scope.slice(scope.indexOf('@') + 1)} m`;
  if (level === 'vehicle') return `${name}, ${scope.slice(scope.indexOf('#') + 1)}`;
  return name;
}

// A preset as people read it: its name, then where it applies when the name does not say
// it ("Default layout — all vehicles", "Long nose — Peterbilt 389 +1").
function displayName(store, key, truck = null) {
  if (isCollectionKey(key)) return collectionLabel(store.collection[key]);
  const { name } = store.presets[key];
  const scopes = scopesOf(store, key);
  if (!scopes.length) return name;
  const where = scopeLabel(store, scopes[0], truck);
  const more = scopes.length > 1 ? ` +${scopes.length - 1}` : '';
  return where === name ? `${name}${more}` : `${name} — ${where}${more}`;
}

// What a preset picked in the list applies to by itself.
function scopeOfKey(store, key, truck) {
  if (isCollectionKey(key)) {
    const { vehicle, vehicleName } = store.collection[key];
    if (!vehicle) return 'only where it is chosen';
    const name = vehicleName ?? modelName(store, modelOf(vehicle), truck);
    return levelOf(vehicle) === 'chassis' ? `${name} on the hook ${vehicle.slice(vehicle.indexOf('@') + 1)} m chassis` : `all ${name}`;
  }
  const scopes = scopesOf(store, key);
  if (!scopes.length) return 'only where it is chosen';
  return scopes.map((s) => (s === ALL_SCOPE ? EVERY : scopeLabel(store, s, truck))).join('; ');
}

const EVERY = 'every vehicle without its own preset';
const chassisScope = (truck) => (truck.variant ? `all ${truck.name} on this chassis` : `all ${truck.name}`);

// A vehicle's scopes for the card, narrowest first: { level, scope, label, holder } where
// holder is the preset or file assigned there, or null. "This vehicle" only for a plate
// of your own (a quick job's is random).
export function scopeLadder(store, truck) {
  const brand = brandKey(truck);
  const game = gameKey(truck);
  return [
    truck.plate && !truck.quickJob && ['vehicle', plateKey(truck), `this vehicle (${truck.plate})`],
    truck.variant && ['chassis', chassisKey(truck), `this chassis (hook ${truck.variant} m)`],
    ['model', truck.key, truck.variant ? `all chassis of ${truck.name}` : `all ${truck.name}`],
    brand && ['brand', brand, scopeLabel(store, brand, truck)],
    game && ['game', game, scopeLabel(store, game, truck)],
    ['all', ALL_SCOPE, 'all vehicles'],
  ].filter(Boolean).map(([level, scope, label]) => ({ level, scope, label, holder: store.assignments[scope] ?? null }));
}

const LADDER_HOWS = new Set(['vehicle', 'chassis', 'model', 'brand', 'game', 'all']);

// Where the preset that plays in Auto sits on this vehicle's ladder, or null: another
// chassis's preset, a shared file, or a preset picked in the list.
export function currentScope(store, selection, truck) {
  if (selection.mode !== 'auto' || !truck) return null;
  const auto = autoPreset(store, truck);
  if (!auto || !LADDER_HOWS.has(auto.how) || isCollectionKey(auto.key)) return null;
  return scopeLadder(store, truck).some((r) => r.scope === auto.scope) ? auto.scope : null;
}

const holderName = (store, key) => (isCollectionKey(key) ? store.collection?.[key]?.name ?? key : store.presets[key]?.name ?? key);

// What putting the preset that plays at the scope `to` means, for the card's dialogs:
//   mode       'move' (Auto, from its scope on this ladder), 'copy' (Auto, from another
//              chassis or a file: a copy takes `to`), 'use' (a preset picked in the list:
//              it gets `to` as well)
//   direction  'up' | 'down' for a move
//   mustCopy   moving away from all vehicles leaves a copy there instead (something must play)
//   taken      { key, name, keeps } the other preset at `to`, which loses it (keeps: it still
//              applies elsewhere, or it is a file)
//   shadow     [{ scope, label, name }] narrower scopes of this vehicle with other presets,
//              which would keep playing here
//   fallback   for a move down: { label, name } what plays from then on where it was
//   outplayed  { name, file } what would still play in this vehicle, narrower than `to`, with
//              the shadow cleared: a shared file for this chassis or the model (files are
//              never unassigned), or null
// Null when nothing would change.
export function planScope(store, selection, truck, to) {
  if (!truck) return null;
  const ladder = scopeLadder(store, truck);
  const index = (scope) => ladder.findIndex((r) => r.scope === scope);
  if (index(to) < 0) return null;
  const { key } = resolvePlaying(store, selection, truck);
  const from = currentScope(store, selection, truck);
  if (from === to || (selection.mode !== 'auto' && store.assignments[to] === key)) return null;
  let mode = 'copy';
  if (selection.mode !== 'auto') mode = 'use';
  else if (from) mode = 'move';
  const direction = mode === 'move' ? (index(to) > index(from) ? 'up' : 'down') : null;
  const holder = store.assignments[to];
  const taken = holder && holder !== key
    ? { key: holder, name: holderName(store, holder), keeps: isCollectionKey(holder) || scopesOf(store, holder).length > 1 }
    : null;
  const shadow = ladder.slice(0, index(to))
    .filter((r) => r.holder && r.holder !== key && !(mode === 'move' && r.scope === from))
    .map((r) => ({ scope: r.scope, label: r.label, name: holderName(store, r.holder) }));
  let fallback = null;
  if (direction === 'down') {
    const wider = ladder.slice(index(from) + 1).find((r) => r.holder && r.holder !== key);
    fallback = wider ? { label: wider.label, name: holderName(store, wider.holder) } : null;
  }
  const plan = { mode, key, from, to, direction, mustCopy: mode === 'move' && from === ALL_SCOPE, taken, shadow, fallback, outplayed: null };
  const after = applyScope(store, plan, truck, { clear: shadow.map((s) => s.scope) });
  const plays = autoPreset(after, truck);
  if (plays && plays.key !== after.assignments[to]) {
    plan.outplayed = { name: holderName(store, plays.key), file: isCollectionKey(plays.key) };
  }
  return plan;
}

// Carries out a plan (planScope): copy (a move down kept where it was, or anything from a
// file, another chassis or all vehicles) puts a copy at `to`; a move frees `from`; clear
// frees those narrower scopes. Presets that lose a scope stay.
export function applyScope(store, plan, truck, { copy = false, clear = [] } = {}) {
  let next = store;
  let key = plan.key;
  if (plan.mode === 'copy' || plan.mustCopy || copy || isCollectionKey(key)) {
    const layout = presetLayout(store, key);
    key = freePresetKey(store.presets);
    next = { ...next, presets: { ...next.presets, [key]: { ...structuredClone(layout), name: nameFor(store, plan.to, truck, layout.name) } } };
  }
  const assignments = { ...next.assignments };
  if (plan.mode === 'move' && key === plan.key && plan.from !== ALL_SCOPE) delete assignments[plan.from];
  for (const scope of clear) if (scope !== ALL_SCOPE) delete assignments[scope];
  assignments[plan.to] = key;
  return { ...next, assignments };
}

// A copy's name: the vehicle, chassis or model as ownPreset names it; for wider scopes the
// source's name with " copy".
function nameFor(store, scope, truck, sourceName) {
  const level = levelOf(scope);
  if (level === 'vehicle') return `${truck.name}, ${truck.plate}`;
  if (level === 'chassis') return `${truck.name}, hook ${truck.variant} m`;
  if (level === 'model') return truck.name;
  return uniqueName(sourceName, new Set(Object.values(store.presets).map((l) => l.name)));
}

// The panel's card for the truck in the game: what plays, what it applies to, a note on
// editing, and what can be done:
//   scope   { value, options } the vehicle's ladder to move the preset that plays (Auto);
//           value '' with a first option saying where it comes from when it is not on it
//   useIn   { options } the ladder to put a preset picked in the list to use here
//   buttons [{ action, label }]: Unbind
export function truckStatus(store, selection, truck) {
  const playing = resolvePlaying(store, selection, truck);
  const base = {
    truck: truck ? [truck.name, truck.variant && `hook ${truck.variant} m`, truck.plate].filter(Boolean).join(' · ') : 'no vehicle in the game',
    plays: displayName(store, playing.key, truck),
    appliesTo: EVERY,
    note: null,
    scope: null,
    useIn: null,
    buttons: [],
  };
  const lent = truck?.plate && truck.quickJob ? 'This quick-job vehicle has a random plate, so "this vehicle" is not offered.' : '';
  const note = (...parts) => parts.filter(Boolean).join(' ') || null;
  const rungOptions = (marked) => scopeLadder(store, truck).map((r) => {
    const other = r.holder && r.holder !== marked ? ` — "${holderName(store, r.holder)}"` : '';
    return { value: r.scope, label: `${r.label}${other}` };
  });

  if (selection.mode !== 'auto') {
    const file = playing.kind === 'collection' ? store.collection[playing.key].file : null;
    return {
      ...base,
      plays: `${base.plays} (picked in the list)`,
      appliesTo: scopeOfKey(store, playing.key, truck),
      note: note(file ? `From the collection: ${file}. Editing makes your own copy first.` : 'Editing changes this preset.', truck && lent),
      useIn: truck ? { options: [{ value: '', label: 'Use it in…' }, ...rungOptions(playing.key)] } : null,
    };
  }
  if (!truck) return base;
  const auto = autoPreset(store, truck);
  const from = currentScope(store, selection, truck);
  const FROM = {
    sibling: `another chassis of ${truck.name}`,
    collectionChassis: `${chassisScope(truck)}, from the collection`,
    collectionModel: `${truck.variant ? `all chassis of ${truck.name}` : `all ${truck.name}`}, from the collection`,
    collectionSibling: `another chassis of ${truck.name}, from the collection`,
  };
  const appliesTo = from ? scopeLadder(store, truck).find((r) => r.scope === from).label : FROM[auto?.how] ?? `${scopeLabel(store, auto.scope, truck)}, from the collection`;
  const scope = from
    ? { value: from, options: rungOptions(playing.key) }
    : { value: '', options: [{ value: '', label: appliesTo }, ...rungOptions(playing.key)] };
  const owns = ownsEdits(auto, truck);
  const file = isCollectionKey(auto.key) ? store.collection[auto.key].file : null;
  const copy = truck.variant ? 'copy for this chassis' : `preset for ${truck.name}`;
  let editNote = null;
  if (file) editNote = `From the collection: ${file}. Editing makes your own ${copy} first.`;
  else if (!owns) editNote = `Editing makes a ${copy} first.`;
  return {
    ...base,
    appliesTo: from === ALL_SCOPE ? EVERY : appliesTo,
    note: note(editNote, lent),
    scope,
    buttons: from && from !== ALL_SCOPE ? [{ action: 'unbind', label: 'Unbind' }] : [],
  };
}

const AUTO_NOTE = {
  vehicle: () => ' (this vehicle)',
  chassis: () => '',
  model: (truck) => (truck.variant ? ' (all chassis)' : ''),
  sibling: () => ' (other chassis)',
  collectionChassis: () => ' (collection)',
  collectionModel: () => ' (collection)',
  collectionSibling: () => ' (collection)',
  brand: () => '',
  game: () => '',
  all: () => '',
};

// The preset list: Auto, your presets that apply somewhere by name, then the Unassigned
// ones and the Collection.
export function presetOptions(store, truck) {
  let auto = 'Auto — no game';
  if (truck) {
    const playing = autoPreset(store, truck);
    auto = playing ? `Auto — ${displayName(store, playing.key, truck)}${AUTO_NOTE[playing.how](truck)}` : 'Auto';
  }
  const own = Object.keys(store.presets).map((key) => ({ value: `truck:${key}`, label: displayName(store, key, truck), key }));
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  const assigned = own.filter((o) => scopesOf(store, o.key).length).sort(byLabel);
  const unassigned = own.filter((o) => !scopesOf(store, o.key).length).sort(byLabel);
  const strip = ({ value, label }) => ({ value, label });
  const files = Object.values(store.collection ?? {})
    .map((entry) => ({ value: `truck:${entry.key}`, label: collectionLabel(entry) }))
    .sort(byLabel);
  return [
    { value: 'auto', label: auto },
    ...assigned.map(strip),
    ...(unassigned.length ? [{ group: 'Unassigned', options: unassigned.map(strip) }] : []),
    ...(files.length ? [{ group: 'Collection', options: files }] : []),
  ];
}

// The preset that plays as a file to share (collection.js): { fileName, data }, or null
// for a shared file, which is one already. vehicle: its narrowest model or chassis scope;
// a preset for one vehicle (by plate) is shared for that vehicle's chassis, so the plate
// stays private; wider or no scopes: for no vehicle.
export function exportPreset(store, key, truck) {
  if (!key || isCollectionKey(key)) return null;
  const layout = store.presets[key];
  if (!layout) return null;
  const scope = scopesOf(store, key).find((s) => ['vehicle', 'chassis', 'model'].includes(levelOf(s)));
  let vehicle = null;
  if (scope && levelOf(scope) !== 'vehicle') vehicle = scope;
  else if (scope) vehicle = truck && plateKey(truck) === scope ? variantKey(truck) : modelOf(scope);
  const name = vehicle && modelName(store, modelOf(vehicle), truck);
  const vehicleName = name && name !== readableId(modelOf(vehicle)) ? name : null; // an id is no name
  return { fileName: presetFileName(layout.name), data: presetFile({ name: layout.name, vehicle, vehicleName, layout }) };
}

export function selectionValue(selection) {
  return selection.mode === 'truck' ? `truck:${selection.key}` : 'auto';
}

export function parseSelection(value) {
  return value.startsWith('truck:') ? { mode: 'truck', key: value.slice('truck:'.length) } : { mode: 'auto' };
}
