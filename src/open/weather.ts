import { Color } from 'three';
import type { GameCtx, WeatherApi, WeatherKind } from './game/api';
import { WX } from './render/wx';
import { PrecipFx, rng } from './weather-fx';
import { WeatherSound } from './weather-sound';

/**
 * 天气：晴 / 多云 / 雨 / 雷暴 / 雪，气温，地面的干湿和积雪（接口见 game/api.ts 的 WeatherApi）。
 *
 * 时间表：按游戏里的钟走（第几天几点），由世界种子决定——同一个世界、同一个时刻永远是同一种天气，
 * 跳时间、读档以后接得上。一段天气持续一到四个游戏小时（= 现实一到四分钟），一段接一段：
 *   晴 → 多云 →（多半）下雨或者下雪 → 多云 →（多半）放晴 → ……
 *   雨可能越下越大变成雷暴，也可能冷锋过来变成雪。雨和雪哪种更久没下，下一场多半就是哪种。
 * 新开一局（第 1 天 9 点）先晴到中午过后，下午第一场是雨，雪通常在第一天夜里之前就能遇到。
 *
 * 过渡：云量、降水、气温、风都是平滑量（云先厚起来，雨雪才下得起来，前后四五十秒）。
 * 下的是雨还是雪看气温：1.5℃ 以上是雨，零下 1℃ 以下是雪，中间是雨夹雪——冷锋来了气温往下掉，雨就自己变成雪。
 *
 * 画面：每帧在钟（daycycle.ts）定好的光、雾、天空上再改一遍，不累积：云把太阳遮住、天光变灰、雾变浓
 * （雨天暗、雪天白），雷暴有闪电——只改已有的太阳和天光的强度，不加灯。粒子在 weather-fx.ts，声音在 weather-sound.ts，
 * 地面 / 草 / 树 / 房顶的积雪和潮湿靠 render/wx.ts 的共享 uniform。
 *
 * 调试：?weather=clear|cloudy|rain|storm|snow 固定天气；__open.weather.set(kind, true) 立刻换（见 set）。
 */

const KINDS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow'];
const isKind = (v: unknown): v is WeatherKind => KINDS.includes(v as WeatherKind);

/** 时间表上的一段：从 t0 到 t1（游戏小时，从第 1 天 0 点算起） */
interface Spell {
  kind: WeatherKind;
  t0: number;
  t1: number;
  /** 这一段有多「重」0–1：雨雪有多大、云有多厚 */
  power: number;
  /** 风往哪边吹（弧度） */
  dir: number;
}

/** 每种天气持续多少游戏小时（最短、最长） */
const SPAN: Record<WeatherKind, [number, number]> = { clear: [2.2, 4.5], cloudy: [1, 2], rain: [1.5, 3], storm: [0.8, 1.4], snow: [2, 3.5] };
/** set() 换上的天气保持多少现实秒，之后回到时间表 */
const HOLD: Record<WeatherKind, number> = { clear: 240, cloudy: 150, rain: 170, storm: 90, snow: 200 };

/** 一段天气要把各个量带到哪 */
const look = { clouds: 0.4, precip: 0, storm: 0, mid: 14, amp: 4, wind: 0.2 };
function lookOf(s: Spell): typeof look {
  const p = s.power;
  look.precip = 0;
  look.storm = 0;
  switch (s.kind) {
    case 'clear':
      look.clouds = 0.3 + 0.22 * p;
      look.mid = 14;
      look.amp = 4;
      look.wind = 0.1 + 0.15 * p;
      break;
    case 'cloudy':
      look.clouds = 0.8 + 0.3 * p;
      look.mid = 12.5;
      look.amp = 3;
      look.wind = 0.22 + 0.2 * p;
      break;
    case 'rain':
      look.clouds = 1.3;
      look.precip = p;
      look.mid = 6;
      look.amp = 3;
      look.wind = 0.3 + 0.3 * p;
      break;
    case 'storm':
      look.clouds = 1.45;
      look.precip = p;
      look.storm = 1;
      look.mid = 5.5;
      look.amp = 2.5;
      look.wind = 0.75 + 0.25 * p;
      break;
    default:
      look.clouds = 1.35;
      look.precip = p;
      look.mid = -3.5;
      look.amp = 3;
      look.wind = 0.2 + 0.55 * p * p;
      break;
  }
  return look;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 平滑跟随：这一帧往目标走多少（tau 秒走完六成多；snap = 直接到位） */
const ease = (dt: number, tau: number, snap: boolean): number => (snap ? 1 : 1 - Math.exp(-dt / tau));
/** 一天里的冷暖：−1（凌晨 5 点最冷）… +1（下午 3 点最暖） */
const diurnal = (h: number): number => (h >= 5 && h < 15 ? -Math.cos(((h - 5) / 10) * Math.PI) : Math.cos((((h - 15 + 24) % 24) / 14) * Math.PI));
/** 每天比平常冷一点还是暖一点（±1℃） */
const dayBias = (seed: number, day: number): number => {
  const s = Math.sin(day * 127.1 + (seed % 1000) * 0.618) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};
const lum = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

const FLASH = new Color().setRGB(0.78, 0.85, 1);
const _tint = new Color();
const _c = new Color();
const _rainCol = new Color();
const _snowCol = new Color();

export class Weather implements WeatherApi {
  kind: WeatherKind = 'clear';
  rain = 0;
  snow = 0;
  wet = 0;
  cover = 0;
  temp = 12;
  wind = 0.2;
  /** 风往哪边吹（水平方向，长度约 1；风向转的时候会短一阵） */
  windX = 1;
  windZ = 0;

  private readonly rnd: () => number;
  private readonly spells: Spell[] = [];
  private cur = 0;
  /** 上一场雨 / 雪 / 随便哪种是什么时候停的（游戏小时；−1 = 还没下过） */
  private lastRain = -1;
  private lastSnow = -1;
  private lastWet = 0;
  /** set() 换上的天气，还保持多少秒 */
  private forced: Spell | null = null;
  private hold = 0;
  /** 下一帧不过渡，所有量直接到位 */
  private snap = true;
  /** 平滑量：云量（= Sky.clouds：0.3 少云 … 1 阴 … 1.4 盖满）、降水、雷暴、气温的日均值和日较差、风 */
  private clouds = 0.4;
  private precip = 0;
  private stormV = 0;
  private tMid = 14;
  private tAmp = 4;
  private windBase = 0.2;
  private time = 0;
  /** 闪电：现在有多亮 0–1；一道闪电会接着再闪两三下（reT = 还有几秒，reA = 多亮） */
  private flash = 0;
  private flashHold = 0;
  private flashPower = 0;
  private nextStrike = 4;
  private readonly reT = [-1, -1, -1];
  private readonly reA = [0, 0, 0];
  private text = '晴 12℃';
  private textT = 0;
  private readonly fx: PrecipFx;
  private readonly sound = new WeatherSound();

  constructor(private readonly ctx: GameCtx) {
    this.rnd = rng((ctx.world.seed ^ 0x57ea7e4) >>> 0);
    // 第 1 天 0 点起一直晴到中午过后：新开一局（9 点）先有三个多小时的好天气
    this.spells.push({ kind: 'clear', t0: 0, t1: 12.3 + this.rnd() * 0.9, power: this.rnd(), dir: this.rnd() * Math.PI * 2 });
    this.fx = new PrecipFx(ctx);
    const pin = ctx.params.get('weather');
    if (isKind(pin)) this.pin(pin);
  }

  // ---------------------------------------------------------------- 时间表

  /** 雨还是雪：哪种更久没下，这次多半就是哪种（一局里两种都能遇到）；这一局的第一场是雨 */
  private pick(t: number, q: number): WeatherKind {
    if (this.lastRain < 0) return 'rain';
    return q < (t - this.lastSnow > t - this.lastRain ? 0.8 : 0.2) ? 'snow' : 'rain';
  }

  /** 时间表往后排一段 */
  private grow(): void {
    const r = this.rnd;
    const list = this.spells;
    const prev = list[list.length - 1] as Spell;
    const before = list[list.length - 2];
    const t = prev.t1;
    let kind: WeatherKind;
    if (prev.kind === 'clear') kind = 'cloudy';
    else if (prev.kind === 'cloudy') {
      // 从晴天阴过来的云：多半要变天；雨雪之后的云：多半放晴。太久（8 个游戏小时）没下过，这次一定下
      const after = before !== undefined && before.kind !== 'clear';
      kind = t - this.lastWet > 8 || r() < (after ? 0.22 : 0.8) ? this.pick(t, r()) : 'clear';
    } else if (prev.kind === 'rain') {
      // 雨：可能越下越大变成雷暴，可能冷锋过来变成雪（很久没下雪的话机会大），多数时候慢慢停
      const q = r();
      const storm = 0.27;
      kind = q < storm ? 'storm' : q < storm + (t - this.lastSnow > 10 ? 0.3 : 0.08) ? 'snow' : 'cloudy';
    } else if (prev.kind === 'storm') kind = r() < 0.45 ? 'rain' : 'cloudy';
    else kind = r() < 0.72 ? 'cloudy' : 'clear';
    const first = this.lastRain < 0;
    const power = kind === 'storm' ? 0.9 + 0.1 * r() : kind === 'rain' ? (first ? 0.55 : 0.35 + 0.5 * r()) : kind === 'snow' ? 0.45 + 0.55 * r() : r();
    const [a, b] = SPAN[kind];
    const s: Spell = { kind, t0: t, t1: t + a + (b - a) * r(), power, dir: prev.dir + (r() - 0.5) * 2.4 };
    if (kind === 'rain' || kind === 'storm') this.lastRain = s.t1;
    if (kind === 'snow') this.lastSnow = s.t1;
    if (kind !== 'clear' && kind !== 'cloudy') this.lastWet = s.t1;
    list.push(s);
  }

  /** 游戏时刻 T（小时，从第 1 天 0 点算起）是哪一段 */
  private at(T: number): Spell {
    const list = this.spells;
    while (T >= (list[this.cur] as Spell).t1) {
      if (this.cur === list.length - 1) this.grow();
      this.cur++;
    }
    while (this.cur > 0 && T < (list[this.cur] as Spell).t0) this.cur--;
    return list[this.cur] as Spell;
  }

  /** 接下来几段天气（调试；以后做「天气预报」也能用）。from / to = 游戏小时，从第 1 天 0 点算起 */
  forecast(n = 6): Array<{ kind: WeatherKind; from: number; to: number; power: number }> {
    const c = this.ctx.clock;
    const T = (c.day - 1) * 24 + c.hours;
    this.at(T);
    while (this.spells.length < this.cur + n) this.grow();
    return this.spells.slice(this.cur, this.cur + n).map((s) => ({ kind: s.kind, from: Math.round(s.t0 * 100) / 100, to: Math.round(s.t1 * 100) / 100, power: Math.round(s.power * 100) / 100 }));
  }

  // ---------------------------------------------------------------- 接口

  label(): string {
    return this.text;
  }

  private makeLabel(): string {
    const r = this.rain;
    const s = this.snow;
    let name: string;
    if (r > 0.06 && s > 0.06) name = '雨夹雪';
    else if (s > 0.06) name = s < 0.42 ? '小雪' : s < 0.72 ? '中雪' : this.wind > 0.6 ? '暴雪' : '大雪';
    else if (r > 0.06) name = this.stormV > 0.5 && r > 0.6 ? '雷暴' : r < 0.42 ? '小雨' : r < 0.72 ? '中雨' : '大雨';
    else name = this.clouds < 0.64 ? '晴' : this.clouds < 0.98 ? '多云' : '阴';
    return `${name} ${Math.round(this.temp)}℃`;
  }

  /**
   * 直接换天气（调试 / 读档）。保持几分钟以后回到时间表。snap = 不过渡：光、雾、粒子立刻到位，地面也一步到位
   * （雪：积雪 0.85；雨：湿透；晴 / 多云：干的、没有雪）。power = 多大 0–1（不给：雨 0.7、雷暴 1、雪 0.85）
   */
  set(kind: WeatherKind, snap = false, power?: number): void {
    if (!isKind(kind)) return;
    const p = clamp01(power ?? (kind === 'storm' ? 1 : kind === 'rain' ? 0.7 : kind === 'snow' ? 0.85 : 0.35));
    this.forced = { kind, t0: 0, t1: 0, power: p, dir: Math.atan2(this.windZ, this.windX) };
    this.hold = HOLD[kind];
    this.kind = kind;
    if (!snap) return;
    this.snap = true;
    if (kind === 'snow') {
      this.cover = Math.max(this.cover, 0.85);
      this.wet = 0;
    } else if (kind === 'rain' || kind === 'storm') {
      this.wet = Math.max(this.wet, Math.min(1, 0.5 + 0.6 * p));
      this.cover = 0;
    } else {
      this.wet = 0;
      this.cover = 0;
    }
  }

  /** 调试：把天气固定住（null = 放开，回到时间表）。?weather= 用的就是它 */
  pin(kind: WeatherKind | null, power?: number): void {
    if (!kind) {
      this.forced = null;
      return;
    }
    this.set(kind, true, power);
    this.hold = Infinity;
  }

  setQuality(k: number): void {
    this.fx.quality = Math.max(0.1, Math.min(1, k));
  }

  /** 调试：马上打一道闪电；hold = 电光保持几秒不灭（截图用） */
  debugStrike(hold = 0, inCloud = false): number {
    const d = this.fx.strike(inCloud);
    this.flash = this.flashPower = 1;
    this.flashHold = hold;
    this.sound.thunder(d / 343, 1);
    return d;
  }

  /** 调试：里面的量 */
  debug(): Record<string, unknown> {
    const c = this.ctx.clock;
    const r = (v: number): number => Math.round(v * 100) / 100;
    return { T: r((c.day - 1) * 24 + c.hours), kind: this.kind, forced: !!this.forced, hold: r(this.hold), clouds: r(this.clouds), precip: r(this.precip), storm: r(this.stormV), rain: r(this.rain), snow: r(this.snow), wet: r(this.wet), cover: r(this.cover), temp: r(this.temp), wind: r(this.wind), fx: this.fx.stats() };
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    const ctx = this.ctx;
    const clock = ctx.clock;
    this.time += dt;
    if (this.forced) {
      this.hold -= dt;
      if (this.hold <= 0) this.forced = null;
    }
    const spell = this.forced ?? this.at((clock.day - 1) * 24 + clock.hours);
    this.kind = spell.kind;
    const L = lookOf(spell);
    const snap = this.snap;
    this.snap = false;

    // 云先厚起来，雨雪才下得起来；停的时候雨先停，云慢慢散
    this.clouds += (L.clouds - this.clouds) * ease(dt, L.clouds > this.clouds ? 12 : 22, snap);
    const gate = snap ? 1 : smooth(0.95, 1.25, this.clouds);
    this.precip += (L.precip * gate - this.precip) * ease(dt, 13, snap);
    this.stormV += (L.storm * gate - this.stormV) * ease(dt, 10, snap);
    // 气温：降得快（冷锋），回暖慢
    this.tMid += (L.mid - this.tMid) * ease(dt, L.mid < this.tMid ? 26 : 50, snap);
    this.tAmp += (L.amp - this.tAmp) * ease(dt, 40, snap);
    this.windBase += (L.wind - this.windBase) * ease(dt, 15, snap);
    const kd = ease(dt, 20, snap);
    this.windX += (Math.cos(spell.dir) - this.windX) * kd;
    this.windZ += (Math.sin(spell.dir) - this.windZ) * kd;
    // 阵风：两个慢的正弦相乘，一阵强一阵弱
    const t = this.time;
    const gust = 1 + 0.24 * Math.sin(t * 0.31) * Math.sin(t * 0.113 + 1.7) + 0.08 * Math.sin(t * 0.9 + 0.6);
    this.wind = clamp01(this.windBase * gust);

    const seed = ctx.world.seed;
    const bias = mix(dayBias(seed, clock.day), dayBias(seed, clock.day + 1), clock.hours / 24);
    // 地上有雪的时候更冷一点
    this.temp = this.tMid + this.tAmp * diurnal(clock.hours) + bias - 1.5 * this.cover;
    // 下的是雨还是雪看气温
    this.snow = this.precip * (1 - smooth(-1, 1.5, this.temp));
    this.rain = this.precip - this.snow;

    // 地面。湿：大雨二十来秒湿透，小雨只湿到六七成（没有积水）；停了以后两三个游戏小时干透，出太阳干得快
    const o = smooth(0.62, 1.25, this.clouds);
    const cap = this.rain > 0.02 ? Math.min(1, 0.5 + 0.6 * this.rain) : 0;
    if (this.wet < cap) this.wet = Math.min(cap, this.wet + (this.rain * dt) / 22);
    else this.wet = Math.max(cap, this.wet - dt / (210 - 90 * clock.dayK * (1 - o)));
    // 积雪：大雪一个多游戏小时盖满；零上才化，越暖化得越快（十来度要四个游戏小时），淋雨化得最快；化出来的水把地打湿
    if (this.snow > 0.02 && this.temp < 1.5) this.cover = Math.min(1, this.cover + (this.snow * dt) / 75);
    else if (this.temp > 0 && this.cover > 0) {
      const melt = (dt * (0.3 + this.temp * 0.07 + this.rain * 2.5)) / 280;
      this.cover = Math.max(0, this.cover - melt);
      if (this.wet < 0.6) this.wet = Math.min(0.6, this.wet + melt * 4 + dt / 210);
    }
    WX.snow.value = this.cover;
    WX.wet.value = this.wet;
    WX.rain.value = this.rain;

    this.lightning(dt);
    this.atmosphere(o, snap);
    const wk = this.wind;
    this.fx.update(dt, this.rain, this.snow, this.windX * wk, this.windZ * wk, _rainCol, _snowCol, this.flash);
    const car = ctx.garage.driving;
    this.sound.update(dt, this.rain, this.snow, this.wind, ctx.indoors() ? 1 : car && car.def.kind === 'car' ? 0.7 : 0);

    this.textT -= dt;
    if (this.textT <= 0 || snap) {
      this.textT = 0.4;
      this.text = this.makeLabel();
    }
  }

  /** 雷暴里隔几秒到十几秒打一道闪电：一下亮起来、很快暗下去，接着再闪两三下 */
  private lightning(dt: number): void {
    if (this.flashHold > 0) {
      this.flashHold -= dt;
      this.flash = this.flashPower;
    } else {
      this.flash *= Math.exp(-dt * 9);
      if (this.flash < 0.004) this.flash = 0;
    }
    for (let i = 0; i < this.reT.length; i++) {
      const left = this.reT[i] as number;
      if (left < 0) continue;
      this.reT[i] = left - dt;
      if (left - dt < 0) {
        this.flash = Math.max(this.flash, this.reA[i] as number);
        this.reT[i] = -1;
      }
    }
    if (this.stormV < 0.5 || this.rain < 0.4) {
      this.nextStrike = Math.min(this.nextStrike, 4);
      return;
    }
    this.nextStrike -= dt;
    if (this.nextStrike > 0) return;
    this.nextStrike = (4 + Math.random() * 11) / this.stormV;
    // 四成只在云里闪（看不到电光，雷声远）
    const inCloud = Math.random() < 0.4;
    const d = this.fx.strike(inCloud);
    const power = inCloud ? 0.45 : Math.max(0.5, Math.min(1, 1.25 - d / 900));
    this.flash = Math.max(this.flash, power);
    this.flashPower = power;
    const n = 1 + Math.floor(Math.random() * 2.5);
    for (let k = 0; k < this.reT.length; k++) {
      this.reT[k] = k < n ? 0.07 + k * 0.1 + Math.random() * 0.07 : -1;
      this.reA[k] = power * (0.5 + Math.random() * 0.5);
    }
    this.sound.thunder(d / 343, power);
  }

  /** 在钟定好的光、雾、天空上按天气再改一遍（钟每帧重新定，所以不累积）。o = 天有多阴 0–1 */
  private atmosphere(o: number, snap: boolean): void {
    const { lighting: L, sky, scene } = this.ctx;
    const r = this.rain;
    const s = this.snow;
    const st = this.stormV;
    const f = this.flash;
    const night = L.night;
    sky.clouds = this.clouds;

    // 雾（= 地平线、远景的颜色）：阴天褪成灰的（雨天偏冷，雪天是中性的白）；雨天暗，雷暴更暗，雪天发白。
    // 亮度跟着钟定的走（白天亮、夜里黑）
    const fog = L.fog.color;
    const white = Math.max(s, this.cover * o);
    _tint.setRGB(mix(0.93, 1, white), 1, mix(1.1, 1, white));
    fog.lerp(_c.copy(_tint).multiplyScalar(lum(fog)), 0.85 * o);
    // 夜里雾本来就接近黑色，再压就成了一片死黑：夜里压暗只算四成
    fog.multiplyScalar(mix(mix(1, 0.8, o) * mix(1, 0.56, r) * mix(1, 0.55, st), 1, 0.6 * night) * mix(1, 1.6, s));
    // 雪夜：地上的雪把天映亮一点；打闪：整片天亮一下
    const glow = night * (0.012 * Math.max(s, this.cover * 0.5) + 0.006 * o * (1 - s)) + f * 0.07;
    fog.r += glow * 0.9;
    fog.g += glow;
    fog.b += glow * 1.25;

    // 太阳 / 月亮被云挡住：颜色压暗（天上那个圆盘和光晕跟着暗），强度再减
    // 夜里少压一些：月光是夜里唯一的主光，压到 5% 就什么都看不见了
    L.sun.color.multiplyScalar(mix(1, mix(0.2, 0.55, night), o));
    L.sun.intensity *= mix(1, mix(0.5, 0.85, night), o) * mix(1, mix(0.5, 0.85, night), st);
    // 环境反射是一张晴天的全景图：阴天收掉大半，少掉的漫射光由天光补上
    scene.environmentIntensity *= mix(1, mix(0.25, 0.6, night), o);
    // 天光：褪成灰的；雷暴暗；阴天地上有雪的时候亮（雪把光反上来，到处都是亮的）
    const hemi = L.hemi;
    hemi.color.lerp(_c.copy(_tint).multiplyScalar(lum(hemi.color)), 0.7 * o);
    hemi.intensity *= mix(1, 1.3, o) * mix(1, 0.92, r) * mix(1, mix(0.62, 0.9, night), st) * (1 + 0.9 * this.cover * o);
    if (this.cover > 0.01) hemi.groundColor.lerp(_c.copy(hemi.color).multiplyScalar(0.8), this.cover * 0.75);
    sky.zenith?.lerp(fog, 0.9 * o);
    // 积水、湿路面映出来的天色：比地平线亮一截（云）
    WX.sky.value.copy(fog).multiplyScalar(1.5);
    if (f > 0) {
      // 闪电：不加灯，把已有的太阳 / 天光拉亮、拉成冷白色。夜里从黑到亮，白天本来就亮、少加一点
      const k = f * (0.8 + 1.4 * night);
      hemi.intensity += k;
      hemi.color.lerp(FLASH, f * 0.6);
      L.sun.intensity += k;
      L.sun.color.lerp(FLASH, Math.min(1, f * 1.5));
    }

    // 雾的浓度：雨天能看三四百米，大雪一百多米；夜里钟已经把雾加浓了，这里少加一点
    L.fogMult *= 1 + (0.3 * o + 2.2 * r + 1.4 * st * r) * (1 - 0.72 * night) + 5 * s * (1 - 0.4 * night);
    // Lighting.follow 会把浓度慢慢拉过去；不过渡的时候直接到位（基础值：黄昏 0.011 → 夜 0.02，见 lighting.ts）
    if (snap) L.fog.density = (0.011 + 0.009 * night) * L.fogMult;

    // 雨丝 / 雪花的颜色：比背景的雾亮一截；夜里留一点底色，打闪时被照亮
    _rainCol.copy(fog).multiplyScalar(1.9).addScalar(0.03 + f * 0.3);
    _snowCol.copy(fog).multiplyScalar(1.7).addScalar(0.05 + f * 0.3);
  }
}
