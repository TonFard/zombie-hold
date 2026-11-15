import type { GameEvent, HumanRef, ZombieKindId } from './api';
import type { Game } from './game';
import { gunBook } from './gunbook';
import { magOf } from './items';
import { blip } from './sound';

/**
 * 生化模式（open.html?mode=bio）：单独的一局，不读写生存世界的存档，没有饿渴冷。
 *
 * 你和几个带枪的幸存者被困在镇上。二十秒以后，其中一个人变成「母体」；被母体和感染者咬中的人会变成感染者。
 *   - 撑满四分钟（天正好黑下来）还有人活着 → 人类赢；所有人都被感染 → 感染者赢。把母体和感染者全打死也算人类赢。
 *   - 你被咬倒 = 被感染：换到感染者那一边，只剩一双爪子，丧尸不再理你，原来的同伴开始朝你开枪。
 *     用爪子打倒的人会变成感染者；你被打死了过几秒会再站起来。
 *   - 每局结算给军功，用来换武器图鉴里还没解锁的枪：换到的枪守城模式直接拥有，生存世界据点的军械箱也能借。
 *   - 开局带哪把枪，只能从图鉴里已经解锁的挑（生存世界里找到过的、守城模式里解锁的都算），子弹管够。
 */

/** 幸存者 / 丧尸这一局的编号 */
const HT = 81;
const ZT = 82;
const PREP = 20;
const ROUND = 240;
const NAMES = ['老周', '阿杰', '小满', '大刘', '林医生', '陈工', '阿梅', '石头'];

type Phase = 'setup' | 'prep' | 'fight' | 'over';

const _spot = { x: 0, z: 0 };
const _q = { x: 0, z: 0 };

export class Bio {
  phase: Phase = 'setup';
  /** 玩家已经被感染了 */
  turned = false;
  private t = 0;
  private pick = 'glock_17';
  /** 场地：圆心、半径；开局站的地方 */
  private cx = 0;
  private cz = 0;
  private R = 80;
  private sx = 0;
  private sz = 0;
  private motherDead = false;
  private motherByPlayer = false;
  private motherOut = false;
  private kills = 0;
  private infections = 0;
  private fryT = 0;
  private checkT = 0;
  private downT = 0;
  private edgeT = 0;
  private humans = 0;
  private zombies = 0;
  private uiT = 0;
  private uiKey = '';
  private readonly bites = new Map<number, number>();
  private readonly buf: HumanRef[] = [];
  private readonly el: HTMLElement;
  private readonly tint: HTMLElement;

  constructor(private readonly g: Game) {
    const mk = (cls: string): HTMLElement => {
      const e = document.createElement('div');
      e.className = cls;
      document.body.append(e);
      return e;
    };
    this.el = mk('g-bio');
    this.tint = mk('g-infected');
    document.body.classList.add('mode-bio');
  }

  /** 感染者腿脚快一点 */
  get speedMul(): number {
    return this.turned ? 1.12 : 1;
  }

  /** 全部模块建好以后调一次 */
  start(): void {
    const g = this.g;
    const w = g.d.world;
    const site = w.sites.at(0, -2) ?? w.sites.near(0, -960, 600).find((s) => s.kind === 'town') ?? null;
    if (site) {
      this.cx = site.nx;
      this.cz = site.nz;
      let far = 0;
      for (const l of site.lots) for (const x of [l.x0, l.x1]) for (const z of [l.z0, l.z1]) far = Math.max(far, Math.hypot(x - site.nx, z - site.nz));
      this.R = Math.max(60, Math.min(110, far + 8));
      this.sx = site.nx + 3;
      this.sz = site.nz + 3;
    } else {
      const sp = w.sites.spawn();
      this.cx = this.sx = sp.x;
      this.cz = this.sz = sp.z;
    }
    g.survival.needs = false;
    g.flags.add('flashlight');
    // 镇上的房子里不放东西：这一局不存档，不然每局都能重新搜一遍
    g.pickups.siteLoot = false;
    // 一局从傍晚打到天黑：钟走慢一点（平时一个钟头 60 秒）
    g.d.clock.secPerHour = 118;
    const ctx = g.ctx;
    ctx.horde.ambient = false;
    ctx.raiders.ambient = false;
    ctx.raiders.onBitten = (h, amount) => this.bitten(h, amount);
    this.reset();
  }

  /** 回到开局前：清场、人回到街口、挑枪 */
  private reset(): void {
    const g = this.g;
    const ctx = g.ctx;
    const sv = g.survival;
    this.phase = 'setup';
    this.turned = false;
    this.motherDead = this.motherByPlayer = this.motherOut = false;
    this.kills = this.infections = 0;
    this.downT = 0;
    this.bites.clear();
    ctx.horde.clearTag(ZT);
    ctx.raiders.clearTag(HT);
    ctx.horde.passive = false;
    ctx.arsenal.claws = false;
    ctx.arsenal.freeAmmo = true;
    ctx.arsenal.load(null);
    g.bag.load([]);
    sv.dead = false;
    sv.hp = 100;
    sv.stamina = 1;
    sv.shield = 1;
    sv.boostT = sv.numbT = 0;
    this.tint.classList.remove('on');
    this.el.classList.remove('open');
    g.d.clock.day = 1;
    g.d.clock.set(16.5);
    g.d.teleport(this.sx, this.sz, 0);
    this.setup();
  }

  private setup(): void {
    const g = this.g;
    const u = g.unlocks;
    if (!u.owned(this.pick)) this.pick = 'glock_17';
    const back = new URL(window.location.href);
    back.searchParams.delete('mode');
    const html = `<h2>生化模式</h2>
      <p>你和几个带枪的幸存者被困在镇上。${PREP} 秒以后，你们当中的一个会变成<b>母体</b>：被它、被感染者咬中的人，也会变成感染者。<br>
      撑到天黑（${ROUND / 60} 分钟）还有人活着，人类赢；所有人都被感染，感染者赢。<br>
      你要是被感染了，就换到感染者那一边：只剩一双爪子，把剩下的人都抓成同类。<br>
      每局结算给<b>军功</b>，可以换图鉴里还没解锁的枪。</p>
      ${gunBook(u, 'pick', '带哪一把进场（子弹管够，另外给一把手枪、一把砍刀、两颗手雷）', this.pick)}
      <div class="btns"><button data-x="menu">主菜单</button><button data-x="back">回生存世界</button><button class="go" data-x="go">开始</button></div>`;
    g.openModal(
      html,
      (t) => {
        if (t.dataset.x === 'menu') {
          window.location.href = `${import.meta.env.BASE_URL}index.html`;
          return;
        }
        if (t.dataset.x === 'back') {
          window.location.href = back.toString();
          return;
        }
        if (t.dataset.x === 'go') {
          g.closeModal();
          this.begin();
          return;
        }
        const id = (t.closest('[data-gun]') as HTMLElement | null)?.dataset.gun;
        if (id && u.owned(id)) {
          this.pick = id;
          this.setup();
        }
      },
      true,
    );
  }

  private begin(): void {
    const g = this.g;
    const ctx = g.ctx;
    const w = g.d.world;
    this.phase = 'prep';
    this.t = PREP;
    this.uiKey = '';
    ctx.arsenal.giveGun({ id: this.pick, loaded: magOf(this.pick) });
    if (this.pick !== 'glock_17') ctx.arsenal.giveGun({ id: 'glock_17', loaded: magOf('glock_17') });
    ctx.arsenal.giveMelee('machete');
    g.bag.add('grenade', 2);
    g.bag.add('bandage', 2);
    g.bag.add('stim', 1);
    // 幸存者：围着街口站一圈
    const n = NAMES.length - 1;
    const a0 = Math.random() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * 6.28;
      const r = 5 + Math.random() * 7;
      _q.x = this.sx + Math.sin(a) * r;
      _q.z = this.sz + Math.cos(a) * r;
      w.collide(_q, w.groundAt(_q.x, _q.z), 1.75, 0.34, 0.45, false);
      ctx.raiders.spawn({ x: _q.x, z: _q.z, yaw: a, side: 'ally', level: 2 + (k % 3), squad: 1, name: NAMES[k] as string, tag: HT, leash: { x: this.cx, z: this.cz, r: this.R - 6 }, loot: false, freeAmmo: true });
    }
    g.toast(`${PREP} 秒以后，你们当中的一个会变成母体。散开，找个背后有墙的地方`, 7);
    blip(0.35, 0.4, 700, 330);
  }

  /** 活着的幸存者填进 buf，返回个数 */
  private allies(): number {
    const n = this.g.ctx.raiders.list(this.buf);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const h = this.buf[i] as HumanRef;
      if (h.tag !== HT || !h.alive) continue;
      this.buf[i] = this.buf[k] as HumanRef;
      this.buf[k] = h;
      k++;
    }
    return k;
  }

  /** 倒计时到了：离你最远的那个人变成母体 */
  private outbreak(): void {
    const g = this.g;
    const ctx = g.ctx;
    const p = g.d.player;
    this.phase = 'fight';
    this.t = ROUND;
    this.fryT = 8;
    const n = this.allies();
    let far: HumanRef | null = null;
    let best = -1;
    for (let i = 0; i < n; i++) {
      const h = this.buf[i] as HumanRef;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d > best) {
        best = d;
        far = h;
      }
    }
    let id = -1;
    if (far) {
      ctx.raiders.remove(far.id);
      id = ctx.horde.spawnAt('mother', far.x, far.z, { hunt: 'near', tag: ZT });
      g.toast(`${far.name} 变成了母体！`, 5);
    } else if (ctx.horde.spotAround(this.cx, this.cz, 28, this.R - 8, _spot)) {
      id = ctx.horde.spawnAt('mother', _spot.x, _spot.z, { hunt: 'near', tag: ZT });
      g.toast('母体出现了！', 5);
    }
    this.motherOut = id >= 0;
    blip(0.5, 0.8, 260, 120);
  }

  /** 幸存者被丧尸咬了：母体一口就感染，别的要第二口 */
  private bitten(h: HumanRef, amount: number): boolean {
    if (h.tag !== HT || this.phase !== 'fight') return false;
    const n = this.bites.get(h.id) ?? 0;
    if (amount < 30 && n < 1) {
      this.bites.set(h.id, n + 1);
      return false;
    }
    this.g.ctx.raiders.remove(h.id);
    this.infect(h.x, h.z);
    this.g.toast(`${h.name} 被感染了`, 3);
    return true;
  }

  private infect(x: number, z: number): void {
    this.g.ctx.horde.spawnAt('runner', x, z, { hunt: 'near', tag: ZT, hp: 160 });
    blip(0.3, 0.4, 380, 150);
  }

  onEvent(ev: GameEvent): void {
    if (ev.type !== 'kill' || this.phase !== 'fight') return;
    const mine = ev.byPlayer !== false;
    if (ev.human) {
      // 感染者（玩家）用爪子打倒的人：站起来就是同类
      if (mine && this.turned) {
        this.infections++;
        this.infect(ev.x, ev.z);
      }
      return;
    }
    if (ev.kind === 'mother') {
      this.motherDead = true;
      this.motherByPlayer = mine && !this.turned;
      this.g.toast(this.turned ? '母体被他们打死了' : '母体倒下了！把剩下的感染者清干净', 5);
    }
    if (mine && !this.turned) this.kills++;
  }

  /** 玩家的生命到 0 了（game 在这里交给我们，不走平时的死亡流程） */
  playerDown(): void {
    const g = this.g;
    const sv = g.survival;
    const ctx = g.ctx;
    if (this.phase !== 'fight') {
      // 母体还没出现（被自己的手雷炸倒了）、或者已经结算了：不算感染
      sv.dead = false;
      sv.hp = 100;
      if (this.phase === 'prep') g.toast('小心点：母体还没出现呢', 3);
      return;
    }
    if (this.turned) {
      // 感染者被打倒：过几秒再站起来
      this.downT = 5;
      g.toast('你被打倒了：5 秒以后再站起来', 4.5);
      return;
    }
    this.turned = true;
    sv.dead = false;
    sv.hp = 100;
    // 感染者很耐打（相当于四百点血）、跑不累
    sv.shield = 0.25;
    sv.boostT = 1e6;
    ctx.arsenal.claws = true;
    ctx.horde.passive = true;
    ctx.raiders.setSide(HT, 'raider');
    this.tint.classList.add('on');
    this.uiKey = '';
    g.toast('你被感染了。现在你是感染者：用爪子（鼠标左键）把剩下的人抓成同类', 8);
    blip(0.5, 0.9, 200, 90);
  }

  private rise(): void {
    const g = this.g;
    const sv = g.survival;
    sv.dead = false;
    sv.hp = 100;
    if (g.ctx.horde.spotAround(this.cx, this.cz, 18, this.R - 12, _spot)) g.d.teleport(_spot.x, _spot.z, g.d.player.yaw);
    else g.d.teleport(this.sx, this.sz, g.d.player.yaw);
  }

  private fry(): void {
    const ctx = this.g.ctx;
    const el = ROUND - this.t;
    const n = 2 + Math.floor(el / 60);
    for (let k = 0; k < n; k++) {
      if (ctx.horde.countTag(ZT) >= 20) return;
      if (!ctx.horde.spotAround(this.cx, this.cz, 30, this.R - 4, _spot)) return;
      const r = Math.random();
      const kind: ZombieKindId = r < 0.6 ? 'walker' : r < 0.9 ? 'runner' : 'crawler';
      ctx.horde.spawnAt(kind, _spot.x, _spot.z, { hunt: 'near', tag: ZT });
    }
  }

  private end(humansWin: boolean): void {
    const g = this.g;
    const ctx = g.ctx;
    const u = g.unlocks;
    this.phase = 'over';
    const left = this.humans;
    let m = 1;
    if (humansWin && !this.turned) m += 5;
    m += Math.min(4, Math.floor(this.kills / 6));
    if (this.motherDead) m += this.motherByPlayer ? 4 : 1;
    if (this.turned) m += Math.min(5, this.infections) + (humansWin ? 0 : 2);
    u.addMerits(m);
    ctx.horde.clearTag(ZT);
    ctx.raiders.clearTag(HT);
    this.el.classList.remove('open');
    const title = humansWin ? (this.turned ? '人类守住了' : '你活下来了') : '全员感染';
    const sub = humansWin ? (this.turned ? '你已经是感染者了——他们撑到了天黑。' : '天黑了，镇上还有人活着。') : this.turned && this.infections ? '最后一个人也倒下了。' : '没有人撑到天黑。';
    const stats = `打死 ${this.kills} 只 · 亲手感染 ${this.infections} 人 · 还活着 ${left} 人 · 母体${this.motherDead ? (this.motherByPlayer ? '是你打死的' : '被打死了') : this.motherOut ? '还活着' : '没出现'}`;
    blip(0.4, 0.5, humansWin && !this.turned ? 1800 : 300, humansWin && !this.turned ? 880 : 110);
    const show = (): void => {
      g.openModal(
        `<h2>${title}</h2><p>${sub}<br>${stats}<br><b>军功 +${m}</b>（现在一共 ${u.merits}）</p>
        ${gunBook(u, 'buy', '用军功换枪')}
        <div class="btns"><button data-x="menu">主菜单</button><button data-x="back">回生存世界</button><button class="go" data-x="again">再来一局</button></div>`,
        (t) => {
          if (t.dataset.x === 'menu') {
            window.location.href = `${import.meta.env.BASE_URL}index.html`;
          } else if (t.dataset.x === 'back') {
            const back = new URL(window.location.href);
            back.searchParams.delete('mode');
            window.location.href = back.toString();
          } else if (t.dataset.x === 'again') {
            g.closeModal();
            this.reset();
          } else if (t.dataset.buy && u.buy(t.dataset.buy)) {
            blip(0.3, 0.2, 2000, 780);
            show();
          }
        },
        true,
      );
    };
    show();
  }

  /** 地图上：幸存者在哪（你是人的时候是同伴，是感染者的时候是猎物） */
  markers(out: Array<{ x: number; z: number; label: string; color: string }>): void {
    if (this.phase !== 'prep' && this.phase !== 'fight') return;
    const n = this.allies();
    for (let i = 0; i < n; i++) {
      const h = this.buf[i] as HumanRef;
      out.push({ x: h.x, z: h.z, label: '', color: this.turned ? '#ffb060' : '#7fd0ff' });
    }
  }

  update(dt: number): void {
    if (this.phase === 'setup' || this.phase === 'over') return;
    const g = this.g;
    const p = g.d.player;
    // 场地的边：出不去
    const dx = p.x - this.cx;
    const dz = p.z - this.cz;
    const d = Math.hypot(dx, dz);
    this.edgeT -= dt;
    if (d > this.R) {
      p.x = this.cx + (dx / d) * this.R;
      p.z = this.cz + (dz / d) * this.R;
      if (this.edgeT <= 0) {
        this.edgeT = 4;
        g.toast('镇子外面全是感染者：出不去', 2.5);
      }
    }
    this.t -= dt;
    if (this.phase === 'prep') {
      if (this.t <= 0) this.outbreak();
    } else {
      if (this.downT > 0) {
        this.downT -= dt;
        if (this.downT <= 0) this.rise();
      }
      // 母体活着的时候，外面的感染者一拨一拨往里走
      this.fryT -= dt;
      if (this.fryT <= 0 && !this.motherDead) {
        this.fryT = 14;
        this.fry();
      }
      this.checkT -= dt;
      if (this.checkT <= 0) {
        this.checkT = 0.5;
        this.zombies = g.ctx.horde.countTag(ZT);
        this.humans = this.allies() + (this.turned ? 0 : 1);
        if (this.humans === 0) return this.end(false);
        if (this.t <= 0) return this.end(true);
        if (this.motherDead && this.zombies === 0 && !this.turned) return this.end(true);
      }
    }
    this.uiT -= dt;
    if (this.uiT > 0) return;
    this.uiT = 0.25;
    const s = Math.max(0, Math.ceil(this.t));
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const state = this.phase === 'prep' ? `母体 ${s} 秒后出现` : `人类 ${this.humans} · 感染者 ${this.zombies + (this.turned ? 1 : 0)} · 离天黑 ${clock}`;
    const key = `${state}|${this.turned}`;
    if (key === this.uiKey) return;
    this.uiKey = key;
    this.el.innerHTML = `<b>生化模式</b><span>${state}</span><em class="${this.turned ? 'z' : ''}">${this.turned ? '你是感染者' : '你是人类'}</em>`;
    this.el.classList.add('open');
  }
}

export const BIO_CSS = `
  .g-bio { position: fixed; left: 50%; top: 64px; transform: translateX(-50%); display: none; align-items: center; gap: 12px; padding: 7px 16px; border-radius: 4px; border-top: 2px solid #8fd07a; background: #000000b0; font-size: 14px; color: #f2ead8; pointer-events: none; user-select: none; white-space: nowrap; z-index: 4; }
  .g-bio.open { display: flex; }
  .g-bio b { color: #8fd07a; letter-spacing: .15em; }
  .g-bio em { font-style: normal; padding: 1px 8px; border-radius: 3px; background: #7fd0ff30; color: #9fd8ff; font-size: 12px; }
  .g-bio em.z { background: #8fd07a30; color: #a8e890; }
  .g-infected { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity 1.2s; background: radial-gradient(ellipse at center, #2a5a1a18 30%, #1e5a12a8 100%); z-index: 3; }
  .g-infected.on { opacity: 1; }
  body.mode-bio .g-goal, body.mode-bio .g-status .hunger, body.mode-bio .g-status .thirst, body.mode-bio .g-status .warmth { display: none; }
`;
