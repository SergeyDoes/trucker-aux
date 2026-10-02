// SVG top and side views of the cab. Drag speakers and the walls of the bounds, wheel to zoom.
// The static layer is redrawn from the layout; the head marker follows the pose separately.
import {
  boundsCenter, createView, drawOrder, fitScale, gridValues, projectAxes, screenAxes,
} from '../shared/view.js';
import { listenerVectors } from '../shared/pose.js';
import { directionMarker, speakerGlyph, svg } from './marks.js';

const GRID = 0.1;
const GAZE = 0.35;   // metres, length of the gaze arrow
const EDGE_HIT = 8;  // px, invisible stroke width that makes walls easy to grab
const DRAG_START = 3; // px the pointer has to travel before a press becomes a drag
const TITLES = { top: 'Top view (from above)', side: 'Side view (from the left)' };
// Same names as the wall inputs of the Bounds panel.
const WALL_NAMES = [{ min: 'Left', max: 'Right' }, { min: 'Bottom', max: 'Top' }, { min: 'Front', max: 'Back' }];
const WALL_GAP = 6;  // px between a wall and its name, outside the bounds

function speakerShape(s, x, y, selected, silent) {
  const shape = speakerGlyph(s.type, x, y);
  shape.setAttribute('class', `speaker ${s.channel}${selected ? ' selected' : ''}${silent ? ' silent' : ''}`);
  shape.dataset.id = s.id;
  return shape;
}

// Wall names sit outside the bounds at the middle of each wall; the side ones are
// turned to read along the wall. Speaker labels are drawn later, with a halo.
function wallLabel(name, wall, box) {
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  if (wall.role === 'h') {
    const outwards = wall.px < midX ? -1 : 1;
    const x = wall.px + outwards * WALL_GAP;
    return svg('text', {
      x, y: midY, class: 'wall-label', 'text-anchor': 'middle', transform: `rotate(${90 * outwards} ${x} ${midY})`,
    }, [name]);
  }
  const below = wall.px > midY;
  return svg('text', {
    x: midX,
    y: wall.px + (below ? WALL_GAP : -WALL_GAP),
    class: 'wall-label',
    'text-anchor': 'middle',
    'dominant-baseline': below ? 'hanging' : 'alphabetic',
  }, [name]);
}

// Speakers on the same spot (a mirrored pair in the side view) share one label,
// nearest name first; more than two show as "name +N". Labels go above all shapes.
function drawSpeakers(view, layer, speakers, selectedIds, silentIds) {
  const chosen = new Set(selectedIds);
  const silent = new Set(silentIds);
  const labels = new Map();
  for (const s of drawOrder(view.kind, speakers, selectedIds)) {
    const [x, y] = view.toScreen(s.position);
    layer.append(speakerShape(s, x, y, chosen.has(s.id), silent.has(s.id)));
    const spot = `${Math.round(x)}:${Math.round(y)}`;
    labels.set(spot, { x, y, names: [s.name, ...(labels.get(spot)?.names ?? [])] });
  }
  for (const { x, y, names } of labels.values()) {
    const text = names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(' / ');
    layer.append(svg('text', { x: x + 10, y: y - 9, class: 'label' }, [text]));
  }
}

export function createViews(root, actions) {
  const panes = ['top', 'side'].map((kind) => {
    const canvas = svg('svg', { class: 'view-svg' });
    const staticLayer = svg('g');
    const headLayer = svg('g', { class: 'head' });
    const bandLayer = svg('g'); // the selection box while dragging on empty space
    canvas.append(staticLayer, headLayer, bandLayer);
    const header = document.createElement('header');
    header.textContent = TITLES[kind];
    const pane = document.createElement('section');
    pane.className = 'view';
    pane.append(header, canvas);
    return { kind, canvas, staticLayer, headLayer, bandLayer, header, pane };
  });
  const fitButton = document.createElement('button');
  fitButton.textContent = 'Fit';
  panes[0].header.append(fitButton);
  root.replaceChildren(...panes.map((p) => p.pane));

  let model = null;
  let pose = null;
  let headX = 0;
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
    const { bounds } = model.layout;
    center = boundsCenter(bounds);
    scale = Math.min(...panes.map((p) => {
      const { width, height } = size(p);
      return fitScale(p.kind, bounds, width, height);
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

  function drawBounds(view, layer, bounds) {
    const [x1, y1] = view.toScreen(bounds.min);
    const [x2, y2] = view.toScreen(bounds.max);
    const left = Math.min(x1, x2), right = Math.max(x1, x2), top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    layer.append(svg('rect', { x: left, y: top, width: right - left, height: bottom - top, class: 'bounds' }));
    // One grab line per wall; which wall is min or max depends on the axis direction on screen.
    const walls = [
      { role: 'h', px: x1, side: 'min' }, { role: 'h', px: x2, side: 'max' },
      { role: 'v', px: y1, side: 'min' }, { role: 'v', px: y2, side: 'max' },
    ];
    for (const wall of walls) {
      const attrs = wall.role === 'h'
        ? { x1: wall.px, y1: top, x2: wall.px, y2: bottom }
        : { x1: left, y1: wall.px, x2: right, y2: wall.px };
      const axis = view.axisOf(wall.role);
      const line = svg('line', { ...attrs, class: `edge ${wall.role}`, 'stroke-width': EDGE_HIT });
      line.dataset.edge = `${axis}:${wall.side}:${wall.role}`;
      layer.append(wallLabel(WALL_NAMES[axis][wall.side], wall, { left, right, top, bottom }), line);
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
      drawBounds(view, layer, model.layout.bounds);
      // X = 0 is the vehicle's axis, the mirror line of speaker pairs. Its name goes just
      // inside the front wall: the wall's own name is centred on the axis outside it.
      if (pane.kind === 'top') {
        const x = view.pixelAt('h', 0);
        const { min, max } = model.layout.bounds;
        const front = Math.min(view.toScreen(min)[1], view.toScreen(max)[1]);
        layer.append(
          svg('line', { x1: x, y1: 0, x2: x, y2: view.height, class: 'truck-axis' }),
          svg('text', { x: x + 4, y: Math.max(12, front + 14), class: 'wall-label' }, ['Vehicle axis']),
        );
      }
      const [ox, oy] = view.toScreen([0, 0, 0]);
      // The zero point: on the truck's axis, at the driver's eye level and seat line.
      layer.append(
        svg('path', { d: `M${ox - 6},${oy} h12 M${ox},${oy - 6} v12`, class: 'origin' }),
        svg('text', { x: ox + 11, y: oy + 16, class: 'wall-label' }, ['0']),
      );
      drawSpeakers(view, layer, model.layout.speakers, model.selectedIds, model.silentIds);
      // Bottom-left corner, on a backing so it stays readable over the bounds.
      const marker = directionMarker(projectAxes(screenAxes(pane.kind)), 58, view.height - 40, 22);
      layer.append(marker);
      const box = marker.getBBox();
      marker.prepend(svg('rect', {
        x: box.x - 5, y: box.y - 4, width: box.width + 10, height: box.height + 8, rx: 4, class: 'compass-bg',
      }));
    }
    drawHead();
  }

  function drawHead() {
    const active = pose && pose.sdkActive && !pose.paused;
    const position = active ? [headX + pose.head.x, pose.head.y, pose.head.z] : [headX, 0, 0];
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
  // headX: the driver's default head, left of the truck's axis (pose.js headRestX).
  function setPose(next, nextHeadX = 0) {
    pose = next;
    headX = nextHeadX;
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

  // Pointer: a speaker is grabbed with the rest of the selection (ctrl+click toggles it);
  // a wall is dragged; on empty space a box selects (ctrl adds), a plain click clears.
  for (const pane of panes) {
    pane.canvas.addEventListener('pointerdown', (event) => {
      if (!model || event.button !== 0) return;
      const view = viewOf(pane);
      const start = localPoint(pane, event);
      const toggle = event.ctrlKey || event.metaKey;
      const speaker = event.target.closest('[data-id]');
      const edge = event.target.closest('[data-edge]');
      if (speaker) {
        const { id } = speaker.dataset;
        if (toggle) {
          actions.selectSpeaker(id, { toggle: true });
          return;
        }
        const selected = model.selectedIds.includes(id);
        if (!selected) actions.selectSpeaker(id);
        drag = { kind: 'speaker', id, pane, view, start, moved: false, inGroup: selected && model.selectedIds.length > 1 };
      } else if (edge) {
        const [axis, side, role] = edge.dataset.edge.split(':');
        drag = { kind: 'edge', axis: Number(axis), side, role, pane, view, start, moved: false };
      } else {
        drag = { kind: 'box', pane, view, start, moved: false, add: toggle };
      }
      pane.canvas.setPointerCapture(event.pointerId);
    });
    pane.canvas.addEventListener('pointermove', (event) => {
      if (!drag || drag.pane !== pane) return;
      const [x, y] = localPoint(pane, event);
      // A click that wobbles by a pixel or two is still a click.
      if (!drag.moved && Math.hypot(x - drag.start[0], y - drag.start[1]) < DRAG_START) return;
      drag.moved = true;
      if (drag.kind === 'speaker') {
        const current = model.layout.speakers.find((s) => s.id === drag.id);
        if (current) actions.moveSelection(drag.id, drag.view.fromScreen(x, y, current.position));
      } else if (drag.kind === 'edge') {
        actions.setBoundsEdge(drag.axis, drag.side, drag.view.valueAt(drag.role, drag.role === 'h' ? x : y));
      } else {
        drag.end = [x, y];
        const [left, right] = [Math.min(x, drag.start[0]), Math.max(x, drag.start[0])];
        const [top, bottom] = [Math.min(y, drag.start[1]), Math.max(y, drag.start[1])];
        pane.bandLayer.replaceChildren(svg('rect', {
          x: left, y: top, width: right - left, height: bottom - top, class: 'band',
        }));
      }
    });
    pane.canvas.addEventListener('pointerup', () => {
      if (drag?.kind === 'speaker' && !drag.moved && drag.inGroup) actions.selectSpeaker(drag.id);
      if (drag?.kind === 'box') {
        if (drag.moved && drag.end) {
          const [x0, x1] = [Math.min(drag.start[0], drag.end[0]), Math.max(drag.start[0], drag.end[0])];
          const [y0, y1] = [Math.min(drag.start[1], drag.end[1]), Math.max(drag.start[1], drag.end[1])];
          const inside = model.layout.speakers.filter((s) => {
            const [x, y] = drag.view.toScreen(s.position);
            return x >= x0 && x <= x1 && y >= y0 && y <= y1;
          });
          actions.selectBox(inside.map((s) => s.id), drag.add);
        } else if (!drag.add) {
          actions.selectSpeaker(null);
        }
      }
      pane.bandLayer.replaceChildren();
      drag = null;
    });
    pane.canvas.addEventListener('pointercancel', () => {
      pane.bandLayer.replaceChildren();
      drag = null;
    });
    pane.canvas.addEventListener('wheel', (event) => {
      if (scale === null) return;
      event.preventDefault();
      scale *= Math.exp(-event.deltaY * 0.001);
      draw();
    }, { passive: false });
  }

  return { update, setPose };
}
