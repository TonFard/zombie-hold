import { Emitter } from './core/events';
import { Rng } from './core/rng';
import { STRUCTURES, type StructureKind } from './data/structures';
import { WEAPON_ORDER, WEAPONS, statsAt, type WeaponKind } from './data/weapons';
import type { ZombieKind } from './data/zombies';
import type { Projectile } from './entities/projectile';
import type { Structure } from './entities/structure';
import { Zombie, type AttackTarget } from './entities/zombie';
import { Navigator } from './nav/navigator';
import { updateBuildMode, updateStructures, type BuildCursor } from './systems/building';
import { updateProjectiles, updateStatus } from './systems/combat';
import { updatePlayer } from './systems/player';
import { newRunState, updateRun, type Phase, type RunState } from './systems/run';
import { stepZombies } from './systems/zombie-ai';
import { resolveCircleVsGrid } from './world/collision';
import { Grid, GRID_H, GRID_W, HALF_H, HALF_W } from './world/grid';
import { buildOutpost } from './world/map-outpost';
import type { MapData, WorldRect } from './world/types';

export const MAX_ZOMBIES = 256;
/** 固定模拟步长 */
export const STEP = 1 / 60;

export interface PlayerState {
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 朝向（绕 Y，0 = 面向 +Z） */
  yaw: number;
  vx: number;
  vz: number;
  /** 步伐相位，随移动距离增长 */
  walkPhase: number;
  sprinting: boolean;
  weapon: WeaponKind;
  tier: number;
  /** 开火后坐力 0–1，随时间衰减 */
  recoil: number;
  stamina: number;
  maxStamina: number;
  staminaDelay: number;
  /** 体力耗尽后的冷却，期间不能冲刺 */
  staminaLock: number;
  reloadTimer: number;
  fireTimer: number;
  /** 射速递增进度 0–1 */
  ramp: number;
}

/** 每帧由输入层写入 */
export interface PlayerInput {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  fire: boolean;
  sprint: boolean;
  /** 边沿触发，逻辑层读取后清零 */
  reload: boolean;
  /** 0 = 无，1–5 = 切到第几把武器（建造模式下是选建筑）；逻辑层读取后清零 */
  select: number;
  /** 边沿触发：E 键修理 */
  use: boolean;
  /** 边沿触发：B 键开关建造模式 */
  toggleBuild: boolean;
  /** 按住：拆除光标处的建筑（右键 / X） */
  sell: boolean;
  /** 边沿触发：Enter，白天提前开始夜晚 */
  confirm: boolean;
}

export interface WeaponSlot {
  owned: boolean;
  tier: number;
  mag: number;
}

/** 卡牌和升级改动的全局系数 */
export interface Mods {
  damage: number;
  crit: number;
  speed: number;
  reload: number;
  staminaUse: number;
  scrap: number;
  /** 建筑生命倍率 */
  structHp: number;
  /** 炮塔 / 地刺伤害倍率 */
  turret: number;
  /** 炮塔射速倍率 */
  turretRate: number;
  /** 受到的伤害倍率（越小越耐打） */
  armor: number;
  /** 每次击杀回复的生命 */
  lifesteal: number;
  /** 发电机每秒回复的生命 */
  coreRegen: number;
}

export interface CoreState {
  x: number;
  z: number;
  rect: WorldRect;
  hp: number;
  maxHp: number;
}

export interface DamageOpts {
  crit?: boolean;
  kx?: number;
  kz?: number;
  /** 命中后点燃的每秒伤害，0 或缺省 = 不点燃 */
  burn?: number;
  /** 不弹伤害数字（灼烧用） */
  silent?: boolean;
}

export interface GameEvents {
  zombieSpawned: Zombie;
  zombieAttack: { zombie: Zombie; target: AttackTarget };
  zombieDied: { zombie: Zombie };
  zombieHit: { zombie: Zombie; amount: number; crit: boolean };
  structureAdded: Structure;
  structureDamaged: { structure: Structure; amount: number };
  structureRemoved: { structure: Structure; destroyed: boolean };
  coreDamaged: { amount: number };
  playerDamaged: { amount: number };
  shot: { kind: WeaponKind; mx: number; mz: number; yaw: number };
  tracer: { kind: WeaponKind; x0: number; z0: number; x1: number; z1: number; hitFlesh: boolean };
  impact: { x: number; z: number; nx: number; nz: number; flesh: boolean; kind: WeaponKind };
  explosion: { x: number; z: number; radius: number; big: boolean };
  acid: { x: number; z: number; radius: number };
  scrap: { x: number; z: number; amount: number };
  reload: { kind: WeaponKind; start: boolean };
  weaponSwitch: { kind: WeaponKind };
  turretShot: { id: number; x0: number; z0: number; x1: number; z1: number };
  spikesHit: { id: number };
  repaired: { x: number; z: number; core: boolean };
  buildMode: { on: boolean };
  phase: { phase: Phase; night: number };
  banner: { text: string; sub: string };
  cardsOffered: { ids: string[] };
  runEnded: { won: boolean; reason: string };
  scrapBox: { index: number; taken: boolean };
  playerDied: { x: number; z: number };
}

export interface ScrapBox {
  cx: number;
  cy: number;
  x: number;
  z: number;
  alive: boolean;
}

export interface GameStats {
  stuckEvents: number;
  unreachableTicks: number;
  attacksOnStructure: number;
  attacksOnCore: number;
  attacksOnPlayer: number;
  structuresDestroyed: number;
  spawned: number;
  kills: number;
}

export class Game {
  readonly rng: Rng;
  readonly map: MapData;
  readonly grid: Grid;
  readonly nav: Navigator;
  readonly events = new Emitter<GameEvents>();

  readonly zombies: Zombie[] = [];
  readonly projectiles: Projectile[] = [];
  readonly structures = new Map<number, Structure>();
  readonly player: PlayerState;
  readonly core: CoreState;
  readonly input: PlayerInput = {
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 0,
    fire: false,
    sprint: false,
    reload: false,
    select: 0,
    use: false,
    toggleBuild: false,
    sell: false,
    confirm: false,
  };
  readonly loadout: Record<WeaponKind, WeaponSlot>;
  readonly mods: Mods = { damage: 1, crit: 0, speed: 1, reload: 1, staminaUse: 1, scrap: 1, structHp: 1, turret: 1, turretRate: 1, armor: 1, lifesteal: 0, coreRegen: 0 };
  readonly run: RunState = newRunState();
  readonly scrapBoxes: ScrapBox[];
  /** 已选卡牌及叠加层数 */
  readonly cardCounts: Record<string, number> = {};
  /** 本局累计获得的零件（不含拆除返还） */
  scrapEarned = 0;

  /** 建造模式 */
  buildMode = false;
  buildKind: StructureKind = 'barricade';
  buildCursor: BuildCursor = { cx: 0, cy: 0, valid: false, reason: 'zone' };
  placeCd = 0;

  /** 零件（唯一货币） */
  scrap = 0;

  /** 模拟用：核心不会被打死 */
  invulnerableCore = false;
  invulnerablePlayer = false;
  /** 仇恨范围倍率（测试用，正常游戏为 1） */
  aggroScale = 1;

  time = 0;
  tick = 0;
  private nextId = 1;

  /** 空间哈希（链表头 / 下一项），僵尸 AI 用 */
  readonly hashHead = new Int32Array(GRID_W * GRID_H);
  readonly hashNext = new Int32Array(MAX_ZOMBIES);

  readonly stats: GameStats = {
    stuckEvents: 0,
    unreachableTicks: 0,
    attacksOnStructure: 0,
    attacksOnCore: 0,
    attacksOnPlayer: 0,
    structuresDestroyed: 0,
    spawned: 0,
    kills: 0,
  };

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.map = buildOutpost();
    this.grid = this.map.grid;
    this.grid.setInflateExempt(this.map.coreCells);
    this.nav = new Navigator(this.grid, this.map.coreCells);
    this.core = {
      x: this.map.corePos.x,
      z: this.map.corePos.z,
      rect: this.map.coreRect,
      hp: 500,
      maxHp: 500,
    };
    this.player = {
      x: this.map.playerStart.x,
      z: this.map.playerStart.z,
      radius: 0.35,
      hp: 100,
      maxHp: 100,
      alive: true,
      yaw: 0,
      vx: 0,
      vz: 0,
      walkPhase: 0,
      sprinting: false,
      weapon: 'pistol',
      tier: 0,
      recoil: 0,
      stamina: 100,
      maxStamina: 100,
      staminaDelay: 0,
      staminaLock: 0,
      reloadTimer: 0,
      fireTimer: 0,
      ramp: 0,
    };
    const lo = {} as Record<WeaponKind, WeaponSlot>;
    for (const k of WEAPON_ORDER) lo[k] = { owned: k === 'pistol', tier: 0, mag: WEAPONS[k].base.mag };
    this.loadout = lo;
    this.scrapBoxes = this.map.scrapBoxes.map((c) => ({ cx: c.cx, cy: c.cy, x: c.cx - HALF_W + 0.5, z: c.cy - HALF_H + 0.5, alive: true }));
    this.input.aimX = this.player.x;
    this.input.aimZ = this.player.z + 5;
    this.nav.update(1, this.player.x, this.player.z, true);
  }

  update(dt: number): void {
    this.time += dt;
    this.tick++;
    updateBuildMode(this, dt);
    updatePlayer(this, dt);
    const pl = this.player;
    pl.walkPhase += Math.hypot(pl.vx, pl.vz) * dt * 2.4;
    pl.recoil = Math.max(0, pl.recoil - dt * 6);
    updateProjectiles(this, dt);
    this.nav.update(dt, this.player.x, this.player.z, this.player.alive);
    stepZombies(this, dt);
    updateStatus(this, dt);
    updateStructures(this, dt);
    updateRun(this, dt);

    // 清理死亡
    let w = 0;
    for (let r = 0; r < this.zombies.length; r++) {
      const z = this.zombies[r]!;
      if (z.alive) this.zombies[w++] = z;
    }
    this.zombies.length = w;
  }

  // ---------------- 僵尸 ----------------

  spawnZombie(kind: ZombieKind, x: number, z: number, hpScale = 1): Zombie | null {
    if (this.zombies.length >= MAX_ZOMBIES) return null;
    const id = this.nextId++;
    const seed = (Math.imul(id, 2654435761) >>> 0) % 100000;
    const zb = new Zombie(id, kind, x, z, hpScale, seed);
    resolveCircleVsGrid(this.grid, zb, zb.radius);
    this.zombies.push(zb);
    this.stats.spawned++;
    this.events.emit('zombieSpawned', zb);
    return zb;
  }

  /** 在某个刷怪点附近找一个空位生成 */
  spawnAtGate(kind: ZombieKind, spawnIndex: number, hpScale = 1): Zombie | null {
    const sp = this.map.spawns[spawnIndex]!;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = sp.x + this.rng.range(-2.2, 2.2);
      const z = sp.z + this.rng.range(-2.2, 2.2);
      if (this.grid.isBlocked(this.grid.cellX(x), this.grid.cellY(z))) continue;
      let clear = true;
      for (const o of this.zombies) {
        if (Math.hypot(o.x - x, o.z - z) < 0.55) {
          clear = false;
          break;
        }
      }
      if (clear) return this.spawnZombie(kind, x, z, hpScale);
    }
    return null;
  }

  /** 返回这次伤害是否击杀 */
  damageZombie(z: Zombie, amount: number, o: DamageOpts = {}): boolean {
    if (!z.alive) return false;
    z.hp -= amount;
    z.hitFlash = 0.09;
    if (o.kx || o.kz) {
      z.kbx += o.kx ?? 0;
      z.kbz += o.kz ?? 0;
    }
    if (o.burn && o.burn > 0) {
      z.burnT = 3;
      z.burnDps = o.burn;
    }
    if (!o.silent) this.events.emit('zombieHit', { zombie: z, amount, crit: !!o.crit });
    if (z.hp > 0) return false;

    z.alive = false;
    this.stats.kills++;
    const reward = Math.round(z.def.reward * this.mods.scrap);
    this.scrap += reward;
    this.scrapEarned += reward;
    if (this.mods.lifesteal > 0 && this.player.alive) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.lifesteal);
    this.events.emit('zombieDied', { zombie: z });
    this.events.emit('scrap', { x: z.x, z: z.z, amount: reward });
    if (z.kind === 'bloater') this.acidBurst(z.x, z.z);
    return true;
  }

  /** 胖子死亡时爆开酸液：伤害范围内的玩家和建筑 */
  private acidBurst(x: number, z: number): void {
    const radius = 2.2;
    this.events.emit('acid', { x, z, radius });
    const p = this.player;
    if (p.alive && Math.hypot(p.x - x, p.z - z) < radius + p.radius) this.damagePlayer(20);
    for (const s of [...this.structures.values()]) {
      const sx = s.cx - HALF_W + 0.5;
      const sz = s.cy - HALF_H + 0.5;
      if (Math.hypot(sx - x, sz - z) < radius + 0.5) this.damageStructure(s.id, 60);
    }
  }

  performZombieAttack(z: Zombie): void {
    z.everAttacked = true;
    const dmg = z.def.damage;
    switch (z.attackTarget) {
      case 'player':
        this.stats.attacksOnPlayer++;
        this.damagePlayer(dmg);
        break;
      case 'core':
        this.stats.attacksOnCore++;
        this.damageCore(dmg);
        break;
      case 'structure':
        this.stats.attacksOnStructure++;
        this.damageStructure(z.targetStructure, dmg * z.def.structMult);
        break;
      default:
        return;
    }
    this.events.emit('zombieAttack', { zombie: z, target: z.attackTarget });
  }

  damageCore(amount: number): void {
    if (!this.invulnerableCore) this.core.hp = Math.max(0, this.core.hp - amount);
    this.events.emit('coreDamaged', { amount });
  }

  damagePlayer(amount: number): void {
    if (!this.player.alive) return;
    const dealt = amount * this.mods.armor;
    if (!this.invulnerablePlayer) {
      this.player.hp = Math.max(0, this.player.hp - dealt);
      if (this.player.hp <= 0) {
        this.player.alive = false;
        this.events.emit('playerDied', { x: this.player.x, z: this.player.z });
      }
    }
    this.events.emit('playerDamaged', { amount: dealt });
  }

  // ---------------- 武器 ----------------

  buyWeapon(kind: WeaponKind): boolean {
    const slot = this.loadout[kind];
    const price = WEAPONS[kind].price;
    if (slot.owned || this.scrap < price) return false;
    this.scrap -= price;
    slot.owned = true;
    slot.tier = 0;
    slot.mag = statsAt(kind, 0).mag;
    return true;
  }

  /** 升到下一级。弹匣变大时，当前弹匣里补上多出来的容量 */
  upgradeWeapon(kind: WeaponKind): boolean {
    const slot = this.loadout[kind];
    if (!slot.owned || slot.tier >= 5) return false;
    const up = WEAPONS[kind].upgrades[slot.tier];
    if (!up || this.scrap < up.cost) return false;
    const before = statsAt(kind, slot.tier);
    this.scrap -= up.cost;
    slot.tier++;
    const after = statsAt(kind, slot.tier);
    slot.mag += Math.max(0, after.mag - before.mag);
    if (this.player.weapon === kind) this.player.tier = slot.tier;
    return true;
  }

  // ---------------- 建筑 ----------------

  /** force = true 时忽略"可建造区域"限制（模拟和调试用） */
  addStructure(kind: StructureKind, cx: number, cy: number, force = false): Structure | null {
    const { grid } = this;
    const def = STRUCTURES[kind];
    if (!grid.inBounds(cx, cy)) return null;
    const i = grid.idx(cx, cy);
    if (!force && !grid.buildable[i]) return null;
    if (grid.solid[i] || grid.structure[i] >= 0 || grid.trap[i] >= 0) return null;
    if (def.blocks) {
      // 不能压在玩家或僵尸身上
      const x0 = cx - HALF_W;
      const z0 = cy - HALF_H;
      const hits = (px: number, pz: number, r: number) => {
        const qx = Math.min(Math.max(px, x0), x0 + 1);
        const qz = Math.min(Math.max(pz, z0), z0 + 1);
        return Math.hypot(px - qx, pz - qz) < r;
      };
      if (this.player.alive && hits(this.player.x, this.player.z, this.player.radius)) return null;
      for (const z of this.zombies) if (z.alive && hits(z.x, z.z, z.radius)) return null;
    }
    // 地刺的"生命"是耐久次数，不吃建筑生命倍率
    const maxHp = kind === 'spikes' ? def.hp : Math.round(def.hp * this.mods.structHp);
    const s: Structure = { id: this.nextId++, kind, def, cx, cy, hp: maxHp, maxHp, aim: Math.PI, cd: 0, sinceShot: 9, target: -1 };
    this.structures.set(s.id, s);
    if (def.blocks) grid.placeBlocking(i, s.id, def.navCost);
    else grid.placeTrap(i, s.id);
    this.events.emit('structureAdded', s);
    return s;
  }

  removeStructure(id: number, destroyed: boolean): void {
    const s = this.structures.get(id);
    if (!s) return;
    this.structures.delete(id);
    const i = this.grid.idx(s.cx, s.cy);
    if (s.def.blocks) this.grid.clearBlocking(i);
    else this.grid.clearTrap(i);
    if (destroyed) this.stats.structuresDestroyed++;
    this.events.emit('structureRemoved', { structure: s, destroyed });
  }

  damageStructure(id: number, amount: number): void {
    const s = this.structures.get(id);
    if (!s) return;
    s.hp -= amount;
    this.events.emit('structureDamaged', { structure: s, amount });
    if (s.hp <= 0) this.removeStructure(id, true);
  }
}
