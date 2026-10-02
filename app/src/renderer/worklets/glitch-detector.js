import { GlitchCounter } from '../../shared/glitch.js';

class GlitchDetector extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.counter = new GlitchCounter(processorOptions.frequency, sampleRate);
    this.lastReport = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.counter.process(channel);
    if (currentTime - this.lastReport >= 1) {
      this.lastReport = currentTime;
      this.port.postMessage({ glitches: this.counter.glitches, seconds: this.counter.samples / sampleRate });
    }
    return true;
  }
}

registerProcessor('glitch-detector', GlitchDetector);
