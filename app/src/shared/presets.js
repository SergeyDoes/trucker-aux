// Which layout plays and which one an edit goes to.
// Selection: { mode: 'auto' } | { mode: 'truck', key } (a preset picked in the list)
//   | { mode: 'scope', scope } (a key picked in the preset map: what it plays; editing it
//   gives the key a preset of its own first, if it inherits).
// Truck: { key, variant, plate, quickJob, name, game, brand, brandName, centerX } from
// telemetry, or null. Layouts are measured from the truck's axis, so one layout fits every truck.
//
// Presets ("p.N", store.presets) live apart from the scopes they apply to
// (store.assignments: scope -> preset or shared file). The keys of the map, narrowest first:
//   the model     "<truck id>": its variants (docs/superpowers/specs/2026-10-10-model-variants-
//                 design.md): the current one here (the last picked), yours waiting in
//                 store.alternates, and the shared files for the model or its hooks
//   the brand     "brand:<game>/<brand id>"
//   the game      "game:<ats|ets2>"
//   all vehicles  "all" (always assigned: it is what the default layout was)
// and what a model's vehicles remember, no keys of the map:
//   a hook        "<truck id>@<fifth wheel>": the variant a chassis plays
//   your vehicle  "<truck id>#<plate>": the variant it plays, or a preset of its own
// Auto: your vehicle, the hook, a shared file (collection.js) for the hook, the model's current
// variant, a file for the model or another hook of it, then the brand, the game, all vehicles.
// The game reports neither the cab nor the chassis; the fifth wheel sits further back
// on a longer chassis, so its position (to 10 cm) names the chassis (telemetry.js).
import { ALL_SCOPE, freePresetKey, uniqueName } from './layout.js';
import { byHook, collectionLabel, isCollectionKey, presetFile, presetFileName } from './collection.js';

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
const hookOf = (scope) => scope.slice(scope.indexOf('@') + 1);
const plateOf = (scope) => scope.slice(scope.indexOf('#') + 1);
// A model, one of its hooks or one of your vehicles of it.
const isModelLevel = (scope) => Boolean(scope) && ['model', 'chassis', 'vehicle'].includes(levelOf(scope));
const isMemory = (scope) => levelOf(scope) === 'chassis' || levelOf(scope) === 'vehicle';

// What a model's hooks and your vehicles of it remember: [[scope, key]].
const memoriesOf = (store, model) => Object.entries(store.assignments).filter(([s]) => isMemory(s) && modelOf(s) === model);

// Where a preset shows, narrowest first: the models it is a variant of, the vehicles it is the
// own preset of, the brands, games and all vehicles it is on. What hooks remember is no place.
export function scopesOf(store, key) {
  const places = new Set();
  for (const [scope, k] of Object.entries(store.assignments)) {
    if (k !== key) continue;
    if (levelOf(scope) === 'chassis') places.add(modelOf(scope));
    else if (levelOf(scope) === 'vehicle' && ownVariants(store, modelOf(scope)).includes(key)) places.add(modelOf(scope));
    else places.add(scope);
  }
  for (const [scope, keys] of Object.entries(store.alternates ?? {})) {
    if (keys.includes(key)) places.add(isModelLevel(scope) ? modelOf(scope) : scope);
  }
  return [...places].sort(byLevel);
}

export const allPresetKey = (store) => store.assignments[ALL_SCOPE];

// A preset's layout: your own (store.presets) or a shared file's (store.collection, from
// collection.js, never saved). Null when it is gone.
function presetLayout(store, key) {
  if (!key) return null;
  return (isCollectionKey(key) ? store.collection?.[key]?.layout : store.presets[key]) ?? null;
}

const kindOf = (key) => (isCollectionKey(key) ? 'collection' : 'preset');

// The shared files for a vehicle (or a brand, a game), in the order Auto tries them: the
// files from others first, then the defaults (presets/default/, the bottom layer), each by path.
const sharedFiles = (store) => Object.values(store.collection ?? {}).filter((e) => e.vehicle)
  .sort((a, b) => Number(a.default) - Number(b.default) || (a.key < b.key ? -1 : 1));

// The hooks a file for a model plays on (collection.js; an entry made without them: the hook in
// its vehicle).
const fileHooks = (entry) => entry.hooks ?? (levelOf(entry.vehicle) === 'chassis' ? [hookOf(entry.vehicle)] : []);

// Your presets that are variants of a model: its current one, those waiting, and any a hook
// remembers (foldChassis puts those among the waiting).
function ownVariants(store, model) {
  const hooked = memoriesOf(store, model).filter(([s]) => levelOf(s) === 'chassis').map(([, k]) => k);
  return [...new Set([store.assignments[model], ...waitingOn(store, model), ...hooked])].filter((k) => k && store.presets[k]);
}

// The shared files that are variants of a model (sharedFiles' order): those for it or its
// hooks, but not one taken off the model (store.hiddenFiles), nor one a variant of yours was
// copied from (copyOf) or has the same speakers as: yours stands for it. One the model or a
// vehicle of it holds stays.
function modelFiles(store, model) {
  const yours = ownVariants(store, model).map((k) => store.presets[k]);
  const held = new Set([store.assignments[model], ...memoriesOf(store, model).map(([, k]) => k)]);
  const hidden = new Set(store.hiddenFiles?.[model] ?? []);
  return sharedFiles(store).filter((e) => isModelLevel(e.vehicle) && modelOf(e.vehicle) === model)
    .filter((e) => held.has(e.key) || (!hidden.has(e.key) && !yours.some((l) => l.copyOf === e.key || sameLayout(l, e.layout))));
}

// The file a model plays without a current variant: one for the model, else one for a hook.
const modelFile = (store, model) => {
  const files = modelFiles(store, model);
  return files.find((e) => e.vehicle === model) ?? files[0] ?? null;
};

// The preset Auto plays in a truck: { key, how, scope }. how: vehicle (the plate remembers it),
// chassis (the hook remembers it), collectionChassis (a file for the hook), model (the model's
// current variant), collectionModel (a file for the model), collectionSibling (a file for
// another hook), brand, game, all. Several files for one scope: others' before the defaults,
// then by path.
export function autoPreset(store, truck) {
  const assigned = (scope) => {
    const key = scope && store.assignments[scope];
    return key && presetLayout(store, key) ? key : null;
  };
  const files = modelFiles(store, truck.key);
  const steps = [
    ['vehicle', plateKey(truck), assigned],
    ['chassis', chassisKey(truck), assigned],
    // A file for this very hook before the model's current variant: a hook new to you plays the
    // cab made for it. A file never takes over a hook you have set up.
    ['collectionChassis', chassisKey(truck), (scope) => (scope && files.find((e) => fileHooks(e).includes(truck.variant))?.key) ?? null],
    ['model', truck.key, assigned],
    ['collectionModel', truck.key, () => files.find((e) => e.vehicle === truck.key)?.key ?? null],
    ['collectionSibling', truck.key, () => files[0]?.key ?? null],
  ];
  for (const [how, scope, find] of steps) {
    const key = find(scope);
    if (key) return { key, how, scope };
  }
  // The brand, then the game: yours, then a shared file for it (a file exported from a
  // key of the tree carries those, exportFiles).
  const shared = sharedFiles(store);
  for (const [how, scope] of [['brand', brandKey(truck)], ['game', gameKey(truck)], ['all', ALL_SCOPE]]) {
    const key = assigned(scope) ?? (scope && how !== 'all' ? shared.find((e) => e.vehicle === scope)?.key ?? null : null);
    if (key) return { key, how: isCollectionKey(key) ? `collection${how[0].toUpperCase()}${how.slice(1)}` : how, scope };
  }
  return null;
}

// What Auto plays comes from the model (a variant, a vehicle's own preset or a file of it).
const MODEL_HOWS = new Set(['vehicle', 'chassis', 'collectionChassis', 'model', 'collectionModel', 'collectionSibling']);

// Whether Auto's edits go to what plays: a preset of yours the vehicle, the hook or the model
// plays. A file, or a wider preset, first becomes a variant of yours (ownVariant).
function ownsEdits(auto) {
  return Boolean(auto) && ['vehicle', 'chassis', 'model'].includes(auto.how) && !isCollectionKey(auto.key);
}

// What a key of the map plays: { key, at } its own preset or file, else what it inherits up
// its chain (chainOf; a model also from a shared file for it or its hooks).
export function scopePreset(store, scope, truck = null) {
  const files = sharedFiles(store);
  for (const at of chainOf(store, scope, truck)) {
    const key = store.assignments[at];
    if (key && presetLayout(store, key)) return { key, at };
    const file = levelOf(at) === 'model' ? modelFile(store, at) : files.find((e) => e.vehicle === at);
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

// The file of a model that `from` is, or null.
function fileOfModel(store, model, from) {
  const entry = isCollectionKey(from) ? store.collection?.[from] : null;
  return entry && isModelLevel(entry.vehicle) && modelOf(entry.vehicle) === model ? entry : null;
}

// A preset of yours in the place of a model's file: the model's current place and what its
// vehicles remember that held the file, and the file's hooks that remember nothing yet.
function replaceFile(store, model, file, key) {
  const assignments = { ...store.assignments };
  for (const [scope, k] of memoriesOf(store, model)) if (k === file.key) assignments[scope] = key;
  for (const hook of fileHooks(file)) assignments[`${model}@${hook}`] ??= key;
  if (!assignments[model] || assignments[model] === file.key) assignments[model] = key;
  return addAlternate({ ...store, assignments }, model, key);
}

// What plays in the vehicle, made yours to edit (routeEdit): a shared file of the model becomes
// your copy in its place (copyOf, replaceFile); a model without variants gets its first one, a
// copy of what it inherits, the model's current one. The vehicle's hook remembers it.
function ownVariant(store, truck, from) {
  const model = truck.key;
  const file = fileOfModel(store, model, from);
  const key = freePresetKey(store.presets);
  const preset = { ...structuredClone(presetLayout(store, from)), name: keyPath(store, model, truck), ...(file ? { copyOf: file.key } : {}) };
  let next = { ...store, presets: { ...store.presets, [key]: preset } };
  next = file ? replaceFile(next, model, file, key) : joinModel(next, model, key);
  const hook = chassisKey(truck);
  if (hook && !next.assignments[hook]) next = { ...next, assignments: { ...next.assignments, [hook]: key } };
  return { store: next, key };
}

export function routeEdit(store, selection, truck) {
  if (selection.mode === 'truck') return { store, key: selection.key };
  if (selection.mode === 'scope') {
    // A key of the map: its own preset, else a copy of what it plays becomes its own (a file
    // of the model: in the file's place).
    const { scope } = selection;
    const own = store.assignments[scope];
    if (own && store.presets[own]) return { store, key: own };
    const { key: from } = scopePreset(store, scope, truck);
    const key = freePresetKey(store.presets);
    const file = levelOf(scope) === 'model' ? fileOfModel(store, scope, from) : null;
    const preset = { ...structuredClone(presetLayout(store, from)), name: nameFor(store, scope, truck), ...(file ? { copyOf: file.key } : {}) };
    const next = { ...store, presets: { ...store.presets, [key]: preset } };
    if (file) return { store: replaceFile(next, scope, file, key), key };
    return { store: { ...next, assignments: { ...next.assignments, [scope]: key } }, key };
  }
  if (!truck) return { store, key: allPresetKey(store) };
  const auto = autoPreset(store, truck);
  if (ownsEdits(auto)) return { store, key: auto.key };
  return ownVariant(store, truck, auto?.key ?? allPresetKey(store));
}

export function editLayout(store, selection, truck, edit) {
  const routed = routeEdit(store, selection, truck);
  if (isCollectionKey(routed.key)) return store; // files are never changed: adoptPicked copies first
  const current = routed.store.presets[routed.key];
  if (!current) return store;
  return { ...routed.store, presets: { ...routed.store.presets, [routed.key]: unlabelNew(current, edit(current)) } };
}

// A preset labelled "new" (one the app made: adoptVehicle, newAlternate) loses the label at
// its first edit, so the tree tells what is still untouched; an edit of the label itself, or
// no change, keeps it.
function unlabelNew(before, after) {
  if (before.label !== NEW_LABEL || after.label !== before.label || after.labelColor !== before.labelColor) return after;
  if (JSON.stringify(after) === JSON.stringify(before)) return after;
  const { label, labelColor, ...rest } = after;
  return rest;
}

// Frees a scope; the preset stays. A variant waiting on the key plays next. All vehicles
// always keeps one.
export function unassign(store, scope) {
  if (scope === ALL_SCOPE || !store.assignments[scope]) return store;
  return dropAlternate(store, scope, store.assignments[scope]);
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
  const hooks = fileHooks(entry);
  if (hooks.length) info.chassis = [...new Set([...known.chassis, ...hooks])].sort();
  return { ...store, vehicles: { ...store.vehicles, [model]: info } };
}

const sameLayout = (a, b) => JSON.stringify([a.width, a.bounds, a.speakers]) === JSON.stringify([b.width, b.bounds, b.speakers]);

// The very same preset: the layout and what the tree shows of it (name, label, its colour).
const samePreset = (a, b) => sameLayout(a, b) && a.name === b.name
  && (a.label ?? null) === (b.label ?? null) && (a.labelColor ?? null) === (b.labelColor ?? null);

// Preset files (collection.js entries) made your presets. A file for a model (or a hook of it)
// becomes a variant of the model: its current one when it has none, and what the hooks it names
// remember when they remember nothing yet or are in replace (as the model's current one, for a
// file naming no hook, when the model is in replace). A file for a brand, a game or all vehicles
// goes on that key when no preset of yours is there, or the key is in replace (yours waits as a
// variant); else it waits there. One the very same as a preset of yours (samePreset) is not
// added again: that one is used instead; the same speakers under another name or label make a
// preset of their own. A key that held the file itself ("file:<path>") gets the preset. What a
// file says of its vehicle is kept (learnPlace).
// { store, placed, variants, unused, same }: how many play somewhere new, only wait as variants,
// are among the unused, and were yours already.
export function importPresets(store, entries, replace = new Set()) {
  let next = store;
  const counts = { placed: 0, variants: 0, unused: 0, same: 0 };
  const set = (scope, key) => ({ ...next, assignments: { ...next.assignments, [scope]: key } });
  for (const entry of [...entries].sort((a, b) => ((a.file ?? '') < (b.file ?? '') ? -1 : 1))) {
    let key = Object.keys(next.presets).find((k) => samePreset(next.presets[k], entry.layout));
    if (key) counts.same++;
    else ({ store: next, key } = createPreset(next, entry.layout));
    const scope = entry.vehicle;
    const theirs = (held) => !held || held === key || (entry.key && held === entry.key);
    if (scope && isModelLevel(scope)) {
      const model = modelOf(scope);
      const hadCurrent = Boolean(next.assignments[model]);
      next = joinModel(next, model, key);
      let placed = !hadCurrent;
      for (const hook of fileHooks(entry)) {
        const at = `${model}@${hook}`;
        if (theirs(next.assignments[at]) || replace.has(at)) {
          next = set(at, key);
          placed = true;
        }
      }
      if (!fileHooks(entry).length && replace.has(model)) {
        next = pickAlternate(next, model, key);
        placed = true;
      }
      counts[placed ? 'placed' : 'variants']++;
    } else if (scope) {
      const held = next.assignments[scope];
      if (theirs(held) || replace.has(scope)) {
        next = withWaiting(set(scope, key), scope, waitingOn(next, scope).filter((k) => k !== key));
        if (held && held !== key) next = addAlternate(next, scope, held); // yours waits as a variant
        counts.placed++;
      } else {
        next = addAlternate(next, scope, key);
        counts.variants++;
      }
    } else if (!Object.values(next.assignments).includes(key)) counts.unused++;
    if (entry.key) for (const [s, k] of Object.entries(next.assignments)) if (k === entry.key) next = set(s, key);
    next = learnPlace(next, entry);
  }
  return { store: next, ...counts };
}

// Where an import would meet a preset of yours (importPresets' replace): [{ scope, label, yours,
// theirs }]: a hook the file names, the model for a file naming none, or the brand's, game's or
// all vehicles' key. One holding the very same preset, or the file itself, is no clash.
export function importClashes(store, entries, truck = null) {
  return entries.flatMap((entry) => {
    const scope = entry.vehicle;
    if (!scope) return [];
    const model = isModelLevel(scope) ? modelOf(scope) : null;
    const hooks = model ? fileHooks(entry) : [];
    let at = [scope];
    if (model) at = hooks.length ? hooks.map((h) => `${model}@${h}`) : [model];
    return at.flatMap((s) => {
      const held = store.assignments[s];
      const yours = held && presetLayout(store, held);
      if (!yours || held === entry.key || samePreset(yours, entry.layout)) return [];
      return [{ scope: s, label: scopeLabel(store, s, truck), yours: yours.name, theirs: entry.name }];
    });
  });
}

// A new store's preset for all vehicles: a copy of the default one (presets/default/, a file
// for "all") when there is one. All vehicles always has a preset of yours, so that default
// only starts a new store; the other defaults stay files under your presets.
export function seedAll(store, collection) {
  const entry = Object.values(collection ?? {}).filter((e) => e.default && e.vehicle === ALL_SCOPE).sort((a, b) => (a.key < b.key ? -1 : 1))[0];
  if (!entry) return store;
  return { ...store, presets: { ...store.presets, [store.assignments[ALL_SCOPE]]: structuredClone(entry.layout) } };
}

// 0.1.1 made the shipped presets yours (defaultsImported); they are the bottom layer now.
// Your copies the same as the default on their key (layout, name and label) give way to it,
// so the defaults of a newer build reach those keys; copies you changed stay yours.
export function dropImportedDefaults(store, collection) {
  if (!store.defaultsImported) return store;
  const { defaultsImported: _done, ...next } = store;
  next.assignments = { ...store.assignments };
  const same = (a, b) => sameLayout(a, b) && a.name === b.name && (a.label ?? null) === (b.label ?? null);
  for (const [scope, key] of Object.entries(store.assignments)) {
    const def = Object.values(collection ?? {}).find((e) => e.default && e.vehicle === scope);
    if (scope !== ALL_SCOPE && def && store.presets[key] && same(store.presets[key], def.layout)) delete next.assignments[scope];
  }
  const used = new Set(Object.values(next.assignments));
  next.presets = Object.fromEntries(Object.entries(store.presets).filter(([key]) => used.has(key) || !Object.values(collection ?? {}).some((e) => e.default && same(store.presets[key], e.layout))));
  return next;
}

// A shared file picked in the list is never changed: before the first edit it becomes an
// unassigned copy ("New preset"), chosen instead (one tried with the cab's buttons stays tried).
// A file of a model picked in the tree as one of its variants (selection.variantOf) becomes
// your copy in its place (copyOf, replaceFile). Anything else is left as it is.
export function adoptPicked(store, selection) {
  const entry = selection.mode === 'truck' && isCollectionKey(selection.key) ? store.collection?.[selection.key] : null;
  if (!entry) return { store, selection };
  const model = selection.variantOf && fileOfModel(store, selection.variantOf, entry.key) ? selection.variantOf : null;
  if (model) {
    const key = freePresetKey(store.presets);
    const preset = { ...structuredClone(entry.layout), name: keyPath(store, model), copyOf: entry.key };
    return { store: replaceFile({ ...store, presets: { ...store.presets, [key]: preset } }, model, entry, key), selection: { ...selection, key } };
  }
  const created = createPreset(store, entry.layout);
  return { store: created.store, selection: { ...selection, key: created.key } };
}

// Removes a preset and its scopes. The preset of all vehicles stays: something must play.
export function deletePreset(store, key) {
  if (key === allPresetKey(store) || !store.presets[key]) return store;
  const presets = { ...store.presets };
  delete presets[key];
  const assignments = Object.fromEntries(Object.entries(store.assignments).filter(([, k]) => k !== key));
  let next = { ...store, presets, assignments };
  for (const [scope, keys] of Object.entries(store.alternates ?? {})) next = withWaiting(next, scope, keys.filter((k) => k !== key));
  for (const scope of Object.keys(store.assignments)) next = promoteWaiting(next, scope);
  return next;
}

// Variants on a key (docs/superpowers/specs/2026-10-08-key-variants-design.md): one plays, the
// key's preset; presets of yours wait in store.alternates[scope]; the shared files for the key
// are its variants too, the key's by their vehicle. A model's variants
// (2026-10-10-model-variants-design.md) also take in the files for its hooks, and what its hooks
// remember.
const waitingOn = (store, scope) => store.alternates?.[scope] ?? [];

// The store with scope's waiting variants set; an empty list, and an empty map, left out.
function withWaiting(store, scope, keys) {
  const alternates = { ...(store.alternates ?? {}) };
  if (keys.length) alternates[scope] = keys;
  else delete alternates[scope];
  const { alternates: _, ...rest } = store;
  return Object.keys(alternates).length ? { ...rest, alternates } : rest;
}

// A key that lost the preset it played plays the first variant waiting on it.
function promoteWaiting(store, scope) {
  const [next, ...rest] = waitingOn(store, scope);
  if (store.assignments[scope] || !next) return store;
  return withWaiting({ ...store, assignments: { ...store.assignments, [scope]: next } }, scope, rest);
}

// One of your presets among a model's variants: its current one when it has none, else waiting.
function joinModel(store, model, key) {
  if (!store.presets[key] || store.assignments[model]) return addAlternate(store, model, key);
  return withWaiting({ ...store, assignments: { ...store.assignments, [model]: key } }, model, waitingOn(store, model).filter((k) => k !== key));
}

// Where a model's variant is remembered: { hooks, plates } (a file also on its own hooks that
// remember nothing).
function rememberedAt(store, model, key) {
  const at = memoriesOf(store, model).filter(([, k]) => k === key).map(([s]) => s);
  const file = fileOfModel(store, model, key);
  const free = file ? fileHooks(file).filter((h) => !store.assignments[`${model}@${h}`]) : [];
  return {
    hooks: [...new Set([...at.filter((s) => levelOf(s) === 'chassis').map(hookOf), ...free])].sort(byHook),
    plates: at.filter((s) => levelOf(s) === 'vehicle').map(plateOf).sort(),
  };
}

// Where a variant plays, as the card says it: "hook 2.7 m, hook 3.6 m, WP-1".
const whereText = ({ hooks, plates }) => [...hooks.map((h) => `hook ${h} m`), ...plates].join(', ');

const describe = (store, key) => {
  const layout = presetLayout(store, key);
  const file = isCollectionKey(key);
  return {
    key, name: holderName(store, key), label: layout.label ?? null, labelColor: layout.labelColor ?? 'blue',
    file, default: Boolean(file && store.collection[key].default),
  };
};

// The variants of a key: [{ key, name, label, labelColor, file, default, active }], the one
// that plays first (the key's preset, else its first shared file), then yours waiting, then
// the key's other files: not one with the same speakers as one of yours there (yours is a copy
// of it), nor all vehicles' files, which play only when picked by hand. A model's: its current
// one, yours, then its files (modelFiles), each with where it is remembered ({ hooks, plates }).
export function alternatesOf(store, scope) {
  if (levelOf(scope) === 'model') {
    const files = modelFiles(store, scope);
    const held = store.assignments[scope];
    const playing = held && presetLayout(store, held) ? held : modelFile(store, scope)?.key ?? null;
    const keys = [...new Set([playing, ...ownVariants(store, scope), ...files.map((e) => e.key)])];
    return keys.filter((k) => k && presetLayout(store, k))
      .map((key) => ({ ...describe(store, key), active: key === playing, ...rememberedAt(store, scope, key) }));
  }
  const files = scope === ALL_SCOPE ? [] : sharedFiles(store).filter((e) => e.vehicle === scope);
  const held = store.assignments[scope];
  const playing = held && presetLayout(store, held) ? held : files[0]?.key ?? null;
  const yours = [held, ...waitingOn(store, scope)].filter((k) => k && store.presets[k]).map((k) => store.presets[k]);
  const copied = (e) => e.key !== playing && yours.some((l) => sameLayout(l, e.layout));
  const keys = [...new Set([playing, ...waitingOn(store, scope), ...files.filter((e) => !copied(e)).map((e) => e.key)])];
  return keys.filter((k) => k && presetLayout(store, k)).map((key) => ({ ...describe(store, key), active: key === playing }));
}

// The presets your vehicles of a model have of their own: on a plate, no variant of the model.
// [{ key, name, label, labelColor, file, default, plate }]
export function personalOf(store, model) {
  const variants = new Set(alternatesOf(store, model).map((v) => v.key));
  return memoriesOf(store, model)
    .filter(([s, k]) => levelOf(s) === 'vehicle' && !variants.has(k) && presetLayout(store, k))
    .map(([s, k]) => ({ ...describe(store, k), plate: plateOf(s) }))
    .sort((a, b) => a.plate.localeCompare(b.plate));
}

// Plays one of a key's variants there; the one that played waits (a file needs no place).
export function pickAlternate(store, scope, key) {
  const variants = alternatesOf(store, scope);
  if (!variants.some((v) => v.key === key) || variants.find((v) => v.active)?.key === key) return store;
  const held = store.assignments[scope];
  const waiting = waitingOn(store, scope).filter((k) => k !== key);
  if (held && !isCollectionKey(held)) waiting.unshift(held);
  return withWaiting({ ...store, assignments: { ...store.assignments, [scope]: key } }, scope, waiting);
}

// One of your presets waiting on a key as a variant (not the one that plays, not twice).
export function addAlternate(store, scope, key) {
  if (!store.presets[key] || store.assignments[scope] === key || waitingOn(store, scope).includes(key)) return store;
  return withWaiting(store, scope, [...waitingOn(store, scope), key]);
}

// A variant taken off a key: one waiting just leaves; the one that plays leaves and the next
// waiting one plays (all vehicles keeps its last). The preset stays. Off a model, its hooks and
// vehicles forget it too; a shared file of the model is hidden from its variants
// (store.hiddenFiles), as it cannot leave its folder.
export function dropAlternate(store, scope, key) {
  let next = store;
  if (levelOf(scope) === 'model') {
    const forgotten = memoriesOf(store, scope).filter(([, k]) => k === key);
    if (forgotten.length) {
      const assignments = { ...store.assignments };
      for (const [s] of forgotten) delete assignments[s];
      next = { ...store, assignments };
    }
    if (fileOfModel(store, scope, key)) {
      const hidden = [...new Set([...(store.hiddenFiles?.[scope] ?? []), key])];
      next = { ...next, hiddenFiles: { ...store.hiddenFiles, [scope]: hidden } };
    }
  }
  const waiting = waitingOn(next, scope);
  if (waiting.includes(key)) return withWaiting(next, scope, waiting.filter((k) => k !== key));
  if (next.assignments[scope] !== key || (scope === ALL_SCOPE && !waiting.length)) return next;
  const assignments = { ...next.assignments };
  delete assignments[scope];
  return promoteWaiting({ ...next, assignments }, scope);
}

// Presets on chassis keys (before a model's variants) become variants of their model: the first
// by hook its current one when it had none, the others waiting; the chassis keys stay, as what
// the hooks remember. Variants waiting on a chassis key move to the model. The same store when
// there is nothing to fold.
export function foldChassis(store) {
  const chassis = [...new Set([...Object.keys(store.assignments), ...Object.keys(store.alternates ?? {})])]
    .filter((s) => levelOf(s) === 'chassis')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let next = store;
  for (const scope of chassis) {
    const model = modelOf(scope);
    const keys = [next.assignments[scope], ...waitingOn(next, scope)].filter((k) => k && next.presets[k]);
    if (waitingOn(next, scope).length) next = withWaiting(next, scope, []);
    for (const key of keys) next = joinModel(next, model, key);
  }
  return next;
}

// A new variant on a key: a copy of `from` (what plays now, the menu's "copy current"), else of
// what the key plays (or inherits), named by the key and labelled "new"; it plays, the one that
// played waits. On the model of the vehicle in the game it plays there (chooseVariant).
export function newAlternate(store, scope, truck = null, from = null) {
  const layout = presetLayout(store, from ?? scopePreset(store, scope, truck).key);
  const key = freePresetKey(store.presets);
  const preset = { ...structuredClone(layout), name: keyPath(store, scope, truck), label: NEW_LABEL, labelColor: 'green' };
  const held = store.assignments[scope];
  const waiting = held && !isCollectionKey(held) ? [held, ...waitingOn(store, scope)] : waitingOn(store, scope);
  const next = withWaiting({ ...store, presets: { ...store.presets, [key]: preset }, assignments: { ...store.assignments, [scope]: key } }, scope, waiting);
  return truck?.key === scope ? chooseVariant(next, truck, key) : next;
}

// A variant as the card and the tree's menu name it: its label, else its name; a file says so,
// and a vehicle's own preset its plate.
export const variantLabel = (v) => `${v.label || v.name}${v.default ? ' (default)' : v.file ? ' (shared file)' : ''}${v.plate ? ` (${v.plate} only)` : ''}`;

// Your own vehicle's key (a plate, not a quick job), where its choice of a variant goes.
const ownPlate = (truck) => (truck?.plate && !truck.quickJob ? plateKey(truck) : null);

// The card's choice of the model's variants, and your vehicle's own preset:
// { scope, value, options: [{ value, label }] }, or null under two, or when what plays is none
// of them.
export function variantChoice(store, truck) {
  if (!truck) return null;
  const plate = ownPlate(truck);
  const own = personalOf(store, truck.key).filter((p) => `${truck.key}#${p.plate}` === plate);
  const options = [...alternatesOf(store, truck.key), ...own];
  const plays = autoPreset(store, truck)?.key;
  if (options.length < 2 || !options.some((v) => v.key === plays)) return null;
  return { scope: truck.key, value: plays, options: options.map((v) => ({ value: v.key, label: variantLabel(v) })) };
}

// A variant picked for the vehicle in the game (the card, the tree): your own vehicle remembers
// it by its plate, any other its hook; a variant of the model becomes its current one, which a
// hook new to you plays. The vehicle's own preset stays its own.
export function chooseVariant(store, truck, key) {
  const plate = ownPlate(truck);
  const memory = plate ?? chassisKey(truck);
  const next = memory ? { ...store, assignments: { ...store.assignments, [memory]: key } } : store;
  return pickAlternate(next, truck.key, key);
}

// The cab's buttons (2026-10-10-controls-voice-design.md): the variant `step` (1 next, -1
// previous) from `from` among the model's variants (alternatesOf: yours and its files, not a
// vehicle's own preset): { key, index, count, label }. From one that is none of them: the first
// (or the last). Null without a vehicle or a variant.
export function cycleVariant(store, truck, from, step) {
  if (!truck) return null;
  const variants = alternatesOf(store, truck.key);
  if (!variants.length) return null;
  const at = variants.findIndex((v) => v.key === from);
  let index = (at + step + variants.length) % variants.length;
  if (at < 0) index = step > 0 ? 0 : variants.length - 1;
  return { key: variants[index].key, index, count: variants.length, label: variants[index].label };
}

export const NEW_LABEL = 'new';

// The vehicle in the game, seen (app.js, on every vehicle change):
// - a model new to the app (no variant of yours, no file for it, no vehicle of it remembering
//   anything) gets its first variant: a copy of what it would inherit, the brand's, the game's
//   or all vehicles' preset, which serve as templates; named after the model and labelled
//   "new" until you give it a label of your own. Its hook remembers it;
// - a hook new to you remembers what it plays from the model (its current variant or a file),
//   so a variant picked later on another hook does not move it. A file for that very hook plays
//   without a memory, as do your vehicles that remember something.
// The same store when nothing is new.
export function adoptVehicle(store, truck) {
  if (!truck) return store;
  const auto = autoPreset(store, truck);
  const hook = chassisKey(truck);
  if (!auto || !MODEL_HOWS.has(auto.how)) {
    const { layout } = resolvePlaying(store, { mode: 'auto' }, truck);
    const key = freePresetKey(store.presets);
    const preset = { ...structuredClone(layout), name: keyPath(store, truck.key, truck), label: NEW_LABEL, labelColor: 'green' };
    return {
      ...store,
      presets: { ...store.presets, [key]: preset },
      assignments: { ...store.assignments, [truck.key]: key, ...(hook ? { [hook]: key } : {}) },
    };
  }
  if (hook && !store.assignments[hook] && ['model', 'collectionModel', 'collectionSibling'].includes(auto.how)) {
    return { ...store, assignments: { ...store.assignments, [hook]: auto.key } };
  }
  return store;
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

// A model's name: what the game said, else a shared file's vehicleName, else the name of your
// preset for the model (the last part when it is a key's path, as the app names copies: else
// the path would grow with each copy), else its id made readable ("vehicle.peterbilt.389" ->
// "peterbilt 389"). The game gives some models of a brand one name (Freightliner Cascadia 2019
// and 2024 are both "Freightliner Cascadia"; ETS2's Iveco Stralis and Stralis Hi-Way both "Iveco
// Stralis"): such twins get a tag (twinTag), unless the name ends with it already.
function modelName(store, model, truck) {
  const name = givenName(store, model, truck);
  const place = placeOf(store, model, truck);
  const twin = knownModels(store, truck).some((other) => {
    if (other === model || brandIdOf(other) !== brandIdOf(model)) return false;
    const { game } = placeOf(store, other, truck);
    return (!game || !place.game || game === place.game) && givenName(store, other, truck) === name;
  });
  if (!twin) return name;
  const tag = twinTag(model);
  return name.toLowerCase().endsWith(tag.toLowerCase()) ? name : `${name} ${tag}`;
}

// A twin's tag: the year in its id, else the id's last part as the game would write it
// ("vehicle.iveco.hiway" -> "Hi-Way"), else with a capital.
const TAG_NAMES = { hiway: 'Hi-Way' };
function twinTag(model) {
  const year = model.match(/(\d{4})$/)?.[1];
  if (year) return year;
  const tail = model.slice(model.lastIndexOf('.') + 1);
  return TAG_NAMES[tail] ?? tail.charAt(0).toUpperCase() + tail.slice(1);
}

function givenName(store, model, truck) {
  if (truck?.key === model && truck.name) return truck.name;
  if (store.vehicles?.[model]?.name) return store.vehicles[model].name;
  const file = Object.values(store.collection ?? {}).find((e) => e.vehicle && modelOf(e.vehicle) === model && e.vehicleName);
  if (file) return file.vehicleName;
  const own = store.presets[store.assignments[model]]?.name;
  return own ? own.split(' › ').at(-1) : readableId(model);
}

// The models the store knows: driven, with a key, or with a shared file; and the one in the game.
function knownModels(store, truck) {
  const scopes = [...Object.keys(store.vehicles ?? {}), ...Object.keys(store.assignments), ...Object.values(store.collection ?? {}).map((e) => e.vehicle)];
  const models = scopes.filter((s) => s && s !== ALL_SCOPE && !s.startsWith('game:') && !s.startsWith('brand:')).map(modelOf);
  return [...new Set(truck ? [...models, truck.key] : models)];
}

const brandIdOf = (model) => model.split('.')[1] ?? '';
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

// A preset as people read it: its name and label, then where it applies when the name does not
// say it ("Default layout — all vehicles", "Long nose · studio — Peterbilt 389 +1").
function displayName(store, key, truck = null) {
  if (isCollectionKey(key)) return collectionLabel(store.collection[key]);
  const { name, label } = store.presets[key];
  const named = label ? `${name} · ${label}` : name;
  const scopes = scopesOf(store, key);
  if (!scopes.length) return named;
  const where = scopeLabel(store, scopes[0], truck);
  const more = scopes.length > 1 ? ` +${scopes.length - 1}` : '';
  // A name that is the key's path (or the older "Model, hook 2.7 m") says where it applies.
  const said = name === where || name === keyPath(store, scopes[0], truck);
  return said ? `${named}${more}` : `${named} — ${where}${more}`;
}

// What a preset picked in the list applies to by itself.
function scopeOfKey(store, key, truck) {
  if (isCollectionKey(key)) {
    const { vehicle } = store.collection[key];
    if (!vehicle) return 'only where it is chosen';
    if (!isModelLevel(vehicle)) return scopeLabel(store, vehicle, truck);
    const name = modelName(store, modelOf(vehicle), truck);
    const hooks = fileHooks(store.collection[key]);
    return hooks.length ? `${name}, a variant for hook ${hooks.join(', ')} m` : `${name}, a variant`;
  }
  const scopes = scopesOf(store, key);
  if (!scopes.length) return 'only where it is chosen';
  return scopes.map((s) => (s === ALL_SCOPE ? EVERY : scopeLabel(store, s, truck))).join('; ');
}

const EVERY = 'every vehicle without its own preset';
// Picking a key or a preset stops following the vehicle in the game; this goes back.
const BACK_TO_AUTO = { action: 'auto', label: 'Back to Auto' };

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

// The other preset at `to` that putting `key` there takes it from: { key, name, keeps } (keeps:
// it still shows elsewhere, or it is a file), or null. A model takes a variant more, nothing
// is taken there.
function takenAt(store, to, key) {
  const holder = levelOf(to) === 'model' ? null : store.assignments[to];
  if (!holder || holder === key) return null;
  return { key: holder, name: holderName(store, holder), keeps: isCollectionKey(holder) || scopesOf(store, holder).some((s) => s !== to) };
}

// Moving your preset `key` (by default the one on `from`) from one key of the map to another: up
// its chain, down to a key whose chain passes through it, or across to any other (dragging). A
// plan as planScope gives (mode 'move'; direction 'up', 'down' or 'across'), or null.
export function planMove(store, from, to, truck = null, key = store.assignments[from]) {
  if (!key || isCollectionKey(key) || from === to) return null;
  if (to.startsWith('?')) return null; // a folder, no scope
  const up = chainOf(store, from, truck);
  const down = chainOf(store, to, truck);
  let direction = 'across';
  if (up.includes(to)) direction = 'up';
  else if (down.includes(from)) direction = 'down';
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
  return { mode: 'move', key, from, to, direction, mustCopy: from === ALL_SCOPE, taken: takenAt(store, to, key), shadow, fallback, outplayed: null };
}

// A vehicle's scopes for the card, narrowest first: { level, scope, label, holder } where
// holder is what plays from there in this vehicle: your vehicle's preset (its own or a variant
// it remembers), the model's variant (by the hook, a file, the current one), or the key's
// preset; null when none. "This vehicle" only for a plate of your own (a quick job's is random).
export function scopeLadder(store, truck) {
  const brand = brandKey(truck);
  const game = gameKey(truck);
  const name = modelName(store, truck.key, truck);
  const fromModel = autoPreset(store, { ...truck, plate: null });
  const holder = (level, scope) => {
    if (level === 'model') return fromModel && MODEL_HOWS.has(fromModel.how) ? fromModel.key : null;
    return store.assignments[scope] ?? null;
  };
  return [
    ownPlate(truck) && ['vehicle', plateKey(truck), `this vehicle (${truck.plate})`],
    ['model', truck.key, name],
    brand && ['brand', brand, scopeLabel(store, brand, truck)],
    game && ['game', game, scopeLabel(store, game, truck)],
    ['all', ALL_SCOPE, 'all vehicles'],
  ].filter(Boolean).map(([level, scope, label]) => ({ level, scope, label, holder: holder(level, scope) }));
}

// Where the preset that plays in Auto sits on this vehicle's ladder, or null (a shared file,
// or a preset picked in the list): your vehicle for its own preset, the model for a variant of
// yours (whoever remembers it), the brand, the game or all vehicles.
export function currentScope(store, selection, truck) {
  if (selection.mode !== 'auto' || !truck) return null;
  const auto = autoPreset(store, truck);
  if (!auto || isCollectionKey(auto.key)) return null;
  if (auto.how === 'vehicle') return ownVariants(store, truck.key).includes(auto.key) ? truck.key : auto.scope;
  if (auto.how === 'chassis' || auto.how === 'model') return truck.key;
  return ['brand', 'game', 'all'].includes(auto.how) ? auto.scope : null;
}

const holderName = (store, key) => (isCollectionKey(key) ? store.collection?.[key]?.name ?? key : store.presets[key]?.name ?? key);

// What putting the preset that plays at the scope `to` means, for the card's dialogs:
//   mode       'move' (Auto, from its scope on this ladder), 'copy' (Auto, from a file: a copy
//              takes `to`), 'use' (a preset picked in the list: it gets `to` as well)
//   direction  'up' | 'down' for a move
//   mustCopy   moving away from all vehicles leaves a copy there instead (something must play)
//   taken      { key, name, keeps } the other preset at `to`, which loses it (keeps: it still
//              applies elsewhere, or it is a file); never on a model, which takes a variant more
//   shadow     [{ scope, label, name }] narrower scopes of this vehicle with other presets,
//              which would keep playing here (a model: all its variants of yours)
//   fallback   for a move down: { label, name } what plays from then on where it was
//   outplayed  { name, file } what would still play in this vehicle, narrower than `to`, with
//              the shadow cleared: a shared file of the model (files are never unassigned), or
//              another variant of it, or null
// Null when nothing would change.
export function planScope(store, selection, truck, to) {
  if (!truck) return null;
  const ladder = scopeLadder(store, truck);
  const index = (scope) => ladder.findIndex((r) => r.scope === scope);
  if (index(to) < 0) return null;
  const { key } = resolvePlaying(store, selection, truck);
  const from = currentScope(store, selection, truck);
  if (from === to || (selection.mode !== 'auto' && ladder[index(to)].holder === key)) return null;
  let mode = 'copy';
  if (selection.mode !== 'auto') mode = 'use';
  else if (from) mode = 'move';
  const direction = mode === 'move' ? (index(to) > index(from) ? 'up' : 'down') : null;
  // What keeps playing on the narrower rungs: your vehicle's preset, the model's variants of
  // yours (a model cleared loses them all, so all are named; the one moved off it is not).
  const others = (r) => {
    if (r.level === 'model') return ownVariants(store, r.scope).filter((k) => k !== key);
    return r.holder && r.holder !== key && !(mode === 'move' && r.scope === from) ? [r.holder] : [];
  };
  const shadow = ladder.slice(0, index(to)).filter((r) => others(r).length)
    .map((r) => ({ scope: r.scope, label: r.label, name: others(r).map((k) => holderName(store, k)).join('", "') }));
  let fallback = null;
  if (direction === 'down') {
    const wider = ladder.slice(index(from) + 1).find((r) => r.holder && r.holder !== key);
    fallback = wider ? { label: wider.label, name: holderName(store, wider.holder) } : null;
  }
  const plan = { mode, key, from, to, direction, mustCopy: mode === 'move' && from === ALL_SCOPE, taken: takenAt(store, to, key), shadow, fallback, outplayed: null };
  const after = applyScope(store, plan, truck, { clear: shadow.map((s) => s.scope) });
  const plays = autoPreset(after, truck);
  if (plays && plays.key !== after.assignments[to]) {
    plan.outplayed = { name: holderName(after, plays.key), file: isCollectionKey(plays.key) };
  }
  return plan;
}

// A key cleared for a wider one to play here (planScope's shadow): a model loses its variants
// of yours (they stay presets) and what its hooks remember; any other key its preset.
function clearScope(store, scope) {
  if (levelOf(scope) !== 'model') return unassign(store, scope);
  const assignments = { ...store.assignments };
  for (const [s] of memoriesOf(store, scope)) if (levelOf(s) === 'chassis') delete assignments[s];
  if (isCollectionKey(assignments[scope])) delete assignments[scope];
  let next = { ...store, assignments };
  for (const key of ownVariants(next, scope)) next = dropAlternate(next, scope, key);
  return next;
}

// A preset of yours put on a key: on a model a variant, its current one, which the vehicle in
// the game plays when it is of that model (by its plate, or its hook when its plate keeps a
// preset of its own); on any other key its preset, the one there waiting as a variant when
// asked (variant; your vehicle's own is let go).
function putOn(store, to, key, truck, variant) {
  if (levelOf(to) === 'model') {
    let next = pickAlternate(joinModel(store, to, key), to, key);
    if (truck?.key === to) {
      const plate = ownPlate(truck);
      const kept = plate && next.assignments[plate];
      const own = kept && !isCollectionKey(kept) && !ownVariants(next, to).includes(kept);
      const memory = plate && !own ? plate : chassisKey(truck);
      if (memory) next = { ...next, assignments: { ...next.assignments, [memory]: key } };
    }
    return next;
  }
  const held = store.assignments[to];
  let next = withWaiting({ ...store, assignments: { ...store.assignments, [to]: key } }, to, waitingOn(store, to).filter((k) => k !== key));
  if (variant && held && held !== key && levelOf(to) !== 'vehicle') next = addAlternate(next, to, held); // "Add as a variant"
  return next;
}

// Carries out a plan (planScope, planMove, planAssign): copy (a move down kept where it was, or
// anything from a file or all vehicles) puts a copy at `to`; a move takes it off `from` (off a
// model with what its vehicles remember of it); clear frees those narrower scopes. Presets that
// lose a scope stay.
export function applyScope(store, plan, truck, { copy = false, clear = [], variant = false } = {}) {
  let next = store;
  let key = plan.key;
  if (plan.mode === 'copy' || plan.mustCopy || copy || isCollectionKey(key)) {
    const layout = presetLayout(store, key);
    key = freePresetKey(store.presets);
    next = { ...next, presets: { ...next.presets, [key]: { ...structuredClone(layout), name: nameFor(store, plan.to, truck) } } };
  }
  if (plan.mode === 'move' && key === plan.key && plan.from && plan.from !== ALL_SCOPE) next = dropAlternate(next, plan.from, key);
  for (const scope of clear) if (scope !== ALL_SCOPE) next = clearScope(next, scope);
  return putOn(next, plan.to, key, truck, variant);
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
    truck: truck ? [modelName(store, truck.key, truck), truck.variant && `hook ${truck.variant} m`, truck.plate].filter(Boolean).join(' · ') : 'no vehicle in the game',
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
    if (!own && at === selection.scope) note = `A shared file of ${label}: editing makes your own copy in its place first.`;
    else if (!own) note = `It inherits this from ${scopeLabel(store, at, truck)}: editing gives ${label} a preset of its own first.`;
    return { ...base, plays: `${base.plays} (key picked in the map)`, appliesTo: selection.scope === ALL_SCOPE ? EVERY : label, note, buttons: [BACK_TO_AUTO] };
  }

  if (selection.mode !== 'auto') {
    const file = playing.kind === 'collection' ? store.collection[playing.key].file : null;
    // A variant tried with the cab's buttons (app.js controlAction) stays the cab's on getting out.
    const tried = selection.cycled ? 'Tried with the controls: this cab keeps it when you get out, unless Auto goes back first.' : '';
    // A variant picked in the tree (selection.variantOf): edits go to it wherever it plays; a
    // file of the model becomes your copy in its place.
    const where = selection.variantOf ? whereText(rememberedAt(store, selection.variantOf, playing.key)) : '';
    let edits = file ? `From the collection: ${file}. Editing makes your own copy first.` : 'Editing changes this preset.';
    if (selection.variantOf) edits = file ? `From the collection: ${file}. Editing makes your own copy in its place first.` : `Editing changes this variant${where ? `, which plays on ${where}` : ''}.`;
    let picked = 'picked in the list';
    if (selection.cycled) picked = 'tried with the controls';
    else if (selection.variantOf) picked = 'a variant picked in the map';
    return {
      ...base,
      plays: `${base.plays} (${picked})`,
      appliesTo: scopeOfKey(store, playing.key, truck),
      note: note(tried, edits, truck && lent),
      useIn: truck ? { options: [{ value: '', label: 'Use it in…' }, ...rungOptions(playing.key)] } : null,
      buttons: [BACK_TO_AUTO],
    };
  }
  if (!truck) return base;
  const auto = autoPreset(store, truck);
  const from = currentScope(store, selection, truck);
  const name = modelName(store, truck.key, truck);
  const appliesTo = from
    ? scopeLadder(store, truck).find((r) => r.scope === from).label
    : `${MODEL_HOWS.has(auto?.how) ? name : scopeLabel(store, auto.scope, truck)}, from the collection`;
  const scope = from
    ? { value: from, options: rungOptions(playing.key) }
    : { value: '', options: [{ value: '', label: appliesTo }, ...rungOptions(playing.key)] };
  const file = isCollectionKey(auto.key) ? store.collection[auto.key].file : null;
  let editNote = null;
  if (file && MODEL_HOWS.has(auto.how)) editNote = `From the collection: ${file}. Editing makes it your own variant of ${name} first.`;
  else if (file) editNote = `From the collection: ${file}. Editing makes a variant of ${name} first.`;
  else if (!ownsEdits(auto)) editNote = `Editing makes a variant of ${name} first.`;
  else if (from === truck.key) {
    // Edits go to the variant, wherever else it plays.
    const { hooks, plates } = rememberedAt(store, truck.key, auto.key);
    const elsewhere = [...hooks.filter((h) => h !== truck.variant).map((h) => `hook ${h} m`), ...plates.filter((p) => p !== truck.plate)];
    if (elsewhere.length) editNote = `Edits also change it on ${elsewhere.join(', ')}.`;
  }
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
  model: () => '',
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
    const note = isCollectionKey(playing?.key) && store.collection[playing.key].default ? ' (default)' : AUTO_NOTE[playing?.how]?.(truck);
    auto = playing ? `Auto — ${displayName(store, playing.key, truck)}${note}` : 'Auto';
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

const MAP_ORDER = ['game', 'brand', 'model'];

// The preset map, laid out like registry keys: all vehicles > game > brand > model. Every model
// you have driven gets its key; so do keys that hold a preset or a shared file (a model also for
// its hooks' files and what its hooks and vehicles remember), and the vehicle in the game.
// A model whose game is not known yet (not driven since presets got scopes) sits under
// "Game not known yet (drive a vehicle once)"; that folder is no scope (pseudo).
// Node: { scope, label, pseudo, level, own, alternates, inherited, current, plays, picked, children }
//   own        { key, name, file, default, label, labelColor } the preset or file at this key
//              (default: a file of presets/default/), or null; on a model the variant that
//              plays in the vehicle in the game (other models: their current one), with where it
//              is remembered ({ hooks, plates })
//   alternates the key's other variants (alternatesOf), on a model also your vehicles' own
//              presets (personalOf: with their plate)
//   inherited  { key, name, from } what a key without its own falls back to, and the key it is from
//   current    on the chain of the vehicle in the game; plays: the key whose preset plays in
//              Auto; picked: the key picked in the map (selection mode 'scope')
// Also gives the unassigned presets and the files that apply nowhere.
export function presetTree(store, truck, selection = { mode: 'auto' }) {
  const files = sharedFiles(store);
  const auto = truck && selection.mode === 'auto' ? autoPreset(store, truck) : null;
  const fromModel = auto && MODEL_HOWS.has(auto.how);
  const variantsAt = (scope) => {
    if (levelOf(scope) !== 'model') return alternatesOf(store, scope);
    const list = [...alternatesOf(store, scope), ...personalOf(store, scope)];
    // The model in the game shows what plays in it.
    if (!fromModel || truck.key !== scope || !list.some((v) => v.key === auto.key)) return list;
    return list.map((v) => ({ ...v, active: v.key === auto.key }));
  };
  // Every key to show: the models driven, keys with presets or files (a hook's or a vehicle's
  // on its model), and the vehicle in the game.
  const mapScope = (s) => (isMemory(s) ? modelOf(s) : s);
  const scopes = new Set([ALL_SCOPE, ...Object.keys(store.assignments).map(mapScope), ...Object.keys(store.alternates ?? {}).map(mapScope), ...files.map((e) => mapScope(e.vehicle))]);
  for (const model of Object.keys(store.vehicles ?? {})) scopes.add(model);
  const ladder = truck ? scopeLadder(store, truck) : [];
  for (const r of ladder) if (r.level !== 'vehicle') scopes.add(r.scope);
  const chain = new Set(truck ? ladder.map((r) => r.scope) : [ALL_SCOPE]);
  const playsAt = auto ? (fromModel ? truck.key : auto.scope) : null;

  const nodes = new Map();
  const node = (scope, label, parent) => {
    if (!nodes.has(scope)) {
      const pseudo = scope.startsWith('?');
      // A variant picked in the tree (selection.variantOf) is marked on its row.
      const variants = pseudo ? [] : variantsAt(scope)
        .map((v) => ({ ...v, picked: selection.mode === 'truck' && selection.variantOf === scope && selection.key === v.key }));
      const shown = variants.find((v) => v.active);
      nodes.set(scope, {
        scope, label, pseudo, level: pseudo ? null : levelOf(scope), own: shown ?? null, alternates: variants.filter((v) => v !== shown),
        inherited: null, current: chain.has(scope), plays: scope === playsAt,
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
  }
  for (const n of nodes.values()) {
    if (n.parent) n.parent.children.push(n);
  }
  const finish = (n, inherited) => {
    n.inherited = n.own ? null : inherited;
    n.children.sort((a, b) => MAP_ORDER.indexOf(levelOf(a.scope)) - MAP_ORDER.indexOf(levelOf(b.scope))
      || Number(a.pseudo) - Number(b.pseudo) || a.label.localeCompare(b.label));
    const passOn = n.own ? { key: n.own.key, name: n.own.name, from: n.label } : inherited;
    for (const c of n.children) finish(c, passOn);
    delete n.parent;
    return n;
  };
  const used = new Set([...Object.values(store.assignments), ...Object.values(store.alternates ?? {}).flat()]);
  return {
    root: finish(root, null),
    unassigned: Object.keys(store.presets).filter((k) => !used.has(k))
      .map((key) => ({ key, name: store.presets[key].name, label: store.presets[key].label ?? null, labelColor: store.presets[key].labelColor ?? 'blue' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: Object.values(store.collection ?? {}).filter((e) => !e.vehicle && !used.has(e.key))
      .map((e) => ({ key: e.key, name: collectionLabel(e), default: Boolean(e.default), label: e.layout.label ?? null, labelColor: e.layout.labelColor ?? 'blue' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Puts one of your presets (or a file) at a key of the map, as "Use it in" does on the card: on
// a model a variant, its current one. A plan for applyScope (mode 'use'), or null when it is
// there already.
export function planAssign(store, key, to) {
  if (store.assignments[to] === key || to.startsWith('?')) return null;
  return { mode: 'use', key, from: null, to, direction: null, mustCopy: false, taken: takenAt(store, to, key), shadow: [], fallback: null, outplayed: null };
}

// What a preset at a key is shared for: { vehicle, hooks }. A model's variant goes for the hooks
// remembering it (those of your vehicles remembering it too, so the plates stay private), the
// first one in vehicle, else for the model; a brand's, a game's or all vehicles' for that key;
// one on no key (scope null) for no vehicle.
function shareOf(store, scope, key, truck) {
  if (!scope || scope.startsWith('?')) return { vehicle: null, hooks: [] };
  if (!isModelLevel(scope)) return { vehicle: scope, hooks: [] };
  const model = modelOf(scope);
  const { hooks, plates } = rememberedAt(store, model, key);
  const plateHooks = plates.map((p) => plateChassis(store, `${model}#${p}`, truck)).filter(Boolean).map(hookOf);
  const all = [...new Set([...hooks, ...plateHooks])].sort(byHook);
  return { vehicle: all.length ? `${model}@${all[0]}` : model, hooks: all };
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
  // The game's name, not the year modelName gives twins: the app tells them apart itself.
  const name = givenName(store, modelOf(vehicle), truck);
  return {
    vehicleName: name !== readableId(modelOf(vehicle)) ? name : null, // an id is no name
    game,
    brand: game && brand,
    brandName: game && brand ? brandName(store, game, brand, truck) : null,
  };
}

// The presets ticked in the export window as files to share (collection.js). picks:
// [{ scope, key }], a preset of yours or a shared file and the key it is on (null: on none),
// each going for that key (shareOf). { files: [{ fileName, data }], plates }: plates, how many
// vehicles' own presets go for their hook.
export function exportFiles(store, picks, truck = null) {
  const files = [];
  let plates = 0;
  for (const { scope, key } of picks) {
    const layout = presetLayout(store, key);
    if (!layout) continue;
    const { vehicle, hooks } = shareOf(store, scope, key, truck);
    if (scope && isModelLevel(scope) && personalOf(store, modelOf(scope)).some((p) => p.key === key)) plates++;
    const place = vehicle && vehicle !== ALL_SCOPE ? placeOfScope(store, vehicle, truck) : {};
    const author = isCollectionKey(key) ? store.collection[key].author : null;
    files.push({
      fileName: presetFileName(layout.name),
      data: presetFile({ name: layout.name, vehicle, hooks, author, ...place, layout }),
    });
  }
  return { files, plates };
}

export function selectionValue(selection) {
  if (selection.mode === 'scope') return `scope:${selection.scope}`;
  return selection.mode === 'truck' ? `truck:${selection.key}` : 'auto';
}

export function parseSelection(value) {
  if (value.startsWith('scope:')) return { mode: 'scope', scope: value.slice('scope:'.length) };
  return value.startsWith('truck:') ? { mode: 'truck', key: value.slice('truck:'.length) } : { mode: 'auto' };
}
