import { Rng } from '../../game/core/rng';
import { CAR, type GameCtx, type HordeApi, type Prey, type ZombieHit, type ZombieKindId, type ZombieRef } from '../game/api';
import { Brain, type ZEvent, type Zed } from './zombie-brain';
import { FIELD_STEP, type Field } from './zombie-nav';
import { ZombieSounds } from './zombie-sound';
import { Spawner, type Slot } from './zombie-spawn';
import { ZKINDS, type ZKind } from './zombie-types';
import { ZombieViews, type ZView } from './zombie-view';

/**
 * 丧尸（HordeApi 的实现）。这个文件只是把几块接起来：
 *   zombie-spawn.ts  世界上哪里住着丧尸（按种子算的「坑位」）
 *   zombie-brain.ts  行为和移动（看、听、追、出手、挨打；zombie-nav.ts 找路）
 *   zombie-view.ts   模型、动画、细节档、尸体
 *   zombie-sound.ts  声音
 * 这里管：玩家周围的坑位什么时候变成真的丧尸、什么时候撤掉，子弹 / 近战打没打中，死了以后掉东西、记账。
 *
 * 调试：地址加 ?zombies=0 不自动刷；控制台 __open.horde.debugSpawn(n, kind?, dist?) / list() / debugKillAll()。
 */

/** 同时活着的上限（最高画质的夜里；setQuality 会按档位乘） */
const CAP = 45;
/** 白天的上限是夜里的几成：大镇子、基地的坑位比上限多得多，白天就刷满的话夜里看不出「更多」 */
const DAY_CAP = 0.7;
/**
 * 所有丧尸加起来的硬上限（最高画质；平时的 + spawnAt 放的带编号的），和开局建好的模型数一样多（zombie-view.ts 的 PREBUILD）。
 * 带编号的不占上面那个上限，但到了这个数就得先撤掉一只平时的才放得下。
 * 一只在画面里的丧尸约 1.6 次绘制、4700 个三角形（围上来时 2.4 次），60 只就是一百多次绘制：再多帧率保不住
 */
const HARD = 60;
/** 这个距离以内的坑位才变成丧尸；丧尸离玩家超过 R_DESPAWN 就撤掉（坑位还在，回来还有） */
const R_SPAWN = 120;
const R_DESPAWN = 140;
/** 离玩家至少这么远才刷（并且要在看不见的地方，见 hidden()） */
const R_MIN = 45;
/** 一个游戏日有多少秒（daycycle.ts：一小时 60 秒）。打死的丧尸的坑位至少空这么久 */
const DAY = 1440;
const TAU = Math.PI * 2;
const P = { x: 0, z: 0 };

/** 射线和球：返回进入球的距离（起点就在球里返回 0），没打到返回 -1 */
function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const h = b * b - c;
  return h < 0 ? -1 : -b - Math.sqrt(h);
}

/** 射线和胶囊（a → b 的线段，半径 r）：返回距离，没打到返回 -1 */
function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-6) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const oax = ox - ax;
  const oay = oy - ay;
  const oaz = oz - az;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // 起点就在胶囊里（顶着脸开枪）
  const t0 = Math.max(0, Math.min(1, baoa / baba));
  if (oaoa - 2 * t0 * baoa + t0 * t0 * baba < r * r) return 0;
  const a = baba - bard * bard;
  if (a < 1e-9) {
    // 射线和轴平行：只可能打到两头
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
    const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
    return t1 < 0 ? t2 : t2 < 0 ? t1 : Math.min(t1, t2);
  }
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t >= 0 ? t : -1;
  // 两头的半球
  return y <= 0 ? raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r) : raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
}

export class Horde implements HordeApi {
  private readonly brain: Brain;
  private readonly spawner: Spawner;
  private readonly sounds = new ZombieSounds();
  private readonly rng = new Rng(977);
  private readonly byId = new Map<number, Zed>();
  private readonly bySlot = new Map<number, Zed>();
  private readonly slots: Slot[] = [];
  private readonly deadQ: Zed[] = [];
  /** 命中体积的草稿：头的球心、髋 */
  private readonly vol = new Float32Array(6);
  private readonly camp: { x: number; z: number } | null;
  /** ?zombies=0：不自动刷（debugSpawn 照样能用） */
  private readonly off: boolean;
  /** 平时按坑位自动刷、夜里游荡的开关（守城时、生化模式里关着）。关掉以后已经在场的不动 */
  ambient = true;
  /** 带编号的（spawnAt 的 tag）现在有几只 */
  private tagged = 0;
  /** 现在的硬上限（按画质） */
  private hard = HARD;
  /** 放出来的那一帧模型池里没有现成的：先不带模型，之后每帧补 */
  private readonly naked: Zed[] = [];
  /** near() 的草稿 */
  private readonly nearZ: Zed[] = [];
  private readonly nearD: number[] = [];
  /** 「走得到」的图（spotAround 用）上一次有人问是什么时候：两秒没人问了才给别的中心重铺 */
  private reachUse = -9;
  /** 夜里的上限、现在的上限 */
  private cap = CAP;
  private capNow = CAP;
  private k = 1;
  /** 自己的钟（秒）：坑位空到什么时候用它记 */
  private time = 0;
  private popT = 0;
  private tick = 0;
  private slotT = 0;
  private slotX = Infinity;
  private slotZ = Infinity;
  private roamT = 25;
  /** 开局、传送以后的头几轮：不管看不看得见，先把周围填上 */
  private burst = 4;
  private lastX = Infinity;
  private lastZ = Infinity;

  private constructor(
    private readonly ctx: GameCtx,
    private readonly views: ZombieViews,
  ) {
    this.brain = new Brain({
      world: ctx.world,
      player: ctx.player,
      driving: () => ctx.garage.driving,
      vehicles: () => ctx.garage.vehicles,
      night: () => ctx.clock.night,
      playerDead: () => ctx.survival.dead,
      hurt: (amount, x, z) => ctx.survival.hurt(amount, x, z, '被丧尸咬死'),
      on: (ev, z) => this.on(ev, z),
      car: CAR,
    });
    this.spawner = new Spawner(ctx.world, this.brain.nav);
    const c = ctx.world.sites.at(0, 0);
    this.camp = c ? { x: c.x, z: c.z } : null;
    this.off = ctx.params.get('zombies') === '0';
  }

  /** 加载模型、建好池子（之后运行中不再加载、不再编译着色器） */
  static async create(ctx: GameCtx): Promise<Horde> {
    const views = await ZombieViews.load(ctx.scene, ctx.renderer);
    return new Horde(ctx, views);
  }

  get count(): number {
    return this.brain.zeds.length;
  }

  /** 丧尸不理玩家（生化模式里玩家自己变成丧尸以后）：看见了不追、不打、不挤。Prey 照追 */
  get passive(): boolean {
    return this.brain.passive;
  }

  set passive(v: boolean) {
    this.brain.passive = v;
  }

  /** 贴在玩家身上的丧尸有几只（中心距 1.45 米以内、站在同一层、没被打出硬直），折成 0–1 */
  get grip(): number {
    if (this.ctx.garage.driving || this.brain.passive) return 0;
    const feet = this.ctx.player.feet;
    let n = 0;
    for (const z of this.brain.zeds) {
      if (!z.alive || z.state === 'dead' || z.state === 'stagger') continue;
      if (z.dist < 1.45 && Math.abs(z.y - feet) < 1.6) n++;
    }
    return Math.min(1, n * 0.34);
  }

  update(dt: number): void {
    const { ctx, brain, views } = this;
    this.time += dt;
    views.look(ctx.camera);
    this.sounds.listen(ctx.camera, dt);
    this.populate(dt);
    if (this.naked.length) this.dress();
    // spotAround 要的那张「走得到」的图：一帧铺两截（约一毫秒），半秒多铺完
    const rf = brain.nav.reach;
    if (rf.state === 1 && rf.run(FIELD_STEP * 2)) rf.state = 2;
    brain.update(dt);
    this.flushDead();
    views.update(dt, brain.zeds, ctx.clock.night);
    this.sounds.ambient(dt, brain.zeds);
  }

  // ---------------------------------------------------------------- 刷新 / 撤掉

  private populate(dt: number): void {
    const p = this.ctx.player;
    // 传送（调试、读档、重生）：周围要马上有丧尸
    if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) > 40) this.burst = 4;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.popT -= dt;
    if (this.popT > 0) return;
    this.popT = 0.2;
    const tick = ++this.tick;
    const { views, spawner } = this;
    const zeds = this.brain.zeds;
    const dark = this.ctx.clock.night > 0.5;
    const cap = (this.capNow = Math.round(this.cap * (dark ? 1 : DAY_CAP)));
    let tagged = 0;
    for (let i = zeds.length - 1; i >= 0; i--) {
      const z = zeds[i] as Zed;
      // 带编号的（守城的一波、生化模式的）不按距离撤：谁放的谁用 clearTag 收
      if (z.tag) {
        tagged++;
        continue;
      }
      const d = Math.hypot(z.x - p.x, z.z - p.z);
      const hunting = z.state === 'chase' || z.state === 'attack';
      // 走远了；或者只在夜里出来的，天亮以后在看不见的地方消失
      if (d > R_DESPAWN || (z.nightOnly && !dark && d > 30 && !hunting && !views.sees(z.x, z.y + 0.9, z.z, 1.5))) this.despawn(z);
    }
    this.tagged = tagged;
    // 天亮了、画质调低了，上限变小：把最远的撤掉（带编号的不占这个上限）
    if (zeds.length - tagged > cap) this.evict(0);
    // 「先填满」的那几轮在不自动刷的时候也照样过掉：不然守城打完、开关一开回来，丧尸会在眼前冒出来
    const burst = this.burst > 0;
    if (burst) this.burst--;
    if (this.off || !this.ambient) return;
    if (Math.hypot(p.x - this.slotX, p.z - this.slotZ) > 8 || this.time > this.slotT) {
      spawner.collect(p.x, p.z, R_SPAWN, this.slots);
      this.slotX = p.x;
      this.slotZ = p.z;
      this.slotT = this.time + 3;
    }
    // 满了的时候不用每轮都找（找只是为了看要不要把远处的换成近处的）
    if (zeds.length - tagged < cap || burst || tick % 5 === 0) {
      const min = burst ? 22 : R_MIN;
      for (let n = burst ? 14 : 2; n > 0; n--) {
        // 现在能放的坑位里最近的那个
        let best: Slot | null = null;
        let bd = Infinity;
        for (const s of this.slots) {
          if ((s.night && !dark) || this.bySlot.has(s.key)) continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (d < min || d >= bd) continue;
          const until = spawner.cleared.get(s.key);
          if (until !== undefined) {
            if (until > this.time) continue;
            spawner.cleared.delete(s.key);
          }
          if (!burst && !this.hidden(s, d)) continue;
          best = s;
          bd = d;
        }
        if (!best) break;
        if ((zeds.length - tagged >= cap || zeds.length >= this.hard) && !this.evict(bd + 25)) break;
        if (!this.spawnSlot(best)) break;
      }
    }
    this.roam(dark);
  }

  /** 这个坑位现在刷出一只来，玩家看不看得出是凭空冒出来的 */
  private hidden(s: Slot, d: number): boolean {
    // 屋里的隔着墙
    return !!s.house || this.unseen(s.x, s.z, d);
  }

  /** 屋外的 (x, z) 这个点现在站出一只丧尸来，玩家看不看得见（d = 离玩家多远） */
  private unseen(x: number, z: number, d: number): boolean {
    // 70 米以外只有几个像素高
    if (d >= 70) return true;
    const w = this.ctx.world;
    const y = w.groundAt(x, z) + 1.1;
    if (!this.views.sees(x, y, z, 1.2)) return true;
    // 在画面里：中间有东西挡着也行
    const c = this.ctx.camera.position;
    const dx = x - c.x;
    const dy = y - c.y;
    const dz = z - c.z;
    const L = Math.hypot(dx, dy, dz);
    return w.raycast(c.x, c.y, c.z, dx / L, dy / L, dz / L, L - 0.6) !== Infinity;
  }

  private spawnSlot(s: Slot): boolean {
    const kind = this.spawner.kindFor(s, this.ctx.clock.night);
    // 外观按坑位定：同一栋房子里每次去都是那几只
    const seed = (Math.imul(s.key % 0x7fffffff, 2654435761) ^ Math.floor(s.u * 0xffff)) >>> 0;
    const v = this.views.acquire(kind, seed);
    if (!v) return false;
    const z = this.brain.spawn(kind, s.x, s.z, { house: s.house, slot: s.key, nightOnly: s.night });
    this.adopt(z, v);
    this.bySlot.set(s.key, z);
    return true;
  }

  private adopt(z: Zed, v: ZView | null): void {
    z.view = v;
    this.byId.set(z.id, z);
    if (v) v.place(z.x, z.y, z.z, z.yaw);
  }

  /** 放出来的时候没拿到模型的：现在补上（一帧最多新建一只，建不出来的下一帧再来） */
  private dress(): void {
    const nk = this.naked;
    for (let i = nk.length - 1; i >= 0; i--) {
      const z = nk[i] as Zed;
      if (z.alive && this.byId.get(z.id) === z) {
        const v = this.views.acquire(z.kind, z.seed);
        if (!v) continue;
        z.view = v;
        v.place(z.x, z.y, z.z, z.yaw);
      }
      nk[i] = nk[nk.length - 1] as Zed;
      nk.pop();
    }
  }

  /** 撤掉一只（不是打死：它的坑位还在） */
  private despawn(z: Zed): void {
    this.brain.remove(z);
    this.byId.delete(z.id);
    if (z.slot) this.bySlot.delete(z.slot);
    const v = z.view as ZView | null;
    if (v) this.views.release(v);
    z.view = null;
    z.alive = false;
  }

  /**
   * 把最远的一只没在追人、看不见的撤掉（要比 farther 米还远、至少 70 米；farther = 0 时不限距离）。撤了返回 true。
   * 70 米：走进大镇子时名额先被镇子边上的坑位占满，身后的要能及时换成前面的，不然走到镇中心街上是空的
   */
  private evict(farther: number): boolean {
    let far: Zed | null = null;
    let fd = farther > 0 ? Math.max(70, farther) : 0;
    for (const z of this.brain.zeds) {
      if (z.tag || z.dist <= fd || z.state === 'chase' || z.state === 'attack' || z.state === 'stagger') continue;
      if (z.dist < 110 && this.views.sees(z.x, z.y + 0.9, z.z, 1.5)) continue;
      far = z;
      fd = z.dist;
    }
    if (!far) return false;
    this.despawn(far);
    return true;
  }

  /** 夜里：隔一阵从野地里来一小群，朝玩家这边晃过来 */
  private roam(dark: boolean): void {
    this.roamT -= 0.2;
    if (!dark || this.roamT > 0) return;
    // 这次没放成的话过一会再试
    this.roamT = 10;
    const p = this.ctx.player;
    const zeds = this.brain.zeds;
    if (zeds.length - this.tagged > this.capNow - 4 || zeds.length > this.hard - 4) return;
    // 营地附近不来：开局手里什么都没有
    if (this.camp && Math.hypot(p.x - this.camp.x, p.z - this.camp.z) < 130) return;
    let roamers = 0;
    for (const z of zeds) if (z.roamer) roamers++;
    if (roamers >= Math.round(8 * this.k)) return;
    const w = this.ctx.world;
    const r = this.rng;
    for (let t = 0; t < 6; t++) {
      const a = r.next() * TAU;
      const d = 58 + r.next() * 20;
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      // 只从野地里来（地点里夜里本来就多一倍）；水里不行；夜里 66 米以外看不清，再近就得在画面外
      if (w.waterDepth(x, z) > 0.15 || this.brain.nav.at(x, z)) continue;
      if (d < 66 && this.views.sees(x, w.groundAt(x, z) + 0.9, z, 3)) continue;
      const n = 2 + Math.floor(r.next() * 3);
      for (let k = 0; k < n; k++) {
        const kind: ZKind = r.next() < 0.3 ? 'runner' : 'walker';
        const v = this.views.acquire(kind, Math.floor(r.next() * 0xffffffff));
        if (!v) break;
        const zed = this.brain.spawn(kind, x + (r.next() - 0.5) * 5, z + (r.next() - 0.5) * 5, {
          roamer: true,
          nightOnly: true,
          hx: p.x + (r.next() - 0.5) * 30,
          hz: p.z + (r.next() - 0.5) * 30,
        });
        this.adopt(zed, v);
      }
      this.roamT = 35 + r.next() * 40;
      return;
    }
  }

  // ---------------------------------------------------------------- 死

  private on(ev: ZEvent, z: Zed): void {
    const s = this.sounds;
    if (ev === 'die') this.deadQ.push(z);
    else if (ev === 'aggro') s.screech(z);
    else if (ev === 'swing') s.swing(z);
    else if (ev === 'hit') s.bite(z);
    else s.hurt(z);
  }

  /** 刚死的那些：从名单里拿掉、模型转成尸体、坑位记空、掉东西、报给玩法层 */
  private flushDead(): void {
    const q = this.deadQ;
    while (q.length) {
      const z = q.pop() as Zed;
      this.brain.remove(z);
      this.byId.delete(z.id);
      if (z.slot) {
        this.bySlot.delete(z.slot);
        this.spawner.cleared.set(z.slot, this.time + DAY * (1 + 0.5 * this.rng.next()));
      }
      this.sounds.die(z);
      this.views.kill(z, 20 + this.rng.next() * 10);
      this.loot(z);
      // 不是玩家打死的（带枪的人打的、别人的手雷炸的）：玩法层不给经验
      if (z.byPlayer) this.ctx.emit({ type: 'kill', kind: z.kind, x: z.x, z: z.z, head: z.head });
      else this.ctx.emit({ type: 'kill', kind: z.kind, x: z.x, z: z.z, head: z.head, byPlayer: false });
    }
  }

  /** 掉东西：十只里一只，大多是吃的喝的和绷带，子弹很少；肿胀者 / 重装身上的好一些 */
  private loot(z: Zed): void {
    const r = this.rng;
    const tough = z.kind === 'bloater' || z.kind === 'armored';
    if (r.next() > (tough ? 0.5 : 0.11)) return;
    const u = r.next();
    let item = 'bandage';
    let n = 1;
    if (tough) {
      if (u < 0.3) {
        item = 'ammo_556';
        n = r.int(6, 14);
      } else if (u < 0.5) {
        item = 'ammo_762';
        n = r.int(5, 10);
      } else if (u < 0.62) {
        item = 'ammo_12g';
        n = r.int(3, 6);
      } else if (u < 0.82) item = 'medkit';
      else item = 'mre';
    } else if (u < 0.26) item = 'bandage';
    else if (u < 0.46) item = 'canned_meat';
    else if (u < 0.64) item = 'water';
    else if (u < 0.76) item = 'biscuits';
    else if (u < 0.84) item = 'soda';
    else if (u < 0.9) item = 'painkiller';
    else if (u < 0.96) {
      item = 'ammo_9mm';
      n = r.int(3, 7);
    } else {
      item = 'ammo_12g';
      n = r.int(2, 4);
    }
    this.ctx.drop(item, n, undefined, z.x + (r.next() - 0.5) * 0.6, z.z + (r.next() - 0.5) * 0.6);
  }

  // ---------------------------------------------------------------- 打

  /** 头的球心和髋的位置（世界坐标）放进 vol。有模型就跟着模型现在的动作，没有就按站姿估 */
  private volumes(z: Zed): void {
    const V = this.vol;
    const v = z.view as ZView | null;
    if (v && v.volumes(z, V)) return;
    const crawl = z.kind === 'crawler';
    const f = crawl ? 0.6 : 0.3;
    V[0] = z.x + Math.sin(z.yaw) * f;
    V[1] = z.y + z.spec.eye;
    V[2] = z.z + Math.cos(z.yaw) * f;
    V[3] = z.x;
    V[4] = z.y + (crawl ? 0.25 : 0.95);
    V[5] = z.z;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): ZombieHit | null {
    const zeds = this.brain.zeds;
    const V = this.vol;
    let best = maxDist;
    let hit: Zed | null = null;
    let head = false;
    for (let i = 0; i < zeds.length; i++) {
      const z = zeds[i] as Zed;
      if (!z.alive) continue;
      const s = z.spec;
      // 粗筛：射线离丧尸身体中间那一点超过 1.8 米的不用细算
      const mx = z.x - ox;
      const my = z.y + Math.min(0.9, s.hitH * 0.6) - oy;
      const mz = z.z - oz;
      const t = mx * dx + my * dy + mz * dz;
      if (t < -2 || t > best + 2) continue;
      const px = mx - dx * t;
      const py = my - dy * t;
      const pz = mz - dz * t;
      if (px * px + py * py + pz * pz > 3.24) continue;
      this.volumes(z);
      const hx = V[0] as number;
      const hy = V[1] as number;
      const hz = V[2] as number;
      const qx = V[3] as number;
      const qy = V[4] as number;
      const qz = V[5] as number;
      const th = raySphere(ox, oy, oz, dx, dy, dz, hx, hy, hz, s.headR);
      // 躯干：髋 → 肩（到头的一半多一点，上面留给头）
      const r1 = s.hitR * 0.8;
      let tb = rayCapsule(ox, oy, oz, dx, dy, dz, qx, qy, qz, qx + (hx - qx) * 0.55, qy + (hy - qy) * 0.55, qz + (hz - qz) * 0.55, r1);
      // 腿：脚 → 髋。爬行者的下半身拖在后面
      const r2 = s.hitR * 0.7;
      let fx = z.x;
      let fy = z.y + r2;
      let fz = z.z;
      if (z.kind === 'crawler') {
        fx = qx - Math.sin(z.yaw) * 0.8;
        fy = z.y + 0.16;
        fz = qz - Math.cos(z.yaw) * 0.8;
      }
      const tl = rayCapsule(ox, oy, oz, dx, dy, dz, fx, fy, fz, qx, qy, qz, r2);
      if (tl >= 0 && (tb < 0 || tl < tb)) tb = tl;
      // 头和肩膀的胶囊有一点重叠：差不多远的时候算头
      let tt = -1;
      let hd = false;
      if (th >= 0 && (tb < 0 || th <= tb + 0.15)) {
        tt = th;
        hd = true;
      } else if (tb >= 0) tt = tb;
      if (tt >= 0 && tt < best) {
        best = tt;
        hit = z;
        head = hd;
      }
    }
    if (!hit) return null;
    return { id: hit.id, dist: best, head, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
  }

  damage(id: number, amount: number, head: boolean, dx: number, dz: number, byPlayer = true): boolean {
    const z = this.byId.get(id);
    if (!z || !z.alive) return false;
    const died = this.brain.damage(z, amount, head, dx, dz, byPlayer);
    if (died) this.flushDead();
    return died;
  }

  /**
   * 爆炸：离得越近伤得越重（贴着炸吃满，三分之一半径处七成多，一半半径处一半，到边上是零），中间隔着墙、隔着车的不算；
   * 被炸到的朝离开中心的方向退。返回伤到几只
   */
  blast(x: number, y: number, z: number, radius: number, damage: number, byPlayer = true): number {
    const zeds = this.brain.zeds;
    const w = this.ctx.world;
    // 手雷是躺在地上炸的：从高一点的地方量，不然地上一道门槛、一块路肩就把它挡住了
    const oy = y + 0.3;
    let n = 0;
    for (let i = zeds.length - 1; i >= 0; i--) {
      const q = zeds[i] as Zed;
      if (!q.alive) continue;
      const dx = q.x - x;
      const dz = q.z - z;
      if (Math.abs(dx) > radius + 1 || Math.abs(dz) > radius + 1) continue;
      const dy = q.y + Math.min(0.9, q.spec.hitH * 0.55) - oy;
      const d = Math.hypot(dx, dy, dz);
      // 按离身体表面多远算
      const e = Math.max(0, d - q.spec.hitR);
      if (e >= radius) continue;
      if (d > 0.7 && w.raycast(x, oy, z, dx / d, dy / d, dz / d, d - 0.35, false) !== Infinity) continue;
      const k = 1 - e / radius;
      this.brain.damage(q, damage * k * k * (3 - 2 * k), false, dx, dz, byPlayer);
      n++;
    }
    this.flushDead();
    return n;
  }

  /** (x, z) 周围 r 米内活着的丧尸，从近到远填进 out（对象复用） */
  near(x: number, z: number, r: number, out: ZombieRef[]): number {
    const zeds = this.brain.zeds;
    const ord = this.nearZ;
    const dd = this.nearD;
    const r2 = r * r;
    let n = 0;
    for (let i = 0; i < zeds.length; i++) {
      const q = zeds[i] as Zed;
      if (!q.alive) continue;
      const d2 = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d2 > r2) continue;
      // 一共几十只：边找边按距离插进去
      let k = n++;
      while (k > 0 && (dd[k - 1] as number) > d2) {
        dd[k] = dd[k - 1] as number;
        ord[k] = ord[k - 1] as Zed;
        k--;
      }
      dd[k] = d2;
      ord[k] = q;
    }
    const V = this.vol;
    for (let i = 0; i < n; i++) {
      const q = ord[i] as Zed;
      let o = out[i];
      if (!o) out[i] = o = { id: 0, x: 0, y: 0, z: 0, h: 0, after: -1 };
      o.id = q.id;
      o.x = q.x;
      o.y = q.y;
      o.z = q.z;
      // 头的高度跟着现在的动作（弯腰、前扑时矮一截）
      this.volumes(q);
      o.h = (V[1] as number) - q.y;
      // 挨打硬直的那一下也算在追（它缓过来接着追）
      const busy = q.state === 'chase' || q.state === 'attack' || (q.state === 'stagger' && (q.hunt > 0 || q.seen < q.spec.lose));
      o.after = busy ? (q.prey ? q.prey.prey.id : 0) : -1;
    }
    return n;
  }

  addPrey(p: Prey): void {
    this.brain.addPrey(p);
    // 不会动的大件（守城的发电机）：接下来多半要在它周围放一波，「走得到」的图现在就开始铺
    if (p.radius > 0.6) this.reachOf(p.x, p.z);
  }

  removePrey(p: Prey): void {
    this.brain.removePrey(p);
  }

  /**
   * 在 (x, z) 放一只（给的点站不了就挪到旁边能站的格子）。带 tag 的不占坑位、不按距离撤、不占平时的上限；
   * 但所有丧尸加起来有硬上限（HARD × 画质，最少 32）：到了就先撤掉远处一只平时的（没在追人、玩家看不见的），撤不了返回 -1。
   * 模型池里这一帧没有现成的也照放（先不带模型，之后几帧补上），所以一帧放一批不会因为池子返回 -1
   */
  spawnAt(kind: ZombieKindId, x: number, z: number, opts: { hunt?: number | 'near'; tag?: number; yaw?: number; hp?: number; speedMul?: number } = {}): number {
    const zeds = this.brain.zeds;
    // 满了：撤掉远处平时的（没在追人、玩家看不见的）腾地方；腾不出来就是放不下
    while (zeds.length >= this.hard) if (!this.evict(0)) return -1;
    const k: ZKind = kind;
    let sx = x;
    let sz = z;
    const g = this.brain.nav.at(x, z);
    if (g) {
      if (!g.freeNear(x, z, P, 8)) return -1;
      sx = P.x;
      sz = P.z;
    }
    const tag = opts.tag !== undefined && opts.tag > 0 ? opts.tag : 0;
    const zed = this.brain.spawn(k, sx, sz, { yaw: opts.yaw, tag, hunt: opts.hunt, hp: opts.hp, speedMul: opts.speedMul });
    const v = this.views.acquire(k, zed.seed);
    this.adopt(zed, v);
    if (!v) this.naked.push(zed);
    return zed.id;
  }

  /**
   * 圈的中心在地点里时：从中心往外铺的那张「走得到」的图（中心不在地点里、周围全堵死了、图正被别的中心用着，返回 null = 不管走不走得到）。
   * 中心换了地方就重新铺（horde.update 里一帧铺两截，半秒多铺完）；原来那个中心两秒没人问了才换，免得两个人轮着问把它来回重铺
   */
  private reachOf(cx: number, cz: number): Field | null {
    const nav = this.brain.nav;
    const g = nav.at(cx, cz);
    if (!g) return null;
    const f = nav.reach;
    if (f.state !== 0 && f.grid === g && Math.abs(f.gx - cx) + Math.abs(f.gz - cz) < 1.5) {
      this.reachUse = this.time;
      return f;
    }
    if (f.state !== 0 && this.time - this.reachUse < 2) return null;
    this.reachUse = this.time;
    if (!f.begin(g, cx, cz)) {
      f.state = 0;
      return null;
    }
    // 头一截现在就铺（中心周围十几米马上有数），剩下的每帧接着铺
    if (f.run(FIELD_STEP * 3)) f.state = 2;
    return f;
  }

  /** 从 (x, z) 走不走得到圈的中心（f = 从中心铺出来的图） */
  private walkable(f: Field, cx: number, cz: number, x: number, z: number): boolean {
    const g = f.grid;
    // 图外面（出了这个地点）：看不出来，放行
    if (!g || !g.covers(x, z) || f.reached(x, z)) return true;
    // 还在铺：调用方只在已经铺到的那一圈里挑点，所以没铺到的就是被围栏隔开的
    if (f.state === 1) return false;
    // 铺完了也没有它。能到的地方都铺过了 = 真的围死了；到了上限停的 = 直线距离比铺到的路程近的是要绕远路的（围栏外面），
    // 比它远的图上没有，放行
    return f.capped && Math.hypot(x - cx, z - cz) >= f.radius;
  }

  /**
   * (cx, cz) 周围 rMin–rMax 米里找一个能站、玩家现在看不见的点（画面外，或者被东西挡着，或者 70 米以外）。
   * 不在水里、不在墙里、不在屋里（关着门的屋子出不来），也不贴着玩家；中心在地点里时还要从那个点走得到中心
   * （围栏外面要绕很远才进得来的不算）。找不到返回 false：过一会再问。
   * 换了一个中心以后的头半秒多（「走得到」的图还在铺）给的点都在圈里靠中心的那一侧
   */
  spotAround(cx: number, cz: number, rMin: number, rMax: number, out: { x: number; z: number }): boolean {
    const w = this.ctx.world;
    const p = this.ctx.player;
    const r = this.rng;
    let reach = this.reachOf(cx, cz);
    let hi = rMax;
    if (reach && reach.state === 1) {
      // 「走得到」的图还在铺（半秒多）：只在已经铺到的那一圈里挑。铺的时候是按路程一圈圈往外的，直线距离在路程的九成以内的都有数了
      const known = reach.radius * 0.9;
      if (known > rMin + 1) hi = Math.min(rMax, known);
      // 圈里一点都还没铺到（刚换了中心的头几帧）：先不管走不走得到，免得只问一次的扑空
      else reach = null;
    }
    // 离玩家至少这么远（圈本身很小的时候放宽）
    const keep = Math.min(16, rMin * 0.6);
    for (let t = 0; t < 14; t++) {
      const a = r.next() * TAU;
      const d = rMin + r.next() * (hi - rMin);
      let x = cx + Math.sin(a) * d;
      let z = cz + Math.cos(a) * d;
      const g = this.brain.nav.at(x, z);
      if (g) {
        if (!g.freeNear(x, z, P, 6)) continue;
        x = P.x;
        z = P.z;
        if (g.houseAt(x, z)) continue;
      } else {
        // 野地里：别正好站在树干、石头里
        P.x = x;
        P.z = z;
        w.collide(P, w.groundAt(x, z), 1.7, 0.3, 0.45);
        x = P.x;
        z = P.z;
      }
      if (w.waterDepth(x, z) > 0.15) continue;
      if (reach && !this.walkable(reach, cx, cz, x, z)) continue;
      const pd = Math.hypot(x - p.x, z - p.z);
      if (pd < keep || !this.unseen(x, z, pd)) continue;
      out.x = x;
      out.z = z;
      return true;
    }
    return false;
  }

  countTag(tag: number): number {
    const zeds = this.brain.zeds;
    let n = 0;
    for (let i = 0; i < zeds.length; i++) {
      const z = zeds[i] as Zed;
      if (z.tag === tag && z.alive) n++;
    }
    return n;
  }

  /** 把带这个 tag 的全撤掉：不算打死，不留尸体、不掉东西、不报 kill、不记坑位 */
  clearTag(tag: number): void {
    const zeds = this.brain.zeds;
    for (let i = zeds.length - 1; i >= 0; i--) {
      const z = zeds[i] as Zed;
      if (z.tag === tag) this.despawn(z);
    }
  }

  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number {
    const zeds = this.brain.zeds;
    const p = this.ctx.player;
    const w = this.ctx.world;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ca = Math.cos(arc);
    let n = 0;
    for (let i = zeds.length - 1; i >= 0; i--) {
      const q = zeds[i] as Zed;
      if (!q.alive) continue;
      const dx = q.x - x;
      const dz = q.z - z;
      const d = Math.hypot(dx, dz);
      if (d - q.spec.hitR > reach || Math.abs(q.y - p.feet) > 1.6) continue;
      // 贴脸的不看角度
      if (d > 0.7 && dx * fx + dz * fz < ca * d) continue;
      // 隔着墙够不着
      const oy = p.feet + 1.25;
      const dy = q.y + Math.min(1, q.spec.hitH * 0.6) - oy;
      const L = Math.hypot(d, dy);
      if (L > 0.7 && w.raycast(x, oy, z, dx / L, dy / L, dz / L, L - 0.3, false) !== Infinity) continue;
      this.brain.damage(q, amount, false, d > 1e-3 ? dx / d : fx, d > 1e-3 ? dz / d : fz);
      n++;
    }
    this.flushDead();
    return n;
  }

  noise(x: number, z: number, radius: number): void {
    this.brain.noise(x, z, radius);
  }

  setQuality(k: number): void {
    this.k = k;
    this.cap = Math.round(CAP * k);
    this.hard = Math.max(32, Math.round(HARD * k));
    this.views.setQuality(k);
  }

  /** 存档：打空了的坑位和还要空多久（秒）。清过的房子重开页面以后还是清过的 */
  save(): unknown {
    const out: Array<[number, number]> = [];
    for (const [key, until] of this.spawner.cleared) if (until > this.time) out.push([key, Math.round(until - this.time)]);
    return out;
  }

  load(data: unknown): void {
    const cleared = this.spawner.cleared;
    cleared.clear();
    if (!Array.isArray(data)) return;
    for (const e of data as unknown[]) {
      if (!Array.isArray(e)) continue;
      const key = Number(e[0]);
      const left = Number(e[1]);
      if (Number.isFinite(key) && Number.isFinite(left) && left > 0) cleared.set(key, this.time + left);
    }
  }

  // ---------------------------------------------------------------- 调试

  /** 在玩家面前 dist 米放 n 只（九只一排）。kind 不给 = 行尸，'mix' = 各种都来点 */
  debugSpawn(n = 1, kind: ZKind | 'mix' = 'walker', dist = 10): number[] {
    const p = this.ctx.player;
    const ids: number[] = [];
    const mix: ZKind[] = ['walker', 'walker', 'runner', 'walker', 'crawler', 'walker', 'runner', 'bloater', 'walker', 'armored'];
    for (let i = 0; i < n; i++) {
      const k: ZKind = kind === 'mix' ? (mix[i % mix.length] as ZKind) : ZKINDS.includes(kind) ? kind : 'walker';
      const row = Math.floor(i / 9);
      const r = dist + row * 1.5;
      // 这一排有几只：以玩家正前方为中心排开（只放一只就在正前方）
      const inRow = Math.min(9, n - row * 9);
      const a = p.yaw + ((i % 9) - (inRow - 1) / 2) * (1.15 / Math.max(3, r));
      let x = p.x + Math.sin(a) * r;
      let z = p.z + Math.cos(a) * r;
      const g = this.brain.nav.at(x, z);
      if (g && g.freeNear(x, z, P, 8)) {
        x = P.x;
        z = P.z;
      }
      const seed = (Math.imul(i + 1, 2654435761) ^ Math.floor(this.rng.next() * 0xffff)) >>> 0;
      const zed = this.brain.spawn(k, x, z, { yaw: Math.atan2(p.x - x, p.z - z) });
      this.adopt(zed, this.views.acquire(k, seed, true));
      ids.push(zed.id);
    }
    return ids;
  }

  /** tag = spawnAt 给的编号；after = 现在的目标（0 玩家，> 0 那个 Prey 的 id） */
  list(): Array<{ id: number; kind: ZKind; x: number; z: number; hp: number; state: string; tag: number; after: number }> {
    return this.brain.zeds.map((z) => ({ id: z.id, kind: z.kind, x: Math.round(z.x * 10) / 10, z: Math.round(z.z * 10) / 10, hp: Math.round(z.hp), state: z.state, tag: z.tag, after: z.prey ? z.prey.prey.id : 0 }));
  }

  debugKillAll(): number {
    const all = [...this.brain.zeds];
    for (const z of all) this.brain.damage(z, 1e6, false, 0, 1);
    this.flushDead();
    return all.length;
  }

  /** 全部撤掉（不留尸体、不记坑位；量性能时换场景用） */
  debugClear(): number {
    const all = [...this.brain.zeds];
    for (const z of all) this.despawn(z);
    return all.length;
  }

  /** 内部的东西（测试脚本、量性能用） */
  get debug(): { brain: Brain; views: ZombieViews; spawner: Spawner; slots: Slot[] } {
    return { brain: this.brain, views: this.views, spawner: this.spawner, slots: this.slots };
  }
}
