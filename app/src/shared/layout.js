// Speaker layouts: defaults, normalization of loaded data and pure edit helpers.
// Positions are metres from the zero point, in SCS cab axes (X right, Y up, Z back,
// forward is -Z): X from the cab's centre line (the truck's axis), Y and Z from the
// driver's default head (eye level, seat line). The head sits left of X = 0 by what the
// game reports (pose.js headRestX). Mirrored pairs are mirror images about X = 0.

export const MAX_SPEAKERS = 16;
// 1: X started at the driver's head. 2: X starts at the truck's axis.
export const STORE_VERSION = 2;
export const CHANNELS = ['L', 'R', 'M'];
export const TYPES = ['full', 'small', 'tweeter', 'mid', 'midbass', 'sub']; // full-range ones, then high to low
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
      { id: 's1', name: 'Door L', position: [-1.12, -0.6, -0.35], channel: 'L', gainDb: 0, type: 'full', pair: 's2' },
      { id: 's2', name: 'Door R', position: [1.12, -0.6, -0.35], channel: 'R', gainDb: 0, type: 'full', pair: 's1' },
    ],
  };
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

export function normalizeStore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const trucks = {};
  if (src.trucks && typeof src.trucks === 'object') {
    for (const [key, layout] of Object.entries(src.trucks)) {
      if (key) trucks[key] = normalizeLayout(layout, key);
    }
  }
  // Version 1 measured X from the driver's head; its mirror line was the centre of the
  // bounds, which becomes X = 0 (with "Center on truck" that was the truck's axis).
  const convert = src.version === STORE_VERSION ? (l) => l : (l) => centerOn(l, 0);
  // Presets chosen by hand for a truck variant ("<truck id>@<variant>" -> preset key).
  const assignments = {};
  if (src.assignments && typeof src.assignments === 'object') {
    for (const [variant, key] of Object.entries(src.assignments)) {
      if (variant && typeof key === 'string' && trucks[key]) assignments[variant] = key;
    }
  }
  return {
    version: STORE_VERSION,
    default: convert(normalizeLayout(src.default)),
    trucks: Object.fromEntries(Object.entries(trucks).map(([key, l]) => [key, convert(l)])),
    assignments,
  };
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

// Applies a patch to one speaker; a moved speaker drags its mirrored partner along.
export function updateSpeaker(layout, id, patch) {
  const current = layout.speakers.find((s) => s.id === id);
  if (!current) return layout;
  const next = cleanSpeaker({ ...current, ...patch, pair: current.pair }, id, current.name);
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
  const speaker = cleanSpeaker(
    { name: `Speaker ${layout.speakers.length + 1}`, position: [0, -0.35, -0.9], channel: 'M' },
    id,
    'Speaker',
  );
  return { layout: withSpeakers(layout, [...layout.speakers, speaker]), id };
}

export function addPair(layout) {
  if (layout.speakers.length + 2 > MAX_SPEAKERS) return { layout, ids: [] };
  const used = new Set(layout.speakers.map((s) => s.id));
  const left = freeId(used);
  used.add(left);
  const right = freeId(used);
  const n = layout.speakers.length + 1;
  const leftPosition = [snap(layout.bounds.min[0] + 0.03), -0.6, -0.35];
  return {
    layout: withSpeakers(layout, [
      ...layout.speakers,
      cleanSpeaker({ name: `Speaker ${n} L`, position: leftPosition, channel: 'L', pair: right }, left, 'Speaker L'),
      cleanSpeaker(
        { name: `Speaker ${n} R`, position: mirrorPosition(leftPosition), channel: 'R', pair: left },
        right,
        'Speaker R',
      ),
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
