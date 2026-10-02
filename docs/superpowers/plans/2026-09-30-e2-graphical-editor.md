# E2: Graphical Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place speakers and shape the cab with the mouse in SVG top and side views, with a read-only three.js 3D overview.

**Architecture:** Pure view math (`shared/view.js`: axis mapping, fitting, grid values, nudging) and cabin editing (`layout.setCabinEdge`) are unit-tested. `renderer/views.js` draws both SVG views from the playing layout and turns pointer gestures into the existing edit actions; the head marker is a separate layer updated from the pose without redrawing. `renderer/overview3d.js` renders the same layout with three.js (loaded through an import map, dynamically, so the app still works without it).

**Tech Stack:** SVG + pointer events, three.js 0.186 (MIT) with OrbitControls, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-speaker-editor-design.md`, section "Editor UI" (delivery 2). Builds on `docs/superpowers/plans/2026-09-30-e1-editor-foundation.md`.

## Global Constraints

- Everything in English (UI, comments, docs); the English guard test must stay green.
- The user commits; never commit. Show changed files at the end of each task.
- `npm install three` only after the user's explicit yes (`three` 0.186.1, MIT, 20.4 MB unpacked, 1263 files).
- Axes: X right, Y up, Z back (forward is −Z); metres from the default head position; positions snap to 1 cm.
- Top view: X to the right, forward (−Z) up. Side view, seen from the left: forward (−Z) to the left, up (+Y) up.
- Grid 10 cm, stronger lines every 50 cm. Colours: L `#2f6fde`, R `#d9463b`, M `#2f9e5a`. Shapes: circle full range, diamond tweeter, square sub.
- Cabin walls stay at least 20 cm apart; moving a wall keeps mirrored pairs mirrored about the new centre line.
- The 3D view is read-only.

## File map

| File | Responsibility |
|---|---|
| `app/src/shared/view.js` | screen mapping per view, fit scale, grid values, arrow-key nudge |
| `app/src/shared/layout.js` | `setCabinEdge`; `snap` without −0 |
| `app/src/renderer/views.js` | SVG top/side views: drawing, dragging, zoom, fit, head layer |
| `app/src/renderer/overview3d.js` | three.js overview |
| `app/src/renderer/panel.js` | "Cabin, cm" fieldset |
| `app/src/renderer/app.js` | wiring: moves, cabin edges, keyboard, pose to the views |
| `app/src/renderer/index.html`, `style.css` | three-column layout, import map |
| `app/test/view.test.js`, `app/test/layout.test.js` | unit tests |

---

### Task 1: View math and cabin editing

**Files:**
- Create: `app/src/shared/view.js`
- Modify: `app/src/shared/layout.js`
- Test: `app/test/view.test.js`, `app/test/layout.test.js`

**Interfaces:**
- Consumes: `snap`, `mirrorPosition` (E1).
- Produces:
  - `createView(kind: 'top' | 'side', { width, height, scale, center: [x,y,z] })` → `{ kind, width, height, scale, center, toScreen(p): [sx, sy], fromScreen(sx, sy, p): p', axisOf(role: 'h' | 'v'): 0|1|2, valueAt(role, px): metres, pixelAt(role, metres): px }`;
  - `cabinCenter(cabin): [x,y,z]`, `fitScale(kind, cabin, width, height, margin = 0.15): number`;
  - `gridValues(from, to, step): number[]` (ascending, whatever the order of from/to);
  - `nudge(position, key, big): position | null` (arrows move in the top-view plane: Left/Right = X, Up = forward −Z, Down = +Z; 1 cm, or 10 cm with `big`);
  - `setCabinEdge(layout, axis: 0|1|2, side: 'min' | 'max', value: metres): Layout`.

- [x] **Step 1: Write the failing tests**

`app/test/view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabinCenter, createView, fitScale, gridValues, nudge } from '../src/shared/view.js';

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

test('fitScale fits the cabin with a margin; cabinCenter', () => {
  const cabin = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.equal(fitScale('top', cabin, 400, 300, 0.2), 125);
  assert.deepEqual(cabinCenter({ min: [-0.75, -1.15, -1.3], max: [1.55, 0.95, 0.6] }).map((c) => Math.round(c * 100) / 100), [0.4, -0.1, -0.35]);
});

test('gridValues lists multiples of the step in range', () => {
  assert.deepEqual(gridValues(-0.25, 0.1, 0.1).map((x) => Math.round(x * 10) / 10), [-0.2, -0.1, 0, 0.1]);
  assert.deepEqual(gridValues(0.1, -0.25, 0.1).map((x) => Math.round(x * 10) / 10), [-0.2, -0.1, 0, 0.1]);
});

test('nudge moves in the top-view plane', () => {
  assert.deepEqual(nudge([0, 0, 0], 'ArrowRight', false), [0.01, 0, 0]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowLeft', false), [-0.01, 0, 0]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowUp', true), [0, 0, -0.1]);
  assert.deepEqual(nudge([0, 0, 0], 'ArrowDown', false), [0, 0, 0.01]);
  assert.equal(nudge([0, 0, 0], 'KeyA', false), null);
});
```

Append to `app/test/layout.test.js` (and add `setCabinEdge` to its import list):

```js
test('setCabinEdge moves a wall and keeps pairs mirrored about the new centre', () => {
  const layout = setCabinEdge(defaultLayout(), 0, 'max', 1.35);
  assert.equal(layout.cabin.max[0], 1.35);
  assert.deepEqual(layout.speakers[0].position, [-0.72, -0.6, -0.35]);
  close(layout.speakers[1].position, [1.32, -0.6, -0.35]);
});

test('setCabinEdge keeps walls at least 20 cm apart and snaps', () => {
  const layout = setCabinEdge(defaultLayout(), 0, 'min', 2);
  assert.equal(layout.cabin.min[0], 1.35);
  assert.equal(setCabinEdge(defaultLayout(), 1, 'max', 0.9876).cabin.max[1], 0.99);
});

test('snap never returns -0', () => {
  assert.ok(Object.is(snap(-0.001), 0));
});
```

- [x] **Step 2: Run them to see them fail**

Run: `cd app && npm test`
Expected: FAIL (`view.js` missing, `setCabinEdge` not exported).

- [x] **Step 3: Implement `app/src/shared/view.js`**

```js
import { snap } from './layout.js';

// Screen mapping for the 2D editor views. Each view shows two of the three axes:
// top — X to the right, Z down (forward, -Z, is up); side, seen from the left —
// Z to the right (forward to the left), Y up.
const AXES = {
  top: { h: { axis: 0, sign: 1 }, v: { axis: 2, sign: 1 } },
  side: { h: { axis: 2, sign: 1 }, v: { axis: 1, sign: -1 } },
};

export function createView(kind, { width, height, scale, center }) {
  const roles = AXES[kind];
  const half = { h: width / 2, v: height / 2 };
  const pixelAt = (role, metres) => {
    const { axis, sign } = roles[role];
    return half[role] + sign * (metres - center[axis]) * scale;
  };
  const valueAt = (role, px) => {
    const { axis, sign } = roles[role];
    return center[axis] + (px - half[role]) / (sign * scale);
  };
  return {
    kind, width, height, scale, center,
    axisOf: (role) => roles[role].axis,
    pixelAt,
    valueAt,
    toScreen: (p) => [pixelAt('h', p[roles.h.axis]), pixelAt('v', p[roles.v.axis])],
    fromScreen(x, y, p) {
      const q = [...p];
      q[roles.h.axis] = snap(valueAt('h', x));
      q[roles.v.axis] = snap(valueAt('v', y));
      return q;
    },
  };
}

export function cabinCenter(cabin) {
  return cabin.min.map((m, i) => (m + cabin.max[i]) / 2);
}

// Pixels per metre that fit the cabin, plus a margin on every side, into a view.
export function fitScale(kind, cabin, width, height, margin = 0.15) {
  const { h, v } = AXES[kind];
  const spanH = cabin.max[h.axis] - cabin.min[h.axis] + 2 * margin;
  const spanV = cabin.max[v.axis] - cabin.min[v.axis] + 2 * margin;
  return Math.min(width / spanH, height / spanV);
}

export function gridValues(from, to, step) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const values = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) values.push(k * step);
  return values;
}

// Arrow keys move the selected speaker in the top view's plane.
const NUDGE = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [2, -1], ArrowDown: [2, 1] };

export function nudge(position, key, big) {
  const step = NUDGE[key];
  if (!step) return null;
  const q = [...position];
  q[step[0]] = snap(q[step[0]] + step[1] * (big ? 0.1 : 0.01));
  return q;
}
```

- [x] **Step 4: Add `setCabinEdge` and fix `snap` in `app/src/shared/layout.js`**

`snap` becomes:

```js
// Rounds metres to whole centimetres (never -0).
export function snap(metres) {
  return Math.round(metres * 100) / 100 + 0;
}
```

Add after `setWidth`:

```js
const MIN_CABIN = 0.2; // metres between opposite walls

// Moves one cabin wall. Mirrored pairs stay mirror images about the new centre line:
// the first speaker of each pair keeps its place, its partner follows.
export function setCabinEdge(layout, axis, side, value) {
  const min = [...layout.cabin.min];
  const max = [...layout.cabin.max];
  const v = clamp(isNum(value) ? value : 0, -COORD_LIMIT, COORD_LIMIT);
  if (side === 'min') min[axis] = snap(Math.min(v, max[axis] - MIN_CABIN));
  else max[axis] = snap(Math.max(v, min[axis] + MIN_CABIN));
  const cabin = { min, max };
  const speakers = layout.speakers.map((s) => ({ ...s }));
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const done = new Set();
  for (const s of speakers) {
    if (!s.pair || done.has(s.id)) continue;
    done.add(s.id);
    done.add(s.pair);
    byId.get(s.pair).position = mirrorPosition(s.position, cabin);
  }
  return { ...layout, cabin, speakers };
}
```

- [x] **Step 5: Run the tests**

Run: `cd app && npm test`
Expected: `fail 0`.

- [x] **Step 6: Show the user the changed files**

---

### Task 2: SVG top and side views

**Files:**
- Create: `app/src/renderer/views.js`
- Modify: `app/src/renderer/index.html`, `app/src/renderer/style.css`, `app/src/renderer/panel.js`, `app/src/renderer/app.js`

**Interfaces:**
- Consumes: `createView`, `cabinCenter`, `fitScale`, `gridValues`, `nudge` (Task 1); `setCabinEdge`, `updateSpeaker` (layout); `listenerVectors` (pose).
- Produces:
  - `createViews(root, actions)` → `{ update({ layout, layoutKey, selectedId }), setPose(pose) }`;
  - new actions used by the views and the panel: `moveSpeaker(id, position)`, `setCabinEdge(axis, side, metres)`, `selectSpeaker(id | null)`;
  - panel view field `cabin` (the playing layout's cabin).

- [x] **Step 1: Create `app/src/renderer/views.js`**

```js
// SVG top and side views of the cab. Drag speakers and cabin walls, wheel to zoom.
// The static layer is redrawn from the layout; the head marker follows the pose separately.
import { cabinCenter, createView, fitScale, gridValues } from '../shared/view.js';
import { listenerVectors } from '../shared/pose.js';

const NS = 'http://www.w3.org/2000/svg';
const GRID = 0.1;
const GAZE = 0.35;   // metres, length of the gaze arrow
const EDGE_HIT = 8;  // px, invisible stroke width that makes walls easy to grab
const TITLES = { top: 'Top view', side: 'Side view (from the left)' };

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function speakerShape(s, x, y, selected) {
  const cls = `speaker ${s.channel}${selected ? ' selected' : ''}`;
  let shape;
  if (s.type === 'tweeter') shape = svg('polygon', { points: `${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}`, class: cls });
  else if (s.type === 'sub') shape = svg('rect', { x: x - 7, y: y - 7, width: 14, height: 14, class: cls });
  else shape = svg('circle', { cx: x, cy: y, r: 7, class: cls });
  const group = svg('g', {}, [shape, svg('text', { x: x + 10, y: y - 9, class: 'label' }, [s.name])]);
  group.dataset.id = s.id;
  return group;
}

export function createViews(root, actions) {
  const panes = ['top', 'side'].map((kind) => {
    const canvas = svg('svg', { class: 'view-svg' });
    const staticLayer = svg('g');
    const headLayer = svg('g', { class: 'head' });
    canvas.append(staticLayer, headLayer);
    const header = document.createElement('header');
    header.textContent = TITLES[kind];
    const pane = document.createElement('section');
    pane.className = 'view';
    pane.append(header, canvas);
    return { kind, canvas, staticLayer, headLayer, header, pane };
  });
  const fitButton = document.createElement('button');
  fitButton.textContent = 'Fit';
  panes[0].header.append(fitButton);
  root.replaceChildren(...panes.map((p) => p.pane));

  let model = null;
  let pose = null;
  let scale = null;
  let center = [0, 0, 0];
  let fittedKey = null;
  let drag = null;

  const size = (pane) => {
    const r = pane.canvas.getBoundingClientRect();
    return { width: r.width, height: r.height };
  };
  const viewOf = (pane) => createView(pane.kind, { ...size(pane), scale, center });
  const localPoint = (pane, event) => {
    const r = pane.canvas.getBoundingClientRect();
    return [event.clientX - r.left, event.clientY - r.top];
  };

  function fit() {
    const { cabin } = model.layout;
    center = cabinCenter(cabin);
    scale = Math.min(...panes.map((p) => {
      const { width, height } = size(p);
      return fitScale(p.kind, cabin, width, height);
    }));
  }

  function drawGrid(view, layer) {
    const { width, height } = view;
    for (const [role, extent] of [['h', width], ['v', height]]) {
      for (const metres of gridValues(view.valueAt(role, 0), view.valueAt(role, extent), GRID)) {
        const px = view.pixelAt(role, metres);
        const major = Math.abs(Math.round(metres / GRID)) % 5 === 0;
        const attrs = role === 'h'
          ? { x1: px, y1: 0, x2: px, y2: height }
          : { x1: 0, y1: px, x2: width, y2: px };
        layer.append(svg('line', { ...attrs, class: major ? 'grid major' : 'grid' }));
      }
    }
  }

  function drawCabin(view, layer, cabin) {
    const [x1, y1] = view.toScreen(cabin.min);
    const [x2, y2] = view.toScreen(cabin.max);
    const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    layer.append(svg('rect', { x: left, y: top, width: right - left, height: bottom - top, class: 'cabin' }));
    // One grab line per wall; which wall is min or max depends on the axis direction on screen.
    const walls = [
      { role: 'h', px: x1, side: 'min' }, { role: 'h', px: x2, side: 'max' },
      { role: 'v', px: y1, side: 'min' }, { role: 'v', px: y2, side: 'max' },
    ];
    for (const wall of walls) {
      const attrs = wall.role === 'h'
        ? { x1: wall.px, y1: top, x2: wall.px, y2: bottom }
        : { x1: left, y1: wall.px, x2: right, y2: wall.px };
      const line = svg('line', { ...attrs, class: `edge ${wall.role}`, 'stroke-width': EDGE_HIT });
      line.dataset.edge = `${view.axisOf(wall.role)}:${wall.side}:${wall.role}`;
      layer.append(line);
    }
  }

  function draw() {
    if (!model) return;
    for (const pane of panes) {
      const view = viewOf(pane);
      if (!view.width || !view.height) continue;
      const layer = pane.staticLayer;
      layer.replaceChildren();
      drawGrid(view, layer);
      drawCabin(view, layer, model.layout.cabin);
      const [ox, oy] = view.toScreen([0, 0, 0]);
      layer.append(svg('path', { d: `M${ox - 6},${oy} h12 M${ox},${oy - 6} v12`, class: 'origin' }));
      for (const s of model.layout.speakers) {
        const [x, y] = view.toScreen(s.position);
        layer.append(speakerShape(s, x, y, s.id === model.selectedId));
      }
    }
    drawHead();
  }

  function drawHead() {
    const active = pose && pose.sdkActive && !pose.paused;
    const position = active ? [pose.head.x, pose.head.y, pose.head.z] : [0, 0, 0];
    const { forward } = active ? listenerVectors(pose.head.heading, pose.head.pitch, pose.head.roll) : listenerVectors(0, 0, 0);
    const tip = position.map((c, i) => c + forward[i] * GAZE);
    for (const pane of panes) {
      const view = viewOf(pane);
      if (!view.width || !scale) continue;
      const [x, y] = view.toScreen(position);
      const [tx, ty] = view.toScreen(tip);
      pane.headLayer.replaceChildren(
        svg('line', { x1: x, y1: y, x2: tx, y2: ty, class: 'gaze' }),
        svg('circle', { cx: x, cy: y, r: 9, class: 'head-dot' }),
      );
    }
  }

  let headFrame = 0;
  function setPose(next) {
    pose = next;
    if (!headFrame) headFrame = requestAnimationFrame(() => {
      headFrame = 0;
      drawHead();
    });
  }

  function update(next) {
    model = next;
    const ready = panes.every((p) => size(p).width > 0);
    if (ready && (scale === null || fittedKey !== next.layoutKey)) {
      fittedKey = next.layoutKey;
      fit();
    }
    draw();
  }

  fitButton.onclick = () => {
    if (!model) return;
    fit();
    draw();
  };

  new ResizeObserver(() => {
    if (!model) return;
    if (scale === null) fit();
    draw();
  }).observe(root);

  for (const pane of panes) {
    pane.canvas.addEventListener('pointerdown', (event) => {
      if (!model || event.button !== 0) return;
      const view = viewOf(pane);
      const speaker = event.target.closest('[data-id]');
      const edge = event.target.closest('[data-edge]');
      if (speaker) {
        actions.selectSpeaker(speaker.dataset.id);
        drag = { kind: 'speaker', id: speaker.dataset.id, pane, view };
      } else if (edge) {
        const [axis, side, role] = edge.dataset.edge.split(':');
        drag = { kind: 'edge', axis: Number(axis), side, role, pane, view };
      } else {
        actions.selectSpeaker(null);
        return;
      }
      pane.canvas.setPointerCapture(event.pointerId);
    });
    pane.canvas.addEventListener('pointermove', (event) => {
      if (!drag || drag.pane !== pane) return;
      const [x, y] = localPoint(pane, event);
      if (drag.kind === 'speaker') {
        const current = model.layout.speakers.find((s) => s.id === drag.id);
        if (current) actions.moveSpeaker(drag.id, drag.view.fromScreen(x, y, current.position));
      } else {
        actions.setCabinEdge(drag.axis, drag.side, drag.view.valueAt(drag.role, drag.role === 'h' ? x : y));
      }
    });
    const stop = () => {
      drag = null;
    };
    pane.canvas.addEventListener('pointerup', stop);
    pane.canvas.addEventListener('pointercancel', stop);
    pane.canvas.addEventListener('wheel', (event) => {
      if (scale === null) return;
      event.preventDefault();
      scale *= Math.exp(-event.deltaY * 0.001);
      draw();
    }, { passive: false });
  }

  return { update, setPose };
}
```

- [x] **Step 2: Three-column layout in `index.html` and `style.css`**

`index.html` body becomes:

```html
<body>
  <aside id="panel"></aside>
  <main id="views"></main>
  <section id="overview"><p class="placeholder">3D view</p></section>
  <script type="module" src="app.js"></script>
</body>
```

In `style.css` replace the `body` and `#editor` rules with:

```css
body { margin: 0; display: grid; grid-template-columns: 340px 1fr 340px; height: 100vh; }
#views { display: grid; grid-template-rows: 1fr 1fr; min-width: 0; min-height: 0; }
#overview { position: relative; border-left: 1px solid #8884; min-height: 0; color: var(--dim); }
.placeholder { margin: 8px; }
.view { display: grid; grid-template-rows: auto 1fr; min-height: 0; border-bottom: 1px solid #8884; }
.view header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-weight: 600; }
.view-svg { width: 100%; height: 100%; display: block; touch-action: none; user-select: none; }
.grid { stroke: #8882; stroke-width: 1; }
.grid.major { stroke: #8885; }
.cabin { fill: #8881; stroke: #888; stroke-width: 1.5; }
.edge { stroke: transparent; }
.edge.h { cursor: ew-resize; }
.edge.v { cursor: ns-resize; }
.edge:hover { stroke: #8884; }
.origin { stroke: var(--dim); stroke-width: 1.5; fill: none; }
.head-dot { fill: #8883; stroke: currentColor; stroke-width: 1.5; }
.gaze { stroke: currentColor; stroke-width: 2; }
.speaker { stroke: #0006; stroke-width: 1; cursor: grab; }
.speaker.L { fill: var(--left); }
.speaker.R { fill: var(--right); }
.speaker.M { fill: var(--mono); }
.speaker.selected { stroke: currentColor; stroke-width: 3; }
.label { font-size: 11px; fill: currentColor; pointer-events: none; }
```

- [x] **Step 3: "Cabin, cm" fieldset in `panel.js`**

Distances from the default head position, positive numbers: left and right walls, floor and roof, front and back. Add before `root.replaceChildren(`:

```js
  const WALLS = [
    ['Left', 0, 'min'], ['Right', 0, 'max'], ['Floor', 1, 'min'],
    ['Roof', 1, 'max'], ['Front', 2, 'min'], ['Back', 2, 'max'],
  ];
  const walls = WALLS.map(([label, axis, side]) => {
    const field = el('input', { type: 'number', step: 1, min: 0 });
    field.onchange = () => actions.setCabinEdge(axis, side, (side === 'min' ? -1 : 1) * Number(field.value) / 100);
    return { label, axis, side, field };
  });
  const cabinForm = el('fieldset', {}, [
    el('legend', { textContent: 'Cabin, cm from the head' }),
    el('div', { className: 'walls' }, walls.map((w) => el('label', {}, [w.label, w.field]))),
  ]);
```

Insert `cabinForm,` after the "Layout" fieldset in `root.replaceChildren(...)`, and at the start of `update(view)`'s layout part (after `widthValue.textContent = ...`):

```js
    for (const w of walls) setValue(w.field, Math.round((w.side === 'min' ? -1 : 1) * view.cabin[w.side][w.axis] * 100));
```

In `style.css` add:

```css
.walls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; }
.walls label { display: grid; gap: 2px; font-size: 11px; color: var(--dim); }
.walls input { width: 100%; box-sizing: border-box; }
```

- [x] **Step 4: Wire the views in `app.js`**

Imports: add `setCabinEdge` to the layout import, and

```js
import { createViews } from './views.js';
import { nudge } from '../shared/view.js';
```

Actions: replace `selectSpeaker` and add two:

```js
  selectSpeaker(id) {
    state.selectedId = id;
    render();
  },
  moveSpeaker(id, position) {
    edit((layout) => updateSpeaker(layout, id, { position }));
  },
  setCabinEdge(axis, side, metres) {
    edit((layout) => setCabinEdge(layout, axis, side, metres));
  },
```

After `const panel = createPanel(...)`:

```js
const views = createViews(document.getElementById('views'), actions);
```

In `render()`, pass `cabin: layout.cabin` to `panel.update`, then add:

```js
  views.update({ layout, layoutKey: current.key ?? 'default', selectedId: state.selectedId });
```

In the `onPose` handler, after `audio?.engine.setPose(pose);`:

```js
  views.setPose(pose);
```

Keyboard, before the final `render();`:

```js
// Arrow keys nudge the selected speaker (Shift: 10 cm); Delete removes it.
document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, select, textarea') || !state.selectedId) return;
  if (event.key === 'Delete') {
    actions.deleteSelected();
    return;
  }
  const speaker = playing().layout.speakers.find((s) => s.id === state.selectedId);
  const position = speaker && nudge(speaker.position, event.key, event.shiftKey);
  if (!position) return;
  event.preventDefault();
  actions.moveSpeaker(state.selectedId, position);
});
```

- [x] **Step 5: Syntax check, unit tests, engine check**

Run: `cd app && node --check src/renderer/views.js && node --check src/renderer/app.js && node --check src/renderer/panel.js && npm test && npm run test:engine`
Expected: no syntax errors, `fail 0`, 8 `PASS`.

- [x] **Step 6: Smoke test through the debugging port (muted, the user's instance untouched)**

Start `electron . --remote-debugging-port=9224 --mute-audio` from `app/` and evaluate:
- two `svg.view-svg` elements with non-zero size; `.speaker` shapes: 2 per view; `.edge` lines: 4 per view;
- dispatch `pointerdown` / `pointermove` / `pointerup` on the Door L circle in the top view, 50 px to the right: its X in the panel grows by about 50 / scale × 100 cm, and Door R moves the opposite way;
- `app/data/layouts.json` afterwards: delete it if the smoke test created it (it contains test edits).

- [x] **Step 7: Show the user the changed files**

---

### Task 3: three.js 3D overview

**Files:**
- Create: `app/src/renderer/overview3d.js`
- Modify: `app/package.json` (dependency), `app/src/renderer/index.html` (import map), `app/src/renderer/app.js`

**Interfaces:**
- Consumes: `cabinCenter` (view.js), `listenerVectors` is not needed — the head uses SCS Euler angles directly (three.js `'YXZ'` order equals R = Ry(heading)·Rx(pitch)·Rz(roll)).
- Produces: `createOverview(root)` → `{ update({ layout, layoutKey, selectedId }), setPose(pose) }`.

- [x] **Step 1: Ask for permission and install three**

Ask: "May I run `npm install three` in `app/`? three 0.186.1 (MIT) from npmjs.com, 20.4 MB unpacked (1263 files, mostly examples; the app loads the ~700 KB module and OrbitControls)." After a yes:

Run: `cd app && npm install three@^0.186.1`
Expected: `added 1 package`.

- [x] **Step 2: Import map in `index.html`**

In `<head>`, before the stylesheet:

```html
  <script type="importmap">
    {
      "imports": {
        "three": "../../node_modules/three/build/three.module.js",
        "three/addons/": "../../node_modules/three/examples/jsm/"
      }
    }
  </script>
```

- [x] **Step 3: Create `app/src/renderer/overview3d.js`**

```js
// Read-only 3D overview: translucent cab, head with a gaze cone, speakers.
// three.js shares our axes (X right, Y up, -Z forward), so positions map 1:1.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cabinCenter } from '../shared/view.js';

const COLORS = { L: 0x2f6fde, R: 0xd9463b, M: 0x2f9e5a };
const RADIUS = { full: 0.05, tweeter: 0.035, sub: 0.07 };
const TURN = 2 * Math.PI;

export function createOverview(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  root.replaceChildren(renderer.domElement);
  const hint = document.createElement('p');
  hint.className = 'overview-hint';
  hint.textContent = 'Drag to orbit, wheel to zoom';
  root.append(hint);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  // Cabin: a unit cube scaled and moved to the layout's box.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cabin = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.08, depthWrite: false }));
  const cabinEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x8899aa }));
  scene.add(cabin, cabinEdges);

  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), new THREE.MeshStandardMaterial({ color: 0xbbbbbb })));
  const gaze = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0xe9b20b }));
  gaze.rotation.x = -Math.PI / 2; // the cone points along +Y; turn it to -Z (forward)
  gaze.position.z = -0.19;
  head.add(gaze);
  scene.add(head);

  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const materials = Object.fromEntries(Object.entries(COLORS).map(([channel, color]) => [channel, {
    normal: new THREE.MeshStandardMaterial({ color }),
    selected: new THREE.MeshStandardMaterial({ color, emissive: 0xffffff, emissiveIntensity: 0.35 }),
  }]));
  const speakers = new THREE.Group();
  scene.add(speakers);

  let frame = 0;
  const renderSoon = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  };
  controls.addEventListener('change', renderSoon);

  new ResizeObserver(() => {
    const { width, height } = root.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderSoon();
  }).observe(root);

  let framedKey = null;

  function update({ layout, layoutKey, selectedId }) {
    const center = cabinCenter(layout.cabin);
    const size = layout.cabin.max.map((m, i) => m - layout.cabin.min[i]);
    for (const object of [cabin, cabinEdges]) {
      object.position.set(...center);
      object.scale.set(...size);
    }
    if (framedKey !== layoutKey) {
      framedKey = layoutKey;
      controls.target.set(...center);
      // From behind the driver's left shoulder, slightly above.
      camera.position.set(center[0] - 1.6, center[1] + 1.5, center[2] + 2.8);
      controls.update();
    }
    speakers.clear();
    for (const s of layout.speakers) {
      const mesh = new THREE.Mesh(sphere, materials[s.channel][s.id === selectedId ? 'selected' : 'normal']);
      mesh.scale.setScalar(RADIUS[s.type] * (s.id === selectedId ? 1.4 : 1));
      mesh.position.set(...s.position);
      speakers.add(mesh);
    }
    renderSoon();
  }

  function setPose(pose) {
    const active = pose && pose.sdkActive && !pose.paused;
    if (active) {
      head.position.set(pose.head.x, pose.head.y, pose.head.z);
      head.rotation.set(pose.head.pitch * TURN, pose.head.heading * TURN, pose.head.roll * TURN);
    } else {
      head.position.set(0, 0, 0);
      head.rotation.set(0, 0, 0);
    }
    renderSoon();
  }

  return { update, setPose };
}
```

In `style.css` add:

```css
#overview canvas { display: block; }
.overview-hint { position: absolute; left: 8px; bottom: 4px; margin: 0; font-size: 11px; color: var(--dim); pointer-events: none; }
```

- [x] **Step 4: Wire the overview in `app.js` (optional at runtime)**

After `const views = createViews(...)`:

```js
// three.js is loaded on demand; without it the app still works, only the 3D view is missing.
let overview = null;
import('./overview3d.js')
  .then(({ createOverview }) => {
    overview = createOverview(document.getElementById('overview'));
    render();
    overview.setPose(state.pose);
  })
  .catch((err) => {
    document.getElementById('overview').textContent = `3D view unavailable: ${err.message}`;
  });
```

In `render()`, next to `views.update(...)`:

```js
  overview?.update({ layout, layoutKey: current.key ?? 'default', selectedId: state.selectedId });
```

In the `onPose` handler, next to `views.setPose(pose)`:

```js
  overview?.setPose(pose);
```

- [x] **Step 5: Checks**

Run: `cd app && node --check src/renderer/overview3d.js && npm test && npm run test:engine`
Expected: `fail 0`, 8 `PASS`.
Smoke test (muted, debugging port): `#overview canvas` exists with non-zero size; no "3D view unavailable" text; no uncaught errors in the log.

Fixed after the smoke screenshot (the code above is the first version):
- The canvas was sized from `getBoundingClientRect()`, which includes the 1 px border, so the page scrolled. It now uses the ResizeObserver's `contentRect`; `body` and `#overview` hide overflow, and `body` has `grid-template-rows: minmax(0, 1fr)`.
- The fixed camera offset cropped the cab in the narrow column. `frameDistance(cabin, fovDeg, aspect)` in `view.js` fits the cabin's bounding sphere into the narrower field of view; the overview frames again once its real size is known.
- In the side view a mirrored pair sits on one spot and the labels overlapped. `drawOrder(kind, speakers, selectedId)` in `view.js` draws far speakers first and the selected one last, and speakers on one spot share a label ("Door L / Door R").
- Unit tests for both helpers: 72 in total.

- [x] **Step 6: Show the user the changed files**

---

### Task 4: Final checks

- [x] **Step 1: Run everything**

Run: `cd app && npm test && npm run test:engine`
Expected: `fail 0` (English guard included), 8 `PASS`.

- [x] **Step 2: Update `PLAN.md`**

Mark E2 done (`### E2 — graphical editor ✓`) with a one-line summary and the manual checklist below as the user's part.

- [ ] **Step 3: Manual checklist for the user**

1. Top view: the cab rectangle with the head near the left wall, two door speakers; the gaze arrow turns with the camera in ATS.
2. Drag Door L: Door R moves as its mirror image; the sound follows immediately.
3. Drag the right wall in the top view: Door R stays mirrored about the new centre line.
4. Side view: dragging changes height and front/back.
5. Wheel zooms both views, `Fit` restores.
6. Arrow keys move the selected speaker by 1 cm (Shift 10 cm), Delete removes it.
7. 3D view: cab, head with gaze cone following the camera, speakers; orbit and zoom work.
