// Which layout plays and which one an edit goes to.
// Selection: { mode: 'auto' } | { mode: 'truck', key } (a preset picked in the list)
//   | { mode: 'scope', scope } (a key picked in the preset map: what it plays; editing it
//   gives the key a preset of its own first, if it inherits).
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
  // The brand, then the game: yours, then a shared file for it (a file exported from a
  // key of the tree carries those, exportFiles).
  for (const [how, scope] of [['brand', brandKey(truck)], ['game', gameKey(truck)], ['all', ALL_SCOPE]]) {
    const key = assigned(scope) ?? (scope && how !== 'all' ? file((v) => v === scope) : null);
    if (key) return { key, how: isCollectionKey(key) ? `collection${how[0].toUpperCase()}${how.slice(1)}` : how, scope };
  }
  return null;
}

// Whether Auto's edits go to what plays: a preset for this vehicle or this chassis, or the
// model's on a model without chassis. Anything wider first gets a copy for this chassis.
function ownsEdits(auto, truck) {
  if (!auto) return false;
  return auto.how === 'vehicle' || auto.how === 'chassis' || (auto.how === 'model' && !truck.variant);
}

// What a key of the map plays: { key, at } its own preset or file, else what it inherits up
// its chain (chainOf; a chassis or model also from a shared file for it).
export function scopePreset(store, scope, truck = null) {
  const files = Object.values(store.collection ?? {}).filter((e) => e.vehicle).sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const at of chainOf(store, scope, truck)) {
    const key = store.assignments[at];
    if (key && presetLayout(store, key)) return { key, at };
    const file = files.find((e) => e.vehicle === at);
    if (file) return { key: file.key, at };
  }
  return { key: allPresetKey(store), at: ALL_SCOPE };
}

export function resolvePlaying(store, selection, truck) {
  if (selection.mode === 'scope') {
    const { key } = scopePreset(store, selection.scope, truck);
    return { kind: kindOf(key), key, layout: presetLayout(store, key) };
  }
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
  const key = freePresetKey(store.presets);
  const preset = { ...structuredClone(resolvePlaying(store, { mode: 'auto' }, truck).layout), name: keyPath(store, where, truck) };
  return { ...store, presets: { ...store.presets, [key]: preset }, assignments: { ...store.assignments, [where]: key } };
}

export function routeEdit(store, selection, truck) {
  if (selection.mode === 'truck') return { store, key: selection.key };
  if (selection.mode === 'scope') {
    // A key of the map: its own preset, else a copy of what it inherits becomes its own.
    const own = store.assignments[selection.scope];
    if (own && store.presets[own]) return { store, key: own };
    const { layout } = resolvePlaying(store, selection, truck);
    const key = freePresetKey(store.presets);
    const name = nameFor(store, selection.scope, truck);
    return {
      store: { ...store, presets: { ...store.presets, [key]: { ...structuredClone(layout), name } }, assignments: { ...store.assignments, [selection.scope]: key } },
      key,
    };
  }
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

// What a file says of its model (name, game, brand), kept as if the model had been driven,
// so the tree places it; what the game told is never overwritten.
function learnPlace(store, entry) {
  if (!entry.vehicle || !['model', 'chassis'].includes(levelOf(entry.vehicle))) return store;
  const model = modelOf(entry.vehicle);
  const known = store.vehicles?.[model] ?? { name: null, game: null, brand: null, brandName: null, chassis: [], plates: {} };
  const info = {
    ...known,
    name: known.name ?? entry.vehicleName,
    game: known.game ?? entry.game,
    brand: known.brand ?? (entry.game && entry.brand),
    brandName: known.brandName ?? (entry.game && entry.brandName),
  };
  if (levelOf(entry.vehicle) === 'chassis') info.chassis = [...new Set([...known.chassis, entry.vehicle.slice(entry.vehicle.indexOf('@') + 1)])].sort();
  return { ...store, vehicles: { ...store.vehicles, [model]: info } };
}

const sameLayout = (a, b) => JSON.stringify([a.width, a.bounds, a.speakers]) === JSON.stringify([b.width, b.bounds, b.speakers]);

// Preset files (collection.js entries) made your presets. Each goes on the key its file says
// when no preset of yours is there, or the key is in replace (the one there stays, among the
// unused if it is on no other key); else among the unused ones. One the same as a preset of
// yours (speakers, bounds, width) is not added again: that one goes on the key instead. A key
// that held the file itself ("file:<path>") gets the preset. What a file says of its vehicle
// is kept (learnPlace). { store, placed, unused, same }: how many went on keys, among the
// unused, and were yours already.
export function importPresets(store, entries, replace = new Set()) {
  let next = { ...store, assignments: { ...store.assignments } };
  const counts = { placed: 0, unused: 0, same: 0 };
  for (const entry of [...entries].sort((a, b) => ((a.file ?? '') < (b.file ?? '') ? -1 : 1))) {
    let key = Object.keys(next.presets).find((k) => sameLayout(next.presets[k], entry.layout));
    if (key) counts.same++;
    else ({ store: next, key } = createPreset(next, entry.layout));
    const scope = entry.vehicle;
    const held = scope && next.assignments[scope];
    if (scope && (!held || held === key || (entry.key && held === entry.key) || replace.has(scope))) {
      next.assignments[scope] = key;
      counts.placed++;
    } else if (!Object.values(next.assignments).includes(key)) counts.unused++;
    if (entry.key) for (const [s, k] of Object.entries(next.assignments)) if (k === entry.key) next.assignments[s] = key;
    next = learnPlace(next, entry);
  }
  return { store: next, ...counts };
}

// The keys where an import would meet a preset of yours (importPresets' replace): [{ scope,
// label, yours, theirs }]. A key holding the same layout, or the file itself, is no clash.
export function importClashes(store, entries, truck = null) {
  return entries.flatMap((entry) => {
    const scope = entry.vehicle;
    const held = scope && store.assignments[scope];
    const yours = held && presetLayout(store, held);
    if (!yours || held === entry.key || sameLayout(yours, entry.layout)) return [];
    return [{ scope, label: scopeLabel(store, scope, truck), yours: yours.name, theirs: entry.name }];
  });
}

// The presets shipped with the app (defaults/) made yours, once (store.defaultsImported),
// as importPresets does. In a new store (fresh) the shipped preset for all vehicles ("all")
// takes the place of the default layout, and its name.
export function importDefaults(store, entries, fresh) {
  let start = store;
  const replace = new Set();
  if (fresh && entries.some((e) => e.vehicle === ALL_SCOPE)) {
    const { [store.assignments[ALL_SCOPE]]: _gone, ...presets } = store.presets;
    start = { ...store, presets };
    replace.add(ALL_SCOPE);
  }
  return { ...importPresets(start, entries, replace).store, defaultsImported: true };
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

export const NEW_LABEL = 'new';

// A model seen for the first time without a key of its own (none for the model, its chassis
// or its vehicles, and no shared file for it) gets one: a copy of what it would inherit
// (the brand's, the game's or all vehicles' preset), named after it. From then on the model
// has its own preset to tune, and wider presets serve as templates. The same store when the
// model has a key.
export function adoptNewModel(store, truck) {
  if (!truck) return store;
  const ofModel = (scope) => modelOf(scope) === truck.key && levelOf(scope) !== 'brand' && levelOf(scope) !== 'game' && scope !== ALL_SCOPE;
  if (Object.keys(store.assignments).some(ofModel)) return store;
  if (Object.values(store.collection ?? {}).some((e) => e.vehicle && modelOf(e.vehicle) === truck.key)) return store;
  const { layout } = resolvePlaying(store, { mode: 'auto' }, truck);
  const key = freePresetKey(store.presets);
  return {
    ...store,
    // Labelled "new" so it stands out in the key tree until you give it a label of your own.
    presets: { ...store.presets, [key]: { ...structuredClone(layout), name: keyPath(store, truck.key, truck), label: NEW_LABEL, labelColor: 'green' } },
    assignments: { ...store.assignments, [truck.key]: key },
  };
}

// Keeps what the game tells about a model (name, game, brand) for naming its scopes when
// you drive something else. The same store when nothing new was learned.
export function rememberVehicle(store, truck) {
  if (!truck) return store;
  const known = store.vehicles?.[truck.key] ?? {};
  const chassis = known.chassis ?? [];
  const plates = known.plates ?? {};
  const info = {
    name: truck.name || known.name || null,
    game: truck.game ?? known.game ?? null,
    brand: truck.brand ?? known.brand ?? null,
    brandName: truck.brandName ?? known.brandName ?? null,
    chassis: truck.variant && !chassis.includes(truck.variant) ? [...chassis, truck.variant].sort() : chassis,
    // A quick job lends a truck with a random plate: not one of yours.
    plates: truck.plate && !truck.quickJob && plates[truck.plate] !== (truck.variant ?? null)
      ? { ...plates, [truck.plate]: truck.variant ?? null }
      : plates,
  };
  const same = ['name', 'game', 'brand', 'brandName'].every((k) => info[k] === (known[k] ?? null))
    && info.chassis === chassis && info.plates === plates && known.chassis;
  if (same) return store;
  return { ...store, vehicles: { ...store.vehicles, [truck.key]: info } };
}

const GAME_NAMES = { ats: 'ATS', ets2: 'ETS2' };

// A model's name: what the game said, else the name of your preset for the model, else a
// shared file's vehicleName, else its id made readable ("vehicle.peterbilt.389" -> "peterbilt 389").
function modelName(store, model, truck) {
  if (truck?.key === model) return truck.name;
  const own = store.presets[store.assignments[model]];
  const file = Object.values(store.collection ?? {}).find((e) => e.vehicle && modelOf(e.vehicle) === model && e.vehicleName);
  return store.vehicles?.[model]?.name ?? own?.name ?? file?.vehicleName ?? readableId(model);
}

const readableId = (model) => model.replace(/^vehicle\./, '').replace(/[._]/g, ' ');

function brandName(store, game, brand, truck) {
  if (truck?.game === game && truck?.brand === brand && truck.brandName) return truck.brandName;
  const known = Object.values(store.vehicles ?? {}).find((v) => v.game === game && v.brand === brand && v.brandName)
    ?? Object.values(store.collection ?? {}).find((e) => e.game === game && e.brand === brand && e.brandName);
  return known?.brandName ?? brand.charAt(0).toUpperCase() + brand.slice(1); // never driven: its id
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
  // A name that is the key's path (or the older "Model, hook 2.7 m") says where it applies.
  const said = name === where || name === keyPath(store, scopes[0], truck);
  return said ? `${name}${more}` : `${name} — ${where}${more}`;
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
// Picking a key or a preset stops following the vehicle in the game; this goes back.
const BACK_TO_AUTO = { action: 'auto', label: 'Back to Auto' };
const chassisScope = (truck) => (truck.variant ? `all ${truck.name} on this chassis` : `all ${truck.name}`);

// Where a model belongs: { game, brand }, as the game said (the vehicle in it, or when it
// was driven), else as a shared file for it says. Null parts are not known: no guesses.
function placeOf(store, model, truck) {
  if (truck?.key === model && (truck.game || truck.brand)) return { game: truck.game ?? null, brand: truck.brand ?? null };
  const known = store.vehicles?.[model];
  if (known?.game) return { game: known.game, brand: known.brand ?? null };
  // A shared file for the model may say where it is from (collection.js).
  const file = Object.values(store.collection ?? {}).find((e) => e.vehicle && modelOf(e.vehicle) === model && e.game);
  return { game: file?.game ?? null, brand: file?.brand ?? known?.brand ?? null };
}

// The chassis of one of your vehicles ("<id>#<plate>"): the vehicle in the game's, else the
// one it had when last driven (store.vehicles). Null when not known.
function plateChassis(store, scope, truck) {
  if (truck && plateKey(truck) === scope) return chassisKey(truck);
  const model = modelOf(scope);
  const hook = store.vehicles?.[model]?.plates?.[scope.slice(scope.indexOf('#') + 1)];
  return hook ? `${model}@${hook}` : null;
}

// A scope and the wider ones it falls back to, narrowest first, as far as they are known:
// a vehicle's chassis, a chassis's model, a model's brand and game (placeOf), all vehicles.
export function chainOf(store, scope, truck = null) {
  const level = levelOf(scope);
  if (level === 'all') return [ALL_SCOPE];
  if (level === 'game') return [scope, ALL_SCOPE];
  if (level === 'brand') return [scope, `game:${scope.slice(6).split('/')[0]}`, ALL_SCOPE];
  const model = modelOf(scope);
  const { game, brand } = placeOf(store, model, truck);
  const wider = [model, game && brand && `brand:${game}/${brand}`, game && `game:${game}`, ALL_SCOPE].filter(Boolean);
  if (level === 'model') return wider;
  if (level === 'chassis') return [scope, ...wider];
  return [scope, ...(plateChassis(store, scope, truck) ? [plateChassis(store, scope, truck)] : []), ...wider];
}

// Moving your preset from one scope to another in the map: up its chain, down to a scope
// whose chain passes through it, or across to any other key (dragging). A plan as
// planScope gives (mode 'move'; direction 'up', 'down' or 'across'), or null.
export function planMove(store, from, to, truck = null) {
  const key = store.assignments[from];
  if (!key || isCollectionKey(key) || from === to) return null;
  const up = chainOf(store, from, truck);
  const down = chainOf(store, to, truck);
  if (to.startsWith('?')) return null; // a folder, no scope
  let direction = 'across';
  if (up.includes(to)) direction = 'up';
  else if (down.includes(from)) direction = 'down';
  const holder = store.assignments[to];
  const taken = holder && holder !== key
    ? { key: holder, name: holderName(store, holder), keeps: isCollectionKey(holder) || scopesOf(store, holder).length > 1 }
    : null;
  let between = [];
  if (direction === 'up') between = up.slice(1, up.indexOf(to));
  else if (direction === 'down') between = down.slice(1, down.indexOf(from));
  const shadow = between.filter((s) => store.assignments[s] && store.assignments[s] !== key)
    .map((s) => ({ scope: s, label: scopeLabel(store, s, truck), name: holderName(store, store.assignments[s]) }));
  let fallback = null;
  if (direction !== 'up') {
    const wider = up.slice(1).find((s) => store.assignments[s] && store.assignments[s] !== key);
    fallback = wider ? { label: scopeLabel(store, wider, truck), name: holderName(store, store.assignments[wider]) } : null;
  }
  return { mode: 'move', key, from, to, direction, mustCopy: from === ALL_SCOPE, taken, shadow, fallback, outplayed: null };
}

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
    next = { ...next, presets: { ...next.presets, [key]: { ...structuredClone(layout), name: nameFor(store, plan.to, truck) } } };
  }
  const assignments = { ...next.assignments };
  if (plan.mode === 'move' && key === plan.key && plan.from !== ALL_SCOPE) delete assignments[plan.from];
  for (const scope of clear) if (scope !== ALL_SCOPE) delete assignments[scope];
  assignments[plan.to] = key;
  return { ...next, assignments };
}

// A key's path as the tree shows it, without "All vehicles": "ATS › Kenworth › Kenworth T680
// 2014 › hook 2.7 m › WP-1"; "All vehicles" for that key. Presets the app makes for a key are
// named so. Parts not known (a model's game and brand before it is driven) are left out.
export function keyPath(store, scope, truck = null) {
  if (scope === ALL_SCOPE) return 'All vehicles';
  const part = (s) => {
    const level = levelOf(s);
    if (level === 'game') return GAME_NAMES[s.slice(5)] ?? s.slice(5);
    if (level === 'brand') {
      const [game, brand] = s.slice(6).split('/');
      return brandName(store, game, brand, truck);
    }
    if (level === 'model') return modelName(store, s, truck);
    if (level === 'chassis') return `hook ${s.slice(s.indexOf('@') + 1)} m`;
    return s.slice(s.indexOf('#') + 1);
  };
  return chainOf(store, scope, truck).filter((s) => s !== ALL_SCOPE).reverse().map(part).join(' › ');
}

// A copy's name: the path of its key.
function nameFor(store, scope, truck) {
  return keyPath(store, scope, truck);
}

// The panel's card for the truck in the game: what plays, what it applies to, a note on
// editing, and what can be done:
//   scope   { value, options } the vehicle's ladder to move the preset that plays (Auto);
//           value '' with a first option saying where it comes from when it is not on it
//   useIn   { options } the ladder to put a preset picked in the list to use here
//   buttons [{ action, label }]: Unbind; Back to Auto when a key or a preset is picked
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

  if (selection.mode === 'scope') {
    // A key picked in the map: it plays what is set on it or what it inherits.
    const label = scopeLabel(store, selection.scope, truck);
    const { at } = scopePreset(store, selection.scope, truck);
    const own = at === selection.scope && !isCollectionKey(playing.key);
    let note = `Editing changes the preset of ${label}.`;
    if (!own) note = `It inherits this from ${scopeLabel(store, at, truck)}: editing gives ${label} a preset of its own first.`;
    return { ...base, plays: `${base.plays} (key picked in the map)`, appliesTo: selection.scope === ALL_SCOPE ? EVERY : label, note, buttons: [BACK_TO_AUTO] };
  }

  if (selection.mode !== 'auto') {
    const file = playing.kind === 'collection' ? store.collection[playing.key].file : null;
    return {
      ...base,
      plays: `${base.plays} (picked in the list)`,
      appliesTo: scopeOfKey(store, playing.key, truck),
      note: note(file ? `From the collection: ${file}. Editing makes your own copy first.` : 'Editing changes this preset.', truck && lent),
      useIn: truck ? { options: [{ value: '', label: 'Use it in…' }, ...rungOptions(playing.key)] } : null,
      buttons: [BACK_TO_AUTO],
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
  collectionBrand: () => ' (collection)',
  collectionGame: () => ' (collection)',
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
export function presetOptions(store, truck, selection = { mode: 'auto' }) {
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
  // A key picked in the map shows as an entry of its own.
  const key = selection.mode === 'scope'
    ? [{ value: selectionValue(selection), label: `Key: ${scopeLabel(store, selection.scope, truck)}` }]
    : [];
  return [
    { value: 'auto', label: auto },
    ...key,
    ...assigned.map(strip),
    ...(unassigned.length ? [{ group: 'Unassigned', options: unassigned.map(strip) }] : []),
    ...(files.length ? [{ group: 'Collection', options: files }] : []),
  ];
}

const MAP_ORDER = ['game', 'brand', 'model', 'chassis', 'vehicle'];

// The preset map, laid out like registry keys: all vehicles > game > brand > model > chassis >
// your vehicle (by plate). Every model you have driven gets its key, with the chassis and
// vehicles seen; so do scopes that hold a preset or a shared file, and the vehicle in the game.
// A model whose game is not known yet (not driven since presets got scopes) sits under
// "Game not known yet (drive a vehicle once)"; that folder is no scope (pseudo).
// Node: { scope, label, pseudo, own, inherited, current, plays, moveTo, children }
//   own        { key, name, file, label, labelColor } the preset or file at this key, or null
//   inherited  { key, name, from } what a key without its own falls back to, and the key it is from
//   current    on the chain of the vehicle in the game; plays: the key whose preset plays in
//              Auto; picked: the key picked in the map (selection mode 'scope')
//   moveTo     for a preset of yours: [{ value, label }] wider keys up its chain, then the
//              keys under it
// Also gives the unassigned presets and the files that apply nowhere.
export function presetTree(store, truck, selection = { mode: 'auto' }) {
  const files = Object.values(store.collection ?? {}).filter((e) => e.vehicle).sort((a, b) => (a.key < b.key ? -1 : 1));
  const ownAt = (scope) => {
    const key = store.assignments[scope];
    const tag = (layout) => ({ label: layout?.label ?? null, labelColor: layout?.labelColor ?? 'blue' });
    if (key && presetLayout(store, key)) return { key, name: holderName(store, key), file: isCollectionKey(key), ...tag(presetLayout(store, key)) };
    const file = files.find((e) => e.vehicle === scope);
    return file ? { key: file.key, name: file.name, file: true, ...tag(file.layout) } : null;
  };
  // Every key to show: the vehicles driven with their chassis and plates, scopes with
  // presets or files, and the vehicle in the game.
  const scopes = new Set([ALL_SCOPE, ...Object.keys(store.assignments), ...files.map((e) => e.vehicle)]);
  for (const [model, v] of Object.entries(store.vehicles ?? {})) {
    scopes.add(model);
    for (const hook of v.chassis ?? []) scopes.add(`${model}@${hook}`);
    for (const plate of Object.keys(v.plates ?? {})) scopes.add(`${model}#${plate}`);
  }
  const ladder = truck ? scopeLadder(store, truck) : [];
  for (const r of ladder) scopes.add(r.scope);
  const chain = new Set(truck ? ladder.map((r) => r.scope) : [ALL_SCOPE]);
  const auto = truck && selection.mode === 'auto' ? autoPreset(store, truck) : null;
  const playsAt = auto && chain.has(auto.scope) ? auto.scope : null;

  const nodes = new Map();
  const node = (scope, label, parent) => {
    if (!nodes.has(scope)) {
      const pseudo = scope.startsWith('?');
      nodes.set(scope, {
        scope, label, pseudo, own: pseudo ? null : ownAt(scope), inherited: null, current: chain.has(scope), plays: scope === playsAt,
        picked: selection.mode === 'scope' && selection.scope === scope, children: [], parent,
      });
    }
    return nodes.get(scope);
  };
  const root = node(ALL_SCOPE, 'All vehicles', null);
  const gameNode = (game) => (game ? node(`game:${game}`, GAME_NAMES[game] ?? game, root) : node('?unknown', 'Game not known yet (drive a vehicle once)', root));
  const modelNode = (model) => {
    const { game, brand } = placeOf(store, model, truck);
    let parent = gameNode(game);
    if (game && brand) parent = node(`brand:${game}/${brand}`, brandName(store, game, brand, truck), parent);
    return node(model, modelName(store, model, truck), parent);
  };
  for (const scope of [...scopes].sort(byLevel).reverse()) {
    const level = levelOf(scope);
    if (level === 'game') gameNode(scope.slice(5));
    else if (level === 'brand') {
      const [game, brand] = scope.slice(6).split('/');
      node(scope, brandName(store, game, brand, truck), gameNode(game));
    } else if (level === 'model') modelNode(scope);
    else if (level === 'chassis') node(scope, `hook ${scope.slice(scope.indexOf('@') + 1)} m`, modelNode(modelOf(scope)));
    else if (level === 'vehicle') {
      const chassis = plateChassis(store, scope, truck);
      const parent = chassis ? node(chassis, `hook ${chassis.slice(chassis.indexOf('@') + 1)} m`, modelNode(modelOf(scope))) : modelNode(modelOf(scope));
      node(scope, scope.slice(scope.indexOf('#') + 1), parent);
    }
  }
  for (const n of nodes.values()) {
    if (n.parent) n.parent.children.push(n);
  }
  const below = (n) => n.children.flatMap((c) => [...(c.pseudo ? [] : [c]), ...below(c)]);
  const finish = (n, inherited) => {
    n.inherited = n.own ? null : inherited;
    n.children.sort((a, b) => MAP_ORDER.indexOf(levelOf(a.scope)) - MAP_ORDER.indexOf(levelOf(b.scope))
      || Number(a.pseudo) - Number(b.pseudo) || a.label.localeCompare(b.label));
    const passOn = n.own ? { key: n.own.key, name: n.own.name, from: n.label } : inherited;
    for (const c of n.children) finish(c, passOn);
    n.moveTo = n.own && !n.own.file ? [
      ...chainOf(store, n.scope, truck).slice(1).map((s) => ({ value: s, label: `↑ ${scopeLabel(store, s, truck)}` })),
      ...below(n).map((c) => ({ value: c.scope, label: `↓ ${scopeLabel(store, c.scope, truck)}` })),
    ] : [];
    delete n.parent;
    return n;
  };
  const used = new Set(Object.values(store.assignments));
  return {
    root: finish(root, null),
    unassigned: Object.keys(store.presets).filter((k) => !used.has(k))
      .map((key) => ({ key, name: store.presets[key].name, label: store.presets[key].label ?? null, labelColor: store.presets[key].labelColor ?? 'blue' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: Object.values(store.collection ?? {}).filter((e) => !e.vehicle && !used.has(e.key))
      .map((e) => ({ key: e.key, name: collectionLabel(e) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Puts one of your presets (or a file) at a key of the map, as "Use it in" does on the card.
// A plan for applyScope (mode 'use'), or null when it is there already.
export function planAssign(store, key, to) {
  if (store.assignments[to] === key || to.startsWith('?')) return null;
  const holder = store.assignments[to];
  const taken = holder
    ? { key: holder, name: holderName(store, holder), keeps: isCollectionKey(holder) || scopesOf(store, holder).length > 1 }
    : null;
  return { mode: 'use', key, from: null, to, direction: null, mustCopy: false, taken, shadow: [], fallback: null, outplayed: null };
}

// What a preset at a key is shared for, the key in the file's "vehicle": the key itself; a
// vehicle's own (by plate) its chassis, or its model when that is not known, so the plate
// stays private; all vehicles' "all"; one on no key (scope null): no vehicle.
function shareScope(store, scope, truck) {
  if (!scope || scope.startsWith('?')) return null;
  if (scope === ALL_SCOPE) return ALL_SCOPE;
  return levelOf(scope) === 'vehicle' ? plateChassis(store, scope, truck) ?? modelOf(scope) : scope;
}

// Where a key is from, as a file says it: a brand's or a game's place, a model's name and
// place (placeOf); nothing that is not known.
function placeOfScope(store, vehicle, truck) {
  const level = levelOf(vehicle);
  if (level === 'brand') {
    const [game, brand] = vehicle.slice(6).split('/');
    return { game, brand, brandName: brandName(store, game, brand, truck) };
  }
  if (level === 'game') return { game: vehicle.slice(5) };
  const { game, brand } = placeOf(store, modelOf(vehicle), truck);
  const name = modelName(store, modelOf(vehicle), truck);
  return {
    vehicleName: name !== readableId(modelOf(vehicle)) ? name : null, // an id is no name
    game,
    brand: game && brand,
    brandName: game && brand ? brandName(store, game, brand, truck) : null,
  };
}

// The presets ticked in the export window as files to share (collection.js). picks:
// [{ scope, key }], a preset of yours or a shared file and the key it is on (null: on none),
// each going for that key (shareScope; all vehicles' as "all"). { files: [{ fileName, data }], clashes, plates }:
// clashes, the keys that more than one file goes for (only one of them would play there);
// plates, how many vehicles' own presets go for their chassis.
export function exportFiles(store, picks, truck = null) {
  const files = [];
  const targets = new Map();
  let plates = 0;
  for (const { scope, key } of picks) {
    const layout = presetLayout(store, key);
    if (!layout) continue;
    const vehicle = shareScope(store, scope, truck);
    if (scope && levelOf(scope) === 'vehicle') plates++;
    if (vehicle) targets.set(vehicle, (targets.get(vehicle) ?? 0) + 1);
    const place = vehicle && vehicle !== ALL_SCOPE ? placeOfScope(store, vehicle, truck) : {};
    const author = isCollectionKey(key) ? store.collection[key].author : null;
    files.push({
      fileName: presetFileName(layout.name),
      data: presetFile({ name: layout.name, vehicle, author, ...place, layout }),
    });
  }
  const clashes = [...targets].filter(([, n]) => n > 1).map(([vehicle]) => scopeLabel(store, vehicle, truck));
  return { files, clashes, plates };
}

export function selectionValue(selection) {
  if (selection.mode === 'scope') return `scope:${selection.scope}`;
  return selection.mode === 'truck' ? `truck:${selection.key}` : 'auto';
}

export function parseSelection(value) {
  if (value.startsWith('scope:')) return { mode: 'scope', scope: value.slice('scope:'.length) };
  return value.startsWith('truck:') ? { mode: 'truck', key: value.slice('truck:'.length) } : { mode: 'auto' };
}
