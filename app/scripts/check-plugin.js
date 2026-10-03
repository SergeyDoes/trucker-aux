// Before npm run dist: the release ships the telemetry plugin, which is built separately
// (Visual Studio, see README) and dropped into app/plugin/.
import fs from 'node:fs';

const dll = new URL('../plugin/scs-telemetry.dll', import.meta.url);
if (!fs.existsSync(dll)) {
  console.error('app/plugin/scs-telemetry.dll is missing: build the plugin (Release | x64) and copy the DLL there.');
  process.exit(1);
}
