// ============================================================
//  MOTO RUSH — procedural audio engine (Web Audio, zero files)
//  · motorcycle engine: saw+square+sub through gears, wind noise
//  · synthwave music: lookahead step sequencer (kick/snare/hats/
//    bass/pad/arp with feedback delay + sidechain-style ducking)
//  · SFX: pickup, crash, whoosh, horn, low-fuel warn, UI tick
// ============================================================

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    try { this.muted = localStorage.getItem('motoRushMuted') === '1'; } catch (e) {}
    this.bpm = 108;
    this._step = 0;
    this._nextT = 0;
    this._musTimer = null;
    this._eng = null;
  }

  // ---- core graph (must be called from a user gesture) ----
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 20;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.18;
      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);

      this.music = ctx.createGain(); this.music.gain.value = 0.75; this.music.connect(this.master);
      this.sfx   = ctx.createGain(); this.sfx.gain.value   = 0.9;  this.sfx.connect(this.master);
      this.eng   = ctx.createGain(); this.eng.gain.value   = 0.9;  this.eng.connect(this.master);

      // ducked bus (pads/bass dip when the kick hits)
      this.duck = ctx.createGain(); this.duck.gain.value = 1; this.duck.connect(this.music);

      // feedback delay for the arp lead
      this.delay = ctx.createDelay(1.0);
      this.delay.delayTime.value = 0.27;
      this.dfb = ctx.createGain(); this.dfb.gain.value = 0.34;
      this.dwet = ctx.createGain(); this.dwet.gain.value = 0.22;
      this.delay.connect(this.dfb); this.dfb.connect(this.delay);
      this.delay.connect(this.dwet); this.dwet.connect(this.duck);

      // shared noise buffer
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.ready = true;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('motoRushMuted', m ? '1' : '0'); } catch (e) {}
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume()  { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noise(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    return src;
  }

  // ================= ENGINE =================
  startEngine() {
    this.ensure();
    if (!this.ready || this._eng) return;
    const ctx = this.ctx;

    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const sub = ctx.createOscillator(); sub.type = 'sine';

    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    const g3 = ctx.createGain(); g3.gain.value = 0.6;

    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 1.1;
    const eg = ctx.createGain(); eg.gain.value = 0.0001;

    o1.connect(lp);
    o2.connect(g2); g2.connect(lp);
    sub.connect(g3); g3.connect(lp);
    lp.connect(eg); eg.connect(this.eng);

    // wind / road roar
    const wn = this._noise(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0.0001;
    wn.connect(bp); bp.connect(wg); wg.connect(this.eng);

    const t = ctx.currentTime;
    o1.start(t); o2.start(t); sub.start(t); wn.start(t);
    this._eng = { o1, o2, sub, lp, eg, wg };
  }

  // s01: 0..1 normalized speed · alive: false while coasting out
  updateEngine(s01, alive = true) {
    if (!this._eng) return;
    const t = this.ctx.currentTime;
    const e = this._eng;

    // fake gearbox: pitch climbs, drops at each "shift"
    const gp = s01 * 3.999;
    const rpm = 0.28 + (gp - Math.floor(gp)) * 0.72;
    const base = 46 + rpm * 120;

    e.o1.frequency.setTargetAtTime(base, t, 0.045);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.045);
    e.sub.frequency.setTargetAtTime(base * 0.25, t, 0.06);
    e.lp.frequency.setTargetAtTime(260 + s01 * 2400 + rpm * 320, t, 0.06);
    e.eg.gain.setTargetAtTime(alive ? 0.14 + s01 * 0.12 : 0.0001, t, alive ? 0.09 : 0.25);
    e.wg.gain.setTargetAtTime(alive ? s01 * s01 * 0.42 : 0.0001, t, 0.15);
  }

  stopEngine(fade = 0.5) {
    if (!this._eng) return;
    const t = this.ctx.currentTime;
    const e = this._eng;
    e.eg.gain.cancelScheduledValues(t);
    e.eg.gain.setTargetAtTime(0.0001, t, fade / 3);
    e.wg.gain.setTargetAtTime(0.0001, t, fade / 3);
    const e2 = e;
    setTimeout(() => {
      try { e2.o1.stop(); e2.o2.stop(); e2.sub.stop(); } catch (err) {}
    }, fade * 1000 + 120);
    this._eng = null;
  }

  // engine dies out of fuel — sputter stutter then fade
  sputter() {
    if (!this._eng) return;
    const t = this.ctx.currentTime;
    const g = this._eng.eg.gain;
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.22;
      g.setTargetAtTime(0.12, at, 0.02);
      g.setTargetAtTime(0.004, at + 0.1, 0.03);
    }
  }

  // ================= MUSIC (synthwave sequencer) =================
  // 4-bar loop · Am F C G · 16th-note grid · tempo follows game speed
  startMusic() {
    this.ensure();
    if (!this.ready || this._musTimer) return;
    this._step = 0;
    this._nextT = this.ctx.currentTime + 0.08;
    this._musTimer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    if (this._musTimer) { clearInterval(this._musTimer); this._musTimer = null; }
  }

  setIntensity(x01) { this.bpm = 104 + clamp(x01, 0, 1) * 26; }

  _schedule() {
    const s16 = 60 / this.bpm / 4;
    while (this._nextT < this.ctx.currentTime + 0.14) {
      this._playStep(this._step, this._nextT);
      this._step = (this._step + 1) % 64;
      this._nextT += s16;
    }
  }

  _playStep(st, t) {
    const spb = 60 / this.bpm;
    const bar = (st >> 4) & 3;
    const s = st & 15;
    const ROOTS = [45, 41, 48, 43];            // A2 F2 C3 G2
    const MINOR = [true, false, false, false]; // Am, F, C, G
    const root = ROOTS[bar];

    if (s % 4 === 0) this._kick(t);
    if (s === 4 || s === 12) this._snare(t);
    if (s % 2 === 1) this._hat(t, s % 4 === 3 ? 0.14 : 0.08, false);
    if (s === 2 || s === 10) this._hat(t, 0.11, true);

    // pumping bus on every kick
    if (s % 4 === 0) {
      const g = this.duck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.45, t);
      g.linearRampToValueAtTime(1, t + spb * 0.55);
    }

    // driving 16th bass
    const BP = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 7, 12];
    this._bass(t, root + BP[s], spb / 4 * 0.92, s % 4 === 0 ? 0.30 : 0.18);

    // pad chord each bar
    if (s === 0) {
      const iv = MINOR[bar] ? [0, 3, 7] : [0, 4, 7];
      this._pad(t, [root + 12, root + 12 + iv[1], root + 12 + iv[2]], spb * 3.9);
    }

    // sparkle arp on bars 2 & 4
    if (bar % 2 === 1 && s % 2 === 0) {
      const P = [0, 3, 7, 10, 12, 15];
      this._pluck(t, root + 24 + P[(st * 5) % 6]);
    }
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(41, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g); g.connect(this.music);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(t) {
    const ctx = this.ctx;
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    n.connect(bp); bp.connect(g); g.connect(this.music);
    n.start(t); n.stop(t + 0.2);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 195;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.22, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g2); g2.connect(this.music);
    o.start(t); o.stop(t + 0.1);
  }

  _hat(t, vel, open) {
    const ctx = this.ctx;
    const n = this._noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7600;
    const g = ctx.createGain();
    const dur = open ? 0.09 : 0.035;
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(this.music);
    n.start(t); n.stop(t + dur + 0.02);
  }

  _bass(t, midi, dur, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(midi);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = midiHz(midi - 12);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(340, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.setValueAtTime(vel, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(this.duck);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  _pad(t, midis, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 950; lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.35);
    g.gain.setValueAtTime(0.05, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(this.duck);
    for (const m of midis) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(m); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.33;
        o.connect(og); og.connect(lp);
        o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  _pluck(t, midi) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = midiHz(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o.connect(lp); lp.connect(g);
    g.connect(this.duck); g.connect(this.delay);
    o.start(t); o.stop(t + 0.22);
  }

  // ================= SFX =================
  _env(g, t, peak, dur, attack = 0.005) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }

  pickup() {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [[660, 0, 0.22, 0.1], [990, 0.08, 0.24, 0.13], [1760, 0.16, 0.14, 0.2]].forEach(([f, dt, v, d]) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + dt, v, d);
      o.connect(g); g.connect(this.sfx); o.start(t + dt); o.stop(t + dt + d + 0.05);
    });
  }

  whoosh(pan = 0) {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(this.sfx);
    n.start(t); n.stop(t + 0.35);
  }

  horn() {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
    lp.connect(g); g.connect(this.sfx);
    [392, 494].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + 0.55);
    });
  }

  warn() {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [0, 0.16].forEach((dt) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 987;
      const g = ctx.createGain(); this._env(g, t + dt, 0.07, 0.08);
      o.connect(g); g.connect(this.sfx); o.start(t + dt); o.stop(t + dt + 0.1);
    });
  }

  tick() {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1250;
    const g = ctx.createGain(); this._env(g, t, 0.05, 0.045);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.07);
  }

  crash() {
    this.ensure(); if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;

    // big noise slam, filter sweeping shut
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    n.connect(lp); lp.connect(g); g.connect(this.sfx);
    n.start(t); n.stop(t + 0.9);

    // sub thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.9, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g2); g2.connect(this.sfx);
    o.start(t); o.stop(t + 0.65);

    // metallic clanks
    [820, 540, 1170].forEach((f, i) => {
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = f;
      const g3 = ctx.createGain(); this._env(g3, t + 0.03 + i * 0.07, 0.12, 0.12);
      o2.connect(g3); g3.connect(this.sfx);
      o2.start(t + 0.03 + i * 0.07); o2.stop(t + 0.03 + i * 0.07 + 0.15);
    });
  }
}
