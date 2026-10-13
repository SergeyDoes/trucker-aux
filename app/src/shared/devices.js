// Matching saved devices against what the system offers now, and setup warnings.

const KIND_NAMES = { audioinput: 'input', audiooutput: 'output' };

// A device's source: the last part of its label in brackets, a USB id left out. Both sides of a
// virtual cable share it, and Windows does not translate it, unlike the endpoint's name:
//   "CABLE Output (VB-Audio Virtual Cable)"                    -> "VB-Audio Virtual Cable"
//   "Line In (Steam Streaming Speakers)"                        -> "Steam Streaming Speakers"
//   "Microphone (Logitech PRO X Gaming Headset) (046d:0aaa)"   -> "Logitech PRO X Gaming Headset"
export function deviceSource(label) {
  const parts = [...String(label ?? '').matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim());
  return parts.filter((p) => !/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(p)).at(-1) ?? null;
}

// The endpoint's name: the label before its source, without Windows' "Default - " and
// "Communications - " entries' prefix ("Line 1", "CABLE Output").
const endpointName = (label) => String(label ?? '').replace(/^(Default|Communications) - /, '').replace(/\s*\(.*$/, '').trim();

// Virtual cables, by their source, in the order a new setup takes them: what is played into one
// side is recorded from the other (README: Setup).
const CABLES = [/^VB-Audio Virtual Cable$/i, /^VB-Audio Cable [A-Z]$/i, /^VB-Audio Hi-Fi Cable$/i, /^Virtual Audio Cable$/i, /^Steam Streaming Speakers$/i];
// Other virtual devices, never the speakers: Steam's virtual microphone, VoiceMeeter.
const VIRTUAL = [...CABLES, /^Steam Streaming Microphone$/i, /VoiceMeeter/i];
const rank = (label) => CABLES.findIndex((re) => re.test(deviceSource(label) ?? ''));
export const isCable = (label) => rank(label) >= 0;
const isVirtual = (label) => VIRTUAL.some((re) => re.test(deviceSource(label) ?? ''));

// The device to use: { device, warning }. Order: the saved id, the saved label; then, the
// input: a virtual cable (CABLES' order), never a microphone, which would play the room into
// the headphones; the output: the system default, unless that is a virtual device (a loop),
// else the first real one.
export function pickDevice(devices, kind, saved) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
  if (saved) {
    const found = list.find((d) => d.deviceId === saved.id) ?? list.find((d) => d.label === saved.label);
    if (found) return { device: found, warning: null };
  }
  let device;
  let note = null;
  if (kind === 'audioinput') {
    device = list.filter((d) => d.deviceId !== 'default' && isCable(d.label)).sort((a, b) => rank(a.label) - rank(b.label))[0] ?? null;
    if (!device) note = 'No virtual cable found (VB-Audio Virtual Cable, Virtual Audio Cable, Steam Streaming Speakers): install one, or pick the input by hand.';
  } else {
    const fallback = list.find((d) => d.deviceId === 'default');
    device = fallback && !isVirtual(fallback.label) ? fallback : list.find((d) => d.deviceId !== 'default' && !isVirtual(d.label)) ?? fallback ?? list[0] ?? null;
    if (fallback && device !== fallback && !saved) note = `The system's default output is a virtual device: playing to "${device.label}".`;
  }
  if (saved) note = `Saved ${KIND_NAMES[kind]} "${saved.label}" not found — using ${device ? `"${device.label}"` : 'nothing'}.`;
  return { device, warning: note };
}

// For a cable recorded from (the input), the side to play the music into: an output with the
// same source, the same endpoint name first (Virtual Audio Cable's "Line 1" and "Line 2" share
// the source). Null for an input that is no cable.
export function cableOutputFor(devices, input) {
  if (!input || !isCable(input.label)) return null;
  const source = deviceSource(input.label);
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && deviceSource(d.label) === source);
  return outputs.find((d) => endpointName(d.label) === endpointName(input.label)) ?? outputs[0] ?? null;
}

export function rateWarning(inputRate, outputRate) {
  return inputRate && outputRate && inputRate !== outputRate
    ? `Sample rates differ (${inputRate} vs ${outputRate} Hz) — clicks are likely. Set the cable and the output to one rate.`
    : null;
}

// More than two channels: Windows opens the output as a surround device. Some headsets do
// that with virtual surround off too (Logitech PRO X: 7.1), and stereo then plays on the
// front pair, so this only asks to check; a second virtualizer would blur the sound.
export function channelsWarning(channels) {
  return channels > 2
    ? `Output has ${channels} channels. Fine for headphones if virtual surround (DTS Headphone:X, Windows Sonic, Dolby Atmos) is off; check that it is.`
    : null;
}
