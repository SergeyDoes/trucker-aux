// The game's shared memory exists only on Windows; elsewhere the app runs without a game
// and does not load the native module at all.
const koffi = process.platform === 'win32' ? (await import('koffi')).default : null;

export const MMF_NAME = 'Local\\SCSTelemetry';
const MMF_SIZE = 32 * 1024;
const FILE_MAP_READ = 0x0004;

// The game camera from our own plugin (native/camera-plugin/camera_block.h), when installed.
export const CAMERA_NAME = 'Local\\TruckerAuxCamera';
export const CAMERA_SIZE = 64;

// Offsets from third_party/scs-sdk-plugin/scs-telemetry/inc/scs-telemetry-common.hpp
// (offsetof, MSVC x64), the same as in tools/shm_probe.py.
const OFF_SDK_ACTIVE = 0;
const OFF_PAUSED = 4;
const OFF_PLUGIN_REVISION = 40;    // scs_values.telemetry_plugin_revision: these offsets are revision 12's
const OFF_GAME = 52;               // scs_values.game, u32: 1 ETS2, 2 ATS
const OFF_RENDER_TIME = 24;        // u64, µs; stands still outside the game world
const OFF_GEAR = 504;              // truck_i.gear, int; negative is reverse
const OFF_GAME_STEER = 972;        // truck_f.gameSteer, -1..1, positive is left
const OFF_ELECTRIC_ENABLED = 1575; // truck_b.electricEnabled
const OFF_ENGINE_ENABLED = 1576;   // truck_b.engineEnabled
const OFF_BLINKER_LEFT = 1578;     // truck_b.blinkerLeftActive: the lever, not the blinking light
const OFF_BLINKER_RIGHT = 1579;    // truck_b.blinkerRightActive
const OFF_CABIN_POSITION = 1640;   // config_fv.cabinPosition, 3 floats, vehicle space
const OFF_HEAD_POSITION = 1652;    // config_fv.headPosition, 3 floats, cabin space
const OFF_HOOK_Z = 1672;           // config_fv.truckHookPositionZ, fifth wheel, vehicle space
const OFF_CABIN_OFFSET = 2000;     // 6 floats: x y z heading pitch roll of the cab on its suspension
const OFF_HEAD_OFFSET = 2024; // 6 floats: x y z heading pitch roll, angles in turns
const OFF_WORLD = 2200;            // truck_dp: 6 doubles, the truck's world position and heading pitch roll
const OFF_TRUCK_BRAND_ID = 2300;
const OFF_TRUCK_BRAND = 2364;
const OFF_TRUCK_ID = 2428;
const OFF_TRUCK_NAME = 2492;
const OFF_PLATE = 3212;            // config_s.truckLicensePlate, the same for a truck you own
const OFF_JOB_MARKET = 3404;       // config_s.jobMarket, 32 bytes: "quick_job" lends a truck
const STR_SIZE = 64;
const MARKET_SIZE = 32;
export const SNAPSHOT_SIZE = OFF_JOB_MARKET + MARKET_SIZE; // only the start of the structure is copied

const GAMES = { 1: 'ets2', 2: 'ats' };
const decoder = new TextDecoder();

function readString(view, offset, size = STR_SIZE) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, size);
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

// Preset key: the game's truck id; if it is empty, brand id + model name.
export function truckKey({ brandId, id, name }) {
  if (id) return id;
  if (brandId || name) return `${brandId}/${name}`;
  return null;
}

// The truck's centre line relative to the default head position, metres, + is right.
// Vehicles are symmetric about x = 0 of vehicle space, and the default head sits at
// cabinPosition + headPosition there. All zeros: the game has not sent them, unknown.
// Checked in ATS: 0.477 for the International 9900i, 0.385 for a Ford Mustang 1967.
function truckCenterX(view) {
  const head = [0, 1, 2].map((i) => view.getFloat32(OFF_HEAD_POSITION + 4 * i, true));
  if (head.every((v) => v === 0)) return null;
  const x = view.getFloat32(OFF_CABIN_POSITION, true) + head[0];
  return Math.round(-x * 1000) / 1000 + 0;
}

// Variants of one truck model (a day cab or a sleeper) share the truck id and the head
// position; the game does not report the cab. The fifth wheel sits further back behind
// a longer cab (9900i: 2.118 m day cab, 3.184 m sleeper), so its position, to 10 cm,
// names the variant. Null when the game reports none.
function truckVariant(view) {
  const z = view.getFloat32(OFF_HOOK_Z, true);
  return Number.isFinite(z) && Math.abs(z) >= 0.05 ? (Math.round(z * 10) / 10).toFixed(1) : null;
}

const floats = (view, offset, n) => Array.from({ length: n }, (_, i) => view.getFloat32(offset + 4 * i, true));

// x y z heading pitch roll at offset: 6 floats (fplacement) or 6 doubles (dplacement).
function placement(view, offset, double = false) {
  const v = double
    ? Array.from({ length: 6 }, (_, i) => view.getFloat64(offset + 8 * i, true))
    : floats(view, offset, 6);
  return { x: v[0], y: v[1], z: v[2], heading: v[3], pitch: v[4], roll: v[5] };
}

export function parsePose(view) {
  const f = (i) => view.getFloat32(OFF_HEAD_OFFSET + 4 * i, true);
  const brandId = readString(view, OFF_TRUCK_BRAND_ID);
  const brand = readString(view, OFF_TRUCK_BRAND);
  const id = readString(view, OFF_TRUCK_ID);
  const name = readString(view, OFF_TRUCK_NAME);
  const key = truckKey({ brandId, id, name });
  return {
    sdkActive: view.getUint8(OFF_SDK_ACTIVE) !== 0,
    paused: view.getUint8(OFF_PAUSED) !== 0,
    renderTime: Number(view.getBigUint64(OFF_RENDER_TIME, true)),
    steer: view.getFloat32(OFF_GAME_STEER, true),
    gear: view.getInt32(OFF_GEAR, true),
    electricOn: view.getUint8(OFF_ELECTRIC_ENABLED) !== 0,
    engineOn: view.getUint8(OFF_ENGINE_ENABLED) !== 0,
    blinkers: { left: view.getUint8(OFF_BLINKER_LEFT) !== 0, right: view.getUint8(OFF_BLINKER_RIGHT) !== 0 },
    head: { x: f(0), y: f(1), z: f(2), heading: f(3), pitch: f(4), roll: f(5) },
    pluginRevision: view.getUint32(OFF_PLUGIN_REVISION, true),
    // Where the game camera should be in the cab (shared/camera.js): the truck in the world,
    // the cab on its suspension, the cab's joint in the vehicle and the head in the cab.
    world: placement(view, OFF_WORLD, true),
    cabin: placement(view, OFF_CABIN_OFFSET),
    cabinPosition: floats(view, OFF_CABIN_POSITION, 3),
    headPosition: floats(view, OFF_HEAD_POSITION, 3),
    truck: key ? {
      key,
      variant: truckVariant(view),
      plate: readString(view, OFF_PLATE).trim() || null,
      quickJob: readString(view, OFF_JOB_MARKET, MARKET_SIZE) === 'quick_job',
      name: `${brand} ${name}`.trim() || key,
      game: GAMES[view.getUint32(OFF_GAME, true)] ?? null, // the brand and game scopes of presets
      brand: brandId || null,
      brandName: brand || null,
      centerX: truckCenterX(view),
    } : null,
  };
}

let kernel32 = null;

function api() {
  if (!kernel32) {
    const lib = koffi.load('kernel32.dll');
    kernel32 = {
      OpenFileMappingW: lib.func('void *OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
      MapViewOfFile: lib.func('void *MapViewOfFile(void *mapping, uint32_t access, uint32_t offsetHigh, uint32_t offsetLow, size_t size)'),
      RtlMoveMemory: lib.func('void RtlMoveMemory(void *dst, void *src, size_t size)'),
    };
  }
  return kernel32;
}

// Only opens existing memory: if the app created it before the game,
// the plugin might not get write access.
export function openTelemetry() {
  if (!koffi) return null;
  const { OpenFileMappingW, MapViewOfFile, RtlMoveMemory } = api();
  const mapping = OpenFileMappingW(FILE_MAP_READ, 0, MMF_NAME);
  if (!mapping) return null;
  const base = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, MMF_SIZE);
  if (!base) return null;
  // Copied into a plain Buffer: koffi.view would create an external ArrayBuffer,
  // which Electron's V8 memory cage forbids.
  const snapshot = Buffer.alloc(SNAPSHOT_SIZE);
  const view = new DataView(snapshot.buffer, snapshot.byteOffset, SNAPSHOT_SIZE);
  return {
    read() {
      RtlMoveMemory(snapshot, base, SNAPSHOT_SIZE);
      return parsePose(view);
    },
  };
}

// The camera block from two copies taken one after the other: used only when the plugin was not
// writing (an even sequence) and nothing changed in between; null otherwise, or for another layout.
export function cameraRecord(first, second) {
  if (!first.equals(second) || first.readUInt32LE(0) !== 1) return null;
  const sequence = first.readUInt32LE(4);
  if (sequence % 2) return null;
  return {
    sequence,
    state: first.readUInt32LE(8),
    camera: first.readUInt32LE(12),
    fov: first.readFloatLE(16),
    x: first.readDoubleLE(24),
    y: first.readDoubleLE(32),
    z: first.readDoubleLE(40),
    rotation: [0, 1, 2, 3].map((i) => first.readFloatLE(48 + 4 * i)),
  };
}

// Like openTelemetry: only opens the plugin's memory, never creates it; null without it.
// read() gives the last whole record (cameraRecord), or the one before while it is written.
export function openCamera() {
  if (!koffi) return null;
  const { OpenFileMappingW, MapViewOfFile, RtlMoveMemory } = api();
  const mapping = OpenFileMappingW(FILE_MAP_READ, 0, CAMERA_NAME);
  if (!mapping) return null;
  const base = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, CAMERA_SIZE);
  if (!base) return null;
  const first = Buffer.alloc(CAMERA_SIZE);
  const second = Buffer.alloc(CAMERA_SIZE);
  let last = null;
  return {
    read() {
      RtlMoveMemory(first, base, CAMERA_SIZE);
      RtlMoveMemory(second, base, CAMERA_SIZE);
      last = cameraRecord(first, second) ?? last;
      return last;
    },
  };
}
