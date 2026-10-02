import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BOOST_DB, forMeasuring, pinkNoise, trimFromLevels,
} from '../src/shared/loudness.js';
import { defaultLayout } from '../src/shared/layout.js';

test('trimFromLevels: down by the difference, lifted at most 6 dB, nothing without a level', () => {
  assert.equal(trimFromLevels(-20, -15.2), -4.800000000000001);
  assert.equal(trimFromLevels(-20, -23), 3);
  assert.equal(trimFromLevels(-20, -40), MAX_BOOST_DB);
  assert.equal(MAX_BOOST_DB, 6);
  assert.equal(trimFromLevels(-20, -Infinity), 0); // a layout without speakers
});

test('forMeasuring puts every speaker at 0 dB and leaves the layout alone', () => {
  const layout = defaultLayout();
  layout.speakers[0].gainDb = -12;
  const measured = forMeasuring(layout);
  assert.deepEqual(measured.speakers.map((s) => s.gainDb), [0, 0]);
  assert.equal(layout.speakers[0].gainDb, -12);
  assert.deepEqual(measured.speakers[1].position, layout.speakers[1].position);
});

test('pinkNoise: the same for a seed, within ±1, and weighted to the lows', () => {
  const a = pinkNoise(44100, 7);
  assert.deepEqual(a, pinkNoise(44100, 7));
  assert.notDeepEqual(a, pinkNoise(44100, 8));
  assert.ok(a.every((v) => Math.abs(v) < 1));
  // Neighbouring samples are alike (white noise would give about 0).
  let same = 0, power = 0;
  for (let i = 1; i < a.length; i++) {
    same += a[i] * a[i - 1];
    power += a[i] * a[i];
  }
  assert.ok(same / power > 0.5, `${same / power}`);
});
