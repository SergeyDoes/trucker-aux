// Audio math that does not need Web Audio, shared by the engine and the tests.

// Stereo width via M/S: 1 = unchanged, 0 = mono, above 1 = wider.
// L' = direct * L + cross * R, R' = cross * L + direct * R.
export function widthGains(width) {
  return { direct: (1 + width) / 2, cross: (1 - width) / 2 };
}

// Frequency band of each speaker type, Hz. Neighbouring types share their edges
// (sub 120, midbass 500, mid 2500), so a multi-way layout splits the spectrum;
// the midbass keeps down to 60 Hz because a layout may have no sub. A small
// full-range speaker has no deep bass and meets the sub at 120 Hz.
const BANDS = {
  full: {},
  small: { highpass: 120 },
  tweeter: { highpass: 2500 },
  mid: { highpass: 500, lowpass: 2500 },
  midbass: { highpass: 60, lowpass: 500 },
  sub: { lowpass: 120 },
};

// The panners' inverse distance model: closer than this the level stops growing.
export const PANNER_REF_DISTANCE = 0.5;

// For lowpass and highpass, BiquadFilterNode takes Q in dB, so Butterworth
// (Q = 1/sqrt(2)) is -3.01 dB.
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

// Each edge is a 4th-order Linkwitz-Riley filter: two 2nd-order Butterworth
// biquads. Its two halves are in phase, so speakers on one spot sum flat.
export function filtersFor(type) {
  return Object.entries(BANDS[type] ?? {}).flatMap(([kind, frequency]) => {
    const biquad = { type: kind, frequency, Q: BUTTERWORTH_Q_DB };
    return [biquad, { ...biquad }];
  });
}

const hz = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);

export function bandText(type) {
  const { highpass: lo, lowpass: hi } = BANDS[type] ?? {};
  if (lo && hi) {
    const [value, unit] = hz(lo).split(' ');
    return hz(hi).split(' ')[1] === unit ? `${value} – ${hz(hi)}` : `${hz(lo)} – ${hz(hi)}`;
  }
  if (lo) return `from ${hz(lo)}`;
  if (hi) return `up to ${hz(hi)}`;
  return '';
}

export function dbToGain(db) {
  return 10 ** (db / 20);
}

// Silent by the session-only flags: muted, or another speaker is soloed.
export function isSilenced(speaker, soloId, mutedIds) {
  return mutedIds.has(speaker.id) || (soloId !== null && soloId !== speaker.id);
}

// Linear level of a speaker with the session-only solo and mute applied.
export function speakerGain(speaker, soloId, mutedIds) {
  return isSilenced(speaker, soloId, mutedIds) ? 0 : dbToGain(speaker.gainDb);
}
