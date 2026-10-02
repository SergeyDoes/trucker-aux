// Device access for the renderer: lists, input capture and output probing.

let permitted = false;

// Device labels stay hidden until the page has microphone permission.
export async function listDevices() {
  if (!permitted) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((track) => track.stop());
    permitted = true;
  }
  return navigator.mediaDevices.enumerateDevices();
}

export async function openInput(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
  });
  return { stream, rate: stream.getAudioTracks()[0].getSettings().sampleRate };
}

// Native sample rate and channel count of an output device ('' is the system default).
export async function probeOutput(sinkId) {
  const ctx = new AudioContext({ sinkId });
  const result = { rate: ctx.sampleRate, channels: ctx.destination.maxChannelCount };
  await ctx.close();
  return result;
}
