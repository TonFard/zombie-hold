import { siteLevel, type Site, type SiteKind } from '../world/sites';
import { AMMO_ITEM, type Interaction, type Prey, type ZombieKindId } from './api';
import type { Game } from './game';
import { gunBook } from './gunbook';
import { ammoOf, magOf, rollGun } from './items';
import { audio, blip, out } from './sound';

/**
 * 守城（生存世界里的据点防守）。
 *
 * 加油站、货场、检查站、军事基地里都有一台柴油发电机。走到跟前按住 F 把它发动起来：
 * 声音会把四面八方的丧尸一波一波引过来，守住发电机（它也会被咬坏）撑过所有的波次，就能拿到一堆补给。
 *   - 白天、夜里都能守。夜里多一波、每波多三成，奖励里一定有一把枪。
 *   - 据点的军械箱（就在发电机旁边，按 E）能借一把枪：只借「武器图鉴」里已经解锁的型号，子弹管够，守完收回。
 *     —— 生存世界里找到过的、守城模式里解锁的、生化模式里换的，都算。
 *   - 守城的时候周围不再另外刷丧尸；危险等级高的据点，枪声还会把一伙带枪的人引过来。
 *   - 发电机被咬坏、人死了、走远了，都算没守住（不扣东西，过一会儿可以再来）；守住以后这个据点要过几天才能再守。
 * 打到一半关掉页面 = 没守住（借的枪不进存档）。
 */

const HOLD: ReadonlySet<SiteKind> = new Set<SiteKind>(['gas', 'yard', 'post', 'base']);
const TAG = 71;
const PREY_ID = 10000;
/** 守住以后隔几天才能再守 */
const COOLDOWN = 3;
const PREP = 25;
const REST = 16;
/** 离发电机多远算「走远了」，走远多久算放弃 */
const LEAVE_R = 75;
const LEAVE_T = 12;

interface Point {
  site: Site;
  x: number;
  y: number;
  z: number;
}

type Phase = 'idle' | 'prep' | 'wave' | 'rest';

const _spot = { x: 0, z: 0 };
const _q = { x: 0, z: 0 };

export class Siege {
  phase: Phase = 'idle';
  wave = 0;
  waves = 0;
  /** 发电机还剩多少 */
  hp = 0;
  hpMax = 1;
  /** 守住过的据点：地点 key → 是第几天守住的 */
  readonly held = new Map<number, number>();
  private readonly cache = new Map<number, Point[]>();
  private readonly sites: Site[] = [];
  private readonly points: Point[] = [];
  private pt: Point | null = null;
  private near: Point | null = null;
  private level = 1;
  private night = false;
  private t = 0;
  /** 这一波还有几只没出来、出完以后过了多久、这一波打了多久 */
  private left = 0;
  private lateT = 0;
  private waveT = 0;
  private spawnT = 0;
  private alive = 0;
  private awayT = 0;
  private scanT = 0;
  private uiT = 0;
  private uiKey = '';
  private cleanT = 0;
  private raidWave = 0;
  private warned = false;
  private readonly el: HTMLElement;
  private readonly prey: Prey;
  private hum: { stop(): void } | null = null;
  private readonly iStart: Interaction = { key: 'KeyF', label: '启动发电机：守住这个据点', hold: 1.6, prio: 8, tone: 2, act: () => this.near && this.begin(this.near) };
  private readonly iLocker: Interaction = { key: 'KeyE', label: '军械箱：借一把枪', prio: 9, tone: 1, act: () => this.openLocker() };
  private readonly iWait: Interaction = { key: 'KeyF', label: '', prio: 8, act: () => this.g.toast('这个据点刚守过，周围暂时没有那么多丧尸了') };
  private waitDays = -1;

  constructor(private readonly g: Game) {
    const e = document.createElement('div');
    e.className = 'g-siege';
    document.body.append(e);
    this.el = e;
    this.prey = { id: PREY_ID, x: 0, z: 0, feet: 0, alive: false, radius: 0.9, height: 1.3, bitten: (amount) => this.bitten(amount) };
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** 这个据点现在能不能守（守过的要隔几天） */
  private daysLeft(key: number): number {
    const d = this.held.get(key);
    return d === undefined ? 0 : Math.max(0, COOLDOWN - (this.g.d.clock.day - d));
  }

  private scan(): void {
    const w = this.g.d.world;
    const p = this.g.d.player;
    this.sites.length = 0;
    w.sites.near(p.x, p.z, 170, this.sites);
    this.points.length = 0;
    if (this.cache.size > 60) this.cache.clear();
    for (const s of this.sites) {
      if (!HOLD.has(s.kind)) continue;
      let pts = this.cache.get(s.key);
      if (!pts) {
        const c = w.sites.peek(s);
        if (!c) continue;
        pts = [];
        for (const it of c.inst) {
          if (it.id !== 'generator_diesel') continue;
          pts.push({ site: s, x: it.x, y: it.y + 0.03, z: it.z });
          break;
        }
        this.cache.set(s.key, pts);
      }
      for (const q of pts) this.points.push(q);
    }
  }

  /** 每帧：玩家现在能做的事（发动发电机 / 开军械箱） */
  interactions(acts: Interaction[]): void {
    const n = this.near;
    if (!n) return;
    if (this.active) {
      if (n === this.pt) acts.push(this.iLocker);
      return;
    }
    const days = this.daysLeft(n.site.key);
    if (days <= 0) acts.push(this.iStart);
    else {
      if (days !== this.waitDays) {
        this.waitDays = days;
        this.iWait.label = `这个据点刚守过：${days} 天以后再来`;
      }
      acts.push(this.iWait);
    }
  }

  /** 地图上的标记：正在守的发电机；附近能守的据点 */
  markers(out: Array<{ x: number; z: number; label: string; color: string }>): void {
    if (this.pt && this.active) {
      out.push({ x: this.pt.x, z: this.pt.z, label: '发电机', color: '#ffd36a' });
      return;
    }
    for (const q of this.points) if (this.daysLeft(q.site.key) <= 0) out.push({ x: q.x, z: q.z, label: '据点', color: '#ffd36a' });
  }

  // ---------------------------------------------------------------- 开始、一波一波、结束

  private begin(pt: Point): void {
    if (this.active || this.g.survival.dead) return;
    const g = this.g;
    const ctx = g.ctx;
    this.pt = pt;
    this.level = siteLevel(pt.site);
    this.night = g.d.clock.night > 0.5;
    this.waves = 3 + (this.level >= 3 ? 1 : 0) + (this.level >= 5 ? 1 : 0) + (this.night ? 1 : 0);
    this.wave = 0;
    this.phase = 'prep';
    this.t = PREP;
    this.hpMax = 600 + 120 * this.level;
    this.hp = this.hpMax;
    this.awayT = 0;
    this.cleanT = 0;
    this.warned = false;
    // 危险的据点：中间某一波，枪声把一伙带枪的人引过来
    this.raidWave = this.level >= 3 && Math.random() < 0.5 ? 2 + Math.floor(Math.random() * (this.waves - 1)) : 0;
    const pr = this.prey;
    pr.x = pt.x;
    pr.z = pt.z;
    pr.feet = pt.y;
    pr.alive = true;
    ctx.horde.clearTag(TAG);
    ctx.horde.addPrey(pr);
    ctx.horde.ambient = false;
    ctx.combat.noise(pt.x, pt.z, 110);
    this.startHum();
    blip(0.35, 0.5, 300, 90);
    g.toast(`发电机响了。${PREP} 秒以后第一波就到：一共 ${this.waves} 波${this.night ? '（夜里多一波）' : ''}，别让它们把发电机咬坏`, 7);
    this.uiKey = '';
    this.openLocker();
  }

  private startWave(): void {
    this.wave++;
    this.phase = 'wave';
    this.left = Math.round((4 + 2.5 * this.wave + 1.5 * this.level) * (this.night ? 1.25 : 1));
    this.lateT = 0;
    this.waveT = 0;
    this.spawnT = 0;
    this.g.toast(`第 ${this.wave} / ${this.waves} 波`, 3);
    blip(0.4, 0.35, 900, 440);
    setTimeout(() => blip(0.4, 0.5, 900, 330), 260);
    if (this.wave === this.raidWave) this.raid();
  }

  private kind(): ZombieKindId {
    const lv = this.level;
    const wv = this.wave;
    const rows: Array<[ZombieKindId, number]> = [
      ['walker', 10],
      ['runner', 2 + wv * 1.5 + (this.night ? 2 : 0)],
      ['crawler', 2],
      ['bloater', lv >= 2 && wv >= 2 ? 1 + lv * 0.4 : 0],
      ['armored', lv >= 3 && wv >= 2 ? lv * 0.5 : 0],
    ];
    let total = 0;
    for (const r of rows) total += r[1];
    let t = Math.random() * total;
    for (const r of rows) {
      t -= r[1];
      if (t <= 0) return r[0];
    }
    return 'walker';
  }

  /** 一伙带枪的人循着枪声摸过来：他们打丧尸，也打你 */
  private raid(): void {
    const pt = this.pt as Point;
    const ctx = this.g.ctx;
    if (!ctx.horde.spotAround(pt.x, pt.z, 62, 95, _spot)) return;
    const n = 2 + (this.level >= 5 ? 1 : 0);
    let got = 0;
    for (let k = 0; k < n; k++) {
      const id = ctx.raiders.spawn({ x: _spot.x + k * 1.6, z: _spot.z + (k % 2) * 1.4, side: 'raider', level: this.level, squad: 900 + this.wave, goto: { x: pt.x, z: pt.z } });
      if (id >= 0) got++;
    }
    if (!got) return;
    this.g.flags.add('tip:raider');
    this.g.toast('枪声把别人也引来了：有一伙带枪的人正往这边摸', 6);
    blip(0.3, 0.3, 500, 220);
  }

  private bitten(amount: number): void {
    if (!this.active) return;
    this.hp -= amount;
    if (!this.warned && this.hp < this.hpMax * 0.4) {
      this.warned = true;
      this.g.toast('发电机快被咬坏了！', 3);
      blip(0.4, 0.3, 500, 200);
    }
    if (this.hp <= 0) this.end(false, '发电机被咬坏了');
  }

  /** 人死了（game 在掉东西之前调） */
  playerDied(): void {
    if (this.active) this.end(false, '');
  }

  private end(won: boolean, why: string): void {
    const g = this.g;
    const ctx = g.ctx;
    const pt = this.pt as Point;
    this.phase = 'idle';
    this.prey.alive = false;
    ctx.horde.removePrey(this.prey);
    ctx.horde.ambient = true;
    ctx.arsenal.returnLoans();
    this.stopHum();
    g.closeModal();
    this.el.classList.remove('open');
    this.uiKey = '';
    if (!won) {
      // 剩下的丧尸还在：过一会儿再把走散的收掉（带编号的不会自己消失）
      this.cleanT = 60;
      if (why) g.toast(`没守住：${why}。借的枪收回去了`, 6);
      blip(0.4, 0.6, 220, 110);
      return;
    }
    ctx.horde.clearTag(TAG);
    this.held.set(pt.site.key, g.d.clock.day);
    g.flags.add('held');
    this.reward(pt);
    g.gain(120 + 50 * this.level + (this.night ? 80 : 0), `守住了 ${pt.site.name}！补给在发电机旁边`);
    blip(0.35, 0.3, 1800, 660);
    setTimeout(() => blip(0.35, 0.5, 2400, 990), 200);
    g.save();
  }

  /** 发电机周围哪个方向是空的（先试朝着玩家的那边，再一左一右往外转）：补给堆在那儿 */
  private clearDir(pt: Point): number {
    const w = this.g.d.world;
    const p = this.g.d.player;
    const a0 = Math.atan2(p.x - pt.x, p.z - pt.z);
    for (let k = 0; k < 8; k++) {
      const a = a0 + ((k + 1) >> 1) * (k % 2 ? 1 : -1) * (Math.PI / 4);
      let free = true;
      for (const r of [1.7, 2.4]) {
        const x = pt.x + Math.sin(a) * r;
        const z = pt.z + Math.cos(a) * r;
        _q.x = x;
        _q.z = z;
        w.collide(_q, pt.y, 1.2, 0.5, 0.3, false);
        if (Math.hypot(_q.x - x, _q.z - z) > 0.03) {
          free = false;
          break;
        }
      }
      if (free) return a;
    }
    return a0;
  }

  /** 守住的奖励：堆在发电机旁边空着的那一边 */
  private reward(pt: Point): void {
    const g = this.g;
    const a = this.clearDir(pt);
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    let k = 0;
    const put = (item: string, n = 1, loaded = 0): void => {
      // 排成一小片：离发电机一米六，左右错开
      const side = (k % 5) - 2;
      const row = Math.floor(k / 5);
      k++;
      g.drop(item, n, loaded, pt.x + ux * (1.6 + row * 0.6) - uz * side * 0.55, pt.z + uz * (1.6 + row * 0.6) + ux * side * 0.55);
    };
    const lv = this.level;
    // 子弹：手上的枪用的（借的不算），没有枪就给手枪弹
    const kinds = new Set<string>();
    for (const h of g.ctx.arsenal.held()) {
      const a = h && !h.loan ? ammoOf(h.id) : null;
      if (a) kinds.add(AMMO_ITEM[a]);
    }
    if (!kinds.size) kinds.add(AMMO_ITEM['9mm']);
    for (const a of kinds) put(a, 14 + 6 * lv + (this.night ? 10 : 0));
    put('medkit');
    put('bandage', 2);
    put('mre');
    put('water', 2);
    put('grenade', this.night ? 2 : 1);
    if (lv >= 2) put('stim');
    if (lv >= 3) put('injector');
    if (this.night || Math.random() < 0.3 + 0.14 * lv) {
      const id = rollGun(Math.min(4, 1 + Math.ceil(lv / 2) + (this.night ? 1 : 0)), Math.random());
      put(id, 1, magOf(id.slice(4)));
    }
  }

  // ---------------------------------------------------------------- 军械箱

  private openLocker(): void {
    const g = this.g;
    const u = g.unlocks;
    const html = `<h2>据点的军械箱</h2>
      <p>借一把守这一阵：只有图鉴里解锁了的型号能借，子弹管够，守完（或者没守住）就收回去。借来的枪丢不掉，死了也不会掉。</p>
      ${gunBook(u, 'pick', '借哪一把')}
      <div class="btns"><button data-x="close">不借，关上（Esc）</button></div>`;
    g.openModal(html, (t) => {
      const row = t.closest('[data-gun]') as HTMLElement | null;
      if (t.dataset.x === 'close') {
        g.closeModal();
        return;
      }
      const id = row?.dataset.gun;
      if (!id || !u.owned(id)) return;
      const ars = g.ctx.arsenal;
      // 一次只借一把：先把上一把收回去
      ars.returnLoans();
      const old = ars.giveGun({ id, loaded: magOf(id), loan: true });
      if (old && !old.loan) g.stowGun(old);
      g.closeModal();
      g.toast('借到了。按 R 换弹不用自己的子弹', 4);
      blip(0.3, 0.12, 1500, 300);
    });
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    const g = this.g;
    const p = g.d.player;
    const ctx = g.ctx;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.7;
      this.scan();
    }
    // 站在哪台发电机跟前
    let near: Point | null = null;
    if (!g.d.garage.driving && !g.survival.dead) {
      for (const q of this.points) {
        if (Math.abs(q.x - p.x) < 2.9 && Math.abs(q.z - p.z) < 2.9 && Math.abs(q.y - p.feet) < 2 && Math.hypot(q.x - p.x, q.z - p.z) < 2.9) near = q;
      }
    }
    this.near = near;
    if (this.cleanT > 0) {
      this.cleanT -= dt;
      if (this.cleanT <= 0 && !this.active) ctx.horde.clearTag(TAG);
    }
    if (!this.active) return;
    const pt = this.pt as Point;
    // 走远了
    if (Math.hypot(pt.x - p.x, pt.z - p.z) > LEAVE_R) {
      if (this.awayT === 0) g.toast('离发电机太远了：再不回去就算放弃', 4);
      this.awayT += dt;
      if (this.awayT > LEAVE_T) {
        this.end(false, '你离开了据点');
        return;
      }
    } else this.awayT = 0;
    if (this.phase === 'prep' || this.phase === 'rest') {
      this.t -= dt;
      if (this.t <= 0) this.startWave();
    } else {
      this.waveT += dt;
      this.spawnT -= dt;
      const alive = ctx.horde.countTag(TAG);
      this.alive = alive;
      // 一只一只从看不见的地方冒出来；同时在场的有上限（渲染池就那么大）
      const cap = 14 + 2 * this.level;
      if (this.left > 0 && this.spawnT <= 0 && alive < cap) {
        this.spawnT = 0.45;
        if (ctx.horde.spotAround(pt.x, pt.z, 26, 58, _spot)) {
          // 四成奔着发电机，六成奔着人
          const id = ctx.horde.spawnAt(this.kind(), _spot.x, _spot.z, { hunt: Math.random() < 0.4 ? PREY_ID : 0, tag: TAG });
          if (id >= 0) this.left--;
          else this.spawnT = 1.5;
        } else this.spawnT = 1;
      }
      // 实在放不出来（池子满了、找不到地方）：不让这一波卡死
      if (this.left > 0 && this.waveT > 150) this.left = 0;
      if (this.left <= 0) {
        this.lateT += dt;
        // 最后一两只卡在哪了也不等了
        if (alive === 0 || (alive <= 2 && this.lateT > 40)) {
          if (this.wave >= this.waves) {
            this.end(true, '');
            return;
          }
          this.phase = 'rest';
          this.t = REST;
          this.hp = Math.min(this.hpMax, this.hp + this.hpMax * 0.15);
          this.warned = this.hp < this.hpMax * 0.4;
          g.toast(`第 ${this.wave} 波打完了。${REST} 秒以后下一波：发电机旁边的军械箱可以换枪`, 5);
        }
      }
    }
    this.ui(dt);
  }

  private ui(dt: number): void {
    this.uiT -= dt;
    if (this.uiT > 0) return;
    this.uiT = 0.25;
    const hp = Math.max(0, Math.round((this.hp / this.hpMax) * 100));
    const state = this.phase === 'wave' ? `第 ${this.wave} / ${this.waves} 波 · 还有 ${this.left + this.alive} 只` : `${this.phase === 'prep' ? '第一波' : `第 ${this.wave + 1} / ${this.waves} 波`} ${Math.ceil(this.t)} 秒后到`;
    const key = `${state}|${hp}`;
    if (key === this.uiKey) return;
    this.uiKey = key;
    this.el.innerHTML = `<b>守住据点${this.night ? ' · 夜' : ''}</b><span>${state}</span><div class="${hp < 40 ? 'low' : ''}"><i style="width:${hp}%"></i></div><em>发电机 ${hp}%</em>`;
    this.el.classList.add('open');
  }

  // ---------------------------------------------------------------- 发电机的声音

  private startHum(): void {
    const a = audio();
    const dst = out();
    if (!a || !dst || this.hum) return;
    try {
      const g = a.createGain();
      g.gain.value = 0.05;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const o1 = a.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 46;
      const o2 = a.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 23.2;
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(dst);
      o1.start();
      o2.start();
      this.hum = {
        stop: () => {
          g.gain.setTargetAtTime(0, a.currentTime, 0.3);
          o1.stop(a.currentTime + 1.2);
          o2.stop(a.currentTime + 1.2);
        },
      };
    } catch {
      this.hum = null;
    }
  }

  private stopHum(): void {
    try {
      this.hum?.stop();
    } catch {
      // 声音停不了不要紧
    }
    this.hum = null;
  }

  // ---------------------------------------------------------------- 存档

  save(): unknown {
    return { held: [...this.held] };
  }

  load(data: unknown): void {
    this.held.clear();
    const d = data as { held?: Array<[number, number]> } | null;
    if (d && typeof d === 'object' && Array.isArray(d.held)) for (const q of d.held) if (Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])) this.held.set(q[0], q[1]);
  }
}

export const SIEGE_CSS = `
  .g-siege { position: fixed; left: 50%; top: 64px; transform: translateX(-50%); display: none; align-items: center; gap: 12px; padding: 7px 16px; border-radius: 4px; border-top: 2px solid #ffd36a; background: #000000b0; font-size: 14px; color: #f2ead8; pointer-events: none; user-select: none; white-space: nowrap; z-index: 4; }
  .g-siege.open { display: flex; }
  .g-siege b { color: #ffd36a; letter-spacing: .15em; }
  .g-siege div { width: 150px; height: 8px; border: 1px solid #ffffff30; border-radius: 2px; background: #00000090; overflow: hidden; }
  .g-siege div i { display: block; height: 100%; background: #8fd07a; transition: width .2s; }
  .g-siege div.low i { background: #e0563c; }
  .g-siege em { font-style: normal; font-size: 12px; color: #ffffffa0; }
`;
