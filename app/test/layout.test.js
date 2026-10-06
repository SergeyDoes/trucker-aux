import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SPEAKERS, STORE_VERSION, TYPE_NAMES, addPair, addSpeaker, centerOn, copySpeakers, defaultLayout, linkPair, mirrorPosition,
  moveSpeakers, normalizeLayout, normalizeStore, pasteSpeakers, patchSpeakers, removeSpeaker, removeSpeakers,
  setCoordinate, setBoundsEdge, setWidth, shiftGains, snap, unlinkPair, updateSpeaker,
} from '../src/shared/layout.js';

function close(actual, expected) {
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < 1e-9, `[${i}] ${actual[i]} != ${e}`));
}

test('default layout: symmetric about the truck axis X = 0; door R mirrors door L', () => {
  const layout = defaultLayout();
  const [l, r] = layout.speakers;
  assert.deepEqual(layout.bounds, { min: [-1.15, -1.15, -1.3], max: [1.15, 0.95, 0.6] });
  assert.deepEqual(l.position, [-1.12, -0.6, -0.35]);
  assert.deepEqual(mirrorPosition(l.position), r.position);
  assert.equal(l.pair, r.id);
  assert.equal(r.pair, l.id);
});

test('defaultLayout returns a fresh copy every time', () => {
  defaultLayout().speakers[0].position[0] = 9;
  assert.equal(defaultLayout().speakers[0].position[0], -1.12);
});

test('normalizeLayout: nothing gives the default layout', () => {
  assert.deepEqual(normalizeLayout(undefined), defaultLayout());
});

test('normalizeLayout: bad values fall back or are clamped', () => {
  const layout = normalizeLayout({
    name: '  ',
    width: 7,
    bounds: { min: [1, 1, 1], max: [-1, -1, -1] },
    speakers: [{ id: 'x', position: [9, 'a', -9], channel: 'Q', gainDb: 99, type: 'horn' }],
  }, 'Fallback');
  assert.equal(layout.name, 'Fallback');
  assert.equal(layout.width, 2);
  assert.deepEqual(layout.bounds, { min: [-1, -1, -1], max: [1, 1, 1] });
  assert.deepEqual(layout.speakers[0], {
    id: 'x', name: 'Speaker 1', position: [5, 0, -5], channel: 'L', gainDb: 12, type: 'full', pair: null,
  });
});

test('normalizeLayout reads the old "field" and "cabin" keys as the bounds', () => {
  const box = (x) => ({ min: [x, -1, -1], max: [1, 1, 0.5] });
  const fromCabin = normalizeLayout({ cabin: box(-0.5) });
  assert.deepEqual(fromCabin.bounds, box(-0.5));
  assert.equal('cabin' in fromCabin, false);
  const fromField = normalizeLayout({ field: box(-0.4) });
  assert.deepEqual(fromField.bounds, box(-0.4));
  assert.equal('field' in fromField, false);
  // The newest name wins.
  assert.deepEqual(normalizeLayout({ bounds: box(-0.6), field: box(-0.7), cabin: box(-0.8) }).bounds, box(-0.6));
  assert.deepEqual(normalizeLayout({ field: box(-0.7), cabin: box(-0.8) }).bounds, box(-0.7));
});

test('normalizeLayout: duplicate ids are renumbered and pairs made mutual', () => {
  const layout = normalizeLayout({ speakers: [
    { id: 'a', pair: 'b' }, { id: 'b' }, { id: 'a' }, { id: 'c', pair: 'zzz' },
  ] });
  assert.deepEqual(layout.speakers.map((s) => s.id), ['a', 'b', 's1', 'c']);
  assert.deepEqual(layout.speakers.map((s) => s.pair), ['b', 'a', null, null]);
});

test('normalizeLayout: a speaker paired elsewhere loses the link', () => {
  const layout = normalizeLayout({ speakers: [
    { id: 'a', pair: 'b' }, { id: 'b', pair: 'c' }, { id: 'c', pair: 'b' },
  ] });
  assert.deepEqual(layout.speakers.map((s) => s.pair), [null, 'c', 'b']);
});

test('normalizeLayout: at most 16 speakers', () => {
  const layout = normalizeLayout({ speakers: Array.from({ length: 20 }, () => ({})) });
  assert.equal(layout.speakers.length, MAX_SPEAKERS);
});

test('normalizeStore keeps and normalizes presets; all vehicles always has one', () => {
  const store = normalizeStore({ version: STORE_VERSION, presets: { 'p.1': { name: 'X 1', width: 0.5 }, 'bad': {} }, assignments: { all: 'p.1' } });
  assert.equal(store.version, 3);
  assert.deepEqual(Object.keys(store.presets), ['p.1']);
  assert.equal(store.presets['p.1'].width, 0.5);
  assert.deepEqual(store.assignments, { all: 'p.1' });
  assert.deepEqual(store.vehicles, {});
  // Nothing for all vehicles: the default layout gets a new preset.
  const empty = normalizeStore({ version: STORE_VERSION });
  assert.deepEqual(empty.presets, { 'p.1': defaultLayout() });
  assert.deepEqual(empty.assignments, { all: 'p.1' });
  assert.deepEqual(normalizeStore(null), empty);
});

test('normalizeStore keeps assignments to presets that exist and to shared files', () => {
  const store = normalizeStore({
    version: STORE_VERSION,
    presets: { 'p.1': {}, 'p.2': {} },
    assignments: { all: 'p.1', 'vehicle.x@3.2': 'p.2', 'vehicle.x@2.1': 'gone', 'vehicle.y': 7, 'vehicle.z': 'file:z.json' },
    vehicles: { 'vehicle.x': { name: 'X', game: 'ats', brand: 'x', brandName: 'X' }, 'vehicle.q': { name: 'Q', game: 'gta' } },
  });
  assert.deepEqual(store.assignments, { all: 'p.1', 'vehicle.x@3.2': 'p.2', 'vehicle.z': 'file:z.json' });
  assert.deepEqual(store.vehicles['vehicle.q'], { name: 'Q', game: null, brand: null, brandName: null, chassis: [], plates: {} });
  const seen = normalizeStore({ version: STORE_VERSION, vehicles: { 'vehicle.x': { chassis: ['3.2', '2.1', '3.2', 4], plates: { 'WP-1': '3.2', 'A-2': 7 } } } });
  assert.deepEqual(seen.vehicles['vehicle.x'].chassis, ['2.1', '3.2']);
  assert.deepEqual(seen.vehicles['vehicle.x'].plates, { 'WP-1': '3.2', 'A-2': null });
  // All vehicles never plays a file: a missing file would leave nothing to play.
  assert.equal(normalizeStore({ version: STORE_VERSION, assignments: { all: 'file:a.json' } }).assignments.all, 'p.1');
});

test('normalizeStore converts version 2: each preset keyed by its scope becomes p.N assigned to it', () => {
  const store = normalizeStore({
    version: 2,
    default: { name: 'Default layout', width: 0.7 },
    trucks: {
      'vehicle.a.b': { name: 'A B', width: 0.1 },
      'vehicle.a.b@2.6': { name: 'A B, hook 2.6 m' },
      'vehicle.c.d@3.2': { name: 'C D, hook 3.2 m' },
      'vehicle.c.d#WP-1': { name: 'Mine' },
      'custom.1': { name: 'Try' },
      'custom.2': { name: 'Bound' },
    },
    assignments: { 'vehicle.a.b@2.6': 'custom.2', 'vehicle.e.f#X-1': 'custom.2', 'vehicle.g.h': 'file:g.json' },
  });
  const named = (name) => Object.keys(store.presets).find((k) => store.presets[k].name === name);
  assert.equal(store.presets[store.assignments.all].width, 0.7);
  assert.equal(store.presets[store.assignments['vehicle.a.b']].width, 0.1);
  // A binding wins over the scope's own preset, which stays unassigned.
  assert.equal(store.assignments['vehicle.a.b@2.6'], named('Bound'));
  assert.equal(store.assignments['vehicle.e.f#X-1'], named('Bound'));
  assert.equal(Object.values(store.assignments).includes(named('A B, hook 2.6 m')), false);
  assert.ok(store.presets[named('A B, hook 2.6 m')]);
  assert.equal(Object.values(store.assignments).includes(named('Try')), false);
  assert.equal(store.assignments['vehicle.c.d#WP-1'], named('Mine'));
  assert.equal(store.assignments['vehicle.g.h'], 'file:g.json');
  // Model names from the presets' names, with the generated ending cut off.
  assert.deepEqual(Object.fromEntries(Object.entries(store.vehicles).map(([id, v]) => [id, v.name])), {
    'vehicle.a.b': 'A B', 'vehicle.c.d': 'C D',
  });
});

test('normalizeStore converts version 1: X then started at the head, now at the centre of the bounds', () => {
  const door = (id, x, pair) => ({ id, name: id, position: [x, -0.6, -0.35], channel: 'L', pair });
  const old = {
    version: 1,
    default: { field: { min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] }, speakers: [door('s1', -0.72, 's2'), door('s2', 1.52, 's1')] },
    trucks: { 'vehicle.intnational.9900i': { name: '9900i', field: { min: [-0.67, -1.15, -1.3], max: [1.63, 0.95, 0.6] }, speakers: [door('s1', -0.64, null)] } },
  };
  const store = normalizeStore(old);
  assert.equal(store.version, 3);
  const all = store.presets[store.assignments.all];
  assert.deepEqual(all.bounds, defaultLayout().bounds);
  assert.deepEqual(all.speakers.map((s) => s.position[0]), [-1.12, 1.12]);
  const truck = store.presets[store.assignments['vehicle.intnational.9900i']];
  assert.deepEqual(truck.bounds, defaultLayout().bounds);
  assert.equal(truck.speakers[0].position[0], -1.12);
  // A file without a version is version 1; a version 2 file keeps its coordinates.
  const unversioned = normalizeStore({ default: old.default });
  assert.equal(unversioned.presets[unversioned.assignments.all].speakers[0].position[0], -1.12);
  const kept = normalizeStore({ version: 2, default: { bounds: { min: [-0.5, -1, -1], max: [1, 1, 1] } } });
  assert.deepEqual(kept.presets[kept.assignments.all].bounds.min, [-0.5, -1, -1]);
});

test('updateSpeaker moves the mirrored partner and clamps values', () => {
  const layout = updateSpeaker(defaultLayout(), 's1', { position: [-1.1, -0.5, -0.4], gainDb: -99 });
  const [l, r] = layout.speakers;
  assert.deepEqual(l.position, [-1.1, -0.5, -0.4]);
  assert.equal(l.gainDb, -60);
  assert.equal(l.pair, 's2');
  assert.deepEqual(r.position, [1.1, -0.5, -0.4]);
});

test('updateSpeaker without a position change leaves the partner alone', () => {
  const layout = updateSpeaker(defaultLayout(), 's1', { name: 'Front L' });
  assert.equal(layout.speakers[0].name, 'Front L');
  assert.deepEqual(layout.speakers[1], defaultLayout().speakers[1]);
});

test('addSpeaker adds a mono speaker with a free id, up to the limit', () => {
  const { layout, id } = addSpeaker(defaultLayout());
  assert.equal(id, 's3');
  assert.equal(layout.speakers.at(-1).channel, 'M');
  const full = normalizeLayout({ speakers: Array.from({ length: MAX_SPEAKERS }, () => ({})) });
  assert.equal(addSpeaker(full).id, null);
});

test('addPair adds linked L/R speakers at the sides of the bounds', () => {
  const { layout, ids } = addPair(defaultLayout());
  assert.deepEqual(ids, ['s3', 's4']);
  const [l, r] = layout.speakers.slice(-2);
  assert.equal(l.channel, 'L');
  assert.equal(r.channel, 'R');
  assert.equal(l.pair, 's4');
  assert.equal(r.pair, 's3');
  assert.equal(l.position[0], -1.12);
  assert.deepEqual(mirrorPosition(l.position), r.position);
});

test('addSpeaker and addPair at a point (the free camera): snapped to centimetres, a pair mirrored', () => {
  assert.deepEqual(addSpeaker(defaultLayout(), [0.234, -0.301, 6]).layout.speakers.at(-1).position, [0.23, -0.3, 5]);
  const pair = (at) => addPair(defaultLayout(), at).layout.speakers.slice(-2).map((s) => [s.channel, s.position]);
  const expected = [['L', [-0.8, -0.4, -0.3]], ['R', [0.8, -0.4, -0.3]]];
  assert.deepEqual(pair([-0.8, -0.4, -0.3]), expected);
  assert.deepEqual(pair([0.8, -0.4, -0.3]), expected); // the right one at the camera
});

test('removeSpeaker unlinks the partner', () => {
  const layout = removeSpeaker(defaultLayout(), 's1');
  assert.deepEqual(layout.speakers.map((s) => [s.id, s.pair]), [['s2', null]]);
});

test('linkPair mirrors the second speaker; unlinkPair breaks both sides', () => {
  let layout = addSpeaker(unlinkPair(defaultLayout(), 's1')).layout;
  layout = linkPair(layout, 's1', 's3');
  const s3 = layout.speakers.find((s) => s.id === 's3');
  assert.equal(s3.pair, 's1');
  close(s3.position, mirrorPosition(layout.speakers[0].position));
  assert.equal(layout.speakers.find((s) => s.id === 's2').pair, null);
  layout = unlinkPair(layout, 's3');
  assert.equal(layout.speakers[0].pair, null);
  assert.equal(layout.speakers.find((s) => s.id === 's3').pair, null);
});

test('setWidth clamps to 0..2; snap rounds to centimetres', () => {
  assert.equal(setWidth(defaultLayout(), 3).width, 2);
  assert.equal(setWidth(defaultLayout(), 0.25).width, 0.25);
  assert.equal(snap(0.12345), 0.12);
  assert.equal(snap(0.126), 0.13);
});

test('speakers are named after their type; a standard name follows a type change, a name of your own stays', () => {
  assert.deepEqual(defaultLayout().speakers.map((s) => s.name), ['Full range L', 'Full range R']);
  const pair = addPair(defaultLayout());
  assert.deepEqual(pair.layout.speakers.slice(2).map((s) => s.name), ['Full range L 2', 'Full range R 2']);
  assert.equal(addSpeaker(defaultLayout()).layout.speakers[2].name, 'Full range');
  // A pair shares its number, even when only one side is taken.
  const oneTaken = updateSpeaker(defaultLayout(), 's1', { type: 'midbass' });
  assert.deepEqual(addPair(oneTaken).layout.speakers.slice(2).map((s) => s.name), ['Full range L 2', 'Full range R 2']);
  const midbass = patchSpeakers(pair.layout, pair.ids, { type: 'midbass' });
  assert.deepEqual(midbass.speakers.map((s) => s.name), ['Full range L', 'Full range R', 'Midbass L', 'Midbass R']);
  // Names the app gave before count as standard too, numbered when taken.
  const older = normalizeLayout({ speakers: [
    { id: 'a', name: 'Door L' }, { id: 'b', name: 'Speaker 3 R' }, { id: 'c', name: 'Speaker 5' },
    { id: 'd', name: 'Central' }, { id: 'e', name: 'Speaker L' }, { id: 'f', name: 'Midbass L copy' },
  ] });
  const typed = patchSpeakers(older, ['a', 'b', 'c', 'd', 'e', 'f'], { type: 'tweeter' });
  assert.deepEqual(typed.speakers.map((s) => s.name), ['Tweeter L', 'Tweeter R', 'Tweeter', 'Central', 'Tweeter L 2', 'Midbass L copy']);
  // A name given with the type wins; the same type, or a name that already says it, stays.
  assert.equal(updateSpeaker(defaultLayout(), 's1', { type: 'sub', name: 'Bass' }).speakers[0].name, 'Bass');
  assert.equal(updateSpeaker(defaultLayout(), 's1', { type: 'full' }).speakers[0].name, 'Full range L');
  const mismatched = normalizeLayout({ speakers: [{ id: 'a', name: 'Midbass L 2', type: 'full' }] });
  assert.equal(updateSpeaker(mismatched, 'a', { type: 'midbass' }).speakers[0].name, 'Midbass L 2');
  assert.equal(TYPE_NAMES.small, 'Small full range');
});

// s1 and s2 (the doors of the default layout) are a mirrored pair; s3 is a lone speaker.
const withCenter = () => {
  const { layout } = addSpeaker(defaultLayout());
  return updateSpeaker(layout, 's3', { position: [0.3, 0, -1], gainDb: -6, type: 'tweeter' });
};
const pos = (layout) => Object.fromEntries(layout.speakers.map((s) => [s.id, s.position]));

test('moveSpeakers moves a group by one step; the leader keeps its pair mirrored', () => {
  const forward = moveSpeakers(withCenter(), ['s1', 's3'], [0, 0, -0.1], 's1');
  assert.deepEqual(pos(forward), { s1: [-1.12, -0.6, -0.45], s2: [1.12, -0.6, -0.45], s3: [0.3, 0, -1.1] });
  // Both doors selected and dragged right by Door R: Door R follows the pointer, Door L mirrors it.
  const wider = moveSpeakers(withCenter(), ['s1', 's2'], [0.1, 0, 0], 's2');
  assert.deepEqual(pos(wider).s2, [1.22, -0.6, -0.35]);
  assert.deepEqual(pos(wider).s1, [-1.22, -0.6, -0.35]);
});

test('patchSpeakers, shiftGains and setCoordinate edit every selected speaker', () => {
  const typed = patchSpeakers(withCenter(), ['s1', 's3'], { type: 'mid' });
  assert.deepEqual(typed.speakers.map((s) => s.type), ['mid', 'full', 'mid']);
  const quieter = shiftGains(withCenter(), ['s1', 's3'], -3);
  assert.deepEqual(quieter.speakers.map((s) => s.gainDb), [-3, 0, -9]);
  assert.equal(shiftGains(withCenter(), ['s3'], -100).speakers[2].gainDb, -60);
  const raised = setCoordinate(withCenter(), ['s2', 's3'], 1, 0.2, 's3');
  assert.deepEqual(pos(raised), { s1: [-1.12, 0.2, -0.35], s2: [1.12, 0.2, -0.35], s3: [0.3, 0.2, -1] });
  const sideways = setCoordinate(withCenter(), ['s1', 's2'], 0, -0.5, 's1');
  assert.deepEqual([pos(sideways).s1[0], pos(sideways).s2[0]], [-0.5, 0.5]);
});

test('removeSpeakers removes all of them and unlinks partners left behind', () => {
  const left = removeSpeakers(withCenter(), ['s1', 's3']);
  assert.deepEqual(left.speakers.map((s) => [s.id, s.pair]), [['s2', null]]);
});

test('copy and paste in the same layout: new ids and names, 10 cm back, the copies paired', () => {
  const layout = withCenter();
  const clip = copySpeakers(layout, ['s1', 's2']);
  const once = pasteSpeakers(layout, clip);
  assert.deepEqual(once.ids, ['s4', 's5']);
  const [l, r] = once.layout.speakers.slice(3);
  assert.deepEqual([l.name, l.position, l.pair], ['Full range L copy', [-1.12, -0.6, -0.25], 's5']);
  assert.deepEqual([r.name, r.position, r.pair], ['Full range R copy', [1.12, -0.6, -0.25], 's4']);
  const twice = pasteSpeakers(once.layout, clip);
  assert.deepEqual(twice.layout.speakers.slice(5).map((s) => [s.name, s.position[2]]), [['Full range L copy 2', -0.15], ['Full range R copy 2', -0.15]]);
});

test('paste into another layout lands in place; lone halves are unpaired', () => {
  const clip = copySpeakers(withCenter(), ['s1', 's2', 's3']);
  const target = { ...defaultLayout(), speakers: [] };
  const { layout, ids } = pasteSpeakers(target, clip);
  assert.deepEqual(ids, ['s1', 's2', 's3']);
  assert.deepEqual(layout.speakers.map((s) => s.name), ['Full range L', 'Full range R', 'Tweeter']);
  assert.deepEqual(pos(layout), { s1: [-1.12, -0.6, -0.35], s2: [1.12, -0.6, -0.35], s3: [0.3, 0, -1] });
  const half = pasteSpeakers(target, copySpeakers(withCenter(), ['s2']));
  assert.equal(half.layout.speakers[0].pair, null);
});

test('paste refuses what does not fit', () => {
  const full = normalizeLayout({ speakers: Array.from({ length: MAX_SPEAKERS - 1 }, () => ({})) });
  const clip = copySpeakers(withCenter(), ['s1', 's2']);
  assert.deepEqual(pasteSpeakers(full, clip), { layout: full, ids: [] });
  assert.deepEqual(pasteSpeakers(full, []).ids, []);
});

test('centerOn shifts the bounds and every speaker sideways (used to convert version 1)', () => {
  const old = { ...defaultLayout(), bounds: { min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] } };
  old.speakers = old.speakers.map((s) => ({ ...s, position: [s.position[0] + 0.4, ...s.position.slice(1)] }));
  const layout = centerOn(old, 0);
  assert.deepEqual(layout.bounds, defaultLayout().bounds);
  assert.deepEqual(layout.speakers.map((s) => s.position), defaultLayout().speakers.map((s) => s.position));
  const same = defaultLayout();
  assert.equal(centerOn(same, 0.003), same);
  assert.equal(centerOn(same, null), same);
});

test('setBoundsEdge: side walls move together about X = 0, at least 20 cm apart; speakers stay', () => {
  const wider = setBoundsEdge(defaultLayout(), 0, 'max', 1.35);
  assert.deepEqual([wider.bounds.min[0], wider.bounds.max[0]], [-1.35, 1.35]);
  assert.deepEqual(wider.speakers, defaultLayout().speakers);
  const narrow = setBoundsEdge(defaultLayout(), 0, 'min', -0.9);
  assert.deepEqual([narrow.bounds.min[0], narrow.bounds.max[0]], [-0.9, 0.9]);
  const past = setBoundsEdge(defaultLayout(), 0, 'min', 2); // the left wall dragged past the axis
  assert.deepEqual([past.bounds.min[0], past.bounds.max[0]], [-0.1, 0.1]);
});

test('setBoundsEdge: top, bottom, front and back move alone, at least 20 cm apart, snapped', () => {
  assert.equal(setBoundsEdge(defaultLayout(), 1, 'max', 0.9876).bounds.max[1], 0.99);
  assert.equal(setBoundsEdge(defaultLayout(), 1, 'min', 2).bounds.min[1], 0.75);
  assert.equal(setBoundsEdge(defaultLayout(), 2, 'min', -1.5).bounds.max[2], 0.6);
});

test('snap never returns -0', () => {
  assert.ok(Object.is(snap(-0.001), 0));
  assert.ok(Object.is(mirrorPosition([0, 0, 0])[0], 0));
});

test('normalizeLayout keeps a short label, trimmed to 16 characters, and leaves it out when empty', () => {
  assert.equal(normalizeLayout({ label: '  Sleeper  ' }).label, 'Sleeper');
  assert.equal(normalizeLayout({ label: 'A very long label indeed' }).label, 'A very long labe');
  assert.equal('label' in normalizeLayout({ label: '  ' }), false);
  assert.equal('label' in normalizeLayout({}), false);
});

test('normalizeLayout keeps a label colour from the list, blue left out as the default', () => {
  assert.equal(normalizeLayout({ label: 'X', labelColor: 'red' }).labelColor, 'red');
  assert.equal('labelColor' in normalizeLayout({ label: 'X', labelColor: 'blue' }), false);
  assert.equal('labelColor' in normalizeLayout({ label: 'X', labelColor: 'pink' }), false);
  assert.equal('labelColor' in normalizeLayout({ labelColor: 'red' }), false); // no label, no colour
});
