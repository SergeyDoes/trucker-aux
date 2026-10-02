import { snap } from './layout.js';

// Screen mapping for the 2D editor views. Each view shows two of the three axes:
// top — X to the right, Z down (forward, -Z, is up); side, seen from the left (the
// driver's side) — Z to the right (forward to the left), Y up.
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

const unit = (axis, sign) => [0, 1, 2].map((i) => (i === axis ? sign : 0));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 0; // + 0 turns -0 into 0

// The viewer's screen right, screen up and back (towards the viewer) in cab axes.
export function screenAxes(kind) {
  const { h, v } = AXES[kind];
  const right = unit(h.axis, h.sign);
  const up = unit(v.axis, -v.sign); // screen y grows downwards
  const back = [0, 1, 2].map((i) => {
    const [j, k] = [(i + 1) % 3, (i + 2) % 3];
    return right[j] * up[k] - right[k] * up[j] + 0;
  });
  return { right, up, back };
}

// Direction marker: where the cab's front, up and right point on screen (x right,
// y down, unit length when parallel to the screen). Far ones first, for drawing.
const DIRECTIONS = [['Front', [0, 0, -1]], ['Up', [0, 1, 0]], ['Right', [1, 0, 0]]];

export function projectAxes({ right, up, back }) {
  return DIRECTIONS
    .map(([name, d]) => ({ name, x: dot(d, right), y: 0 - dot(d, up), depth: dot(d, back) }))
    .sort((a, b) => a.depth - b.depth);
}

export function boundsCenter(bounds) {
  return bounds.min.map((m, i) => (m + bounds.max[i]) / 2);
}

// Pixels per metre that fit the bounds, plus a margin on every side, into a view.
export function fitScale(kind, bounds, width, height, margin = 0.15) {
  const { h, v } = AXES[kind];
  const spanH = bounds.max[h.axis] - bounds.min[h.axis] + 2 * margin;
  const spanV = bounds.max[v.axis] - bounds.min[v.axis] + 2 * margin;
  return Math.min(width / spanH, height / spanV);
}

// Speakers that overlap on screen: the one nearer to the viewer is drawn on top, and
// the selected ones above all the others.
export function drawOrder(kind, speakers, selectedIds = []) {
  const { back } = screenAxes(kind);
  const chosen = new Set(selectedIds ?? []);
  const key = (s) => (chosen.has(s.id) ? 1000 : 0) + dot(s.position, back);
  return [...speakers].sort((a, b) => key(a) - key(b));
}

// Camera distance at which the bounds' bounding sphere, grown by `margin`, fills
// the narrower of the vertical and horizontal fields of view. The sphere is already
// looser than the box, so no margin is needed by default.
export function frameDistance(bounds, fovDeg, aspect, margin = 1) {
  const radius = Math.hypot(...bounds.max.map((m, i) => m - bounds.min[i])) / 2;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return (margin * radius) / Math.sin(Math.min(vHalf, hHalf));
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
