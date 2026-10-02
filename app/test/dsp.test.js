import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUTTERWORTH_Q_DB, bandText, dbToGain, filtersFor, isSilenced, speakerGain, widthGains,
} from '../src/shared/dsp.js';
import { TYPES } from '../src/shared/layout.js';

test('width 1 leaves the signal as is, 0 is mono', () => {
  assert.deepEqual(widthGains(1), { direct: 1, cross: 0 });
  assert.deepEqual(widthGains(0), { direct: 0.5, cross: 0.5 });
});

test('widening keeps a mono signal unchanged', () => {
  const { direct, cross } = widthGains(1.5);
  assert.equal(direct + cross, 1);
  assert.ok(cross < 0);
});

test('filtersFor: every crossover edge is two Butterworth biquads (Linkwitz-Riley 4)', () => {
  const Q = BUTTERWORTH_Q_DB;
  assert.ok(Math.abs(Q - -3.0103) < 1e-4);
  const edge = (type, frequency) => [{ type, frequency, Q }, { type, frequency, Q }];
  assert.deepEqual(filtersFor('small'), edge('highpass', 120));
  assert.deepEqual(filtersFor('tweeter'), edge('highpass', 2500));
  assert.deepEqual(filtersFor('mid'), [...edge('highpass', 500), ...edge('lowpass', 2500)]);
  assert.deepEqual(filtersFor('midbass'), [...edge('highpass', 60), ...edge('lowpass', 500)]);
  assert.deepEqual(filtersFor('sub'), edge('lowpass', 120));
  assert.deepEqual(filtersFor('full'), []);
  assert.deepEqual(filtersFor('horn'), []);
  filtersFor('sub')[0].frequency = 1;
  assert.equal(filtersFor('sub')[0].frequency, 120);
});

test('every speaker type has a band; bandText describes it', () => {
  assert.deepEqual(TYPES, ['full', 'small', 'tweeter', 'mid', 'midbass', 'sub']);
  for (const type of TYPES.slice(1)) assert.notEqual(bandText(type), '');
  assert.equal(bandText('full'), '');
  assert.equal(bandText('small'), 'from 120 Hz');
  assert.equal(bandText('tweeter'), 'from 2.5 kHz');
  assert.equal(bandText('mid'), '500 Hz – 2.5 kHz');
  assert.equal(bandText('midbass'), '60 – 500 Hz');
  assert.equal(bandText('sub'), 'up to 120 Hz');
});

test('dbToGain', () => {
  assert.equal(dbToGain(0), 1);
  assert.equal(dbToGain(20), 10);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001);
});

test('isSilenced: muted, or another speaker is soloed', () => {
  const a = { id: 'a', gainDb: -60 };
  assert.equal(isSilenced(a, null, new Set()), false); // quiet is not silent
  assert.equal(isSilenced(a, null, new Set(['a'])), true);
  assert.equal(isSilenced(a, 'b', new Set()), true);
  assert.equal(isSilenced(a, 'a', new Set()), false);
  assert.equal(isSilenced(a, 'a', new Set(['a'])), true); // mute wins over solo
});

test('speakerGain applies mute and solo', () => {
  const speaker = { id: 'a', gainDb: -6 };
  assert.ok(Math.abs(speakerGain(speaker, null, new Set()) - 0.501) < 0.001);
  assert.equal(speakerGain(speaker, null, new Set(['a'])), 0);
  assert.equal(speakerGain(speaker, 'b', new Set()), 0);
  assert.ok(speakerGain(speaker, 'a', new Set()) > 0);
});
