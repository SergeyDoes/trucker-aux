// SVG marks shared by the editor views, the speaker list and the 3D view:
// speaker glyphs (shape = type) and the direction marker.
const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

// Unit outlines, from high to low: diamond tweeter, triangle midrange,
// (circle full range, smaller circle small full range), hexagon midbass, (square sub).
const OUTLINES = {
  tweeter: [[0, -1.1], [1.1, 0], [0, 1.1], [-1.1, 0]],
  mid: [[0, -1.2], [1.1, 0.75], [-1.1, 0.75]],
  midbass: [0, 1, 2, 3, 4, 5].map((k) => [1.15 * Math.cos((k * Math.PI) / 3), 1.15 * Math.sin((k * Math.PI) / 3)]),
};

export function speakerGlyph(type, x, y, r = 7) {
  if (OUTLINES[type]) {
    return svg('polygon', { points: OUTLINES[type].map(([px, py]) => `${x + px * r},${y + py * r}`).join(' ') });
  }
  if (type === 'sub') return svg('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  return svg('circle', { cx: x, cy: y, r: type === 'small' ? 0.7 * r : r });
}

// A small standalone icon for lists: glyph coloured by channel, grey when silent.
export function speakerIcon(speaker, silent = false) {
  const cls = `glyph ${speaker.channel}${silent ? ' silent' : ''}`;
  return svg('svg', { class: cls, width: 14, height: 14, viewBox: '-8 -8 16 16' }, [
    speakerGlyph(speaker.type, 0, 0, 5.5),
  ]);
}

const SHORT = 0.2; // an axis this foreshortened points at or away from the viewer: skip it

// Arrows for the cab's front, up and right as seen on screen; axes come from
// projectAxes (view.js), far ones first. Returns a <g class="compass">.
export function directionMarker(axes, cx, cy, length = 26) {
  const group = svg('g', { class: 'compass' });
  for (const { name, x, y } of axes) {
    const size = Math.hypot(x, y);
    if (size < SHORT) continue;
    const [dx, dy] = [x / size, y / size];
    const [tx, ty] = [cx + x * length, cy + y * length];
    const head = [
      [tx, ty],
      [tx - 6 * dx + 3.5 * dy, ty - 6 * dy - 3.5 * dx],
      [tx - 6 * dx - 3.5 * dy, ty - 6 * dy + 3.5 * dx],
    ];
    const label = svg('text', {
      x: tx + 4 * dx,
      y: ty + 4 * dy,
      'text-anchor': dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle',
      'dominant-baseline': dy > 0.35 ? 'hanging' : dy < -0.35 ? 'alphabetic' : 'middle',
    }, [name]);
    group.append(svg('g', { class: `axis ${name}` }, [
      svg('line', { x1: cx, y1: cy, x2: tx, y2: ty }),
      svg('polygon', { points: head.map((p) => p.join(',')).join(' ') }),
      label,
    ]));
  }
  return group;
}
