import { Rng } from '../../game/core/rng';
import { AMMO_ITEM, CAR, type GameCtx, type HumanRef, type HumanSide, type HumanSpawn, type Prey, type RaidersApi, type ZombieHit, type ZombieRef } from '../game/api';
import { specOf, type GunSpec } from './gun-data';
import { RaidBrain, type HEvent, type Human, type RaidEnv } from './raider-brain';
import { Planner, nameFor, pickGun, type Group } from './raider-spawn';
import { RaiderViews } from './raider-view';

/**
 * 带枪的人（RaidersApi 的实现）：敌人（raider，见了玩家和玩家的同伴就打）和同伴（ally，生化模式里一起守的幸存者）。
 * 这个文件只是把几块接起来：
 *   raider-spawn.ts  世界上哪里有一伙人（按种子算，同一个地方每次去都是同一伙）
 *   raider-brain.ts  行为（看、听、反应、瞄、点射、换弹、找掩体、包扎、绕侧面、跟丢了去找）；纯逻辑，.logs/open/raidtest.ts 直接跑它
 *   raider-view.ts   模型、姿势、细节档、尸体、枪口的火光
 * 这里管：玩家周围的伙什么时候变成真人、什么时候撤掉，登记成丧尸的猎物，子弹 / 近战 / 爆炸打没打中，死了以后掉东西、记账、存档。
 *
 * 调试：地址加 ?raiders=0 平时不自动出现；控制台 __open.raiders.debugSpawn(n, side?, dist?, level?, gun?) / debugList() / debugClear()。
 */

/** 同时活着的硬上限（模型池就这么大）。平时自己出现的还要按画质档位再减（setQuality）；玩法层用 spawn() 放的只看硬上限 */
const CAP = 10;
/** 这个距离以内的伙才变成真人；离玩家超过 R_DESPAWN 就撤掉（伙还在，回来还有） */
const R_SPAWN = 150;
const R_DESPAWN = 190;
/**
 * 离玩家至少这么远才出现，而且得在看不见的地方（画面外，或者中间有东西挡着）。
 * R_FAR 以外的不用管看不看得见：那么远一个人只有十几个像素高。不然顺着公路一直盯着镇子开过去，那一伙永远出不来
 */
const R_MIN = 45;
const R_FAR = 110;
/** 一个游戏日有多少秒（daycycle.ts：一小时 60 秒）。打光了的伙空三天左右 */
const DAY = 1440;
const P = { x: 0, z: 0 };

export class Raiders implements RaidersApi {
  ambient = true;
  onBitten: ((h: HumanRef, amount: number) => boolean) | null = null;
  private readonly brain: RaidBrain;
  private readonly planner: Planner;
  private readonly rng = new Rng(4177);
  private readonly byId = new Map<number, Human>();
  private readonly deadQ: Human[] = [];
  private readonly shotQ: Human[] = [];
  private readonly groups: Group[] = [];
  /** 现在场上有哪些伙的哪几个人（伙的 key → 成员的位图） */
  private readonly active = new Map<number, number>();
  /** 打死过的：伙的 key → 死了哪几个（位图）、什么时候才会再有（自己的钟，秒） */
  private readonly gone = new Map<number, { mask: number; until: number }>();
  private readonly ref: HumanRef = { id: 0, x: 0, z: 0, feet: 0, side: 'raider', hp: 0, alive: false, name: '', gun: '', tag: 0 };
  /** ?raiders=0：平时不自动出现（spawn / debugSpawn 照样能用） */
  private readonly off: boolean;
  private cap = CAP;
  /** 自己的钟（秒）：伙空到什么时候用它记 */
  private time = 0;
  private popT = 0;
  private auto = 0;
  /** 开局、传送以后的头两轮：不管看不看得见，先把周围的伙放出来 */
  private burst = 2;
  private lastX = Infinity;
  private lastZ = Infinity;

  private constructor(
    private readonly ctx: GameCtx,
    private readonly views: RaiderViews,
  ) {
    const env: RaidEnv = {
      world: ctx.world,
      player: ctx.player,
      playerDead: () => ctx.survival.dead,
      driving: () => !!ctx.garage.driving,
      night: () => ctx.clock.night,
      hurtPlayer: (amount, x, z) => ctx.survival.hurt(amount, x, z, '被人打死'),
      zombiesNear: (x, z, r, out: ZombieRef[]) => ctx.horde.near(x, z, r, out),
      zombieRay: (ox, oy, oz, dx, dy, dz, max): ZombieHit | null => ctx.horde.raycast(ox, oy, oz, dx, dy, dz, max),
      hitZombie: (id, amount, head, dx, dz) => {
        ctx.horde.damage(id, amount, head, dx, dz, false);
      },
      shot: (h) => {
        ctx.arsenal.shotAt(h.gun, h.x, h.y + 1.45, h.z);
        // 枪声把丧尸也引过来
        ctx.horde.noise(h.x, h.z, h.spec.noise);
        this.shotQ.push(h);
      },
      tracer: (sx, sy, sz, ex, ey, ez, gain) => ctx.arsenal.fx.tracer(sx, sy, sz, ex, ey, ez, gain),
      impact: (kind, x, y, z, dx, dy, dz, k) => ctx.arsenal.fx.impact(kind, x, y, z, dx, dy, dz, k),
      blood: (x, y, z, dx, dy, dz) => ctx.arsenal.fx.blood(x, y, z, dx, dy, dz),
      on: (ev: HEvent, h: Human) => {
        if (ev === 'die') this.deadQ.push(h);
      },
      carNear: (x, z) => {
        for (const v of ctx.garage.vehicles) {
          const p = v.rig.root.position;
          if (Math.abs(p.x - x) < 8 && Math.abs(p.z - z) < 8) return true;
        }
        return false;
      },
    };
    this.brain = new RaidBrain(env);
    this.planner = new Planner(ctx.world, this.brain.nav);
    this.off = ctx.params.get('raiders') === '0';
  }

  /** 建好模型、骨架、枪（之后运行中不再建任何东西、不再编译着色器） */
  static async create(ctx: GameCtx): Promise<Raiders> {
    const views = await RaiderViews.load(ctx.scene, ctx.renderer, ctx.world);
    return new Raiders(ctx, views);
  }

  get count(): number {
    return this.brain.humans.length;
  }

  update(dt: number): void {
    const { ctx, brain, views } = this;
    this.time += dt;
    this.populate(dt);
    brain.update(dt);
    this.runOver();
    this.flushDead();
    // 丧尸模块每帧读猎物的位置
    const horde = ctx.horde;
    for (const h of brain.humans) {
      let p = h.prey as Prey | null;
      if (!p) {
        p = this.makePrey(h);
        h.prey = p;
        horde.addPrey(p);
      }
      p.x = h.x;
      p.z = h.z;
      p.feet = h.y;
      p.height = 1.75 - 0.5 * h.ck;
    }
    views.update(dt, brain.humans, ctx.camera);
    // 枪口的火光：要等这一帧的姿势摆好了才知道枪口在哪
    const q = this.shotQ;
    for (let i = 0; i < q.length; i++) views.flash(q[i] as Human);
    q.length = 0;
  }

  // ---------------------------------------------------------------- 出现 / 撤掉

  private populate(dt: number): void {
    const p = this.ctx.player;
    const hs = this.brain.humans;
    // 传送（调试、读档、重生）
    if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) > 60) this.burst = 2;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.popT -= dt;
    if (this.popT > 0) return;
    this.popT = 0.5;
    // 走远了的撤掉（带 tag 的不撤：那是玩法层放的）
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i] as Human;
      if (!h.tag && Math.hypot(h.x - p.x, h.z - p.z) > R_DESPAWN) this.despawn(h);
    }
    if (this.off || !this.ambient || this.ctx.mode !== 'survival') return;
    const burst = this.burst > 0;
    if (burst) this.burst--;
    this.planner.collect(p.x, p.z, R_SPAWN, this.groups);
    let checked = false;
    for (const g of this.groups) {
      const n = g.members.length;
      const all = (1 << n) - 1;
      let dead = 0;
      const rec = this.gone.get(g.key);
      if (rec) {
        if (rec.until > this.time) dead = rec.mask;
        else this.gone.delete(g.key);
      }
      const here = this.active.get(g.key) ?? 0;
      const missing = all & ~(dead | here);
      if (!missing) continue;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d < (burst ? 30 : R_MIN)) continue;
      if (!burst && d < R_FAR) {
        // 一轮只查一伙（查一次要打几条带地形的射线）
        if (checked) continue;
        checked = true;
        if (!this.hidden(g)) continue;
      }
      let now = here;
      for (let i = 0; i < n; i++) {
        if (!(missing & (1 << i))) continue;
        if (hs.length >= this.cap) break;
        const m = g.members[i] as Group['members'][number];
        const spec = specOf(m.gun);
        if (!spec) continue;
        const h = this.add({ x: m.x, z: m.z, side: 'raider', gun: m.gun, spec, level: m.level, squad: (2e6 + (g.key % 1e6)) * 2, name: m.name, group: g.key, member: i, mil: m.mil, pois: g.pois, watch: m.watch, yaw: Math.atan2(g.x - m.x, g.z - m.z) + Math.PI });
        if (h) now |= 1 << i;
      }
      if (now) this.active.set(g.key, now);
    }
  }

  /** 这一伙现在冒出来，玩家看不看得出是凭空出现的：每个人要么在画面外，要么中间有东西挡着 */
  private hidden(g: Group): boolean {
    const w = this.ctx.world;
    const c = this.ctx.camera.position;
    for (const m of g.members) {
      const y = w.groundAt(m.x, m.z) + 1.1;
      if (!this.views.sees(m.x, y, m.z, 1.2)) continue;
      const dx = m.x - c.x;
      const dy = y - c.y;
      const dz = m.z - c.z;
      const L = Math.hypot(dx, dy, dz);
      if (w.raycast(c.x, c.y, c.z, dx / L, dy / L, dz / L, L - 0.6) === Infinity) return false;
    }
    return true;
  }

  /** 放一个人进场：逻辑、模型都备好。模型池空了返回 null */
  private add(o: Parameters<RaidBrain['spawn']>[0]): Human | null {
    const h = this.brain.spawn(o);
    if (!this.views.acquire(h)) {
      this.brain.remove(h);
      return null;
    }
    this.byId.set(h.id, h);
    return h;
  }

  private makePrey(h: Human): Prey {
    return {
      id: h.id,
      x: h.x,
      z: h.z,
      feet: h.y,
      alive: true,
      radius: 0.3,
      height: 1.75,
      bitten: (amount, fx, fz) => this.bitten(h, amount, fx, fz),
    };
  }

  private dropPrey(h: Human): void {
    const p = h.prey as Prey | null;
    if (!p) return;
    h.prey = null;
    p.alive = false;
    this.ctx.horde.removePrey(p);
  }

  /** 从场上拿掉一个人的账：名单、猎物、所在的伙 */
  private forget(h: Human): void {
    this.brain.remove(h);
    this.byId.delete(h.id);
    this.dropPrey(h);
    if (h.group) {
      const left = (this.active.get(h.group) ?? 0) & ~(1 << h.member);
      if (left) this.active.set(h.group, left);
      else this.active.delete(h.group);
    }
  }

  /** 撤掉一个（不是打死：他那一伙还在，回来还有） */
  private despawn(h: Human): void {
    if (!this.byId.has(h.id)) return;
    this.forget(h);
    this.views.release(h);
    h.alive = false;
  }

  /** 被丧尸打中了一下 */
  private bitten(h: Human, amount: number, fx: number, fz: number): void {
    if (!h.alive || !this.byId.has(h.id)) return;
    const f = this.onBitten;
    // 生化模式：被咬就是感染，由玩法层把人撤掉、在原地放一只丧尸
    if (f && f(this.fill(this.ref, h), amount)) return;
    if (!h.alive || !this.byId.has(h.id)) return;
    if (this.brain.damage(h, amount, false, h.x - fx, h.z - fz, false)) this.flushDead();
  }

  /** 车撞人：车壳碰到、车速超过 4 米/秒，按车速掉血（和丧尸的一样：10 米/秒撞上就是一条命）。只读车的状态，减速由车辆模块管 */
  private runOver(): void {
    const hs = this.brain.humans;
    if (!hs.length) return;
    const ctx = this.ctx;
    for (const v of ctx.garage.vehicles) {
      const sp = Math.abs(v.body.speed);
      if (sp < 4) continue;
      const pos = v.rig.root.position;
      const reach = v.hull.hz + v.hull.hx + 1;
      for (let i = hs.length - 1; i >= 0; i--) {
        const h = hs[i] as Human;
        if (!h.alive || h.carT > this.time) continue;
        if (Math.abs(h.x - pos.x) > reach || Math.abs(h.z - pos.z) > reach || Math.abs(h.y - pos.y) > 2.5) continue;
        const [lx, lz] = v.toHull(h.x, h.z);
        if (Math.abs(lx) > v.hull.hx + 0.42 || Math.abs(lz) > v.hull.hz + 0.42) continue;
        h.carT = this.time + 0.45;
        const vl = Math.hypot(v.body.vel.x, v.body.vel.z) || 1;
        // 最后一个数：撞死的话倒地有多猛（车快的直接撞飞）
        const died = this.brain.damage(h, (sp - 2) * 13 * CAR.ram, false, v.body.vel.x / vl, v.body.vel.z / vl, ctx.garage.driving === v, null, Math.min(4.5, 1 + sp * 0.3));
        CAR.onRam(sp, 75);
        if (!died) {
          // 没撞死：从车壳里推出去
          P.x = h.x;
          P.z = h.z;
          ctx.world.collide(P, h.y, 1.7, 0.3, 0.45);
          h.x = P.x;
          h.z = P.z;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 死

  /** 刚死的那些：从名单里拿掉、模型转成尸体、所在的伙记账、掉东西、报给玩法层 */
  private flushDead(): void {
    const q = this.deadQ;
    while (q.length) {
      const h = q.pop() as Human;
      if (!this.byId.has(h.id)) continue;
      this.forget(h);
      if (h.group) {
        const rec = this.gone.get(h.group);
        const until = this.time + DAY * (2.6 + 0.8 * this.rng.next());
        if (rec && rec.until > this.time) {
          rec.mask |= 1 << h.member;
          rec.until = until;
        } else this.gone.set(h.group, { mask: 1 << h.member, until });
      }
      this.views.kill(h, 35 + this.rng.next() * 15);
      if (h.loot) this.loot(h);
      this.ctx.emit({ type: 'kill', kind: h.side, x: h.x, z: h.z, head: h.head, byPlayer: h.byPlayer, human: true });
    }
  }

  /**
   * 掉东西：手里的枪（弹匣里只剩几发）、一点同口径的子弹，偶尔有绷带 / 吃的。
   * 枪是稀缺资源：等级低的人拿的本来就是一二级的枪（raider-spawn.ts 的 pickGun），子弹也只给一小把
   */
  private loot(h: Human): void {
    const r = this.rng;
    const ctx = this.ctx;
    const s = h.spec;
    // 枪往倒下的方向甩出去一点
    const gx = h.x + h.killDx * 0.5 + (r.next() - 0.5) * 0.4;
    const gz = h.z + h.killDz * 0.5 + (r.next() - 0.5) * 0.4;
    ctx.drop(`gun_${h.gun}`, 1, Math.min(s.st.mag, h.mag + (h.freeAmmo ? 0 : h.ammo), r.int(3, 12)), gx, gz);
    const at = (): [number, number] => [h.x + (r.next() - 0.5) * 0.9, h.z + (r.next() - 0.5) * 0.9];
    if (r.next() < 0.6) {
      const c = s.cls;
      const n = c === 'pistol' ? r.int(3, 8) : c === 'smg' ? r.int(6, 14) : c === 'shotgun' ? r.int(2, 4) : c === 'sniper' ? r.int(2, 4) : c === 'lmg' ? r.int(8, 18) : r.int(4, 10);
      ctx.drop(AMMO_ITEM[s.ammo], n, undefined, ...at());
    }
    const u = r.next();
    if (u < 0.3) ctx.drop(u < 0.12 ? 'bandage' : u < 0.18 ? 'canned_meat' : u < 0.23 ? 'water' : u < 0.27 ? 'biscuits' : 'painkiller', 1, undefined, ...at());
  }

  // ---------------------------------------------------------------- 打

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): ZombieHit | null {
    return this.brain.raycast(ox, oy, oz, dx, dy, dz, maxDist);
  }

  damage(id: number, amount: number, head: boolean, dx: number, dz: number, byPlayer = true): boolean {
    const h = this.byId.get(id);
    if (!h || !h.alive) return false;
    const died = this.brain.damage(h, amount, head, dx, dz, byPlayer);
    if (died) this.flushDead();
    return died;
  }

  /** 近战（玩家挥的）：扇形里的人各挨一下 */
  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number {
    const hs = this.brain.humans;
    const p = this.ctx.player;
    const w = this.ctx.world;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ca = Math.cos(arc);
    let n = 0;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i] as Human;
      if (!h.alive) continue;
      const dx = h.x - x;
      const dz = h.z - z;
      const d = Math.hypot(dx, dz);
      if (d - 0.3 > reach || Math.abs(h.y - p.feet) > 1.6) continue;
      // 贴脸的不看角度
      if (d > 0.7 && dx * fx + dz * fz < ca * d) continue;
      // 隔着墙够不着
      const oy = p.feet + 1.25;
      const dy = h.y + 1 - oy;
      const L = Math.hypot(d, dy);
      if (L > 0.7 && w.raycast(x, oy, z, dx / L, dy / L, dz / L, L - 0.3, false) !== Infinity) continue;
      this.brain.damage(h, amount, false, d > 1e-3 ? dx / d : fx, d > 1e-3 ? dz / d : fz, true);
      n++;
    }
    this.flushDead();
    return n;
  }

  /** 爆炸：半径以内的人按距离衰减受伤，中间有墙挡着的不算 */
  blast(x: number, y: number, z: number, radius: number, damage: number, byPlayer = true): number {
    const hs = this.brain.humans;
    const w = this.ctx.world;
    let n = 0;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i] as Human;
      if (!h.alive) continue;
      const dx = h.x - x;
      const dz = h.z - z;
      const dy = h.y + 0.9 - y;
      const d = Math.hypot(dx, dy, dz);
      if (d >= radius) continue;
      if (d > 0.6 && w.raycast(x, y + 0.2, z, dx / d, (dy - 0.2) / d, dz / d, d - 0.4, false) !== Infinity) continue;
      const k = 1 - d / radius;
      const hl = Math.hypot(dx, dz);
      // 最后一个数：打死的话倒地有多猛（近处的炸飞出去）
      this.brain.damage(h, damage * k * k, false, hl > 1e-3 ? dx / hl : 0, hl > 1e-3 ? dz / hl : 1, byPlayer, null, 2 + 3 * k);
      n++;
    }
    this.flushDead();
    return n;
  }

  noise(x: number, z: number, radius: number): void {
    this.brain.noise(x, z, radius, null);
  }

  // ---------------------------------------------------------------- 玩法层放人、管人

  spawn(o: HumanSpawn): number {
    const ctx = this.ctx;
    const hs = this.brain.humans;
    const r = this.rng;
    if (hs.length >= CAP) {
      // 满了：把离玩家最远的一个平时自己出现的、没在交火的撤掉，给玩法层放的让位
      const p = ctx.player;
      let far: Human | null = null;
      let fd = 30;
      for (const h of hs) {
        if (h.tag || !h.group || h.tk === 1 || h.tk === 2) continue;
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (d > fd) {
          fd = d;
          far = h;
        }
      }
      if (!far) return -1;
      this.despawn(far);
    }
    const level = Math.max(1, Math.min(5, Math.round(o.level ?? 2)));
    let spec: GunSpec | undefined = o.gun ? specOf(o.gun) : undefined;
    if (!spec) spec = specOf(pickGun(level, false, r.next(), r.next())) as GunSpec;
    // 站不了的地方（墙里、家具上）挪到旁边能站的地方
    let x = o.x;
    let z = o.z;
    const g = this.brain.nav.at(x, z);
    if (g) {
      if (g.blockedAt(x, z) && g.freeNear(x, z, P, 12)) {
        x = P.x;
        z = P.z;
      }
    } else {
      P.x = x;
      P.z = z;
      ctx.world.collide(P, ctx.world.groundAt(x, z), 1.75, 0.3, 0.45);
      x = P.x;
      z = P.z;
    }
    const side: HumanSide = o.side === 'ally' ? 'ally' : 'raider';
    // 伙的编号最低位 = 阵营：同一个编号的敌人和同伴不算一伙
    const squad = (o.squad && o.squad > 0 ? Math.floor(o.squad) % 1e6 : 1e6 + (++this.auto % 1e6)) * 2 + (side === 'ally' ? 1 : 0);
    const h = this.add({
      x,
      z,
      side,
      gun: spec.id,
      spec,
      level,
      squad,
      name: o.name ?? nameFor(r.next()),
      tag: o.tag && o.tag > 0 ? o.tag : 0,
      loot: o.loot !== false,
      freeAmmo: !!o.freeAmmo,
      leash: o.leash ? { x: o.leash.x, z: o.leash.z, r: o.leash.r } : null,
      goto: o.goto ? { x: o.goto.x, z: o.goto.z } : null,
      ...(o.yaw !== undefined ? { yaw: o.yaw } : {}),
    });
    return h ? h.id : -1;
  }

  remove(id: number): void {
    const h = this.byId.get(id);
    if (h) this.despawn(h);
  }

  clearTag(tag: number): void {
    const hs = this.brain.humans;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i] as Human;
      if (h.tag === tag) this.despawn(h);
    }
  }

  setSide(tag: number, side: HumanSide): void {
    // 先收集再改：换阵营会把人挪到另一伙里
    const list = this.brain.humans.filter((h) => h.tag === tag && h.side !== side);
    for (const h of list) {
      this.brain.setSide(h, side);
      this.views.setSide(h);
    }
  }

  private fill(r: HumanRef, h: Human): HumanRef {
    r.id = h.id;
    r.x = h.x;
    r.z = h.z;
    r.feet = h.y;
    r.side = h.side;
    r.hp = Math.max(0, h.hp);
    r.alive = h.alive;
    r.name = h.name;
    r.gun = h.gun;
    r.tag = h.tag;
    return r;
  }

  list(out: HumanRef[]): number {
    let n = 0;
    for (const h of this.brain.humans) {
      if (!h.alive) continue;
      let r = out[n];
      if (!r) out[n] = r = { id: 0, x: 0, z: 0, feet: 0, side: 'raider', hp: 0, alive: false, name: '', gun: '', tag: 0 };
      this.fill(r, h);
      n++;
    }
    return n;
  }

  setQuality(k: number): void {
    this.cap = Math.max(4, Math.round(CAP * k));
    this.views.setQuality(k);
  }

  /** 存档：哪些伙死了哪几个、还要空多久（秒）。带 tag 的、玩法层放的不存 */
  save(): unknown {
    const out: Array<[number, number, number]> = [];
    for (const [key, rec] of this.gone) if (rec.until > this.time) out.push([key, rec.mask, Math.round(rec.until - this.time)]);
    return out;
  }

  load(data: unknown): void {
    this.gone.clear();
    if (!Array.isArray(data)) return;
    for (const e of data as unknown[]) {
      if (!Array.isArray(e)) continue;
      const key = Number(e[0]);
      const mask = Number(e[1]);
      const left = Number(e[2]);
      if (Number.isFinite(key) && Number.isFinite(mask) && mask > 0 && Number.isFinite(left) && left > 0) this.gone.set(key, { mask, until: this.time + left });
    }
    // 已经在场上的、存档里说死了的：撤掉
    const hs = this.brain.humans;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i] as Human;
      const rec = h.group ? this.gone.get(h.group) : undefined;
      if (rec && rec.mask & (1 << h.member)) this.despawn(h);
    }
  }

  // ---------------------------------------------------------------- 调试

  /** 在玩家面前 dist 米放 n 个（一排）。返回编号 */
  debugSpawn(n = 1, side: HumanSide = 'raider', dist = 12, level = 2, gun?: string): number[] {
    const p = this.ctx.player;
    const ids: number[] = [];
    const squad = 900000 + (++this.auto % 90000);
    for (let i = 0; i < n; i++) {
      const a = p.yaw + (i - (n - 1) / 2) * (1.6 / Math.max(3, dist));
      const x = p.x + Math.sin(a) * dist;
      const z = p.z + Math.cos(a) * dist;
      const o: HumanSpawn = { x, z, side, level, squad, yaw: Math.atan2(p.x - x, p.z - z), tag: 99 };
      if (gun) o.gun = gun;
      ids.push(this.spawn(o));
    }
    return ids;
  }

  debugList(): Array<Record<string, unknown>> {
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    return this.brain.humans.map((h) => ({ id: h.id, name: h.name, side: h.side, lv: h.level, gun: h.gun, x: r1(h.x), z: r1(h.z), y: r1(h.y), hp: Math.round(h.hp), mode: h.mode, tk: h.tk, mag: h.mag, ammo: h.ammo, shots: h.shots, tag: h.tag, squad: h.sq.id, scout: h.scout, crouch: h.crouch, watch: h.watch, heals: h.heals }));
  }

  /** 全部撤掉（不留尸体、不记账；量性能时换场景用） */
  debugClear(): number {
    const all = [...this.brain.humans];
    for (const h of all) this.despawn(h);
    this.views.clearCorpses();
    return all.length;
  }

  /** 内部的东西（测试脚本、量性能用） */
  get debug(): { brain: RaidBrain; views: RaiderViews; planner: Planner; groups: Group[]; gone: Map<number, { mask: number; until: number }> } {
    return { brain: this.brain, views: this.views, planner: this.planner, groups: this.groups, gone: this.gone };
  }
}
