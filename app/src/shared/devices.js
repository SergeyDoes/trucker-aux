// Matching saved devices against what the system offers now, and setup warnings.

const KIND_NAMES = { audioinput: 'input', audiooutput: 'output' };

// Order: saved id, saved label, a device whose label contains preferLabel,
// the system default, the first device of that kind.
export function pickDevice(devices, kind, saved, preferLabel) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
  if (saved) {
    const found = list.find((d) => d.deviceId === saved.id) ?? list.find((d) => d.label === saved.label);
    if (found) return { device: found, warning: null };
  }
  const preferred = preferLabel
    ? list.find((d) => d.deviceId !== 'default' && d.label.includes(preferLabel))
    : null;
  const device = preferred ?? list.find((d) => d.deviceId === 'default') ?? list[0] ?? null;
  const warning = saved
    ? `Saved ${KIND_NAMES[kind]} "${saved.label}" not found — using ${device ? `"${device.label}"` : 'nothing'}.`
    : null;
  return { device, warning };
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
