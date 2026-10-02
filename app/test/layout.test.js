import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SPEAKERS, STORE_VERSION, addPair, addSpeaker, centerOn, copySpeakers, defaultLayout, linkPair, mirrorPosition,
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

test('normalizeStore keeps and normalizes truck presets', () => {
  const store = normalizeStore({ version: STORE_VERSION, trucks: { 'vehicle.x': { name: 'X 1', width: 0.5 }, '': {} } });
  assert.equal(store.version, 2);
  assert.deepEqual(store.default, defaultLayout());
  assert.deepEqual(Object.keys(store.trucks), ['vehicle.x']);
  assert.equal(store.trucks['vehicle.x'].name, 'X 1');
  assert.equal(store.trucks['vehicle.x'].width, 0.5);
});

test('normalizeStore keeps assignments only to presets that exist', () => {
  const store = normalizeStore({
    version: STORE_VERSION,
    trucks: { 'custom.1': {} },
    assignments: { 'vehicle.x@3.2': 'custom.1', 'vehicle.x@2.1': 'gone', 'vehicle.y': 7 },
  });
  assert.deepEqual(store.assignments, { 'vehicle.x@3.2': 'custom.1' });
  assert.deepEqual(normalizeStore({}).assignments, {});
});

test('normalizeStore converts version 1: X then started at the head, now at the centre of the bounds', () => {
  const door = (id, x, pair) => ({ id, name: id, position: [x, -0.6, -0.35], channel: 'L', pair });
  const old = {
    version: 1,
    default: { field: { min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] }, speakers: [door('s1', -0.72, 's2'), door('s2', 1.52, 's1')] },
    trucks: { 'vehicle.intnational.9900i': { name: '9900i', field: { min: [-0.67, -1.15, -1.3], max: [1.63, 0.95, 0.6] }, speakers: [door('s1', -0.64, null)] } },
  };
  const store = normalizeStore(old);
  assert.equal(store.version, 2);
  assert.deepEqual(store.default.bounds, defaultLayout().bounds);
  assert.deepEqual(store.default.speakers.map((s) => s.position[0]), [-1.12, 1.12]);
  const truck = store.trucks['vehicle.intnational.9900i'];
  assert.deepEqual(truck.bounds, defaultLayout().bounds);
  assert.equal(truck.speakers[0].position[0], -1.12);
  // A file without a version is version 1; a version 2 file is taken as it is.
  assert.equal(normalizeStore({ default: old.default }).default.speakers[0].position[0], -1.12);
  const kept = normalizeStore({ version: 2, default: { bounds: { min: [-0.5, -1, -1], max: [1, 1, 1] } } });
  assert.deepEqual(kept.default.bounds.min, [-0.5, -1, -1]);
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

// Door L (s1) and Door R (s2) are a mirrored pair; s3 is a lone speaker.
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
  assert.deepEqual([l.name, l.position, l.pair], ['Door L copy', [-1.12, -0.6, -0.25], 's5']);
  assert.deepEqual([r.name, r.position, r.pair], ['Door R copy', [1.12, -0.6, -0.25], 's4']);
  const twice = pasteSpeakers(once.layout, clip);
  assert.deepEqual(twice.layout.speakers.slice(5).map((s) => [s.name, s.position[2]]), [['Door L copy 2', -0.15], ['Door R copy 2', -0.15]]);
});

test('paste into another layout lands in place; lone halves are unpaired', () => {
  const clip = copySpeakers(withCenter(), ['s1', 's2', 's3']);
  const target = { ...defaultLayout(), speakers: [] };
  const { layout, ids } = pasteSpeakers(target, clip);
  assert.deepEqual(ids, ['s1', 's2', 's3']);
  assert.deepEqual(layout.speakers.map((s) => s.name), ['Door L', 'Door R', 'Speaker 3']);
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
