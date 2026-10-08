import {
  PANNER_REF_DISTANCE, filtersFor, speakerGain, widthGains,
} from '../shared/dsp.js';
import { listenerVectors } from '../shared/pose.js';

const SMOOTH = 0.02;      // time constant for pose and parameter changes, s
const RETIRE_MS = 200;    // a removed speaker fades out before it is disconnected
const REF_DISTANCE = PANNER_REF_DISTANCE; // closer than this the level stops growing
const MAKEUP = 1.7;       // restores the level of speakers ~0.86 m away with REF_DISTANCE 0.5
const SILENCE_FADE = 0.1;  // time constant of muting when the truck is parked, s (-60 dB in ~0.7 s)
const LIMIT_DB = -3;      // the limiter's threshold, dBFS
const LIMIT_RATIO = 20;

const monoBus = (ctx) => new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit' });

// output: where the mix goes, the speakers (ctx.destination) or a meter.
// limiter: off for measuring loudness (loudness-meter.js), where it would flatten the noise.
export function createEngine(ctx, output = ctx.destination, { limiter = true } = {}) {
  const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  input.connect(split);

  // Width matrix: L' and R' each mix both input channels; M' = (L' + R') / 2.
  const bus = { L: monoBus(ctx), R: monoBus(ctx), M: monoBus(ctx) };
  const matrix = [0, 1].map((from) => [0, 1].map((to) => {
    const gain = new GainNode(ctx, { gain: from === to ? 1 : 0 });
    split.connect(gain, from);
    gain.connect(to === 0 ? bus.L : bus.R);
    return gain;
  }));
  for (const side of [bus.L, bus.R]) side.connect(new GainNode(ctx, { gain: 0.5 })).connect(bus.M);

  const master = new GainNode(ctx, { gain: MAKEUP });
  const gate = new GainNode(ctx, { gain: 1 }); // closed while the truck is parked
  const volume = new GainNode(ctx, { gain: 1 }); // the volume slider, over everything
  master.connect(gate).connect(volume);
  if (limiter) {
    // Peaks held under 0 dBFS: the volume over 100 % (up to +12 dB) and loudness matching (up
    // to +6 dB) can lift a quiet preset 18 dB. Below the threshold it passes the sound as it is: Chromium's compressor
    // adds a makeup gain of (1 - 1/ratio) x |threshold| x 0.6 dB everywhere, taken off after.
    const limit = new DynamicsCompressorNode(ctx, { threshold: LIMIT_DB, knee: 0, ratio: LIMIT_RATIO, attack: 0.003, release: 0.25 });
    const makeupDb = (1 - 1 / LIMIT_RATIO) * -LIMIT_DB * 0.6;
    volume.connect(limit).connect(new GainNode(ctx, { gain: 10 ** (-makeupDb / 20) })).connect(output);
  } else {
    volume.connect(output);
  }

  const chains = new Map(); // speaker id -> { speaker, entry, nodes, level, panner }
  const muted = new Set();
  let solo = null;
  let width = 1;

  function build(speaker) {
    const filters = filtersFor(speaker.type).map((params) => new BiquadFilterNode(ctx, params));
    const level = new GainNode(ctx, { gain: 0 });
    const [positionX, positionY, positionZ] = speaker.position;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: REF_DISTANCE,
      rolloffFactor: 1,
      positionX, positionY, positionZ,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    const nodes = [...filters, level, panner];
    const entry = nodes[0];
    bus[speaker.channel].connect(entry);
    nodes.reduce((from, to) => from.connect(to));
    panner.connect(master);
    // New speakers fade in, so adding one does not click.
    level.gain.setTargetAtTime(speakerGain(speaker, solo, muted), ctx.currentTime, SMOOTH);
    return { speaker, entry, nodes, level, panner };
  }

  function retire(chain) {
    chain.level.gain.cancelScheduledValues(ctx.currentTime);
    chain.level.gain.setTargetAtTime(0, ctx.currentTime, SMOOTH);
    setTimeout(() => {
      bus[chain.speaker.channel].disconnect(chain.entry);
      for (const node of chain.nodes) node.disconnect();
    }, RETIRE_MS);
  }

  function update(chain, speaker) {
    const t = ctx.currentTime;
    chain.speaker = speaker;
    [chain.panner.positionX, chain.panner.positionY, chain.panner.positionZ]
      .forEach((param, i) => param.setTargetAtTime(speaker.position[i], t, SMOOTH));
    chain.level.gain.setTargetAtTime(speakerGain(speaker, solo, muted), t, SMOOTH);
  }

  function setWidth(value) {
    if (value === width) return;
    width = value;
    const { direct, cross } = widthGains(value);
    const t = ctx.currentTime;
    matrix[0][0].gain.setTargetAtTime(direct, t, SMOOTH);
    matrix[1][1].gain.setTargetAtTime(direct, t, SMOOTH);
    matrix[0][1].gain.setTargetAtTime(cross, t, SMOOTH);
    matrix[1][0].gain.setTargetAtTime(cross, t, SMOOTH);
  }

  // Brings the graph in line with a layout. Positions, levels and width glide; only
  // speakers that were added, removed or changed channel or type are rebuilt, with a fade.
  function sync(layout) {
    setWidth(layout.width);
    const wanted = new Map(layout.speakers.map((s) => [s.id, s]));
    for (const [id, chain] of chains) {
      const next = wanted.get(id);
      if (!next || next.channel !== chain.speaker.channel || next.type !== chain.speaker.type) {
        retire(chain);
        chains.delete(id);
      }
    }
    for (const speaker of layout.speakers) {
      const chain = chains.get(speaker.id);
      if (chain) update(chain, speaker);
      else chains.set(speaker.id, build(speaker));
    }
  }

  function refreshLevels() {
    for (const chain of chains.values()) update(chain, chain.speaker);
  }

  function setSolo(id) {
    solo = id;
    refreshLevels();
  }

  function setMuted(id, on) {
    if (on) muted.add(id);
    else muted.delete(id);
    refreshLevels();
  }

  const listener = ctx.listener;
  const neutral = listenerVectors(0, 0, 0);

  // headX: where the driver's default head is, left of the truck's axis (pose.js headRestX).
  // No game (pose = null or sdkActive = false): the head at rest, looking ahead. On pause the
  // app holds the head where it was (pose.js createPauseHold).
  function setPose(pose, headX = 0) {
    const active = pose && pose.sdkActive;
    const position = active ? [headX + pose.head.x, pose.head.y, pose.head.z] : [headX, 0, 0];
    const { forward, up } = active ? listenerVectors(pose.head.heading, pose.head.pitch, pose.head.roll) : neutral;
    const t = ctx.currentTime;
    [listener.positionX, listener.positionY, listener.positionZ].forEach((p, i) => p.setTargetAtTime(position[i], t, SMOOTH));
    [listener.forwardX, listener.forwardY, listener.forwardZ].forEach((p, i) => p.setTargetAtTime(forward[i], t, SMOOTH));
    [listener.upX, listener.upY, listener.upZ].forEach((p, i) => p.setTargetAtTime(up[i], t, SMOOTH));
  }

  // A gain for the whole layout (loudness matching across presets, loudness.js).
  function setTrim(gain) {
    master.gain.setTargetAtTime(MAKEUP * gain, ctx.currentTime, SMOOTH);
  }

  // Fades all music out or back in, like a car radio when the truck is switched off.
  function setSilent(on) {
    gate.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, SILENCE_FADE);
  }

  // The volume slider's gain (loudness.js perceptualGain).
  function setVolume(gain) {
    volume.gain.setTargetAtTime(gain, ctx.currentTime, SMOOTH);
  }

  setPose(null);
  return { input, sync, setSolo, setMuted, setPose, setSilent, setTrim, setVolume };
}
