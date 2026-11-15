import type { PerspectiveCamera } from 'three';
import { audio, blip, noise, out } from '../game/sound';
import type { Zed } from './zombie-brain';
import type { ZKind } from './zombie-types';

/**
 * 丧尸的声音：全是合成的（一个锯齿波当声带，两个带通当口腔，再加一点气声），按离相机多远定音量、按左右定声像。
 * 游荡时隔一阵哼一声，发现人时尖叫，出手、挨打、死的时候各有一声。没有用户手势以前 audio() 是 null，什么都不播。
 */

/** 各类的嗓音高低（Hz）：肿胀者最低沉，奔袭者尖 */
const PITCH: Record<ZKind, number> = { walker: 95, runner: 128, crawler: 108, bloater: 62, armored: 78, mother: 54 };
/** 同时最多几声（一群一起叫的时候不糊成一片，也省节点） */
const MAX_VOICES = 6;

export class ZombieSounds {
  private lx = 0;
  private lz = 0;
  private rx = 1;
  private rz = 0;
  private att = 0;
  private pan = 0;
  private readonly until: number[] = [];
  private nextGroan = 2;
  private lastScreech = -9;
  private lastHurt = -9;
  private t = 0;

  /** 每帧：耳朵（相机）在哪、右边是哪边 */
  listen(camera: PerspectiveCamera, dt: number): void {
    const e = camera.matrixWorld.elements;
    this.lx = camera.position.x;
    this.lz = camera.position.z;
    const rx = e[0] as number;
    const rz = e[2] as number;
    const l = Math.hypot(rx, rz) || 1;
    this.rx = rx / l;
    this.rz = rz / l;
    this.t += dt;
  }

  /** 算这个位置的音量衰减和声像；太远听不见返回 false */
  private at(x: number, z: number): boolean {
    const dx = x - this.lx;
    const dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    this.att = 1 / (1 + (d / 8) ** 2);
    this.pan = d < 0.5 ? 0 : Math.max(-0.85, Math.min(0.85, ((dx * this.rx + dz * this.rz) / d) * 0.9));
    return this.att > 0.012;
  }

  /**
   * 一声：f0 → f1 滑过去的锯齿波（vib = 颤音的深度，vibHz = 颤音的快慢），过两个带通（form = 第一个的中心），
   * 再用几十赫兹的调幅做出喉咙里「咯咯」的粗糙感；breath = 气声的量
   */
  private voice(x: number, z: number, vol: number, f0: number, f1: number, dur: number, vib: number, vibHz: number, form: number, breath: number): void {
    const a = audio();
    const dst = out();
    if (!a || !dst || !this.at(x, z)) return;
    const t = a.currentTime;
    const live = this.until;
    for (let i = live.length - 1; i >= 0; i--) if ((live[i] as number) <= t) live.splice(i, 1);
    if (live.length >= MAX_VOICES) return;
    live.push(t + dur);
    const v = vol * this.att;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.09, dur * 0.25));
    g.gain.setValueAtTime(v, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 远处的发闷
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + 6000 * this.att;
    const pan = a.createStereoPanner();
    pan.pan.value = this.pan;
    g.connect(lp).connect(pan).connect(dst);
    // 喉咙的粗糙感：调幅
    const am = a.createGain();
    am.gain.value = 0.62;
    const rasp = a.createOscillator();
    rasp.type = 'sawtooth';
    rasp.frequency.value = 26 + Math.random() * 16;
    const raspG = a.createGain();
    raspG.gain.value = 0.38;
    rasp.connect(raspG).connect(am.gain);
    am.connect(g);
    const o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const lfo = a.createOscillator();
    lfo.frequency.value = vibHz;
    const lfoG = a.createGain();
    lfoG.gain.value = f0 * vib;
    lfo.connect(lfoG).connect(o.frequency);
    const b1 = a.createBiquadFilter();
    b1.type = 'bandpass';
    b1.frequency.value = form;
    b1.Q.value = 2.2;
    const b2 = a.createBiquadFilter();
    b2.type = 'bandpass';
    b2.frequency.value = form * 2.3;
    b2.Q.value = 3;
    const g2 = a.createGain();
    g2.gain.value = 0.5;
    o.connect(b1).connect(am);
    o.connect(b2).connect(g2).connect(am);
    const end = t + dur + 0.05;
    o.start(t);
    o.stop(end);
    lfo.start(t);
    lfo.stop(end);
    rasp.start(t);
    rasp.stop(end);
    const n = noise();
    if (breath > 0 && n) {
      const src = a.createBufferSource();
      src.buffer = n;
      const bf = a.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.value = form * 1.7;
      bf.Q.value = 0.8;
      const bg = a.createGain();
      bg.gain.value = breath;
      src.connect(bf).connect(bg).connect(g);
      src.start(t, Math.random() * 1.2, dur + 0.05);
    }
  }

  /** 游荡时的哼声 / 追人时的低吼 */
  groan(z: Zed): void {
    const f = PITCH[z.kind] * (0.88 + Math.random() * 0.3);
    const hunting = z.state === 'chase' || z.state === 'attack';
    if (hunting) this.voice(z.x, z.z, 0.55, f * 1.35, f * 1.05, 0.45 + Math.random() * 0.3, 0.07, 9, 760, 0.4);
    else this.voice(z.x, z.z, 0.42, f * 1.08, f * 0.8, 0.9 + Math.random() * 0.8, 0.04, 5, 520 + Math.random() * 180, 0.22);
  }

  /** 发现人了：尖叫（一群同时发现时不会每只都叫） */
  screech(z: Zed): void {
    if (this.t - this.lastScreech < 0.45) return;
    this.lastScreech = this.t;
    const f = PITCH[z.kind] * (2.4 + Math.random() * 0.5);
    this.voice(z.x, z.z, 0.8, f, f * 1.4, 0.5 + Math.random() * 0.25, 0.1, 17, 1150, 0.5);
  }

  /** 出手 */
  swing(z: Zed): void {
    const f = PITCH[z.kind] * 1.6;
    this.voice(z.x, z.z, 0.6, f, f * 0.7, 0.3, 0.06, 12, 820, 0.6);
  }

  /** 打中玩家了：闷的一下，带一点撕扯声 */
  bite(z: Zed): void {
    if (!this.at(z.x, z.z)) return;
    blip(0.55, 0.14, 230, 85, this.pan);
    blip(0.22, 0.1, 1900, 0, this.pan);
  }

  /** 丧尸挨了一下 */
  hurt(z: Zed): void {
    if (this.t - this.lastHurt < 0.13) return;
    this.lastHurt = this.t;
    const f = PITCH[z.kind] * (1.7 + Math.random() * 0.3);
    this.voice(z.x, z.z, 0.45, f, f * 0.75, 0.17, 0.05, 14, 900, 0.5);
  }

  die(z: Zed): void {
    const f = PITCH[z.kind] * (1.3 + Math.random() * 0.25);
    this.voice(z.x, z.z, 0.6, f, f * 0.45, 0.7 + Math.random() * 0.3, 0.06, 7, 640, 0.45);
  }

  /** 每帧：隔一阵让附近的某一只哼一声（丧尸越多越频繁） */
  ambient(dt: number, zeds: readonly Zed[]): void {
    this.nextGroan -= dt;
    if (this.nextGroan > 0) return;
    const n = zeds.length;
    this.nextGroan = (1.6 + Math.random() * 4.5) / (1 + Math.min(n, 30) / 12);
    if (!n || !audio()) return;
    // 随便挑几只，取 40 米以内的第一只
    for (let k = 0; k < 5; k++) {
      const z = zeds[Math.floor(Math.random() * n)] as Zed;
      if (z.alive && z.dist < 40 && z.state !== 'stagger') {
        this.groan(z);
        return;
      }
    }
  }
}
