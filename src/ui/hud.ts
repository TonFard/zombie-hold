import { reactive } from 'vue';
import type { StructureKind } from '../game/data/structures';
import { WEAPON_ORDER, WEAPONS, statsAt, sustainedDps, type WeaponKind } from '../game/data/weapons';
import type { Game } from '../game/sim';
import { reasonText } from '../game/systems/building';
import { HALF_H, HALF_W } from '../game/world/grid';
import type { Phase } from '../game/systems/run';

export interface HurtMark {
  /** 相对当前视线的顺时针角度（弧度，0 = 正前方），每次同步时按攻击者的方位重算 */
  a: number;
  /** 攻击者相对玩家的世界方位（atan2(dx, dz)） */
  world: number;
  life: number;
}

export interface WeaponRow {
  kind: WeaponKind;
  key: number;
  name: string;
  owned: boolean;
  equipped: boolean;
  tier: number;
  price: number;
  dps: number;
  /** 下一级升级（满级为空） */
  nextName: string;
  nextDesc: string;
  nextCost: number;
  /** 买下后（或升级后）的 DPS，用来让玩家看到收益 */
  dpsAfter: number;
  canBuy: boolean;
  canUpgrade: boolean;
  /** 特殊能力标签：穿透、范围、点燃…… */
  specials: string[];
}

const specialsOf = (kind: WeaponKind, tier: number): string[] => {
  const st = statsAt(kind, tier);
  const out: string[] = [];
  if (st.pierce > 0) out.push(`穿透 ${st.pierce}`);
  if (st.aoe > 0) out.push(`范围 ${st.aoe}`);
  if (st.burn > 0) out.push('点燃');
  if (st.ramp > 0) out.push('射速递增');
  if (st.split > 0) out.push('分裂');
  if (st.pellets > 1) out.push(`${st.pellets} 弹丸`);
  return out;
};

/** UI 读取的游戏状态快照。逻辑层不依赖 Vue，由应用层把状态抄进来 */
export const hud = reactive({
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  weaponName: '',
  tier: 0,
  mag: 0,
  magMax: 0,
  /** 换弹进度 0–1，-1 = 没在换弹 */
  reload: -1,
  scrap: 0,
  kills: 0,
  coreHp: 500,
  coreMaxHp: 500,
  /** 受伤红屏 0–1 */
  hurt: 0,
  /** 鼠标是否已锁定；没锁定时提示玩家点一下画面 */
  locked: true,
  /** 命中标记 0–1（打中僵尸）、击杀标记 0–1、是否暴击 */
  hit: 0,
  hitCrit: false,
  kill: 0,
  /** 发电机刚被打，0–1 */
  coreHurt: 0,
  /** 受击方向：a 是相对视线的顺时针角度（弧度，0 = 正前方），life 1→0 */
  hurtMarks: [] as HurtMark[],
  /** 准星张开程度（像素） */
  spread: 14,
  alive: true,
  phase: 'menu' as Phase,
  night: 1,
  /** 这一夜还没打死的敌人（含没刷出来的） */
  remaining: 0,
  total: 0,
  dayTimer: 0,
  benchNear: false,
  benchDist: 99,
  bossName: '',
  bossHp: 0,
  bossMax: 1,
  weapons: [] as WeaponRow[],
  buildMode: false,
  buildKind: 'barricade' as StructureKind,
  /** 光标处不能建的原因；空串 = 可以建 */
  buildMsg: '',
  buildOk: false,
});

let lastHp = 100;

/** 雷达用的快照。数据量大且每帧变，所以不放进 reactive，由雷达组件自己用 canvas 读取绘制 */
export const radar = {
  px: 0,
  pz: 0,
  /** 玩家朝向（0 = 面向 +Z） */
  yaw: 0,
  /** 僵尸：每 3 个数一组 [x, z, 种类编号] */
  zombies: [] as number[],
  /** 建筑：每 3 个数一组 [x, z, 种类编号] */
  structs: [] as number[],
  /** 还没捡的零件箱：每 2 个数一组 [x, z] */
  boxes: [] as number[],
  coreX: 0,
  coreZ: 0,
  benchX: 0,
  benchZ: 0,
  /** 地形阻挡（引用逻辑层的格子数组，只读） */
  solid: null as Uint8Array | null,
};

const ZOMBIE_CODE: Record<string, number> = { walker: 0, runner: 1, bloater: 2, breaker: 3, colossus: 4 };
const STRUCT_CODE: Record<string, number> = { barricade: 0, turret: 1, spikes: 2 };

export function syncHud(game: Game, dt: number, input: { locked: boolean; yaw: number }): void {
  const p = game.player;
  // ---- 雷达快照 ----
  radar.px = p.x;
  radar.pz = p.z;
  radar.yaw = input.yaw;
  radar.coreX = game.core.x;
  radar.coreZ = game.core.z;
  radar.benchX = game.map.workbench.x;
  radar.benchZ = game.map.workbench.z;
  radar.solid = game.grid.solid;
  radar.zombies.length = 0;
  for (const z of game.zombies) if (z.alive) radar.zombies.push(z.x, z.z, ZOMBIE_CODE[z.kind] ?? 0);
  radar.structs.length = 0;
  for (const s of game.structures.values()) radar.structs.push(s.cx - HALF_W + 0.5, s.cy - HALF_H + 0.5, STRUCT_CODE[s.kind] ?? 0);
  radar.boxes.length = 0;
  for (const b of game.scrapBoxes) if (b.alive) radar.boxes.push(b.x, b.z);

  // ---- 命中标记、受击方向的衰减 ----
  hud.hit = Math.max(0, hud.hit - dt * 7);
  hud.kill = Math.max(0, hud.kill - dt * 3.2);
  hud.coreHurt = Math.max(0, hud.coreHurt - dt * 1.6);
  for (let i = hud.hurtMarks.length - 1; i >= 0; i--) {
    const m = hud.hurtMarks[i] as HurtMark;
    m.life -= dt * 0.8;
    if (m.life <= 0) {
      hud.hurtMarks.splice(i, 1);
      continue;
    }
    // 玩家转头时，指示跟着攻击者的方位走。yaw 变小是向右转，所以右边的敌人 world - yaw < 0，屏幕角度取反
    let rel = m.world - input.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    m.a = -rel;
  }
  const st = statsAt(p.weapon, p.tier);
  const slot = game.loadout[p.weapon];
  hud.hp = Math.ceil(p.hp);
  hud.maxHp = p.maxHp;
  hud.stamina = p.stamina;
  hud.maxStamina = p.maxStamina;
  hud.weaponName = WEAPONS[p.weapon].name;
  hud.tier = p.tier;
  hud.mag = slot.mag;
  hud.magMax = st.mag;
  hud.reload = p.reloadTimer > 0 ? 1 - p.reloadTimer / st.reload : -1;
  hud.scrap = game.scrap;
  hud.kills = game.stats.kills;
  hud.coreHp = Math.ceil(game.core.hp);
  hud.coreMaxHp = game.core.maxHp;
  hud.alive = p.alive;
  if (p.hp < lastHp - 0.01) hud.hurt = Math.min(1, hud.hurt + (lastHp - p.hp) / 25);
  lastHp = p.hp;
  hud.hurt = Math.max(0, hud.hurt - dt * 1.8);
  hud.locked = input.locked;
  // 准星随散布和后坐力张开
  hud.spread = 10 + st.spread * 2.2 + p.recoil * 10 + (p.sprinting ? 8 : 0);
  const run = game.run;
  hud.phase = run.phase;
  hud.night = run.night;
  hud.total = run.total;
  hud.remaining = run.phase === 'night' ? run.toSpawn + game.zombies.length : 0;
  hud.dayTimer = Math.max(0, run.timer);
  const wb = game.map.workbench;
  hud.benchDist = Math.hypot(p.x - wb.x, p.z - wb.z);
  hud.benchNear = run.phase === 'day' && hud.benchDist < 3.8;
  const boss = game.zombies.find((z) => z.alive && z.kind === 'colossus');
  hud.bossName = boss ? (run.night >= 10 ? '巨像·终焉' : '巨像·初代') : '';
  hud.bossHp = boss ? boss.hp : 0;
  hud.bossMax = boss ? boss.maxHp : 1;

  // 工坊：每把武器的购买 / 升级信息。只在工坊相关阶段刷新，省一点开销
  if (run.phase === 'day' || hud.weapons.length === 0) {
    hud.weapons = WEAPON_ORDER.map((k, i) => {
      const slot = game.loadout[k];
      const def = WEAPONS[k];
      const up = slot.tier < 5 ? def.upgrades[slot.tier] : undefined;
      const dps = sustainedDps(statsAt(k, slot.tier));
      return {
        kind: k,
        key: i + 1,
        name: def.name,
        owned: slot.owned,
        equipped: p.weapon === k,
        tier: slot.tier,
        price: def.price,
        dps,
        nextName: up?.name ?? '',
        nextDesc: up?.desc ?? '',
        nextCost: up?.cost ?? 0,
        dpsAfter: slot.owned ? (up ? sustainedDps(statsAt(k, slot.tier + 1)) : dps) : sustainedDps(statsAt(k, 1)),
        canBuy: !slot.owned && game.scrap >= def.price,
        canUpgrade: slot.owned && !!up && game.scrap >= up.cost,
        specials: specialsOf(k, slot.owned ? slot.tier : 5),
      };
    });
  }
  hud.buildMode = game.buildMode;
  hud.buildKind = game.buildKind;
  hud.buildOk = game.buildCursor.valid;
  hud.buildMsg = reasonText(game.buildCursor.reason);
}
