// 店内BGM。音源ファイルは使わず、Web Audioでその場で鳴らす（オリジナル曲）。
// ブラウザは操作なしに音を出せないので、入店ボタンを押したときに start() する。

const BPM = 112;
const EIGHTH = 60 / BPM / 2;
const HOLD = -1; // 前の音をのばす
const REST = null;

const CHORDS = {
  C: [48, 52, 55], Am: [45, 48, 52], F: [41, 45, 48], G: [43, 47, 50], Em: [40, 43, 47],
};

// 1小節＝8分音符8つ。Aメロ8小節＋Bメロ8小節をくり返す
const SONG = [
  ['C', [76, HOLD, 79, HOLD, 84, HOLD, 83, 81]],
  ['Am', [79, HOLD, 76, HOLD, 72, HOLD, 74, 76]],
  ['F', [77, HOLD, 81, HOLD, 79, 77, 76, 74]],
  ['G', [74, HOLD, HOLD, HOLD, 79, HOLD, HOLD, REST]],
  ['C', [76, HOLD, 79, HOLD, 84, HOLD, 86, 88]],
  ['Em', [86, HOLD, 83, HOLD, 79, HOLD, 81, 83]],
  ['F', [84, HOLD, 81, HOLD, 77, 79, 81, 83]],
  ['C', [84, HOLD, HOLD, HOLD, REST, REST, 79, HOLD]],
  ['F', [81, HOLD, 79, 77, 76, HOLD, 77, HOLD]],
  ['G', [79, HOLD, HOLD, HOLD, 74, HOLD, HOLD, HOLD]],
  ['Em', [79, HOLD, 77, 76, 74, HOLD, 76, HOLD]],
  ['Am', [72, HOLD, HOLD, HOLD, 76, HOLD, 79, HOLD]],
  ['F', [81, HOLD, 84, HOLD, 83, HOLD, 81, HOLD]],
  ['G', [79, HOLD, 83, HOLD, 86, HOLD, HOLD, HOLD]],
  ['C', [84, HOLD, 83, 81, 79, HOLD, 76, HOLD]],
  ['G', [74, HOLD, HOLD, HOLD, REST, REST, REST, REST]],
];

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class Bgm {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  start() {
    if (!this.ctx) this.setup();
    this.ctx.resume();
    if (!this.timer) {
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 25);
    }
    this.apply();
  }

  toggle() {
    this.on = !this.on;
    if (this.ctx) this.apply();
    return this.on;
  }

  apply() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.on ? 0.22 : 0, t, 0.15);
  }

  setup() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // 広い店内の響き。作った残響を少しだけ混ぜる
    const verb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(verb);
    const n = ctx.sampleRate * 0.2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  tone(type, freq, t, dur, vol, attack = 0.01) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hit(t, vol, freq, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.2);
  }

  schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.2) {
      this.play(this.step, this.nextTime);
      this.step = (this.step + 1) % (SONG.length * 8);
      this.nextTime += EIGHTH;
    }
  }

  play(step, t) {
    const [chordName, mel] = SONG[Math.floor(step / 8)];
    const i = step % 8;
    const chord = CHORDS[chordName];
    // メロディ：やわらかい三角波。のばす長さを先読みする
    const note = mel[i];
    if (note !== REST && note !== HOLD) {
      let len = 1;
      while (i + len < 8 && mel[i + len] === HOLD) len++;
      this.tone('triangle', hz(note), t, len * EIGHTH * 0.95 + 0.1, 0.16);
      this.tone('sine', hz(note + 12), t, 0.25, 0.03);
    }
    // 伴奏：オルゴールのような分散和音
    const arp = [0, 2, 1, 2, 0, 2, 1, 2][i];
    this.tone('sine', hz(chord[arp] + 24), t, 0.5, 0.07, 0.005);
    // ベース：1拍目と3拍目
    if (i === 0 || i === 4) this.tone('triangle', hz(chord[0] - 12 + (i === 4 ? 7 : 0)), t, EIGHTH * 3.5, 0.2, 0.02);
    // リズム：軽いキック・ハイハット・手拍子
    if (i === 0 || i === 4) this.kick(t);
    if (i % 2 === 1) this.hit(t, 0.05, 7000, 0.05);
    if (i === 2 || i === 6) this.hit(t, 0.09, 1500, 0.12);
  }
}
