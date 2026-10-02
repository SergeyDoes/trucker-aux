import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsCenter, createView, drawOrder, fitScale, frameDistance, gridValues, nudge, projectAxes, screenAxes,
} from '../src/shared/view.js';

const opts = { width: 400, height: 300, scale: 100, center: [0, 0, 0] };

test('top view: X to the right, forward up', () => {
  const v = createView('top', opts);
  assert.deepEqual(v.toScreen([0, 0, 0]), [200, 150]);
  assert.deepEqual(v.toScreen([1, 0, 0]), [300, 150]);
  assert.deepEqual(v.toScreen([0, 0, -1]), [200, 50]);
  assert.deepEqual(v.toScreen([0, 5, 0]), [200, 150]);
});

test('side view from the left: forward to the left, up is up', () => {
  const v = createView('side', opts);
  assert.deepEqual(v.toScreen([0, 0, -1]), [100, 150]);
  assert.deepEqual(v.toScreen([0, 1, 0]), [200, 50]);
  assert.deepEqual(v.toScreen([7, 0, 0]), [200, 150]);
});

test('fromScreen changes only the view plane and snaps to centimetres', () => {
  assert.deepEqual(createView('top', opts).fromScreen(312.34, 150, [0.5, -0.4, 0.3]), [1.12, -0.4, 0]);
  assert.deepEqual(createView('side', opts).fromScreen(150, 110, [0.5, -0.4, 0.3]), [0.5, 0.4, -0.5]);
});

test('valueAt and pixelAt are inverse along one axis', () => {
  const v = createView('side', { ...opts, center: [0, 0.2, -0.3] });
  assert.equal(v.axisOf('h'), 2);
  assert.equal(v.axisOf('v'), 1);
  assert.ok(Math.abs(v.valueAt('v', v.pixelAt('v', 0.75)) - 0.75) < 1e-9);
  assert.ok(Math.abs(v.valueAt('h', v.pixelAt('h', -1.2)) - -1.2) < 1e-9);
});

test('fitScale fits the bounds with a margin; boundsCenter', () => {
  const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.equal(fitScale('top', bounds, 400, 300, 0.2), 125);
  assert.deepEqual(
    boundsCenter({ min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] }).map((c) => Math.round(c * 100) / 100),
    [0.4, -0.1, -0.35],
  );
});

test('gridValues lists multiples of the step in range', () => {
  assert.deepEqual(gridValues(-0.25, 0.1, 0.1).map((x) => Math.round(x * 10) / 10), [-0.2, -0.1, 0, 0.1]);
  assert.deepEqual(gridValues(0.1, -0.25, 0.1).map((x) => Math.round(x * 10) / 10), [-0.2, -0.1, 0, 0.1]);
});

test('drawOrder draws far speakers first and the selected one last', () => {
  const speakers = [
    { id: 'a', position: [-0.7, -0.6, 0] },
    { id: 'b', position: [1.5, -0.6, 0] },
    { id: 'c', position: [0.4, 0.8, 0] },
  ];
  const ids = (list) => list.map((s) => s.id);
  // Top: seen from above, so the lowest is the farthest.
  assert.deepEqual(ids(drawOrder('top', speakers, null)), ['a', 'b', 'c']);
  // Side: seen from the left, so the rightmost is the farthest.
  assert.deepEqual(ids(drawOrder('side', speakers, null)), ['b', 'c', 'a']);
  assert.deepEqual(ids(drawOrder('side', speakers, ['b'])), ['c', 'a', 'b']);
  // Several selected: all above the rest, in depth order among themselves.
  assert.deepEqual(ids(drawOrder('side', speakers, ['c', 'a'])), ['b', 'c', 'a']);
  assert.deepEqual(ids(speakers), ['a', 'b', 'c']);
});

test('frameDistance fits the bounds in the narrower bounds of view', () => {
  const bounds = { min: [-1, -1, -1], max: [1, 1, 1] }; // bounding sphere radius sqrt(3)
  const r = Math.sqrt(3);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(frameDistance(bounds, 90, 1, 1), r / Math.sin(Math.PI / 4)));
  // A tall narrow view is limited by its horizontal bounds of view.
  const hHalf = Math.atan(Math.tan(Math.PI / 4) * 0.5);
  assert.ok(near(frameDistance(bounds, 90, 0.5, 1), r / Math.sin(hHalf)));
  assert.ok(near(frameDistance(bounds, 90, 1, 1.2), 1.2 * r / Math.sin(Math.PI / 4)));
});

test('screenAxes: the viewer\'s right, up and back in cab axes', () => {
  assert.deepEqual(screenAxes('top'), { right: [1, 0, 0], up: [0, 0, -1], back: [0, 1, 0] });
  assert.deepEqual(screenAxes('side'), { right: [0, 0, 1], up: [0, 1, 0], back: [-1, 0, 0] });
});

test('projectAxes: where front, up and right point on screen, far ones first', () => {
  assert.deepEqual(projectAxes(screenAxes('top')), [
    { name: 'Front', x: 0, y: -1, depth: 0 },
    { name: 'Right', x: 1, y: 0, depth: 0 },
    { name: 'Up', x: 0, y: 0, depth: 1 },
  ]);
  assert.deepEqual(projectAxes(screenAxes('side')), [
    { name: 'Right', x: 0, y: 0, depth: -1 },
    { name: 'Front', x: -1, y: 0, depth: 0 },
    { name: 'Up', x: 0, y: -1, depth: 0 },
  ]);
});

test('nudge moves in the top-view plane', () => {
  assert.deepEqual(nudge([0, 0, 0], 'ArrowRight', false), [0.01, 0, 0]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowLeft', false), [-0.01, 0, 0]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowUp', true), [0, 0, -0.1]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowDown', false), [0, 0, 0.01]);
  assert.equal(nudge([0, 0, 0], 'KeyA', false), null);
});
