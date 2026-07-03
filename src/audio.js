// =============================================================
//  オーディオエンジン（Web Audio API・完全プロシージャル）
//  外部音源ファイル不要。すべて合成音で生成します。
// =============================================================

import { CONFIG } from './config.js';
import { clamp } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.started = false;
    this._musicTimer = 0;
    this._chordIndex = 0;
    this._noiseBuffer = null;
  }

  // ユーザー操作後に呼ぶ（ブラウザの自動再生制限対策）
  resume() {
    try {
      if (!this.ctx) this._build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.started = true;
    } catch (e) {
      console.warn('[audio] resume failed', e);
    }
  }

  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const a = CONFIG.audio;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : a.masterVolume;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = a.musicVolume;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = a.sfxVolume;
    this.sfxGain.connect(this.master);

    // ノイズバッファ（爆発・打撃用）
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : CONFIG.audio.masterVolume;
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  get ok() { return this.started && this.ctx; }

  // --- 低レベル: 音色 ---
  _tone(freq, dur, type = 'sine', gain = 0.5, dest = null, detune = 0) {
    if (!this.ok) return;
    const t = this.now;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _sweep(f0, f1, dur, type = 'sawtooth', gain = 0.4, dest = null) {
    if (!this.ok) return;
    const t = this.now;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, gain = 0.5, filterFreq = 1200, type = 'lowpass', dest = null) {
    if (!this.ok) return;
    const t = this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _chord(freqs, dur, type = 'sine', gain = 0.15) {
    freqs.forEach((f) => this._tone(f, dur, type, gain, this.musicGain));
  }

  // --- 効果音 ---
  hit(strength = 0.5) {
    const base = 600 + strength * 700;
    this._tone(base, 0.12, 'triangle', 0.22 + strength * 0.2);
    this._noise(0.07, 0.12 + strength * 0.18, 2600, 'bandpass');
  }

  slash() {
    this._sweep(1800, 320, 0.16, 'sawtooth', 0.16);
    this._noise(0.09, 0.14, 3200, 'highpass');
  }

  kick() {
    this._tone(140, 0.16, 'sine', 0.5);
    this._noise(0.1, 0.3, 900, 'bandpass');
  }

  bolt() {
    this._sweep(900, 1600, 0.1, 'square', 0.1);
    this._tone(1200, 0.08, 'triangle', 0.12);
  }

  explosion(size = 0.6) {
    this._noise(0.5 + size * 0.4, 0.5 + size * 0.3, 900 - size * 300, 'lowpass');
    this._tone(120 - size * 40, 0.5 + size * 0.3, 'sine', 0.4 + size * 0.2);
    this._sweep(420, 60, 0.4, 'square', 0.16);
  }

  playerHit() {
    this._tone(90, 0.4, 'sine', 0.5);
    this._noise(0.25, 0.35, 600, 'lowpass');
    this._sweep(300, 60, 0.3, 'sawtooth', 0.2);
  }

  guard() {
    this._tone(320, 0.1, 'square', 0.2);
    this._noise(0.06, 0.2, 2000, 'bandpass');
  }

  dodge() {
    this._sweep(400, 1800, 0.25, 'sine', 0.22);
    this._noise(0.15, 0.12, 4000, 'highpass');
  }

  clap() {
    this._noise(0.12, 0.5, 1800, 'bandpass');
    this._sweep(900, 200, 0.25, 'triangle', 0.25);
    this._tone(180, 0.3, 'sine', 0.3);
  }

  fusion() {
    this._sweep(200, 900, 0.4, 'sawtooth', 0.3);
    this._chord([392, 523.25, 659.25], 1.0, 'triangle', 0.16);
    setTimeout(() => this.explosion(0.9), 150);
  }

  sigil() {
    // 図形詠唱の成立
    this._sweep(500, 1500, 0.3, 'triangle', 0.2);
    this._chord([659.25, 987.77], 0.6, 'sine', 0.12);
  }

  barrier() {
    this._tone(220, 0.6, 'triangle', 0.2);
    this._sweep(300, 700, 0.5, 'sine', 0.14);
  }

  charge() {
    this._tone(520 + Math.random() * 60, 0.08, 'sine', 0.12);
  }

  coin() {
    this._tone(987.77, 0.1, 'square', 0.14);
    setTimeout(() => this._tone(1318.5, 0.16, 'square', 0.12), 50);
  }

  heal() {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.3, 'sine', 0.16), i * 70));
  }

  revive() {
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.4, 'triangle', 0.2), i * 100));
  }

  downed() {
    this._sweep(300, 60, 0.8, 'sawtooth', 0.3);
    this._tone(80, 0.8, 'sine', 0.4);
  }

  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.35, 'triangle', 0.22), i * 90));
  }

  select() { this._tone(880, 0.08, 'square', 0.15); }
  buy() { this.coin(); setTimeout(() => this._tone(1568, 0.2, 'triangle', 0.14), 120); }
  deny() { this._tone(160, 0.2, 'square', 0.18); }
  chest() {
    this._sweep(300, 900, 0.3, 'triangle', 0.2);
    setTimeout(() => this._chord([783.99, 987.77, 1174.66], 0.8, 'triangle', 0.12), 200);
  }
  door() { this._sweep(200, 90, 0.4, 'sine', 0.25); this._noise(0.2, 0.15, 500, 'lowpass'); }

  ultimate() {
    this._sweep(200, 1400, 0.5, 'sawtooth', 0.3, this.master);
    this._chord([523.25, 659.25, 783.99, 1046.5], 1.6, 'triangle', 0.18);
    setTimeout(() => this.explosion(1), 180);
  }

  bossRoar() {
    this._sweep(180, 40, 1.2, 'sawtooth', 0.4);
    this._tone(55, 1.4, 'sine', 0.5);
    this._noise(1.0, 0.3, 700, 'lowpass');
  }

  waveStart() {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.3, 'triangle', 0.22), i * 90));
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.6, 'triangle', 0.25), i * 140));
  }

  defeat() {
    const notes = [392, 311.13, 261.63, 196];
    notes.forEach((n, i) => setTimeout(() => this._tone(n, 0.7, 'sine', 0.28), i * 220));
  }

  // --- アンビエント音楽（ゆっくり変化するパッド）---
  // 毎フレーム update を呼ぶ。theme でコード進行の雰囲気を変える。
  updateMusic(dt, intensity = 0, theme = 'wa') {
    if (!this.ok || this.muted) return;
    this._musicTimer -= dt;
    if (this._musicTimer <= 0) {
      this._musicTimer = clamp(4.5 - intensity * 2.6, 1.2, 4.5);
      const progressions = theme === 'west'
        ? [ // 洋: 短調のゴシック風
            [110.0, 164.81, 220.0],
            [98.0, 146.83, 196.0],
            [130.81, 196.0, 261.63],
            [103.83, 155.56, 207.65],
          ]
        : theme === 'chaos'
        ? [ // 混沌: 不安定な増四度
            [110.0, 155.56, 220.0],
            [116.54, 164.81, 233.08],
            [103.83, 146.83, 207.65],
            [123.47, 174.61, 246.94],
          ]
        : [ // 和: ヨナ抜き風
            [130.81, 196.0, 293.66],
            [146.83, 220.0, 329.63],
            [110.0, 164.81, 246.94],
            [98.0, 146.83, 220.0],
          ];
      const ch = progressions[this._chordIndex % progressions.length];
      this._chordIndex++;
      ch.forEach((f, i) => {
        this._padNote(f, this._musicTimer * 1.4, i === 0 ? 0.1 : 0.06, intensity);
      });
    }
  }

  _padNote(freq, dur, gain, intensity) {
    if (!this.ok) return;
    const t = this.now;
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600 + intensity * 1400;
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    o.frequency.value = freq; o2.frequency.value = freq;
    o2.detune.value = 8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
}
