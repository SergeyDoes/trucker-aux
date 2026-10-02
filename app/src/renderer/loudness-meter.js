// Measures how loud a layout plays at the driver's head: renders half a second of pink
// noise through the engine offline and takes the K-weighted power (ITU-R BS.1770, as in
// LUFS), so bass counts as much as we hear it. Speaker levels are measured at 0 dB.
import { createEngine } from './engine.js';
import { forMeasuring, pinkNoise } from '../shared/loudness.js';

const RATE = 44100;
const LENGTH = RATE / 2;
const SKIP = Math.round(RATE * 0.15); // speakers fade in and filters settle first

let noise = null; // two uncorrelated channels, made once

// dB of the measured power; -Infinity for a layout without speakers. trimDb plays the
// layout with that trim, to check the matching.
export async function measureLoudness(layout, headX, { trimDb = 0 } = {}) {
  if (!layout.speakers.length) return -Infinity;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: LENGTH, sampleRate: RATE });
  const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1682, gain: 4 });
  const lowCut = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38, Q: 20 * Math.log10(0.5) });
  shelf.connect(lowCut).connect(ctx.destination);
  const engine = createEngine(ctx, shelf);
  engine.sync(forMeasuring(layout));
  engine.setPose(null, headX);
  engine.setTrim(10 ** (trimDb / 20));
  noise ??= [pinkNoise(LENGTH, 1), pinkNoise(LENGTH, 2)];
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: LENGTH, sampleRate: RATE });
  noise.forEach((channel, i) => buffer.copyToChannel(channel, i));
  const source = new AudioBufferSourceNode(ctx, { buffer });
  source.connect(engine.input);
  source.start();
  const out = await ctx.startRendering();
  let sum = 0;
  for (let c = 0; c < 2; c++) {
    const data = out.getChannelData(c);
    for (let i = SKIP; i < LENGTH; i++) sum += data[i] * data[i];
  }
  return 10 * Math.log10(sum / (LENGTH - SKIP) + 1e-30);
}
