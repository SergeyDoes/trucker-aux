import fs from 'node:fs';
import path from 'node:path';
import { STORE_VERSION, normalizeStore } from '../shared/layout.js';
import { normalizeSettings } from '../shared/settings.js';

const LAYOUTS = 'layouts.json';
const SETTINGS = 'settings.json';

// A missing file is not an error. A broken one is moved aside so the user keeps a copy.
export function readJson(file, now = new Date()) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { value: null, warning: null };
    return { value: null, warning: `Cannot read ${file}: ${err.message}` };
  }
  try {
    return { value: JSON.parse(content), warning: null };
  } catch {
    const backup = `${file}.broken-${now.toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(file, backup);
    } catch {
      return { value: null, warning: `${path.basename(file)} is invalid and could not be moved aside.` };
    }
    return { value: null, warning: `${path.basename(file)} was invalid and was moved to ${backup}` };
  }
}

// Writes a temporary file and renames it, so a crash never leaves half a file behind.
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return null;
  } catch (err) {
    return `Cannot save to ${file}: ${err.message}`;
  }
}

// An older layouts file is converted on load and saved in the new format on the next
// edit, so the original is kept next to it once, as layouts.v<version>.json.
function keepOlderVersion(dataDir, raw) {
  if (!raw || typeof raw !== 'object' || raw.version === STORE_VERSION) return null;
  const copy = path.join(dataDir, `layouts.v${Number.isInteger(raw.version) ? raw.version : 1}.json`);
  if (fs.existsSync(copy)) return null;
  try {
    fs.copyFileSync(path.join(dataDir, LAYOUTS), copy);
    return null;
  } catch (err) {
    return `Cannot keep a copy of the older ${LAYOUTS}: ${err.message}`;
  }
}

export function loadData(dataDir) {
  const layouts = readJson(path.join(dataDir, LAYOUTS));
  const settings = readJson(path.join(dataDir, SETTINGS));
  const kept = keepOlderVersion(dataDir, layouts.value);
  return {
    dataDir,
    store: normalizeStore(layouts.value),
    settings: normalizeSettings(settings.value),
    warnings: [layouts.warning, kept, settings.warning].filter(Boolean),
  };
}

export function saveLayouts(dataDir, store) {
  return writeJsonAtomic(path.join(dataDir, LAYOUTS), store);
}

export function saveSettings(dataDir, settings) {
  return writeJsonAtomic(path.join(dataDir, SETTINGS), settings);
}
