// Loudness matching across presets: every preset is trimmed to the loudness of the default
// layout (two doors). Loudness is measured, not modelled: pink noise is rendered through
// the engine itself (renderer/loudness-meter.js), so the number, types and distances of
// the speakers and the direction-dependent HRTF all count. These are the pure parts.

export const MAX_BOOST_DB = 6; // a sparse layout is lifted at most this much

// Trim in dB from the measured levels of the reference and of a layout.
export function trimFromLevels(referenceDb, layoutDb) {
  if (!Number.isFinite(referenceDb) || !Number.isFinite(layoutDb)) return 0;
  return Math.min(referenceDb - layoutDb, MAX_BOOST_DB);
}

// Speaker levels are a manual trim on top of the matching, so they are measured at 0 dB.
export function forMeasuring(layout) {
  return { ...layout, speakers: layout.speakers.map((s) => ({ ...s, gainDb: 0 })) };
}

// Pink noise, equal power per octave like the spectrum of music (Paul Kellet's filter
// over a seeded random generator), the same for the same seed.
export function pinkNoise(length, seed = 1) {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const white = (state / 2 ** 32) * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}
