import { audio, noise, out } from './game/sound';

/**
 * 天气的声音：雨声（两层滤过的噪声：沙沙的雨丝 + 低一点的「哗哗」），风声（带通噪声，一阵一阵），雷声。
 * 在屋里 / 车里：雨声闷下来（低通压到一千赫左右），打在屋顶上的那层低频反而更清楚。
 * 第一次按键 / 点鼠标以后才有 AudioContext：之前什么都不做，有了以后再把节点建起来。
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class WeatherSound {
  private ac: AudioContext | null = null;
  private rainG: GainNode | null = null;
  private bodyG: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private windG: GainNode | null = null;
  private windF: BiquadFilterNode | null = null;
  private t = 0;
  private time = Math.random() * 100;

  private build(ac: AudioContext, dst: AudioNode, buf: AudioBuffer): void {
    this.ac = ac;
    const loop = (rate: number): AudioBufferSourceNode => {
      const s = ac.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      // 几路噪声用不同的速度放：两秒一圈的循环叠在一起听不出重复
      s.playbackRate.value = rate;
      s.start(0, Math.random() * 1.5);
      return s;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode => {
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    // 雨：沙沙声（一千到七千赫）+ 哗哗声（三百赫上下，雨大了、头顶有屋顶时明显）
    const muffle = filter('lowpass', 14000);
    const rainG = ac.createGain();
    rainG.gain.value = 0;
    const hissG = ac.createGain();
    hissG.gain.value = 0.55;
    const bodyG = ac.createGain();
    bodyG.gain.value = 0.3;
    loop(1).connect(filter('highpass', 1100)).connect(filter('lowpass', 7200)).connect(hissG).connect(muffle);
    loop(0.57).connect(filter('bandpass', 330, 0.6)).connect(bodyG).connect(muffle);
    muffle.connect(rainG).connect(dst);
    // 风
    const windF = filter('bandpass', 380, 1.3);
    const windG = ac.createGain();
    windG.gain.value = 0;
    loop(0.43).connect(windF).connect(filter('lowpass', 1900)).connect(windG).connect(dst);
    this.rainG = rainG;
    this.bodyG = bodyG;
    this.muffle = muffle;
    this.windG = windG;
    this.windF = windF;
  }

  /** 每帧调（里面自己限到一秒八次）。shelter：0 露天 … 1 在屋里（车里 0.7） */
  update(dt: number, rain: number, snow: number, wind: number, shelter: number): void {
    this.time += dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.12;
    const ac = audio();
    const dst = out();
    if (!ac || !dst) return;
    if (this.ac !== ac) {
      const buf = noise();
      if (!buf) return;
      this.build(ac, dst, buf);
    }
    const now = ac.currentTime;
    const r = clamp01(rain);
    this.rainG?.gain.setTargetAtTime(Math.pow(r, 0.8) * 0.5 * (1 - 0.5 * shelter), now, 0.25);
    this.bodyG?.gain.setTargetAtTime(0.25 + 0.45 * r * r + 0.5 * shelter, now, 0.25);
    this.muffle?.frequency.setTargetAtTime(14000 - 12900 * shelter, now, 0.2);
    // 风：一阵一阵（两个慢的正弦相乘），风越大声音越尖
    const gust = 0.7 + 0.3 * Math.sin(this.time * 0.43) * Math.sin(this.time * 0.17 + 1.3) + 0.12 * Math.sin(this.time * 1.31);
    const w = clamp01(wind) * gust;
    // 下雪天别的声音都闷，风声显得更清楚
    this.windG?.gain.setTargetAtTime(w * w * (0.38 + 0.12 * clamp01(snow)) * (1 - 0.6 * shelter), now, 0.3);
    this.windF?.frequency.setTargetAtTime(260 + 380 * w, now, 0.4);
  }

  /** 一声雷：delay 秒以后响（闪电离得越远越晚），power 0–1 */
  thunder(delay: number, power: number): void {
    const ac = audio();
    const dst = out();
    const buf = noise();
    if (!ac || !dst || !buf) return;
    const t = ac.currentTime + delay;
    // 远的雷只剩低沉的滚动，近的先「咔嚓」一声
    const far = clamp01(delay / 3.2);
    const len = 3.2 + far * 2.4 + Math.random();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // 放慢四五倍：白噪声变成低沉的隆隆声
    src.playbackRate.value = 0.2 + Math.random() * 0.1;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(760 - 520 * far, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + len);
    const g = ac.createGain();
    const peak = power * (1.15 - 0.45 * far);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.05 + far * 0.25);
    // 滚两下：落下去、再起来一点、再拖着落到底
    const dip = t + 0.45 + Math.random() * 0.3;
    g.gain.exponentialRampToValueAtTime(peak * 0.32, dip);
    g.gain.exponentialRampToValueAtTime(peak * (0.45 + Math.random() * 0.25), dip + 0.35 + Math.random() * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    src.connect(lp).connect(g).connect(dst);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len + 0.1);
    if (far < 0.6) {
      const crack = ac.createBufferSource();
      crack.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.35;
      const cg = ac.createGain();
      cg.gain.setValueAtTime(power * 0.75 * (1 - far / 0.6), t);
      cg.gain.exponentialRampToValueAtTime(0.0008, t + 0.32);
      crack.connect(bp).connect(cg).connect(dst);
      crack.start(t, Math.random() * 1.5, 0.36);
    }
  }
}
