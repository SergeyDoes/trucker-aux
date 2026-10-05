import fs from 'node:fs';
import path from 'node:path';
import { parsePresetFile } from '../shared/collection.js';
import { writeJsonAtomic } from './store.js';

// The preset collection on disk (shared/collection.js): presets/ next to the data
// folder, read only (Export writes where it is told, see main.js).

export function presetsDirFor(dataDir) {
  return path.join(path.dirname(dataDir), 'presets');
}

// Paths of the .json files under dir, relative, with "/", sorted.
function jsonFiles(dir, prefix = '') {
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return jsonFiles(dir, rel);
    return entry.isFile() && /\.json$/i.test(entry.name) ? [rel] : [];
  }).sort();
}

// { collection: { [key]: entry }, warnings }. Files that are not presets are skipped and
// named in a warning; they are not ours, so they are never moved or changed.
export function readCollection(dir) {
  const collection = {};
  const warnings = [];
  for (const file of jsonFiles(dir)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''));
    } catch {
      warnings.push(`presets/${file} is not valid JSON.`);
      continue;
    }
    const { entry, warning } = parsePresetFile(raw, file);
    if (entry) collection[entry.key] = entry;
    else warnings.push(warning);
  }
  return { collection, warnings };
}

// Writes an exported preset as fileName, or "name (2).json" and so on when it is taken.
// Gives { file, warning }.
export function writePresetFile(dir, fileName, data) {
  const base = fileName.replace(/\.json$/i, '');
  let file = path.join(dir, fileName);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).json`);
  const warning = writeJsonAtomic(file, data);
  return { file: warning ? null : file, warning };
}

// Writes a set of exported presets into folder (made when missing); a name taken there gets
// " (2)" and so on. Gives { written, warning }.
export function writePresetSet(folder, files) {
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (err) {
    return { written: 0, warning: `Cannot create ${folder}: ${err.message}` };
  }
  let written = 0;
  for (const { fileName, data } of files) {
    const { warning } = writePresetFile(folder, fileName, data);
    if (warning) return { written, warning };
    written++;
  }
  return { written, warning: null };
}

// Calls onChange delayMs after the last change in the folder (an editor saves in several
// steps). The folder is created if it is missing. Gives a function that stops watching.
export function watchCollection(dir, onChange, delayMs = 300) {
  let timer = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const watcher = fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, delayMs);
    });
    watcher.on('error', () => {});
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return () => {};
  }
}
