import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GlitchCounter } from '../src/shared/glitch.js';

const SR = 48000;
const F = 1000;
const sine = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * F * i) / SR));

test('a clean tone in blocks of 128 has no clicks', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  for (let i = 0; i < s.length; i += 128) counter.process(s.subarray(i, i + 128));
  assert.equal(counter.glitches, 0);
});

test('100 dropped samples give exactly one click', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  const broken = new Float32Array(s.length - 100);
  broken.set(s.subarray(0, SR));
  broken.set(s.subarray(SR + 100), SR);
  assert.equal(counter.process(broken), 1);
});

test('inserted silence gives a click', () => {
  const counter = new GlitchCounter(F, SR);
  const s = sine(SR * 2);
  s.fill(0, SR, SR + 256);
  assert.ok(counter.process(s) >= 1);
});
