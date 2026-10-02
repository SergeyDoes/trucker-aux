// Manual check of the shared-memory reader from Node, without Electron.
import { openTelemetry } from '../src/main/telemetry.js';
import { turnsToDeg } from '../src/shared/pose.js';

const telemetry = openTelemetry();
if (!telemetry) {
  console.log('Local\\SCSTelemetry not found: start the game with scs-telemetry.dll or tools/fake_shm.py');
  process.exit(1);
}
setInterval(() => {
  const p = telemetry.read();
  console.log(`${p.sdkActive ? ' ' : 'X'}${p.paused ? 'P' : ' '} ${p.truck ? `${p.truck.name} [${p.truck.key}]` : '-'}`
    + `  yaw ${turnsToDeg(p.head.heading).toFixed(1)}°  pitch ${turnsToDeg(p.head.pitch).toFixed(1)}°`);
}, 200);
