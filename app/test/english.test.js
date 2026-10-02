import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project is English everywhere (UI, comments, docs).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TARGETS = ['PLAN.md', 'docs', 'tools', 'app/src', 'app/test', 'app/scripts'];
const SKIP_DIRS = new Set(['node_modules', 'data', '__pycache__']);
const EXTENSIONS = new Set(['.md', '.js', '.cjs', '.mjs', '.py', '.html', '.css', '.json']);
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);

function* files(target) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isFile()) {
    yield full;
    return;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    yield* files(path.join(target, entry.name));
  }
}

test('no Cyrillic text in project files', () => {
  const offenders = [];
  for (const target of TARGETS) {
    for (const file of files(target)) {
      if (!EXTENSIONS.has(path.extname(file))) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (CYRILLIC.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
