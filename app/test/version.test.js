import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, versionParts } from '../src/shared/version.js';

test('versionParts: a release tag or a version, else null', () => {
  assert.deepEqual(versionParts('v0.3.0'), [0, 3, 0]);
  assert.deepEqual(versionParts('0.12.4'), [0, 12, 4]);
  assert.equal(versionParts('test'), null);
  assert.equal(versionParts(undefined), null);
});

test('isNewer: by major, minor and patch, numbers not text', () => {
  assert.equal(isNewer('v0.3.1', '0.3.0'), true);
  assert.equal(isNewer('v0.10.0', '0.9.9'), true);
  assert.equal(isNewer('v1.0.0', '0.99.0'), true);
  assert.equal(isNewer('v0.3.0', '0.3.0'), false);
  assert.equal(isNewer('v0.2.4', '0.3.0'), false);
  assert.equal(isNewer('nightly', '0.3.0'), false);
});
