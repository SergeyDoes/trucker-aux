// Click counter for a clean tone. For x[n] = A*sin(wn + phi),
// x[n+1] + x[n-1] = 2cos(w)*x[n]; a break in the signal makes the residual spike.
export class GlitchCounter {
  constructor(frequency, sampleRate, { threshold = 0.05, holdSamples = sampleRate / 10 } = {}) {
    this.k = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
    this.threshold = threshold; // fraction of the amplitude
    this.hold = holdSamples;    // one break is not counted twice
    this.prev1 = 0;
    this.prev2 = 0;
    this.peak = 0;
    this.cooldown = 0;
    this.glitches = 0;
    this.samples = 0;
  }

  process(block) {
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      this.peak = Math.max(this.peak * 0.99999, Math.abs(x));
      const residual = x + this.prev2 - this.k * this.prev1; // residual for the previous sample
      if (this.cooldown > 0) {
        this.cooldown--;
      } else if (this.samples >= 2 && this.peak > 0.01 && Math.abs(residual) > this.threshold * this.peak) {
        this.glitches++;
        this.cooldown = this.hold;
      }
      this.prev2 = this.prev1;
      this.prev1 = x;
      this.samples++;
    }
    return this.glitches;
  }
}
