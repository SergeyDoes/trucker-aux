// Speaker layouts: defaults, normalization of loaded data and pure edit helpers.
// Positions are metres from the zero point, in SCS cab axes (X right, Y up, Z back,
// forward is -Z): X from the cab's centre line (the truck's axis), Y and Z from the
// driver's default head (eye level, seat line). The head sits left of X = 0 by what the
// game reports (pose.js headRestX). Mirrored pairs are mirror images about X = 0.

export const MAX_SPEAKERS = 16;
// 1: X started at the driver's head. 2: X starts at the truck's axis. 3: presets apart from
// their scopes (normalizeStore).
export const STORE_VERSION = 3;
export const CHANNELS = ['L', 'R', 'M'];
export const TYPES = ['full', 'small', 'tweeter', 'mid', 'midbass', 'sub']; // full-range ones, then high to low
// The types' names, as the panel lists them; speakers the app adds are named after them.
export const TYPE_NAMES = {
  full: 'Full range', small: 'Small full range', tweeter: 'Tweeter', mid: 'Midrange', midbass: 'Midbass', sub: 'Subwoofer',
};
const COORD_LIMIT = 5;
const GAIN_MIN = -60;
const GAIN_MAX = 12;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

function vec3(value, fallback) {
  return Array.isArray(value) && value.length === 3
    ? value.map((c, i) => clamp(isNum(c) ? c : fallback[i], -COORD_LIMIT, COORD_LIMIT))
    : [...fallback];
}

// Rounds metres to whole centimetres (never -0).
export function snap(metres) {
  return Math.round(metres * 100) / 100 + 0;
}

// A cab 2.3 m wide with a door speaker on each side, a little below and ahead of the eyes.
export function defaultLayout() {
  return {
    name: 'Default layout',
    width: 1,
    bounds: { min: [-1.15, -1.15, -1.3], max: [1.15, 0.95, 0.6] },
    speakers: [
      { id: 's1', name: 'Full range L', position: [-1.12, -0.6, -0.35], channel: 'L', gainDb: 0, type: 'full', pair: 's2' },
      { id: 's2', name: 'Full range R', position: [1.12, -0.6, -0.35], channel: 'R', gainDb: 0, type: 'full', pair: 's1' },
    ],
  };
}

// Names the app gives: a type's name with an optional side and number ("Midbass L",
// "Subwoofer", "Tweeter R 2"), and those of older versions ("Door L", "Speaker 3 R").
// They follow the speaker's type; a name of your own never changes.
const STANDARD_NAME = new RegExp(`^(Door|Speaker(?: \\d+)?|${Object.values(TYPE_NAMES).join('|')})(?: ([LR]))?(?: \\d+)?$`);

// A type's names for speakers on these sides ([null], ['L'], ['L', 'R']): "Midbass L",
// or "Midbass L 2" and so on when taken; the sides of a pair share one number.
function typeNames(type, sides, taken) {
  const base = (side) => (side ? `${TYPE_NAMES[type]} ${side}` : TYPE_NAMES[type]);
  const numbered = (n) => sides.map((side) => (n === 1 ? base(side) : `${base(side)} ${n}`));
  let n = 1;
  while (numbered(n).some((name) => taken.has(name))) n++;
  return numbered(n);
}

const typeName = (type, side, taken) => typeNames(type, [side], taken)[0];

// The name a speaker should have for its type: a standard name that does not say the type
// becomes the type's name, keeping its side; any other name stays.
export function nameForType(speaker, taken) {
  const match = speaker.name.match(STANDARD_NAME);
  if (!match || match[1] === TYPE_NAMES[speaker.type]) return speaker.name;
  return typeName(speaker.type, match[2] ?? null, taken);
}

const boundsCenterX = (bounds) => (bounds.min[0] + bounds.max[0]) / 2;

// Mirror image across the truck's axis (X = 0): doors are symmetric about the cab,
// not about the driver's head.
export function mirrorPosition(position) {
  return [snap(-position[0]), position[1], position[2]];
}

function freeId(used) {
  for (let n = 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`;
}

function cleanSpeaker(raw, id, fallbackName) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    id,
    name: text(src.name) || fallbackName,
    position: vec3(src.position, [0, 0, -0.5]),
    channel: CHANNELS.includes(src.channel) ? src.channel : 'L',
    gainDb: clamp(isNum(src.gainDb) ? src.gainDb : 0, GAIN_MIN, GAIN_MAX),
    type: TYPES.includes(src.type) ? src.type : 'full',
    pair: text(src.pair) || null,
  };
}

// Keeps only mutual pairs; a speaker whose partner is paired elsewhere loses the link.
function fixPairs(speakers) {
  const byId = new Map(speakers.map((s) => [s.id, s]));
  for (const s of speakers) {
    if (s.pair === null) continue;
    const other = byId.get(s.pair);
    if (!other || other === s || (other.pair !== null && other.pair !== s.id)) s.pair = null;
    else other.pair = s.id;
  }
  return speakers;
}

export function normalizeLayout(raw, fallbackName = 'Default layout') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = defaultLayout();
  // Older files call the box "field" or "cabin".
  const boundsSrc = [src.bounds, src.field, src.cabin].find((box) => box && typeof box === 'object') ?? {};
  const a = vec3(boundsSrc.min, base.bounds.min);
  const b = vec3(boundsSrc.max, base.bounds.max);
  const bounds = { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) };
  const list = Array.isArray(src.speakers) ? src.speakers.slice(0, MAX_SPEAKERS) : base.speakers;
  const requested = new Set(list.map((s) => (s && typeof s.id === 'string' ? s.id : null)));
  const used = new Set();
  const speakers = list.map((s, i) => {
    const wanted = s && typeof s.id === 'string' && s.id ? s.id : null;
    const id = wanted && !used.has(wanted) ? wanted : freeId(new Set([...used, ...requested]));
    used.add(id);
    return cleanSpeaker(s, id, `Speaker ${i + 1}`);
  });
  return {
    name: text(src.name) || fallbackName,
    width: clamp(isNum(src.width) ? src.width : 1, 0, 2),
    bounds,
    speakers: fixPairs(speakers),
  };
}

// The scope every vehicle falls back to: its preset is what the default layout was.
export const ALL_SCOPE = 'all';

// Version 3: presets apart from the scopes they apply to (presets.js).
//   presets      { "p.N": layout }
//   assignments  { scope: preset key or "file:…" } — "all", "game:ats", "brand:ats/peterbilt",
//                a model "<truck id>", a chassis "<truck id>@<hook>", a vehicle "<truck id>#<plate>"
//   vehicles     { "<truck id>": { name, game, brand, brandName, chassis: [hook], plates: { plate: hook } } }
//                learned in the game: every model driven, its chassis and your own vehicles
// Older files are converted: version 1 to 2 (coordinates), then 2 to 3 (migrateV2).
export function normalizeStore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (src.version !== STORE_VERSION) return normalizeV3(migrateV2(normalizeV2(src)));
  return normalizeV3(src);
}

function normalizeV3(src) {
  const presets = {};
  if (src.presets && typeof src.presets === 'object') {
    for (const [key, layout] of Object.entries(src.presets)) {
      if (PRESET_KEY.test(key)) presets[key] = normalizeLayout(layout, key);
    }
  }
  const assignments = {};
  if (src.assignments && typeof src.assignments === 'object') {
    for (const [scope, key] of Object.entries(src.assignments)) {
      // A shared file's key ("file:…", collection.js) is kept: the folder is read separately.
      if (scope && typeof key === 'string' && (presets[key] || (key.startsWith('file:') && scope !== ALL_SCOPE))) {
        assignments[scope] = key;
      }
    }
  }
  // Something must play when nothing else does.
  if (!assignments[ALL_SCOPE]) {
    const key = freePresetKey(presets);
    presets[key] = defaultLayout();
    assignments[ALL_SCOPE] = key;
  }
  const vehicles = {};
  if (src.vehicles && typeof src.vehicles === 'object') {
    for (const [id, v] of Object.entries(src.vehicles)) {
      if (!id || !v || typeof v !== 'object') continue;
      const info = Object.fromEntries(['name', 'game', 'brand', 'brandName'].map((k) => [k, text(v[k]) || null]));
      if (info.game !== 'ats' && info.game !== 'ets2') info.game = null;
      // Chassis seen (fifth-wheel positions) and your own vehicles of the model (plate -> chassis).
      info.chassis = Array.isArray(v.chassis) ? [...new Set(v.chassis.filter((c) => typeof c === 'string' && c))].sort() : [];
      info.plates = {};
      if (v.plates && typeof v.plates === 'object') {
        for (const [plate, hook] of Object.entries(v.plates)) if (plate) info.plates[plate] = typeof hook === 'string' && hook ? hook : null;
      }
      vehicles[id] = info;
    }
  }
  return { version: STORE_VERSION, presets, assignments, vehicles };
}

const PRESET_KEY = /^p\.\d+$/;

// The next "p.N" not taken.
export function freePresetKey(presets) {
  let n = 0;
  for (const key of Object.keys(presets)) if (PRESET_KEY.test(key)) n = Math.max(n, Number(key.slice(2)));
  return `p.${n + 1}`;
}

// Version 2 (and 1, converted): { default, trucks: { scope or "custom.N": layout },
// assignments: { vehicle or chassis: truck key or "file:…" } }.
function normalizeV2(src) {
  const trucks = {};
  if (src.trucks && typeof src.trucks === 'object') {
    for (const [key, layout] of Object.entries(src.trucks)) {
      if (key) trucks[key] = normalizeLayout(layout, key);
    }
  }
  // Version 1 measured X from the driver's head; its mirror line was the centre of the
  // bounds, which becomes X = 0 (with "Center on truck" that was the truck's axis).
  const convert = src.version === 2 ? (l) => l : (l) => centerOn(l, 0);
  const assignments = {};
  if (src.assignments && typeof src.assignments === 'object') {
    for (const [scope, key] of Object.entries(src.assignments)) {
      if (scope && typeof key === 'string' && (trucks[key] || key.startsWith('file:'))) assignments[scope] = key;
    }
  }
  return {
    default: convert(normalizeLayout(src.default)),
    trucks: Object.fromEntries(Object.entries(trucks).map(([key, l]) => [key, convert(l)])),
    assignments,
  };
}

// Version 2 keyed each preset by its scope. Now each layout becomes a preset "p.N"
// assigned to that scope; "custom.N" ones are unassigned; a binding wins over the scope's
// own preset (as Auto played it), which then stays unassigned. Model names are taken from
// the presets' names, as the version 2 list did; game and brand come once a vehicle is driven.
function migrateV2(v2) {
  const presets = { 'p.1': v2.default };
  const assignments = { [ALL_SCOPE]: 'p.1' };
  const keyOf = {};
  for (const [old, layout] of Object.entries(v2.trucks)) {
    const key = freePresetKey(presets);
    presets[key] = layout;
    keyOf[old] = key;
    if (!old.startsWith('custom.')) assignments[old] = key;
  }
  for (const [scope, target] of Object.entries(v2.assignments)) {
    const key = target.startsWith('file:') ? target : keyOf[target];
    if (key) assignments[scope] = key;
  }
  return { presets, assignments, vehicles: migratedVehicles(v2.trucks) };
}

// "International 9900i" from the model's preset, else from "International 9900i, hook 3.2 m"
// or "International 9900i, WP-83695" with the generated ending cut off.
function migratedVehicles(trucks) {
  const names = {};
  for (const [key, layout] of Object.entries(trucks)) {
    if (key.startsWith('custom.')) continue;
    const model = key.split(/[@#]/)[0];
    const at = key.indexOf('@');
    const hash = key.indexOf('#');
    let name = layout.name;
    let rank = 0; // the model's own name wins
    if (at > 0) {
      rank = 1;
      const suffix = `, hook ${key.slice(at + 1)} m`;
      if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
    } else if (hash > 0) {
      rank = 2;
      const suffix = `, ${key.slice(hash + 1)}`;
      if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
    }
    if (!names[model] || rank < names[model].rank) names[model] = { name, rank };
  }
  return Object.fromEntries(Object.entries(names).map(([id, { name }]) => [id, { name, game: null, brand: null, brandName: null, chassis: [], plates: {} }]));
}

const withSpeakers = (layout, speakers) => ({ ...layout, speakers });

export function setWidth(layout, width) {
  return { ...layout, width: clamp(isNum(width) ? width : 1, 0, 2) };
}

const MIN_BOUNDS = 0.2; // metres between opposite walls

// Moves one wall of the bounds. The side walls move together, symmetric about the truck's
// axis; the others move alone. Speakers stay where they are.
export function setBoundsEdge(layout, axis, side, value) {
  const min = [...layout.bounds.min];
  const max = [...layout.bounds.max];
  const v = clamp(isNum(value) ? value : 0, -COORD_LIMIT, COORD_LIMIT);
  if (axis === 0) {
    const half = snap(Math.max(side === 'min' ? -v : v, MIN_BOUNDS / 2));
    min[0] = snap(-half);
    max[0] = half;
  } else if (side === 'min') min[axis] = snap(Math.min(v, max[axis] - MIN_BOUNDS));
  else max[axis] = snap(Math.max(v, min[axis] + MIN_BOUNDS));
  return { ...layout, bounds: { min, max } };
}

// Shifts the bounds and every speaker sideways so the centre of the bounds lands on
// centerX; converts version 1 layouts (centerX = 0). Returns the same layout when it is
// already centred (within 5 mm) or centerX is not a number.
export function centerOn(layout, centerX) {
  if (!isNum(centerX)) return layout;
  const dx = snap(centerX - boundsCenterX(layout.bounds));
  if (dx === 0) return layout;
  const shift = (p) => [snap(clamp(p[0] + dx, -COORD_LIMIT, COORD_LIMIT)), p[1], p[2]];
  return {
    ...layout,
    bounds: { min: shift(layout.bounds.min), max: shift(layout.bounds.max) },
    speakers: layout.speakers.map((s) => ({ ...s, position: shift(s.position) })),
  };
}

// Applies a patch to one speaker; a moved speaker drags its mirrored partner along, and a
// standard name follows a new type ("Midbass L" becomes "Tweeter L").
export function updateSpeaker(layout, id, patch) {
  const current = layout.speakers.find((s) => s.id === id);
  if (!current) return layout;
  let next = cleanSpeaker({ ...current, ...patch, pair: current.pair }, id, current.name);
  if (patch.name === undefined && next.type !== current.type) {
    next = { ...next, name: nameForType(next, new Set(layout.speakers.filter((s) => s.id !== id).map((s) => s.name))) };
  }
  const moved = patch.position !== undefined;
  return withSpeakers(layout, layout.speakers.map((s) => {
    if (s.id === id) return next;
    if (moved && s.id === current.pair) return { ...s, position: mirrorPosition(next.position) };
    return s;
  }));
}

// Group edits. A position change goes through updateSpeaker, so mirrored partners follow;
// when both halves of a pair are selected, the leader (the speaker the user grabbed) or
// else the first one moves, and the other half mirrors it.
function eachLed(layout, ids, leaderId, change) {
  const chosen = new Set(ids);
  const order = layout.speakers
    .filter((s) => chosen.has(s.id))
    .sort((a, b) => Number(b.id === leaderId) - Number(a.id === leaderId));
  const done = new Set();
  let next = layout;
  for (const { id, pair } of order) {
    if (done.has(id)) continue;
    next = change(next, next.speakers.find((s) => s.id === id));
    done.add(id);
    if (pair) done.add(pair);
  }
  return next;
}

export function moveSpeakers(layout, ids, delta, leaderId = null) {
  return eachLed(layout, ids, leaderId, (l, s) => updateSpeaker(l, s.id, {
    position: s.position.map((c, i) => snap(c + delta[i])),
  }));
}

export function setCoordinate(layout, ids, axis, value, leaderId = null) {
  return eachLed(layout, ids, leaderId, (l, s) => updateSpeaker(l, s.id, {
    position: s.position.map((c, i) => (i === axis ? snap(value) : c)),
  }));
}

// Same values for all, for fields other than the position (channel, type).
export function patchSpeakers(layout, ids, patch) {
  return ids.reduce((l, id) => updateSpeaker(l, id, patch), layout);
}

// Levels move together and keep their differences (until one hits a limit).
export function shiftGains(layout, ids, deltaDb) {
  return ids.reduce((l, id) => {
    const s = l.speakers.find((x) => x.id === id);
    return s ? updateSpeaker(l, id, { gainDb: s.gainDb + deltaDb }) : l;
  }, layout);
}

export function removeSpeakers(layout, ids) {
  return ids.reduce(removeSpeaker, layout);
}

// Copies keep a pair link only when both halves are copied.
export function copySpeakers(layout, ids) {
  const chosen = new Set(ids);
  return layout.speakers
    .filter((s) => chosen.has(s.id))
    .map((s) => ({ ...structuredClone(s), pair: chosen.has(s.pair) ? s.pair : null }));
}

// The name itself if free, else "name copy", "name copy 2"... (for speakers and presets).
export function uniqueName(name, taken) {
  let result = name;
  for (let n = 1; taken.has(result); n++) result = n === 1 ? `${name} copy` : `${name} copy ${n}`;
  return result;
}

const PASTE_STEP = 0.1; // m back when the copies would land on speakers already there

const samePlace = (a, b) => a.every((c, i) => Math.abs(c - b[i]) < 0.005);

// Pastes copies with new ids; names already taken get " copy", " copy 2"... In the layout
// they came from (or wherever their place is taken) they land 10 cm further back per paste.
// Pairs are mirrored about X = 0. Nothing is pasted if it does not fit.
export function pasteSpeakers(layout, clip) {
  if (!clip.length || layout.speakers.length + clip.length > MAX_SPEAKERS) return { layout, ids: [] };
  const at = (s, dz) => [s.position[0], s.position[1], snap(s.position[2] + dz)];
  const taken = (dz) => clip.some((c) => layout.speakers.some((s) => samePlace(s.position, at(c, dz))));
  let dz = 0;
  for (let tries = 0; tries < 50 && taken(dz); tries++) dz = snap(dz + PASTE_STEP);

  const used = new Set(layout.speakers.map((s) => s.id));
  const names = new Set(layout.speakers.map((s) => s.name));
  const newId = new Map(clip.map((c) => {
    const id = freeId(used);
    used.add(id);
    return [c.id, id];
  }));
  const pasted = clip.map((c) => {
    const name = uniqueName(c.name, names);
    names.add(name);
    const pair = c.pair ? newId.get(c.pair) ?? null : null;
    return cleanSpeaker({ ...c, name, position: at(c, dz), pair }, newId.get(c.id), name);
  });
  const byId = new Map(pasted.map((s) => [s.id, s]));
  const done = new Set();
  for (const s of pasted) {
    if (!s.pair || done.has(s.id)) continue;
    done.add(s.id).add(s.pair);
    byId.get(s.pair).position = mirrorPosition(s.position);
  }
  return { layout: withSpeakers(layout, [...layout.speakers, ...pasted]), ids: pasted.map((s) => s.id) };
}

export function addSpeaker(layout) {
  if (layout.speakers.length >= MAX_SPEAKERS) return { layout, id: null };
  const id = freeId(new Set(layout.speakers.map((s) => s.id)));
  const name = typeName('full', null, new Set(layout.speakers.map((s) => s.name)));
  const speaker = cleanSpeaker({ name, position: [0, -0.35, -0.9], channel: 'M' }, id, name);
  return { layout: withSpeakers(layout, [...layout.speakers, speaker]), id };
}

export function addPair(layout) {
  if (layout.speakers.length + 2 > MAX_SPEAKERS) return { layout, ids: [] };
  const used = new Set(layout.speakers.map((s) => s.id));
  const left = freeId(used);
  used.add(left);
  const right = freeId(used);
  const [leftName, rightName] = typeNames('full', ['L', 'R'], new Set(layout.speakers.map((s) => s.name)));
  const leftPosition = [snap(layout.bounds.min[0] + 0.03), -0.6, -0.35];
  return {
    layout: withSpeakers(layout, [
      ...layout.speakers,
      cleanSpeaker({ name: leftName, position: leftPosition, channel: 'L', pair: right }, left, leftName),
      cleanSpeaker({ name: rightName, position: mirrorPosition(leftPosition), channel: 'R', pair: left }, right, rightName),
    ]),
    ids: [left, right],
  };
}

export function removeSpeaker(layout, id) {
  return withSpeakers(layout, layout.speakers
    .filter((s) => s.id !== id)
    .map((s) => (s.pair === id ? { ...s, pair: null } : s)));
}

export function unlinkPair(layout, id) {
  const partner = layout.speakers.find((s) => s.id === id)?.pair ?? null;
  if (!partner) return layout;
  return withSpeakers(layout, layout.speakers.map((s) => (s.id === id || s.id === partner ? { ...s, pair: null } : s)));
}

// Links two speakers as a mirrored pair; b jumps to the mirror image of a.
export function linkPair(layout, a, b) {
  const source = layout.speakers.find((s) => s.id === a);
  if (a === b || !source || !layout.speakers.some((s) => s.id === b)) return layout;
  const unlinked = unlinkPair(unlinkPair(layout, a), b);
  return withSpeakers(unlinked, unlinked.speakers.map((s) => {
    if (s.id === a) return { ...s, pair: b };
    if (s.id === b) return { ...s, pair: a, position: mirrorPosition(source.position) };
    return s;
  }));
}
