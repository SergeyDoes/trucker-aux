// Which layout plays and which one an edit goes to.
// Selection: { mode: 'auto' } | { mode: 'default' } | { mode: 'truck', key }.
// Truck: { key, variant, plate, quickJob, name, centerX } from telemetry, or null.
// Layouts are measured from the truck's axis, so one layout fits every truck.
//
// A preset applies to a scope; Auto plays the narrowest one that exists:
//   this truck    "<truck id>#<plate>", or a preset bound to the plate by hand;
//   this chassis  "<truck id>@<fifth wheel>", or a preset bound to the chassis by hand;
//   the model     "<truck id>": all its chassis;
//   then another chassis of the model, then the default layout.
// The game reports neither the cab nor the chassis; the fifth wheel sits further back
// on a longer chassis, so its position (to 10 cm) names the chassis (telemetry.js).
import { uniqueName } from './layout.js';

export function variantKey(truck) {
  return truck.variant ? `${truck.key}@${truck.variant}` : truck.key;
}

export function plateKey(truck) {
  return truck.plate ? `${truck.key}#${truck.plate}` : null;
}

// The preset Auto plays in a truck and its scope: truckBound, truck, chassisBound,
// chassis, model, sibling (another chassis). Null: the default layout.
export function autoPreset(store, truck) {
  const boundTo = (key) => {
    const target = key && store.assignments?.[key];
    return target && store.trucks[target] ? target : null;
  };
  const plate = plateKey(truck);
  const chassis = variantKey(truck);
  if (boundTo(plate)) return { key: boundTo(plate), how: 'truckBound' };
  if (plate && store.trucks[plate]) return { key: plate, how: 'truck' };
  if (boundTo(chassis)) return { key: boundTo(chassis), how: 'chassisBound' };
  if (truck.variant && store.trucks[chassis]) return { key: chassis, how: 'chassis' };
  if (store.trucks[truck.key]) return { key: truck.key, how: 'model' };
  const sibling = Object.keys(store.trucks).sort().find((key) => key.startsWith(`${truck.key}@`));
  return sibling ? { key: sibling, how: 'sibling' } : null;
}

// Whether Auto's edits go to what plays. A chassis playing the model's preset (shared by
// all chassis), another chassis's or the default first gets its own copy.
function ownsEdits(auto, truck) {
  if (!auto || auto.how === 'sibling') return false;
  return auto.how !== 'model' || !truck.variant;
}

export function resolvePlaying(store, selection, truck) {
  if (selection.mode === 'truck' && store.trucks[selection.key]) {
    return { kind: 'truck', key: selection.key, layout: store.trucks[selection.key] };
  }
  const auto = selection.mode === 'auto' && truck ? autoPreset(store, truck) : null;
  if (auto) return { kind: 'truck', key: auto.key, layout: store.trucks[auto.key] };
  return { kind: 'default', key: null, layout: store.default };
}

// A copy of what plays as this chassis's preset (or the model's, without chassis
// variants), or as this truck's; nothing happens when it exists already.
export function ownPreset(store, truck, scope = 'chassis') {
  const key = scope === 'truck' ? plateKey(truck) : variantKey(truck);
  if (!key || store.trucks[key]) return store;
  let name = truck.name;
  if (scope === 'truck') name = `${truck.name}, ${truck.plate}`;
  else if (truck.variant) name = `${truck.name}, hook ${truck.variant} m`;
  const preset = { ...structuredClone(resolvePlaying(store, { mode: 'auto' }, truck).layout), name };
  const assignments = { ...(store.assignments ?? {}) };
  delete assignments[key];
  return { ...store, trucks: { ...store.trucks, [key]: preset }, assignments };
}

export function routeEdit(store, selection, truck) {
  if (selection.mode === 'default') return { store, target: { kind: 'default', key: null } };
  if (selection.mode === 'truck') return { store, target: { kind: 'truck', key: selection.key } };
  if (!truck) return { store, target: { kind: 'default', key: null } };
  const auto = autoPreset(store, truck);
  if (ownsEdits(auto, truck)) return { store, target: { kind: 'truck', key: auto.key } };
  return { store: ownPreset(store, truck, 'chassis'), target: { kind: 'truck', key: variantKey(truck) } };
}

export function editLayout(store, selection, truck, edit) {
  const routed = routeEdit(store, selection, truck);
  const { key, kind } = routed.target;
  const current = kind === 'truck' ? routed.store.trucks[key] : routed.store.default;
  const next = edit(current);
  return kind === 'truck'
    ? { ...routed.store, trucks: { ...routed.store.trucks, [key]: next } }
    : { ...routed.store, default: next };
}

// Auto plays `key` in this truck (by plate) or on this chassis from now on.
export function bindPreset(store, truck, scope, key) {
  const where = scope === 'truck' ? plateKey(truck) : variantKey(truck);
  return where ? { ...store, assignments: { ...(store.assignments ?? {}), [where]: key } } : store;
}

// Forgets the narrowest binding: this truck's, else this chassis's.
export function unbind(store, truck) {
  const assignments = { ...(store.assignments ?? {}) };
  const plate = plateKey(truck);
  if (plate && assignments[plate]) delete assignments[plate];
  else delete assignments[variantKey(truck)];
  return { ...store, assignments };
}

// Presets made with "New preset" are not tied to a truck: Auto never picks them (game
// truck ids look like "vehicle.brand.model"); they are picked in the list or bound.
const CUSTOM = 'custom.';

export const isCustomKey = (key) => key.startsWith(CUSTOM);

// A copy of `layout` as a new custom preset; its name is the source's plus " copy".
export function createPreset(store, layout) {
  let n = 1;
  while (store.trucks[`${CUSTOM}${n}`]) n++;
  const key = `${CUSTOM}${n}`;
  const taken = new Set([store.default.name, ...Object.values(store.trucks).map((l) => l.name)]);
  const preset = { ...structuredClone(layout), name: uniqueName(layout.name, taken) };
  return { store: { ...store, trucks: { ...store.trucks, [key]: preset } }, key };
}

export function deletePreset(store, key) {
  const trucks = { ...store.trucks };
  delete trucks[key];
  const assignments = Object.fromEntries(Object.entries(store.assignments ?? {}).filter(([, k]) => k !== key));
  return { ...store, trucks, assignments };
}

// Parts of a truck preset key: the model, then a chassis (@) or a plate (#).
const truckOf = (key) => key.split(/[@#]/)[0];
const variantOf = (key) => (!key.includes('#') && key.includes('@') ? key.slice(key.indexOf('@') + 1) : null);
const plateOf = (key) => (key.includes('#') ? key.slice(key.indexOf('#') + 1) : null);
const chassisSuffix = (variant) => `, hook ${variant} m`;
const plateSuffix = (plate) => `, ${plate}`;

// Truck presets by model: { title, model, chassis: [...], trucks: [...] }. The title is the
// model preset's name, else a chassis or truck preset's name without its generated suffix.
function truckGroups(store) {
  const groups = new Map();
  for (const [key, layout] of Object.entries(store.trucks)) {
    if (isCustomKey(key)) continue;
    const group = groups.get(truckOf(key)) ?? { model: null, chassis: [], trucks: [] };
    const variant = variantOf(key);
    const plate = plateOf(key);
    if (variant) group.chassis.push({ key, variant, layout, suffix: chassisSuffix(variant) });
    else if (plate) group.trucks.push({ key, plate, layout, suffix: plateSuffix(plate) });
    else group.model = { key, layout };
    groups.set(truckOf(key), group);
  }
  for (const [modelKey, group] of groups) {
    group.chassis.sort((a, b) => Number(a.variant) - Number(b.variant));
    group.trucks.sort((a, b) => a.plate.localeCompare(b.plate));
    const parts = [...group.chassis, ...group.trucks];
    const named = parts.find((p) => p.layout.name.endsWith(p.suffix));
    group.title = group.model?.layout.name
      ?? (named ? named.layout.name.slice(0, -named.suffix.length) : parts[0]?.layout.name)
      ?? modelKey;
  }
  return groups;
}

// Entries inside a model's group: "Hook 3.2 m", "Vehicle WP-83695" for generated names
// (whatever the model was called then), or a renamed preset's name with the chassis or
// plate after it.
function chassisLabel({ variant, layout, suffix }) {
  return layout.name.endsWith(suffix) ? `Hook ${variant} m` : `${layout.name} (hook ${variant} m)`;
}

function truckLabel({ plate, layout, suffix }) {
  return layout.name.endsWith(suffix) ? `Vehicle ${plate}` : `${layout.name} (vehicle ${plate})`;
}

// A preset as people read it: "International 9900i · hook 3.2 m", "… · vehicle WP-83695",
// otherwise its name.
function displayName(store, key, groups = truckGroups(store)) {
  const group = groups.get(truckOf(key));
  if (group && variantOf(key)) return `${group.title} · hook ${variantOf(key)} m`;
  if (group && plateOf(key)) return `${group.title} · vehicle ${plateOf(key)}`;
  return store.trucks[key].name;
}

// What a preset picked in the list applies to by itself.
function scopeOfKey(store, key) {
  if (!key) return EVERY;
  if (isCustomKey(key)) return 'only where it is chosen';
  const groups = truckGroups(store);
  const group = groups.get(truckOf(key));
  if (plateOf(key)) return `only vehicle ${plateOf(key)}`;
  if (variantOf(key)) return `${group.title} on the hook ${variantOf(key)} m chassis`;
  return group.chassis.length ? `all chassis of ${group.title}` : `all ${group.title}`;
}

const EVERY = 'every vehicle without its own preset';
const chassisScope = (truck) => (truck.variant ? `all ${truck.name} on this chassis` : `all ${truck.name}`);

// The panel's card for the truck in the game: what plays, what it applies to, a note
// on editing, and the buttons that change the scope ({ action, label }).
export function truckStatus(store, selection, truck) {
  const playing = resolvePlaying(store, selection, truck);
  const base = {
    truck: truck ? [truck.name, truck.variant && `hook ${truck.variant} m`, truck.plate].filter(Boolean).join(' · ') : 'no vehicle in the game',
    plays: playing.kind === 'truck' ? displayName(store, playing.key) : 'Default layout',
    appliesTo: EVERY,
    note: null,
    buttonsLabel: '',
    buttons: [],
  };
  const byPlate = Boolean(truck?.plate && !truck.quickJob);
  const lent = truck?.plate && truck.quickJob ? 'This quick-job vehicle has a random plate, so "this vehicle only" is not offered.' : '';
  const note = (...parts) => parts.filter(Boolean).join(' ') || null;
  const onlyThisTruck = byPlate ? [{ action: 'own-truck', label: 'Only this vehicle' }] : [];

  if (selection.mode !== 'auto') {
    const buttons = truck && playing.kind === 'truck' ? [
      ...(byPlate ? [{ action: 'bind-truck', label: 'this vehicle only' }] : []),
      { action: 'bind-chassis', label: chassisScope(truck) },
    ] : [];
    return {
      ...base,
      plays: `${base.plays} (picked in the list)`,
      appliesTo: scopeOfKey(store, playing.key),
      note: note('Editing changes this preset.', buttons.length && lent),
      buttonsLabel: buttons.length ? 'Use it in' : '',
      buttons,
    };
  }
  if (!truck) return base;
  const auto = autoPreset(store, truck);
  switch (auto?.how) {
    case 'truck':
      return { ...base, appliesTo: `only this vehicle (${truck.plate})`, buttons: [{ action: 'drop-truck', label: 'Unbind' }] };
    case 'truckBound':
      return { ...base, appliesTo: `only this vehicle (${truck.plate}), chosen by hand`, buttons: [{ action: 'unbind', label: 'Unbind' }] };
    case 'chassisBound':
      return {
        ...base,
        appliesTo: `${chassisScope(truck)}, chosen by hand`,
        note: note(lent),
        buttons: [...onlyThisTruck, { action: 'unbind', label: 'Unbind' }],
      };
    case 'chassis':
      return { ...base, appliesTo: chassisScope(truck), note: note(lent), buttons: onlyThisTruck };
    case 'model':
      if (!truck.variant) return { ...base, appliesTo: `all ${truck.name}`, note: note(lent), buttons: onlyThisTruck };
      break;
    default:
  }
  // Something wider plays: the model's preset for all chassis, another chassis's, the default.
  let appliesTo = EVERY;
  if (auto?.how === 'model') appliesTo = `all chassis of ${truck.name}`;
  if (auto?.how === 'sibling') appliesTo = `another chassis of ${truck.name}`;
  return {
    ...base,
    appliesTo,
    note: note(`Editing makes ${truck.variant ? 'a copy for this chassis' : `a preset for ${truck.name}`} first.`, lent),
    buttons: [
      { action: 'own-chassis', label: truck.variant ? 'Own preset for this chassis' : `Own preset for ${truck.name}` },
      ...onlyThisTruck,
    ],
  };
}

const AUTO_NOTE = {
  truckBound: () => ' (this vehicle)',
  truck: () => '',
  chassisBound: () => ' (assigned)',
  chassis: () => '',
  model: (truck) => (truck.variant ? ' (all chassis)' : ''),
  sibling: () => ' (other chassis)',
};

// The preset list: Auto, the default layout, then the models by name. A model with one
// preset is one entry; with several it is a group: "All chassis", each chassis, single
// trucks. Presets made with "New preset" are grouped under Custom. Entries in a group
// carry `full`, their text while selected, as a closed list hides the group.
export function presetOptions(store, truck) {
  const groups = truckGroups(store);
  let auto = 'Auto — no game';
  if (truck) {
    const playing = autoPreset(store, truck);
    auto = playing
      ? `Auto — ${displayName(store, playing.key, groups)}${AUTO_NOTE[playing.how](truck)}`
      : `Auto — ${truck.name} (default layout)`;
  }
  const trucks = [...groups.values()].map((group) => {
    const entries = [
      ...(group.model ? [{ key: group.model.key, label: 'All chassis', single: group.title }] : []),
      ...group.chassis.map((c) => {
        const label = chassisLabel(c);
        return { key: c.key, label, single: label.startsWith('Hook ') ? group.title : c.layout.name };
      }),
      ...group.trucks.map((t) => {
        const label = truckLabel(t);
        return { key: t.key, label, single: label.startsWith('Vehicle ') ? displayName(store, t.key, groups) : t.layout.name };
      }),
    ];
    if (entries.length === 1) return { value: `truck:${entries[0].key}`, label: entries[0].single };
    const full = (label) => `${group.title} · ${/^(Hook|Vehicle|All) /.test(label) ? label[0].toLowerCase() + label.slice(1) : label}`;
    return { group: group.title, options: entries.map((e) => ({ value: `truck:${e.key}`, label: e.label, full: full(e.label) })) };
  }).sort((a, b) => (a.label ?? a.group).localeCompare(b.label ?? b.group));
  const custom = Object.entries(store.trucks)
    .filter(([key]) => isCustomKey(key))
    .map(([key, layout]) => ({ value: `truck:${key}`, label: layout.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    { value: 'auto', label: auto },
    { value: 'default', label: 'Default layout' },
    ...trucks,
    ...(custom.length ? [{ group: 'Custom', options: custom }] : []),
  ];
}

export function selectionValue(selection) {
  return selection.mode === 'truck' ? `truck:${selection.key}` : selection.mode;
}

export function parseSelection(value) {
  if (value.startsWith('truck:')) return { mode: 'truck', key: value.slice('truck:'.length) };
  return { mode: value === 'default' ? 'default' : 'auto' };
}
