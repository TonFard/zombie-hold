import type { BagApi, SurvivalApi } from './api';
import { ITEMS, type ItemDef } from './items';

/**
 * 背包（按重量）和生存状态（生命、饱、水、体温、体力）。纯逻辑，不碰 three 和界面。
 *
 * 节奏（一个游戏日 = 24 分钟）：不吃东西大约 30 分钟饿到底，不喝水 22 分钟渴到底；跑步消耗更快。
 * 体温看「体感温度」：气温 + 屋里 / 车里 / 外套 / 暖宝宝 − 风 − 淋湿。体感低于 8℃ 开始掉体温，越冷掉得越快。
 * 用 .logs/open/gametest.ts 量过（气温按 weather.ts：晴 10–18℃、雨 3–9℃、雪 −7–0℃）：
 *   雪天不穿外套站在外面约 4 分钟冻透，穿了外套约 12 分钟（一场雪是两三分钟，够撑过去）；
 *   躲进屋里掉得很慢（不穿外套二十分钟才冻透），穿着外套进屋、或者上车开着发动机，一两分钟就缓过来；
 *   雨天不穿外套六分钟多冻透，穿了外套不掉体温。
 */

export class Bag implements BagApi {
  readonly items = new Map<string, number>();
  /** 能背多重（千克）；背包 +15 */
  capacity = 20;
  onChange: () => void = () => {};

  get weight(): number {
    let w = 0;
    for (const [id, n] of this.items) w += (ITEMS[id]?.weight ?? 0) * n;
    return w;
  }

  count(item: string): number {
    return this.items.get(item) ?? 0;
  }

  /** 还能再放几个 */
  room(item: string): number {
    const w = ITEMS[item]?.weight ?? 0;
    return w <= 0 ? Infinity : Math.max(0, Math.floor((this.capacity - this.weight + 1e-6) / w));
  }

  add(item: string, n = 1): number {
    if (!ITEMS[item] || n <= 0) return 0;
    const k = Math.min(n, this.room(item));
    if (k <= 0) return 0;
    this.items.set(item, this.count(item) + k);
    this.onChange();
    return k;
  }

  take(item: string, n = 1): number {
    const have = this.count(item);
    const k = Math.min(have, n);
    if (k <= 0) return 0;
    if (have - k <= 0) this.items.delete(item);
    else this.items.set(item, have - k);
    this.onChange();
    return k;
  }

  save(): Array<[string, number]> {
    return [...this.items];
  }

  load(data: unknown): void {
    this.items.clear();
    if (Array.isArray(data)) for (const q of data as Array<[string, number]>) if (ITEMS[q[0]] && q[1] > 0) this.items.set(q[0], q[1]);
    this.onChange();
  }
}

/** 每帧告诉生存状态：现在周围什么样 */
export interface Env {
  /** 气温（℃） */
  temp: number;
  rain: number;
  snow: number;
  wind: number;
  indoors: boolean;
  /** 头顶有屋顶 / 雨棚（淋不着，但不暖和） */
  roofed: boolean;
  inCar: boolean;
  engine: boolean;
  sprinting: boolean;
  moving: boolean;
  /** 涉水深度（米） */
  wade: number;
}

export class Survival implements SurvivalApi {
  hp = 100;
  hunger = 100;
  thirst = 100;
  /** 体温 0–100（100 = 暖和，0 = 冻透了） */
  warmth = 100;
  stamina = 1;
  /** 身上有多湿 0–1 */
  wet = 0;
  /** 暖宝宝还剩多少秒 */
  heat = 0;
  coat = false;
  dead = false;
  cause = '';
  /** 体感温度（℃，界面上显示） */
  felt = 12;
  /** 最近一次受伤：多久以前、从哪个方向来 */
  hurtT = 99;
  hurtX = 0;
  hurtZ = 0;
  hurtAmount = 0;
  /** 走路的速度倍率（饿、渴、冷的时候走不快） */
  speedMul = 1;
  /** 等级带来的加成：跑步耗体力除以它、饿和渴的速度除以它（1 = 没有加成） */
  fitness = 1;
  thrift = 1;
  /** 肾上腺素还剩多少秒（跑步不耗体力、走得快一成）、镇痛针还剩多少秒（受到的伤害少三成） */
  boostT = 0;
  numbT = 0;
  /** 受到的伤害再乘多少（生化模式里玩家变成丧尸以后很耐打）。平时是 1 */
  shield = 1;
  /** false = 不会饿、不会渴、不会冷（生化模式） */
  needs = true;
  /** 重新开始（死了以后醒过来）：不是满状态 */
  revive(): void {
    this.dead = false;
    this.cause = '';
    this.hp = 70;
    this.hunger = Math.max(this.hunger, 45);
    this.thirst = Math.max(this.thirst, 45);
    this.warmth = Math.max(this.warmth, 70);
    this.wet = 0;
    this.stamina = 1;
    this.hurtT = 99;
    this.boostT = 0;
    this.numbT = 0;
  }

  onDeath: () => void = () => {};

  hurt(amount: number, fromX?: number, fromZ?: number, cause = '伤重不治'): void {
    if (this.dead || amount <= 0) return;
    // 慢慢掉的血（饿、渴、冻：不带方向）不打折
    if (fromX !== undefined) amount *= this.shield * (this.numbT > 0 ? 0.7 : 1);
    this.hp = Math.max(0, this.hp - amount);
    this.hurtT = 0;
    this.hurtAmount = amount;
    if (fromX !== undefined && fromZ !== undefined) {
      this.hurtX = fromX;
      this.hurtZ = fromZ;
    }
    if (this.hp <= 0) {
      this.dead = true;
      this.cause = cause;
      this.onDeath();
    }
  }

  spend(stamina: number): boolean {
    if (this.stamina < stamina) return false;
    this.stamina -= stamina;
    return true;
  }

  /** 现在用不用得着这样东西（已经满了的不让白白用掉） */
  wants(def: ItemDef): boolean {
    const u = def.use;
    if (!u || this.dead) return false;
    return (
      (u.hunger !== undefined && u.hunger > 0 && this.hunger < 99) ||
      (u.thirst !== undefined && u.thirst > 0 && this.thirst < 99) ||
      (u.hp !== undefined && this.hp < 99) ||
      (u.warm !== undefined && this.warmth < 99) ||
      (u.heat !== undefined && this.heat < 30) ||
      (u.stamina !== undefined && this.stamina < 0.9) ||
      (u.boost !== undefined && this.boostT < 5) ||
      (u.numb !== undefined && this.numbT < 5)
    );
  }

  /** 吃 / 喝 / 用。返回 false = 现在用不着（已经满了） */
  use(def: ItemDef): boolean {
    const u = def.use;
    if (!u || !this.wants(def)) return false;
    const cl = (v: number): number => Math.max(0, Math.min(100, v));
    this.hunger = cl(this.hunger + (u.hunger ?? 0));
    this.thirst = cl(this.thirst + (u.thirst ?? 0));
    this.hp = cl(this.hp + (u.hp ?? 0));
    this.warmth = cl(this.warmth + (u.warm ?? 0));
    if (u.heat) this.heat = Math.max(this.heat, u.heat);
    if (u.stamina) this.stamina = Math.min(1, this.stamina + u.stamina);
    if (u.boost) this.boostT = Math.max(this.boostT, u.boost);
    if (u.numb) this.numbT = Math.max(this.numbT, u.numb);
    return true;
  }

  update(dt: number, e: Env): void {
    if (this.dead) return;
    this.hurtT += dt;
    this.heat = Math.max(0, this.heat - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.numbT = Math.max(0, this.numbT - dt);
    if (!this.needs) {
      // 生化模式：只有体力和生命。不回血（被咬了就是被咬了）
      this.hunger = this.thirst = this.warmth = 100;
      this.wet = 0;
      this.felt = e.temp;
      if (e.sprinting && this.boostT <= 0) this.stamina = Math.max(0, this.stamina - dt / (14 * this.fitness));
      else if (!e.sprinting) this.stamina = Math.min(1, this.stamina + dt / (e.moving ? 9 : 6));
      this.speedMul = this.boostT > 0 ? 1.1 : 1;
      return;
    }
    // 淋湿：雨里（不在屋里、不在车里）、蹚水；屋里 / 车里干得快
    const sheltered = e.indoors || e.roofed || e.inCar;
    if (sheltered) this.wet = Math.max(0, this.wet - 0.012 * dt);
    else if (e.rain > 0.02) this.wet = Math.min(1, this.wet + e.rain * 0.035 * dt);
    // 雪只会把人弄得半湿
    else if (e.snow > 0.02) this.wet = this.wet < 0.4 ? Math.min(0.4, this.wet + e.snow * 0.012 * dt) : this.wet - 0.004 * dt;
    else this.wet = Math.max(0, this.wet - 0.004 * dt);
    if (e.wade > 0.5) this.wet = Math.max(this.wet, Math.min(1, e.wade));
    // 体感温度：屋里 / 车里没有风；外套挡一半的风、湿了也只冷一半
    const coat = this.coat ? 0.5 : 1;
    const shelter = e.inCar ? (e.engine ? 18 : 6) : e.indoors ? 10 : -e.wind * 4 * coat;
    this.felt = e.temp + shelter + (this.coat ? 10 : 0) + (this.heat > 0 ? 10 : 0) + (e.sprinting ? 3 : 0) - this.wet * 8 * coat;
    if (this.felt < 8) this.warmth = Math.max(0, this.warmth - (8 - this.felt) * 0.02 * dt);
    else this.warmth = Math.min(100, this.warmth + Math.min(3, (this.felt - 8) * 0.25) * dt);
    // 饿、渴
    const cold = this.warmth < 40;
    this.hunger = Math.max(0, this.hunger - ((0.055 * (e.sprinting ? 1.6 : 1) * (cold ? 1.3 : 1)) / this.thrift) * dt);
    this.thirst = Math.max(0, this.thirst - ((0.076 * (e.sprinting ? 1.8 : 1)) / this.thrift) * dt);
    // 体力
    const weak = this.thirst < 25 || this.warmth < 25 || this.hunger < 15;
    if (e.sprinting && this.boostT <= 0) this.stamina = Math.max(0, this.stamina - dt / (14 * this.fitness));
    else if (!e.sprinting) this.stamina = Math.min(1, this.stamina + (dt / (e.moving ? 9 : 6)) * (weak ? 0.5 : 1));
    this.speedMul = (1 - (this.hunger < 15 ? 0.12 : 0) - (this.thirst < 15 ? 0.12 : 0) - (this.warmth < 20 ? 0.15 : 0)) * (this.boostT > 0 ? 1.1 : 1);
    // 生命
    let drain = 0;
    let why = '';
    if (this.hunger <= 0) {
      drain += 0.35;
      why = '饿死了';
    }
    if (this.thirst <= 0) {
      drain += 0.45;
      why = '渴死了';
    }
    if (this.warmth <= 0) {
      drain += 0.6;
      why = '冻死了';
    }
    if (drain > 0) {
      const t = this.hurtT;
      this.hurt(drain * dt, undefined, undefined, why);
      // 慢慢掉血不算「刚受伤」（不闪红、不打断回血的判断由下面单独处理）
      this.hurtT = t;
    } else if (this.hurtT > 8 && this.hunger > 50 && this.thirst > 50 && this.warmth > 50) this.hp = Math.min(100, this.hp + 0.25 * dt);
  }

  save(): unknown {
    return { hp: this.hp, hunger: this.hunger, thirst: this.thirst, warmth: this.warmth, wet: this.wet, heat: this.heat, coat: this.coat, boost: this.boostT, numb: this.numbT };
  }

  load(data: unknown): void {
    const d = data as Partial<Record<'hp' | 'hunger' | 'thirst' | 'warmth' | 'wet' | 'heat' | 'boost' | 'numb', number>> & { coat?: boolean };
    if (!d || typeof d !== 'object') return;
    const num = (v: number | undefined, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    this.hp = Math.max(1, num(d.hp, 100));
    this.hunger = num(d.hunger, 100);
    this.thirst = num(d.thirst, 100);
    this.warmth = num(d.warmth, 100);
    this.wet = num(d.wet, 0);
    this.heat = num(d.heat, 0);
    this.boostT = num(d.boost, 0);
    this.numbT = num(d.numb, 0);
    this.coat = !!d.coat;
  }
}
