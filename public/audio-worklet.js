// 音声エフェクトのうち、ブラウザ標準の部品では作れないもの（AudioWorklet）。
// src/fx/audio.ts から使う。プレビュー再生と書き出しの両方で同じものが動く。

/** ノイズゲート／エクスパンダー：小さい音をさらに小さくする（mode 0 = ゲート、1 = エクスパンダー） */
class ShmDyn extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.mode = o.mode || 0;
    this.th = Math.pow(10, (o.threshold ?? -40) / 20);
    this.ratio = Math.max(1, o.ratio ?? 2);
    this.att = Math.exp(-1 / (sampleRate * Math.max(0.0005, (o.attack ?? 5) / 1000)));
    this.rel = Math.exp(-1 / (sampleRate * Math.max(0.005, (o.release ?? 150) / 1000)));
    this.env = 0;
    this.gain = 1;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]));
      this.env = peak > this.env ? peak : this.env * this.rel + peak * (1 - this.rel);
      let target = 1;
      if (this.env < this.th) target = this.mode === 0 ? 0 : Math.pow(Math.max(this.env, 1e-6) / this.th, this.ratio - 1);
      const k = target > this.gain ? this.att : this.rel;
      this.gain = this.gain * k + target * (1 - k);
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain;
    }
    return true;
  }
}

/** 低音質化：音の細かさ（ビット数）と、1秒あたりの点の数（サンプリング周波数）を落とす */
class ShmCrush extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.steps = Math.pow(2, Math.max(1, o.bits ?? 8) - 1);
    this.hold = Math.max(1, Math.round(sampleRate / Math.max(500, o.rate ?? 8000)));
    this.count = 0;
    this.last = [0, 0];
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      if (this.count === 0) {
        for (let c = 0; c < output.length; c++) this.last[c] = Math.round((input[c] || input[0])[i] * this.steps) / this.steps;
      }
      this.count = (this.count + 1) % this.hold;
      for (let c = 0; c < output.length; c++) output[c][i] = this.last[c];
    }
    return true;
  }
}

/** 音程：速さを変えずに高さだけを変える（2つの読み出し位置を入れ替えながら重ねる方式） */
class ShmPitch extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.ratio = Math.pow(2, (o.semitones ?? 0) / 12);
    this.win = Math.round(sampleRate * 0.05);
    this.size = this.win * 4;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.phase = 0;
  }
  read(ch, delay) {
    let pos = this.w - delay;
    while (pos < 0) pos += this.size;
    const i = Math.floor(pos);
    const f = pos - i;
    const b = this.buf[ch];
    return b[i % this.size] * (1 - f) + b[(i + 1) % this.size] * f;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const n = input[0].length;
    const step = (1 - this.ratio) / this.win;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) this.buf[c][this.w] = (input[c] || input[0])[i];
      const p1 = this.phase;
      const p2 = (this.phase + 0.5) % 1;
      const w1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1);
      const w2 = 1 - w1;
      for (let c = 0; c < output.length; c++) {
        const ch = Math.min(c, 1);
        output[c][i] = w1 * this.read(ch, 1 + p1 * this.win) + w2 * this.read(ch, 1 + p2 * this.win);
      }
      this.w = (this.w + 1) % this.size;
      this.phase += step;
      this.phase -= Math.floor(this.phase);
    }
    return true;
  }
}

/** 瞬間ループ：一定の間隔で、直前の短い音を何回かくり返す */
class ShmStutter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.len = Math.max(64, Math.round((sampleRate * (o.length ?? 100)) / 1000));
    this.repeats = Math.max(1, Math.round(o.repeats ?? 3));
    this.interval = Math.max(this.len * (this.repeats + 1), Math.round((sampleRate * (o.interval ?? 1000)) / 1000));
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.t = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      const pos = this.t % this.interval;
      for (let c = 0; c < output.length; c++) {
        const ch = Math.min(c, 1);
        const x = (input[c] || input[0])[i];
        if (pos < this.len) {
          this.buf[ch][pos] = x;
          output[c][i] = x;
        } else if (pos < this.len * (this.repeats + 1)) {
          // つなぎ目でプチッと鳴らないよう、両端を少しなめらかにする
          const j = pos % this.len;
          const edge = Math.min(1, j / 48, (this.len - j) / 48);
          output[c][i] = this.buf[ch][j] * edge;
        } else {
          output[c][i] = x;
        }
      }
      this.t++;
    }
    return true;
  }
}

registerProcessor('shm-dyn', ShmDyn);
registerProcessor('shm-crush', ShmCrush);
registerProcessor('shm-pitch', ShmPitch);
registerProcessor('shm-stutter', ShmStutter);
