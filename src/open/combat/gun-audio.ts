import { audio, blip, noise, out } from '../game/sound';

/**
 * 武器的声音：TACZ 枪包自带的采样（开火、换弹的每个动作、掏枪），用开放世界共用的那个 AudioContext 播。
 * 主游戏的 AudioEngine 自己开一个 AudioContext、还绑着主游戏的 Game，这里不用它。
 * 采样在枪的模型加载好时就下载；AudioContext 要等第一次按键 / 点鼠标才有，有了以后再解码。
 * 近战的挥空 / 打中、爆炸、用东西时的小声音都是合成的（sound.ts 的 blip / 白噪声），不用消耗品包里的音频。
 * 别人开的枪（far）：枪包里第三人称的那份采样，按距离变小、变闷、晚一点到，分左右；同时最多 FAR_VOICES 个。
 */

const SFX = `${import.meta.env.BASE_URL}tacz/ak47/sfx/`;
/** 几把枪的枪包里都带着的通用音效（打中身体 / 爆头 / 击杀 / 空仓扣扳机） */
export const HIT_BODY = `${SFX}flesh_hit.ogg`;
export const HIT_HEAD = `${SFX}head_hit.ogg`;
export const HIT_KILL = `${SFX}kill.ogg`;
export const DRY_FIRE = `${SFX}dry_fire.ogg`;

/** 枪包里用不上的采样（第三人称、消音器、枪托近战……）：不下载 */
const SKIP = /_3p\.|silence|melee_|fire_select|inspect/;

/**
 * 别人的枪声最远听多远（米）、同时最多几个。满了就顶掉「现在听起来最轻」的那一路：枪声的劲都在头零点几秒，
 * 放了一阵的只剩尾巴，顶掉听不出来；新来的比它现在还轻就不放
 */
const FAR_MAX = 260;
const FAR_VOICES = 8;
/** 一声枪响过了这么久（秒）就只剩尾巴了 */
const FAR_BODY = 0.5;
/** 爆炸声同时最多几个 */
const MAX_BOOMS = 4;

/** 一路「远处的枪声」：滤波（越远越闷）→ 音量 → 左右。节点建一次一直用，每一枪只新建一个播放源 */
interface Voice {
  f: BiquadFilterNode;
  g: GainNode;
  p: StereoPannerNode;
  src: AudioBufferSourceNode | null;
  /** 这一路什么时候开始响、什么时候放完（AudioContext 的时间），放的有多响 */
  t0: number;
  end: number;
  level: number;
}

export class GunAudio {
  /** 解码好的；null = 文件没有 / 解码失败（不再重试） */
  private readonly bufs = new Map<string, AudioBuffer | null>();
  /** 下载好、还没解码的（AudioContext 还没有） */
  private readonly raw = new Map<string, ArrayBuffer>();
  private readonly asked = new Set<string>();
  private readonly voices: Voice[] = [];
  private booms = 0;

  constructor() {
    this.preload([HIT_BODY, HIT_HEAD, HIT_KILL, DRY_FIRE]);
  }

  /** all = 连平时不下载的那几类也要（别人开枪用的第三人称采样） */
  preload(urls: readonly string[], all = false): void {
    for (const u of urls) {
      if (!u || this.asked.has(u) || (!all && SKIP.test(u))) continue;
      this.asked.add(u);
      fetch(u)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => {
          if (!b || b.byteLength < 64) this.bufs.set(u, null);
          else {
            this.raw.set(u, b);
            this.pump();
          }
        })
        .catch(() => this.bufs.set(u, null));
    }
  }

  /** 每帧调一次：AudioContext 有了就把攒着的采样解码掉 */
  pump(): void {
    if (!this.raw.size) return;
    const a = audio();
    if (!a) return;
    for (const [u, b] of this.raw) {
      a.decodeAudioData(b)
        .then((buf) => this.bufs.set(u, buf))
        .catch(() => this.bufs.set(u, null));
    }
    this.raw.clear();
  }

  /** 这个采样能不能播（已经解码好） */
  has(url: string): boolean {
    return !!this.bufs.get(url);
  }

  /** 播一个采样。rate = 播放速度（开火时略微随机一点，连发不会像机关枪录音循环） */
  play(url: string, gain: number, rate = 1): boolean {
    const a = audio();
    const m = out();
    if (!a || !m) return false;
    const b = this.bufs.get(url);
    if (!b) {
      if (!this.asked.has(url)) this.preload([url]);
      return false;
    }
    const src = a.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(g).connect(m);
    src.start();
    return true;
  }

  /**
   * 别人在 dist 米外开了一枪。pan = 左右（-1 左，1 右）。返回放没放出来（太远、还没解码好、八路都占着而且都比它响 = 没放）。
   * 声音按 343 米/秒晚一点到：两百米外的枪先看到曳光，半秒多以后才听到
   */
  far(url: string, dist: number, pan: number): boolean {
    const a = audio();
    const m = out();
    if (!a || !m || !url || dist >= FAR_MAX) return false;
    const b = this.bufs.get(url);
    if (!b) {
      if (!this.asked.has(url)) this.preload([url], true);
      return false;
    }
    const fade = dist < 200 ? 1 : (FAR_MAX - dist) / (FAR_MAX - 200);
    const level = 0.8 * (14 / (14 + dist)) * fade;
    if (level < 0.003) return false;
    const now = a.currentTime;
    let v: Voice | null = null;
    for (const q of this.voices) {
      if (q.end <= now) {
        v = q;
        break;
      }
    }
    if (!v && this.voices.length < FAR_VOICES) {
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.5;
      const g = a.createGain();
      const p = a.createStereoPanner();
      f.connect(g).connect(p).connect(m);
      v = { f, g, p, src: null, t0: 0, end: 0, level: 0 };
      this.voices.push(v);
    }
    if (!v) {
      // 都占着：按「现在还剩多响」比（还没传到耳朵的算满的），顶掉最轻的那一路；新来的比它现在还轻就不放了
      let low: Voice | null = null;
      let lowNow = Infinity;
      for (const q of this.voices) {
        const age = now - q.t0;
        const left = q.level * (age <= 0 ? 1 : Math.max(0.04, 1 - age / FAR_BODY));
        if (left < lowNow) {
          lowNow = left;
          low = q;
        }
      }
      if (!low || lowNow >= level) return false;
      v = low;
    }
    const voice = v;
    const old = voice.src;
    if (old) {
      old.onended = null;
      try {
        old.stop();
      } catch {
        // 还没开始放的源 stop 会抛
      }
      old.disconnect();
    }
    voice.f.frequency.value = Math.max(450, Math.min(16000, 16000 * Math.exp(-dist / 70)));
    voice.g.gain.value = level;
    voice.p.pan.value = Math.max(-1, Math.min(1, pan));
    const src = a.createBufferSource();
    src.buffer = b;
    const rate = 0.96 + Math.random() * 0.08;
    src.playbackRate.value = rate;
    src.connect(voice.f);
    src.onended = () => {
      src.disconnect();
      if (voice.src === src) voice.src = null;
    };
    const delay = Math.min(0.75, dist / 343);
    src.start(now + delay);
    voice.src = src;
    voice.t0 = now + delay;
    voice.end = now + delay + b.duration / rate;
    voice.level = level;
    return true;
  }

  /** 爆炸：一声往下掉的轰响 + 胸口那一下低音，近处再加一下脆的。按距离变小、变闷、晚到 */
  boom(dist: number, pan: number): void {
    const a = audio();
    const m = out();
    const n = noise();
    if (!a || !m || !n || this.booms >= MAX_BOOMS || dist >= 600) return;
    const k = (26 / (26 + dist)) * (dist < 450 ? 1 : (600 - dist) / 150);
    const t = a.currentTime + Math.min(1.5, dist / 343);
    const bus = a.createGain();
    bus.gain.value = Math.min(1, k * 1.25);
    const pn = a.createStereoPanner();
    pn.pan.value = Math.max(-1, Math.min(1, pan));
    bus.connect(pn).connect(m);
    const src = a.createBufferSource();
    src.buffer = n;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    const top = Math.max(300, 5200 * Math.exp(-dist / 80));
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(90, top * 0.06), t + 0.9);
    const g1 = a.createGain();
    g1.gain.setValueAtTime(1, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(lp).connect(g1).connect(bus);
    src.start(t, Math.random() * 0.5, 1.4);
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.45);
    const g2 = a.createGain();
    g2.gain.setValueAtTime(1.1, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g2).connect(bus);
    o.start(t);
    o.stop(t + 0.85);
    if (dist < 80) {
      const c = a.createBufferSource();
      c.buffer = n;
      const hp = a.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g3 = a.createGain();
      g3.gain.setValueAtTime(0.9 * (1 - dist / 80), t);
      g3.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      c.connect(hp).connect(g3).connect(bus);
      c.start(t, Math.random(), 0.12);
    }
    this.booms++;
    src.onended = () => {
      this.booms--;
      bus.disconnect();
    };
  }

  /**
   * 用东西 / 扔手雷时动作里的小声音（哪一类是导入时按片段里的音效关键帧分好的）：
   * cloth 衣服摩擦 · click 咔哒 · hiss 嘶 · breath 吸气呼气 · squish 挤药膏 · bite 咬 · inject 扎针 · pin 保险销 · throw 扔出去
   */
  cue(kind: string): void {
    switch (kind) {
      case 'click':
        blip(0.16, 0.035, 3400, 1500);
        break;
      case 'hiss':
        blip(0.14, 0.32, 5200);
        break;
      case 'breath':
        blip(0.1, 0.5, 900);
        break;
      case 'squish':
        blip(0.16, 0.12, 500, 180);
        break;
      case 'bite':
        blip(0.22, 0.1, 1300, 240);
        break;
      case 'inject':
        blip(0.2, 0.07, 2600, 700);
        break;
      case 'pin':
        blip(0.24, 0.05, 4600, 2200);
        break;
      case 'throw':
        blip(0.2, 0.2, 620);
        break;
      default:
        blip(0.1, 0.16, 1500);
    }
  }

  /** 手雷磕在地上 / 墙上 */
  tink(vol: number, pan: number): void {
    blip(vol, 0.05, 2800, 1100, pan);
  }

  /** 调试：远处的枪声占了几路（一共建过几路）、有几个爆炸声在响、解码好了几个采样 */
  stats(): { voices: number; built: number; booms: number; decoded: number } {
    const a = audio();
    const now = a ? a.currentTime : 0;
    let n = 0;
    for (const q of this.voices) if (q.end > now) n++;
    let d = 0;
    for (const b of this.bufs.values()) if (b) d++;
    return { voices: n, built: this.voices.length, booms: this.booms, decoded: d };
  }

  /** 空仓扣扳机的「咔」 */
  dry(): void {
    if (!this.play(DRY_FIRE, 0.7)) blip(0.22, 0.035, 3200);
  }

  /** 挥空：一声风声，重武器低一点 */
  whoosh(heavy: number): void {
    blip(0.16 + 0.1 * heavy, 0.16 + 0.1 * heavy, 700 - 380 * heavy);
  }

  /** 近战打中：闷响；flesh = 打在丧尸身上，否则是墙 / 铁皮 */
  thud(heavy: number, flesh: boolean): void {
    if (flesh) {
      blip(0.5 + 0.3 * heavy, 0.13 + 0.08 * heavy, 240 - 90 * heavy, 110 - 40 * heavy);
      this.play(HIT_BODY, 0.5, 0.8 - 0.2 * heavy);
    } else blip(0.4 + 0.2 * heavy, 0.09, 1500 - 700 * heavy, 320 - 120 * heavy);
  }

  /** 子弹打中丧尸的提示音 */
  hit(head: boolean, kill: boolean): void {
    if (kill) this.play(HIT_KILL, 0.55);
    else this.play(head ? HIT_HEAD : HIT_BODY, head ? 0.6 : 0.4, 0.95 + Math.random() * 0.1);
  }
}
