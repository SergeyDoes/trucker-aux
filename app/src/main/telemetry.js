// The game's shared memory exists only on Windows; elsewhere the app runs without a game
// and does not load the native module at all.
const koffi = process.platform === 'win32' ? (await import('koffi')).default : null;

export const MMF_NAME = 'Local\\SCSTelemetry';
const MMF_SIZE = 32 * 1024;
const FILE_MAP_READ = 0x0004;

// Offsets from third_party/scs-sdk-plugin/scs-telemetry/inc/scs-telemetry-common.hpp
// (offsetof, MSVC x64), the same as in tools/shm_probe.py.
const OFF_SDK_ACTIVE = 0;
const OFF_PAUSED = 4;
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
const OFF_HEAD_OFFSET = 2024; // 6 floats: x y z heading pitch roll, angles in turns
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
