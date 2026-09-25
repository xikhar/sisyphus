// Local piano loop with synthesized wind, footsteps and stone scrape.
export class Soundscape {
  constructor() {
    this.enabled = true;
    this.ready = false;
    this.lastStep = -1;
    this.volume = 1;
    this.hidden = document.hidden;
  }

  async init() {
    if (this.ready) {
      await this.ctx.resume();
      this.startMusic();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b = 0;
    for (let i = 0; i < data.length; i++) { b = (b + (Math.random() * 2 - 1) * 0.025) / 1.025; data[i] = b * 6; }
    this.noiseBuffer = buffer;
    const wind = this.ctx.createBufferSource();
    wind.buffer = buffer; wind.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 480;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.28;
    wind.connect(filter).connect(this.windGain).connect(this.master); wind.start();
    this.scrape = this.ctx.createBufferSource(); this.scrape.buffer = buffer; this.scrape.loop = true;
    const scrapeFilter = this.ctx.createBiquadFilter(); scrapeFilter.type = 'bandpass'; scrapeFilter.frequency.value = 840;
    this.scrapeGain = this.ctx.createGain(); this.scrapeGain.gain.value = 0;
    this.scrape.connect(scrapeFilter).connect(this.scrapeGain).connect(this.master); this.scrape.start();
    this.ready = true;
    // Resume synchronously within the input gesture, before waiting on the file.
    const resumed = this.ctx.resume();
    this.startMusic();
    this.applyVolume();
    await resumed;
  }

  startMusic() {
    if (this.music || this.musicLoading) return;
    this.musicLoading = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/sisyphus-piano.mp3`);
      if (!response.ok) throw new Error(`Piano could not load (${response.status})`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      this.music = this.ctx.createBufferSource();
      this.music.buffer = buffer;
      this.music.loop = true;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.music.connect(this.musicGain).connect(this.master);
      this.music.start();
      this.musicGain.gain.setTargetAtTime(2.2, this.ctx.currentTime, 1.2);
    })().catch(error => {
      // Leave the game and ambience working, and allow a later gesture to retry.
      console.warn('Piano unavailable:', error);
    }).finally(() => { this.musicLoading = null; });
  }

  applyVolume() {
    if (this.ready) this.master.gain.setTargetAtTime(
      this.enabled && !this.hidden ? .26 * this.volume : 0, this.ctx.currentTime, .18);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.applyVolume();
  }

  async toggle() {
    this.enabled = !this.enabled;
    await this.init();
    this.applyVolume();
    return this.enabled;
  }

  update(state, volume = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.volume = volume * (state.paused ? .4 : 1);
    this.applyVolume();
    const moving = !state.paused && state.started;
    this.scrapeGain.gain.setTargetAtTime(moving ? Math.min(0.4, Math.abs(state.rockVelocity) * 0.06) : 0, t, 0.1);
    this.windGain.gain.setTargetAtTime(state.phase === 'summit' ? 0.4 : 0.21 + state.progress * 0.1, t, 1);
    const step = Math.floor(state.playerX * 2.1);
    if (moving && Math.abs(state.playerVelocity) > 0.2 && step !== this.lastStep) {
      this.lastStep = step;
      const noise = this.ctx.createBufferSource(); noise.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 250;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      noise.connect(f).connect(g).connect(this.master); noise.start(); noise.stop(t + 0.15);
      noise.onended = () => { noise.disconnect(); f.disconnect(); g.disconnect(); };
    }
  }
}
