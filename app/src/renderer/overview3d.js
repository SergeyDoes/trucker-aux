// Read-only 3D overview: translucent cab, head with a gaze cone, speakers.
// three.js shares our axes (X right, Y up, -Z forward), so positions map 1:1.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { boundsCenter, frameDistance, projectAxes } from '../shared/view.js';
import { directionMarker, svg } from './marks.js';

const COLORS = { L: 0x2f6fde, R: 0xd9463b, M: 0x2f9e5a, silent: 0x8a8a8a }; // silent: muted or soloed away
const SIZE = { tweeter: 0.035, small: 0.035, mid: 0.045, full: 0.05, midbass: 0.06, sub: 0.07 };
const TURN = 2 * Math.PI;
const VIEW_DIR = new THREE.Vector3(-1.6, 1.5, 2.8).normalize();

export function createOverview(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  root.replaceChildren(renderer.domElement);
  const hint = document.createElement('p');
  hint.className = 'overview-hint';
  hint.textContent = 'Drag to orbit, wheel to zoom';
  const compass = svg('svg', { class: 'overview-compass' });
  root.append(hint, compass);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  // Bounds: a unit cube scaled and moved to the layout's box.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const bounds = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.08, depthWrite: false }));
  const boundsEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x8899aa }));
  scene.add(bounds, boundsEdges);

  // Head: R = Ry(heading) * Rx(pitch) * Rz(roll), which is three.js Euler order 'YXZ'.
  const head = new THREE.Group();
  head.rotation.order = 'YXZ';
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), new THREE.MeshStandardMaterial({ color: 0xbbbbbb })));
  const gaze = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0xe9b20b }));
  gaze.rotation.x = -Math.PI / 2; // the cone points along +Y; turn it to -Z (forward)
  gaze.position.z = -0.19;
  head.add(gaze);
  scene.add(head);

  // The same shapes as the 2D glyphs: octahedron (diamond) tweeter, triangular
  // pyramid midrange, sphere full range (smaller when small), hexagonal prism
  // midbass, cube sub.
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const shapes = {
    tweeter: new THREE.OctahedronGeometry(1.2),
    mid: new THREE.ConeGeometry(1.1, 1.8, 3),
    full: sphere,
    small: sphere,
    midbass: new THREE.CylinderGeometry(1.1, 1.1, 1.2, 6),
    sub: new THREE.BoxGeometry(1.6, 1.6, 1.6),
  };
  const materials = Object.fromEntries(Object.entries(COLORS).map(([channel, color]) => [channel, {
    normal: new THREE.MeshStandardMaterial({ color, flatShading: true }),
    selected: new THREE.MeshStandardMaterial({ color, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.35 }),
  }]));
  const speakers = new THREE.Group();
  scene.add(speakers);

  // The camera's own axes in cab space turn the direction marker with the view.
  const basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function drawCompass() {
    camera.matrixWorld.extractBasis(...basis);
    const [right, up, back] = basis.map((v) => v.toArray());
    compass.replaceChildren(directionMarker(projectAxes({ right, up, back }), 70, 55, 30));
  }

  let pending = 0;
  const renderSoon = () => {
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      renderer.render(scene, camera);
      drawCompass();
    });
  };
  controls.addEventListener('change', renderSoon);

  let shown = null; // the bounds on screen
  let framedKey = null;
  let sized = false;

  // Look at the whole cab from behind the driver's left shoulder, slightly above.
  function frame() {
    controls.target.set(...boundsCenter(shown));
    const distance = frameDistance(shown, camera.fov, camera.aspect);
    camera.position.copy(VIEW_DIR).multiplyScalar(distance).add(controls.target);
    controls.update();
  }

  // contentRect excludes the border, so the canvas never overflows the column.
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // update() may run before the first layout; frame again once the size is real.
    if (!sized && shown) frame();
    sized = true;
    renderSoon();
  }).observe(root);

  function update({ layout, layoutKey, selectedIds, silentIds = [] }) {
    const chosen = new Set(selectedIds);
    const silent = new Set(silentIds);
    shown = layout.bounds;
    const center = boundsCenter(layout.bounds);
    const size = layout.bounds.max.map((m, i) => m - layout.bounds.min[i]);
    for (const object of [bounds, boundsEdges]) {
      object.position.set(...center);
      object.scale.set(...size);
    }
    if (framedKey !== layoutKey) {
      framedKey = layoutKey;
      frame();
    }
    speakers.clear();
    for (const s of layout.speakers) {
      const colour = materials[silent.has(s.id) ? 'silent' : s.channel];
      const mesh = new THREE.Mesh(shapes[s.type], colour[chosen.has(s.id) ? 'selected' : 'normal']);
      mesh.scale.setScalar(SIZE[s.type] * (chosen.has(s.id) ? 1.4 : 1));
      mesh.position.set(...s.position);
      speakers.add(mesh);
    }
    renderSoon();
  }

  // headX: the driver's default head, left of the truck's axis (pose.js headRestX).
  function setPose(pose, headX = 0) {
    const active = pose && pose.sdkActive;
    if (active) {
      head.position.set(headX + pose.head.x, pose.head.y, pose.head.z);
      head.rotation.set(pose.head.pitch * TURN, pose.head.heading * TURN, pose.head.roll * TURN);
    } else {
      head.position.set(headX, 0, 0);
      head.rotation.set(0, 0, 0);
    }
    renderSoon();
  }

  return { update, setPose };
}
