import { sandboxConfig, type RunConfig } from './config';
import { Emitter } from './core/events';
import { Rng } from './core/rng';
import { STRUCTURES, isTurret, type StructureKind } from './data/structures';
import { EYE_HEIGHT } from './data/ballistics';
import { COMBO_WINDOW, ELITE_REWARD, FLASHLIGHT, comboMult } from './data/modifiers';
import { MAX_TIER, WEAPON_ORDER, WEAPONS, statsAt, type WeaponKind } from './data/weapons';

/** 正式局最多随身带几把枪（滚轮切换） */
export const CARRY_MAX = 2;
import type { ZombieKind } from './data/zombies';
import type { Bullet } from './entities/bullet';
import type { Projectile } from './entities/projectile';
import type { Structure } from './entities/structure';
import { Zombie, type AttackTarget } from './entities/zombie';
import { Navigator } from './nav/navigator';
import { updateBuildMode, updateStructures, type BuildCursor } from './systems/building';
import { updateBullets, updateProjectiles, updateStatus } from './systems/combat';
import { newAirdrop, updateAirdrop, type AirdropState } from './systems/airdrop';
import { newHazards, updateHazards, type HazardState } from './systems/hazards';
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
  /** 瞄准进度 0（腰射）–1（完全举镜），按武器的 adsTime 线性推进 */
  ads: number;
  /** 这次换弹的总时长（战术换弹比打空换弹快） */
  reloadTotal: number;
  /** 蹲伏程度 0–1（平滑过渡），眼睛高度随之降低 */
  crouch: number;
  crouchHeld: boolean;
  /** 眼睛离地高度（米），子弹从这里出膛 */
  eye: number;
  /** 滑铲剩余时间、冷却、方向 */
  slide: number;
  slideCd: number;
  slideDirX: number;
  slideDirZ: number;
  /** 冲刺结束后的抬枪时间，期间不能开火 */
  sprintOut: number;
  /** 近战剩余时间，> 0 时不能开火 */
  meleeTimer: number;
  /** 后坐力把视线抬起来的量（弧度），开火时累加、松开扳机后回落；子弹和相机都会加上它 */
  kickPitch: number;
  kickYaw: number;
}

/** 每帧由输入层写入 */
export interface PlayerInput {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  /** 视线俯仰角（弧度，抬头为正）。子弹按它飞，决定打头还是打身体 */
  aimPitch: number;
  /** 按住右键瞄准 */
  ads: boolean;
  /** 按住 Ctrl / C 蹲下；冲刺中按下 = 滑铲 */
  crouch: boolean;
  /** 边沿触发：V 近战 */
  melee: boolean;
  fire: boolean;
  sprint: boolean;
  /** 边沿触发，逻辑层读取后清零 */
  reload: boolean;
  /** 0 = 无，1–5 = 切到第几把武器（建造模式下是选建筑）；逻辑层读取后清零 */
  select: number;
  /** 边沿触发：滚轮切到下一把 / 上一把（+1 / -1；建造模式下切建筑）；逻辑层读取后清零 */
  cycle: number;
  /** 边沿触发：E 键交互（修理附近的建筑 / 发电机；靠近工坊时由应用层打开工坊） */
  use: boolean;
  /** 边沿触发：F 键开关建造模式 */
  toggleBuild: boolean;
  /** 按住：拆除光标处的建筑（右键 / X） */
  sell: boolean;
  /** 边沿触发：Enter，白天提前开始夜晚 */
  confirm: boolean;
  /** 边沿触发：G 扔手雷、Q 发电机电击脉冲 */
  grenade: boolean;
  pulse: boolean;
  /** T 键开关的手电筒（状态，不是边沿） */
  flashlight: boolean;
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
  /** 爆头加成（倍率超出 1 的那部分）的倍数（卡牌「弱点打击」） */
  head: number;
  /** 瞄准时散布的额外倍率（卡牌，越小越准） */
  adsSpread: number;
  /** 射速倍率（局外「射击训练」） */
  fireRate: number;
  /** 脱战后每秒回复的玩家生命（局外「急救训练」） */
  regen: number;
  /** 卡牌「连锁反应」：击杀时在尸体处小爆炸的伤害（0 = 没有） */
  chainBlast: number;
  /** 卡牌「战意」：连杀每 +1，武器伤害额外 +这么多（最多 10 连） */
  comboDamage: number;
  /** 卡牌「弹匣回收」：爆头击杀返还几发子弹（所有武器） */
  headRefund: number;
  /** 卡牌「近身狂暴」：3 米内的僵尸受到的武器伤害倍率 */
  closeDamage: number;
  /** 卡牌「推搡专家」：推搡冷却倍率 */
  shoveCd: number;
  /** 卡牌「爆破专家」：手雷每天多补几颗 */
  extraFrags: number;
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
  /** 打中的是头 */
  head?: boolean;
  /** 连锁爆炸造成的伤害（击杀不会再触发连锁） */
  chain?: boolean;
}

export interface GameEvents {
  zombieSpawned: Zombie;
  zombieAttack: { zombie: Zombie; target: AttackTarget };
  zombieDied: { zombie: Zombie; head: boolean };
  zombieHit: { zombie: Zombie; amount: number; crit: boolean; head: boolean };
  structureAdded: Structure;
  structureDamaged: { structure: Structure; amount: number };
  structureRemoved: { structure: Structure; destroyed: boolean };
  coreDamaged: { amount: number };
  playerDamaged: { amount: number };
  shot: { kind: WeaponKind; mx: number; mz: number; yaw: number };
  /** 爆头击杀返还子弹（狙击招牌） */
  refund: { kind: WeaponKind; amount: number };
  slide: Record<string, never>;
  meleeSwing: Record<string, never>;
  meleeHit: { zombie: Zombie | null; x: number; y: number; z: number };
  /** 子弹命中：flesh = 打在僵尸身上；zone 区分头 / 身体 / 墙 / 地面。y 是命中点离地高度 */
  impact: { x: number; y: number; z: number; nx: number; nz: number; flesh: boolean; zone: 'head' | 'body' | 'wall' | 'ground'; kind: WeaponKind };
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
  /** silent = 读档时恢复已经炸掉的状态，不放特效 */
  propExploded: { index: number; x: number; z: number; silent?: boolean };
  grenadeThrown: { fire: boolean };
  shove: { hits: number };
  pulse: { stage: 'charge' | 'fire'; x: number; z: number; radius: number };
  spit: { x: number; z: number };
  scream: { x: number; z: number; radius: number };
  chainBlast: { x: number; z: number };
  combo: { count: number; mult: number };
  challenge: { id: string; done: boolean };
  airdrop: { stage: 'land' | 'taken' | 'gone'; x: number; z: number };
  bossCharge: { id: number; stage: 'windup' | 'go' | 'stun'; x: number; z: number; dx: number; dz: number; len: number };
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
  /** 打中头的次数 / 爆头击杀数 */
  headshots: number;
  headshotKills: number;
  /** 完成的夜间挑战数（结算勋章用） */
  challenges: number;
  /** 最高连杀 */
  bestCombo: number;
}

export class Game {
  readonly rng: Rng;
  readonly map: MapData;
  readonly grid: Grid;
  readonly nav: Navigator;
  readonly events = new Emitter<GameEvents>();

  readonly zombies: Zombie[] = [];
  readonly projectiles: Projectile[] = [];
  /** 空中飞行的子弹（枪械走弹道，榴弹仍是 projectiles） */
  readonly bullets: Bullet[] = [];
  readonly structures = new Map<number, Structure>();
  readonly player: PlayerState;
  readonly core: CoreState;
  readonly input: PlayerInput = {
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 0,
    aimPitch: 0,
    ads: false,
    crouch: false,
    melee: false,
    fire: false,
    sprint: false,
    reload: false,
    select: 0,
    cycle: 0,
    use: false,
    toggleBuild: false,
    sell: false,
    confirm: false,
    grenade: false,
    pulse: false,
    flashlight: false,
  };
  readonly loadout: Record<WeaponKind, WeaponSlot>;
  readonly mods: Mods = { damage: 1, crit: 0, speed: 1, reload: 1, staminaUse: 1, scrap: 1, structHp: 1, turret: 1, turretRate: 1, armor: 1, lifesteal: 0, coreRegen: 0, head: 1, adsSpread: 1, fireRate: 1, regen: 0, chainBlast: 0, comboDamage: 0, headRefund: 0, closeDamage: 1, shoveCd: 1, extraFrags: 0 };
  readonly run: RunState = newRunState();
  /** 这一局的规则（难度、局外成长带来的解锁和上限）；默认是什么都不限制的沙盒 */
  config: RunConfig = sandboxConfig();
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
  /** 手电筒：剩余电量（秒），松开后充能；开着时僵尸更容易发现你 */
  battery = FLASHLIGHT.battery;
  flashOn = false;

  time = 0;
  tick = 0;
  /** 下一个实体 id（僵尸和建筑共用；检查点会保存它，保证读档后生成的僵尸和原来一样） */
  nextId = 1;
  /** 子弹 id（渲染层用它对应曳光）；放在 Game 上而不是模块里，几局同时存在时互不影响 */
  nextBulletId = 1;

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
    headshots: 0,
    headshotKills: 0,
    challenges: 0,
    bestCombo: 0,
  };
  /** 爆炸物、危险区、手雷、推搡、电击脉冲（M12） */
  readonly hz: HazardState = newHazards();
  /** 白天的空投补给（M13） */
  readonly airdrop: AirdropState = newAirdrop();
  /** 连杀：数量和距离上一次击杀的时间 */
  combo = 0;
  /** 这一帧要结算的「连锁反应」爆炸（击杀时登记，下一帧统一炸，避免在伤害结算里递归） */
  chainBlasts: Array<{ x: number; z: number }> = [];
  comboT = 0;
  /** 距离上次受伤的秒数（自动回血用） */
  hurtT = 99;

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
      ads: 0,
      reloadTotal: 1,
      crouch: 0,
      crouchHeld: false,
      eye: EYE_HEIGHT,
      slide: 0,
      slideCd: 0,
      slideDirX: 0,
      slideDirZ: 0,
      sprintOut: 0,
      meleeTimer: 0,
      kickPitch: 0,
      kickYaw: 0,
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
    if (this.comboT > 0) this.comboT = Math.max(0, this.comboT - dt);
    // 上一帧登记的连锁爆炸：半径 2.2 米，只伤僵尸
    if (this.chainBlasts.length) {
      const list = this.chainBlasts.splice(0);
      for (const c of list) {
        this.events.emit('chainBlast', { x: c.x, z: c.z });
        for (const z of this.zombies) {
          if (!z.alive) continue;
          const d = Math.hypot(z.x - c.x, z.z - c.z);
          if (d < 2.2 + z.radius) this.damageZombie(z, this.mods.chainBlast * (1 - 0.5 * Math.min(1, d / 2.2)), { chain: true });
        }
      }
    }
    // 手电筒：开着耗电，耗尽自动关；关着时充电
    const wantLight = this.input.flashlight && this.config.extras && this.player.alive;
    if (wantLight && this.battery > 0) {
      this.flashOn = true;
      this.battery = Math.max(0, this.battery - dt);
      if (this.battery <= 0) this.input.flashlight = false;
    } else {
      this.flashOn = false;
      this.battery = Math.min(FLASHLIGHT.battery, this.battery + dt * FLASHLIGHT.recharge);
    }
    updateBuildMode(this, dt);
    updatePlayer(this, dt);
    const pl = this.player;
    pl.walkPhase += Math.hypot(pl.vx, pl.vz) * dt * 2.4;
    pl.recoil = Math.max(0, pl.recoil - dt * 6);
    // 后坐力回落：松开扳机（或两发之间）视线慢慢回到原位
    const back = Math.exp(-(this.input.fire ? 3.5 : 9) * dt);
    pl.kickPitch *= back;
    pl.kickYaw *= back;
    updateProjectiles(this, dt);
    updateBullets(this, dt);
    this.nav.update(dt, this.player.x, this.player.z, this.player.alive);
    stepZombies(this, dt);
    updateStatus(this, dt);
    if (this.config.extras) {
      updateHazards(this, dt);
      updateAirdrop(this, dt);
    }
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
    const head = !!o.head;
    if (head) this.stats.headshots++;
    if (!o.silent) this.events.emit('zombieHit', { zombie: z, amount, crit: !!o.crit, head });
    if (z.hp > 0) return false;

    z.alive = false;
    this.stats.kills++;
    if (head) this.stats.headshotKills++;
    // 连杀：3 秒内的连续击杀累计倍率（M12，沙盒里关掉）
    let comboK = 1;
    if (this.config.extras) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = COMBO_WINDOW;
      comboK = comboMult(this.combo);
      if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
      if (this.combo >= 3) this.events.emit('combo', { count: this.combo, mult: comboK });
    }
    const reward = Math.round(z.def.reward * (z.elite ? ELITE_REWARD : 1) * this.mods.scrap * this.run.modScrap * comboK);
    this.scrap += reward;
    this.scrapEarned += reward;
    if (this.mods.lifesteal > 0 && this.player.alive) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.lifesteal);
    this.events.emit('zombieDied', { zombie: z, head });
    this.events.emit('scrap', { x: z.x, z: z.z, amount: reward });
    if (z.kind === 'bloater') this.acidBurst(z.x, z.z);
    // 卡牌「连锁反应」：武器击杀（不是爆炸本身造成的）在尸体处炸一下，可以连锁
    if (this.mods.chainBlast > 0 && !o.chain) this.chainBlasts.push({ x: z.x, z: z.z });
    return true;
  }

  /** 胖子死亡时爆开酸液：伤害范围内的玩家和建筑。M12 起范围加大（沙盒保持原值，旧的 sim 结果不变） */
  private acidBurst(x: number, z: number): void {
    const radius = this.config.extras ? 3.4 : 2.2;
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
    const dmg = z.def.damage * this.config.zombieDamage;
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
    this.hurtT = 0;
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

  /** 身上的枪（按武器顺序） */
  carried(): WeaponKind[] {
    return WEAPON_ORDER.filter((k) => this.loadout[k].owned);
  }

  /** 工坊里这把枪能不能买：逻辑和界面都用这一个判断，免得两边对不上 */
  buyState(kind: WeaponKind): 'owned' | 'locked' | 'scrap' | 'ok' {
    if (this.loadout[kind].owned) return 'owned';
    if (!this.config.weapons.includes(kind)) return 'locked';
    if (this.scrap < WEAPONS[kind].price) return 'scrap';
    return 'ok';
  }

  /**
   * 买枪。正式局（extras）最多带两把：已经有两把时，买新枪会换掉手里的那把（手里的就是要扔的），
   * 被换掉的枪等级清零、不退零件
   */
  buyWeapon(kind: WeaponKind): boolean {
    const slot = this.loadout[kind];
    const price = WEAPONS[kind].price;
    if (this.buyState(kind) !== 'ok') return false;
    this.scrap -= price;
    let dropped: WeaponKind | null = null;
    if (this.config.extras && this.carried().length >= CARRY_MAX) {
      dropped = this.player.weapon;
      const old = this.loadout[dropped];
      old.owned = false;
      old.tier = 0;
      old.mag = 0;
    }
    slot.owned = true;
    slot.tier = 0;
    slot.mag = statsAt(kind, 0).mag;
    if (dropped) {
      // 换下来的那把在手上：直接拿新枪
      this.player.weapon = kind;
      this.player.tier = 0;
      this.player.reloadTimer = 0;
      this.player.ads = 0;
      this.events.emit('weaponSwitch', { kind });
    }
    return true;
  }

  /** 升到下一级。弹匣变大时，当前弹匣里补上多出来的容量 */
  upgradeWeapon(kind: WeaponKind): boolean {
    const slot = this.loadout[kind];
    if (!slot.owned || slot.tier >= Math.min(MAX_TIER, this.config.tierCap[kind])) return false;
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

  /** 已经建了几座炮塔（所有类型合计） */
  turretCount(): number {
    let n = 0;
    for (const s of this.structures.values()) if (isTurret(s.kind)) n++;
    return n;
  }

  /** 读档用：原样放回一座建筑（不检查规则、不扣零件） */
  restoreStructure(s: Structure): void {
    this.structures.set(s.id, s);
    const i = this.grid.idx(s.cx, s.cy);
    if (s.def.blocks) this.grid.placeBlocking(i, s.id, s.def.navCost);
    else this.grid.placeTrap(i, s.id);
    this.events.emit('structureAdded', s);
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
