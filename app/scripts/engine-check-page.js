import { createEngine } from '../src/renderer/engine.js';
import { defaultLayout } from '../src/shared/layout.js';
import { trimFromLevels } from '../src/shared/loudness.js';
import { measureLoudness } from '../src/renderer/loudness-meter.js';
import { DEFAULT_HEAD_X } from '../src/shared/pose.js';

const RATE = 44100;
const db = (a, b) => 10 * Math.log10(a / b);

// Power of frequency f in x (Goertzel).
function power(x, f) {
  const k = 2 * Math.cos((2 * Math.PI * f) / RATE);
  let s1 = 0, s2 = 0;
  for (const v of x) {
    const s = v + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - k * s1 * s2) / (x.length * x.length) + 1e-20;
}

const speaker = (id, channel, position, type = 'full') => ({ id, name: id, position, channel, gainDb: 0, type, pair: null });
const PAIR = {
  name: 'pair', width: 1, bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  speakers: [speaker('a', 'L', [-0.7, -0.4, -0.3]), speaker('b', 'R', [0.7, -0.4, -0.3])],
};
const single = (type) => ({ ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], type)] });

// Uncorrelated white noise in both channels, the same every run.
function noiseSource(ctx) {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: RATE, sampleRate: RATE });
  let seed = 12345;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 2 ** 32 - 0.5) * 0.5;
    }
  }
  const source = new AudioBufferSourceNode(ctx, { buffer });
  source.start();
  return source;
}

// Renders 1 s; left/right are the frequencies fed into each input channel, or noise.
async function render({ layout, left = [], right = [], noise = false, yawDeg = 0, headX = 0, setup, change }) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: RATE, sampleRate: RATE });
  const engine = createEngine(ctx);
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  for (const [channel, freqs] of [[0, left], [1, right]]) {
    for (const frequency of freqs) {
      const osc = new OscillatorNode(ctx, { frequency });
      osc.connect(merger, 0, channel);
      osc.start();
    }
  }
  merger.connect(engine.input);
  if (noise) noiseSource(ctx).connect(engine.input);
  engine.sync(layout);
  engine.setPose({ sdkActive: true, paused: false, head: { x: 0, y: 0, z: 0, heading: yawDeg / 360, pitch: 0, roll: 0 }, truck: null }, headX);
  setup?.(engine);
  if (change) {
    ctx.suspend(change.at).then(() => {
      change.run(engine);
      ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  return { left: out.getChannelData(0), right: out.getChannelData(1) };
}

const tail = (x) => x.subarray(RATE / 2); // parameters have settled by then
const both = (r, f) => power(tail(r.left), f) + power(tail(r.right), f);
const energy = (r) => [r.left, r.right].reduce((sum, x) => sum + tail(x).reduce((s, v) => s + v * v, 0), 0);

// The default two doors, and the same with two more doors behind the driver.
const TWO = defaultLayout();
const FOUR = {
  ...TWO,
  speakers: [...TWO.speakers, speaker('r1', 'L', [-1.12, -0.6, 0.4]), speaker('r2', 'R', [1.12, -0.6, 0.4])],
};

const checks = [
  ['separation, head straight', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500] });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l >= 3 && rr <= -3, `L tone ${l.toFixed(1)} dB left-right, R tone ${rr.toFixed(1)} dB`];
  }],
  ['head turned left 90°: both tones move right', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500], yawDeg: 90 });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l < 0 && rr < 0, `L tone ${l.toFixed(1)} dB, R tone ${rr.toFixed(1)} dB`];
  }],
  ['head turned right 90°: both tones move left', async () => {
    const r = await render({ layout: PAIR, left: [500], right: [1500], yawDeg: -90 });
    const l = db(power(tail(r.left), 500), power(tail(r.right), 500));
    const rr = db(power(tail(r.left), 1500), power(tail(r.right), 1500));
    return [l > 0 && rr > 0, `L tone ${l.toFixed(1)} dB, R tone ${rr.toFixed(1)} dB`];
  }],
  ['driver left of the axis hears a centre speaker on the right', async () => {
    const r = await render({ layout: single('full'), left: [700], right: [700], headX: -0.5 });
    const d = db(power(tail(r.right), 700), power(tail(r.left), 700));
    return [d >= 3, `right ear ${d.toFixed(1)} dB above the left`];
  }],
  ['tweeter cuts lows', async () => {
    const r = await render({ layout: single('tweeter'), left: [200, 5000], right: [200, 5000] });
    const d = db(both(r, 5000), both(r, 200));
    return [d >= 20, `5 kHz is ${d.toFixed(1)} dB above 200 Hz`];
  }],
  ['sub cuts highs', async () => {
    const r = await render({ layout: single('sub'), left: [200, 5000], right: [200, 5000] });
    const d = db(both(r, 200), both(r, 5000));
    return [d >= 20, `200 Hz is ${d.toFixed(1)} dB above 5 kHz`];
  }],
  ['midrange keeps the middle', async () => {
    const r = await render({ layout: single('mid'), left: [100, 1100, 9000], right: [100, 1100, 9000] });
    const low = db(both(r, 1100), both(r, 100));
    const high = db(both(r, 1100), both(r, 9000));
    return [low >= 20 && high >= 20, `1.1 kHz is ${low.toFixed(1)} dB above 100 Hz, ${high.toFixed(1)} dB above 9 kHz`];
  }],
  ['midbass cuts highs', async () => {
    const r = await render({ layout: single('midbass'), left: [200, 5000], right: [200, 5000] });
    const d = db(both(r, 200), both(r, 5000));
    return [d >= 20, `200 Hz is ${d.toFixed(1)} dB above 5 kHz`];
  }],
  ['small full range cuts deep bass', async () => {
    const r = await render({ layout: single('small'), left: [40, 1000], right: [40, 1000] });
    const d = db(both(r, 1000), both(r, 40));
    return [d >= 20, `1 kHz is ${d.toFixed(1)} dB above 40 Hz`];
  }],
  ['small full range + sub on one spot sum flat at 120 Hz', async () => {
    const two = { ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], 'small'), speaker('d', 'M', [0, 0, -1], 'sub')] };
    const sum = await render({ layout: two, left: [120], right: [120] });
    const full = await render({ layout: single('full'), left: [120], right: [120] });
    const d = db(both(sum, 120), both(full, 120));
    return [Math.abs(d) <= 1.5, `120 Hz is ${d.toFixed(1)} dB against a full-range speaker`];
  }],
  ['midrange + tweeter on one spot sum flat at the crossover', async () => {
    const two = { ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], 'mid'), speaker('d', 'M', [0, 0, -1], 'tweeter')] };
    const sum = await render({ layout: two, left: [2500], right: [2500] });
    const full = await render({ layout: single('full'), left: [2500], right: [2500] });
    const d = db(both(sum, 2500), both(full, 2500));
    return [Math.abs(d) <= 1.5, `2.5 kHz is ${d.toFixed(1)} dB against a full-range speaker`];
  }],
  ['solo silences the other speaker', async () => {
    const base = await render({ layout: PAIR, left: [500], right: [1500] });
    const solo = await render({ layout: PAIR, left: [500], right: [1500], setup: (e) => e.setSolo('a') });
    const d = db(both(base, 1500), both(solo, 1500));
    return [d >= 30, `R tone dropped by ${d.toFixed(1)} dB`];
  }],
  ['mute silences that speaker', async () => {
    const base = await render({ layout: PAIR, left: [500], right: [1500] });
    const muted = await render({ layout: PAIR, left: [500], right: [1500], setup: (e) => e.setMuted('a', true) });
    const d = db(both(base, 500), both(muted, 500));
    return [d >= 30, `L tone dropped by ${d.toFixed(1)} dB`];
  }],
  ['matched loudness: four doors play as loud as two', async () => {
    const headX = DEFAULT_HEAD_X;
    const two = await measureLoudness(TWO, headX);
    const four = await measureLoudness(FOUR, headX);
    const trim = trimFromLevels(two, four);
    const matched = (await measureLoudness(FOUR, headX, { trimDb: trim })) - two;
    const again = (await measureLoudness(TWO, headX)) - two; // the meter repeats itself
    const ok = four - two > 2 && Math.abs(matched) <= 0.2 && again === 0;
    return [ok, `four doors ${(four - two).toFixed(1)} dB louder, trim ${trim.toFixed(1)} dB, matched ${matched.toFixed(2)} dB`];
  }],
  ['matched loudness ignores speaker levels and white noise agrees', async () => {
    const headX = DEFAULT_HEAD_X;
    const quiet = { ...TWO, speakers: TWO.speakers.map((s) => ({ ...s, gainDb: -12 })) };
    const levels = (await measureLoudness(quiet, headX)) - (await measureLoudness(TWO, headX));
    // An independent check with plain white noise through the live render path.
    const loud = async (layout, trimDb) => energy(await render({ layout, noise: true, headX, setup: (e) => e.setTrim(10 ** (trimDb / 20)) }));
    const trim = trimFromLevels(await measureLoudness(TWO, headX), await measureLoudness(FOUR, headX));
    const white = db(await loud(FOUR, trim), await loud(TWO, 0));
    return [levels === 0 && Math.abs(white) <= 1.5, `levels ignored: ${levels === 0}; white noise after the trim ${white.toFixed(1)} dB`];
  }],
  ['parked truck: music fades out and comes back', async () => {
    const base = await render({ layout: PAIR, left: [500], right: [1500] });
    const silent = await render({ layout: PAIR, left: [500], right: [1500], setup: (e) => e.setSilent(true) });
    const back = await render({
      layout: PAIR, left: [500], right: [1500], setup: (e) => e.setSilent(true), change: { at: 0.25, run: (e) => e.setSilent(false) },
    });
    const end = (r, f) => power(r.left.subarray(RATE * 0.9), f) + power(r.right.subarray(RATE * 0.9), f);
    const off = db(end(base, 500), end(silent, 500));
    const on = db(both(base, 500), both(back, 500));
    return [off >= 60 && Math.abs(on) <= 0.5, `silenced ${off.toFixed(1)} dB down, back within ${on.toFixed(2)} dB`];
  }],
  ['switching layouts mid-stream: no NaN, not silent', async () => {
    const next = { ...PAIR, speakers: [speaker('c', 'M', [0, 0, -1], 'tweeter'), speaker('d', 'M', [0, -0.5, 0], 'sub')] };
    const r = await render({ layout: PAIR, left: [200, 5000], right: [200, 5000], change: { at: 0.5, run: (e) => e.sync(next) } });
    const finite = [...r.left, ...r.right].every(Number.isFinite);
    const end = r.left.subarray(RATE - RATE / 5);
    const rms = Math.sqrt(end.reduce((sum, v) => sum + v * v, 0) / end.length);
    return [finite && rms > 1e-3, `finite ${finite}, RMS of the last 0.2 s ${rms.toExponential(2)}`];
  }],
];

const lines = [];
let ok = true;
for (const [name, run] of checks) {
  try {
    const [pass, detail] = await run();
    ok &&= pass;
    lines.push(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  } catch (err) {
    ok = false;
    lines.push(`FAIL ${name}: ${err.stack}`);
  }
}
window.engineCheck.done({ ok, report: lines.join('\n') });
