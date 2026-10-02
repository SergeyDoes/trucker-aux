import path from 'node:path';

// Where Trucker AUX keeps layouts, settings and the Chromium profile.
// Development: app/data. Packaged: data/ next to the executable
// (electron-builder portable builds report their folder in PORTABLE_EXECUTABLE_DIR).
export function resolveDataDir({ isPackaged, appPath, execPath, portableDir }) {
  if (!isPackaged) return path.join(appPath, 'data');
  return path.join(portableDir || path.dirname(execPath), 'data');
}
