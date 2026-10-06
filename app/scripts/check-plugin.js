// Before npm run dist: the release ships the game plugins, which are built separately
// (Visual Studio, see README) and dropped into app/plugin/: RenCloud's telemetry plugin and
// our camera plugin (native/camera-plugin/build.cmd).
import fs from 'node:fs';

const PLUGINS = [
  ['scs-telemetry.dll', 'build the telemetry plugin (Release | x64) and copy the DLL there'],
  ['trucker_aux_camera.dll', 'run native/camera-plugin/build.cmd and copy out/trucker_aux_camera.dll there'],
];
const missing = PLUGINS.filter(([dll]) => !fs.existsSync(new URL(`../plugin/${dll}`, import.meta.url)));
for (const [dll, how] of missing) console.error(`app/plugin/${dll} is missing: ${how}.`);
if (missing.length) process.exit(1);
