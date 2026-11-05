// 战斗验证：npm run sim:combat
// 让实测伤害去对账平衡表，并验证穿透、墙体阻挡、范围伤害、灼烧、换弹、买枪升级等逻辑。
import { MAX_TIER, WEAPON_ORDER, WEAPONS, statsAt, sustainedDps, type WeaponKind } from '../../src/game/data/weapons';
import { Game, STEP } from '../../src/game/sim';
import { bulletHeightAt } from '../../src/game/data/ballistics';
import { CROUCH_EYE } from '../../src/game/systems/player';
import { MELEE_DAMAGE } from '../../src/game/systems/combat';
import type { Zombie } from '../../src/game/entities/zombie';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const PX = -8;
const PZ = 6;
/** 略微下压：子弹在 2.5–5 m 处约 1.1–1.35 m 高，打在胸口而不是头 */
const CHEST = -0.1;

function fresh(): Game {
  const g = new Game(5);
  g.invulnerablePlayer = true;
  g.invulnerableCore = true;
  g.aggroScale = 0;
  g.player.x = PX;
  g.player.z = PZ;
  return g;
}

/** 让僵尸原地不动（只测伤害，不测 AI） */
function pin(z: Zombie, x: number, zz: number): void {
  z.x = x;
  z.z = zz;
  z.vx = z.vz = 0;
  z.kbx = z.kbz = 0;
}

function setWeapon(g: Game, kind: WeaponKind, tier: number): void {
  const slot = g.loadout[kind];
  slot.owned = true;
  slot.tier = tier;
  slot.mag = statsAt(kind, tier).mag;
  g.player.weapon = kind;
  g.player.tier = tier;
  g.player.reloadTimer = 0;
  g.player.fireTimer = 0;
  g.player.ramp = 0;
}

// ------------------------------------------------------------------
console.log('\n== 实测 DPS 对账（对一个不动的巨像连射，含换弹）==');
console.log('  武器          等级  公式DPS  实测DPS  比值');
for (const kind of WEAPON_ORDER) {
  for (let tier = 0; tier <= MAX_TIER; tier++) {
    const g = fresh();
    setWeapon(g, kind, tier);
    const st = statsAt(kind, tier);
    const target = g.spawnZombie('colossus', PX + 2.6, PZ, 1e6) as Zombie;
    g.input.aimX = PX + 10;
    g.input.aimZ = PZ;
    g.input.fire = true;

    let dmg = 0;
    g.events.on('zombieHit', (e) => {
      if (e.zombie === target) dmg += e.amount;
    });
    const cycle = st.mag / st.rate + st.reload;
    const cycles = Math.max(2, Math.round(100 / cycle));
    const total = Math.round((cycles * cycle) / STEP);
    for (let t = 0; t < total; t++) {
      g.update(STEP);
      pin(target, PX + 2.6, PZ);
    }
    const measured = dmg / (cycles * cycle);
    const formula = sustainedDps(st);
    const ratio = measured / formula;
    console.log(`  ${WEAPONS[kind].name.padEnd(10, '　')}  ${tier}    ${formula.toFixed(1).padStart(6)}   ${measured.toFixed(1).padStart(6)}   ${ratio.toFixed(3)}`);
    // 有射速递增 / 爆炸分裂的版本，实测应不低于公式；其余必须在 3% 以内
    const extra = st.ramp > 0 || st.split > 0;
    check(extra ? ratio >= 0.97 : Math.abs(ratio - 1) <= 0.03, `${WEAPONS[kind].name} ${tier} 级：实测 / 公式 = ${ratio.toFixed(3)}${extra ? '（含递增 / 分裂，应 ≥ 0.97）' : '（应在 ±3% 内）'}`);
  }
}

// ------------------------------------------------------------------
console.log('\n== 手枪满级 vs 其他武器升 1 级：实测对比 ==');
{
  const measure = (kind: WeaponKind, tier: number): number => {
    const g = fresh();
    setWeapon(g, kind, tier);
    const st = statsAt(kind, tier);
    const target = g.spawnZombie('colossus', PX + 2.6, PZ, 1e6) as Zombie;
    g.input.aimX = PX + 10;
    g.input.aimZ = PZ;
    g.input.fire = true;
    let dmg = 0;
    g.events.on('zombieHit', (e) => {
      if (e.zombie === target) dmg += e.amount;
    });
    const cycle = st.mag / st.rate + st.reload;
    const cycles = Math.max(2, Math.round(100 / cycle));
    for (let t = 0; t < Math.round((cycles * cycle) / STEP); t++) {
      g.update(STEP);
      pin(target, PX + 2.6, PZ);
    }
    return dmg / (cycles * cycle);
  };
  const pistolMax = measure('pistol', 5);
  for (const k of WEAPON_ORDER.filter((x) => x !== 'pistol')) {
    const v = measure(k, 1);
    check(v > pistolMax, `实测：${WEAPONS[k].name} 升 1 级（${v.toFixed(1)}）> 满级手枪（${pistolMax.toFixed(1)}）`);
  }
}

// ------------------------------------------------------------------
console.log('\n== 穿透 ==');
{
  const g = fresh();
  setWeapon(g, 'rifle', 3); // 穿透 2，伤害 30
  const zs = [2.5, 3.6, 4.7, 5.8].map((d) => g.spawnZombie('walker', PX + d, PZ, 1) as Zombie);
  g.input.aimX = PX + 10;
  g.input.aimZ = PZ;
  g.input.aimPitch = CHEST; // 瞄胸口，避免爆头倍率干扰
  g.input.fire = true;
  g.update(STEP);
  g.input.fire = false;
  const hp = zs.map((z) => z.hp);
  check(hp[0] === 30 && hp[1] === 30 && hp[2] === 30, `穿透 2：前 3 个都被打中（剩余生命 ${hp.slice(0, 3).join(', ')}）`);
  check(hp[3] === 60, `第 4 个没被打中（剩余生命 ${hp[3]}）`);

  const g2 = fresh();
  setWeapon(g2, 'pistol', 0);
  const zs2 = [2.5, 3.6].map((d) => g2.spawnZombie('walker', PX + d, PZ, 1) as Zombie);
  g2.input.aimX = PX + 10;
  g2.input.aimZ = PZ;
  g2.input.aimPitch = CHEST;
  g2.input.fire = true;
  g2.update(STEP);
  check((zs2[0] as Zombie).hp === 40 && (zs2[1] as Zombie).hp === 60, '手枪不穿透：只打中第一个');
}

console.log('\n== 墙体阻挡 ==');
{
  const g = fresh();
  g.player.x = 10;
  g.player.z = 11; // 南墙在 z=13 (格 y=53)，墙外 z=14.5
  setWeapon(g, 'rifle', 0);
  const behind = g.spawnZombie('walker', 10, 14.6, 1) as Zombie;
  g.input.aimX = 10;
  g.input.aimZ = 20;
  g.input.fire = true;
  let wallImpact = false;
  g.events.on('impact', (e) => {
    if (!e.flesh) wallImpact = true;
  });
  for (let i = 0; i < 20; i++) {
    g.update(STEP);
    pin(behind, 10, 14.6);
  }
  check(behind.hp === 60, `墙后的僵尸没有被打中（生命 ${behind.hp}）`);
  check(wallImpact, '子弹在墙上产生了命中事件');
}

console.log('\n== 榴弹范围伤害 ==');
{
  const g = fresh();
  setWeapon(g, 'launcher', 0); // 伤害 120，半径 2.2
  const center = g.spawnZombie('colossus', PX + 6, PZ, 1e6) as Zombie;
  const near = g.spawnZombie('walker', PX + 6, PZ + 1.6, 100) as Zombie;
  const far = g.spawnZombie('walker', PX + 6, PZ + 6, 100) as Zombie;
  const nearHp = near.hp;
  g.input.aimX = PX + 20;
  g.input.aimZ = PZ;
  g.input.fire = true;
  for (let i = 0; i < 60; i++) {
    g.update(STEP);
    g.input.fire = false;
    pin(center, PX + 6, PZ);
    pin(near, PX + 6, PZ + 1.6);
    pin(far, PX + 6, PZ + 6);
  }
  check(center.hp < center.maxHp - 100, `直击目标吃满伤害（掉了 ${(center.maxHp - center.hp).toFixed(0)}）`);
  check(near.hp < nearHp && nearHp - near.hp < 120, `爆炸范围内的目标受到衰减后的伤害（掉了 ${(nearHp - near.hp).toFixed(0)}）`);
  check(far.hp === far.maxHp, '爆炸范围外的目标毫发无伤');
}

console.log('\n== 灼烧（龙息弹）==');
{
  const g = fresh();
  setWeapon(g, 'shotgun', 5);
  const z = g.spawnZombie('colossus', PX + 2.6, PZ, 1e6) as Zombie;
  g.input.aimX = PX + 10;
  g.input.aimZ = PZ;
  g.input.fire = true;
  g.update(STEP);
  g.input.fire = false;
  pin(z, PX + 2.6, PZ);
  const hpAfterHit = z.hp;
  check(z.burnT > 0, '命中后点燃');
  for (let i = 0; i < 4 * 60; i++) {
    g.update(STEP);
    pin(z, PX + 2.6, PZ);
  }
  const burned = hpAfterHit - z.hp;
  check(Math.abs(burned - 36) < 3, `灼烧 3 秒共约 36 点伤害（实际 ${burned.toFixed(1)}）`);
  check(z.burnT <= 0, '3 秒后火熄灭');
}

console.log('\n== 换弹与切枪 ==');
{
  const g = fresh();
  setWeapon(g, 'pistol', 0);
  const log: string[] = [];
  g.events.on('reload', (e) => log.push(e.start ? 'start' : 'done'));
  g.input.aimX = PX + 10;
  g.input.aimZ = PZ;
  g.input.fire = true;
  for (let i = 0; i < 6 * 60; i++) g.update(STEP);
  check(log.includes('start') && log.includes('done'), `打空后自动换弹并完成（${log.slice(0, 4).join(' → ')}）`);

  const g2 = fresh();
  setWeapon(g2, 'pistol', 0);
  g2.loadout.smg.owned = true;
  g2.loadout.smg.mag = 36;
  g2.input.reload = true;
  g2.loadout.pistol.mag = 3;
  g2.update(STEP);
  check(g2.player.reloadTimer > 0, '手动换弹开始');
  g2.input.select = 2;
  g2.update(STEP);
  check(g2.player.weapon === 'smg' && g2.player.reloadTimer === 0, '切枪会打断换弹');
  g2.input.select = 3; // 没买霰弹枪
  g2.update(STEP);
  check(g2.player.weapon === 'smg', '没买的武器切不过去');
}

console.log('\n== 买枪与升级 ==');
{
  const g = fresh();
  check(!g.buyWeapon('smg'), '零件不够时买不了冲锋枪');
  g.scrap = 1000;
  check(g.buyWeapon('smg') && g.scrap === 650, `买冲锋枪扣 350（剩 ${g.scrap}）`);
  check(!g.buyWeapon('smg'), '不能重复购买');
  const magBefore = g.loadout.smg.mag;
  check(g.upgradeWeapon('smg') && g.loadout.smg.tier === 1, '升到 1 级');
  check(g.upgradeWeapon('smg') && g.loadout.smg.mag === magBefore + 12, `升到 2 级时弹匣 36→48，当前弹匣补上 12（${g.loadout.smg.mag}）`);
  g.scrap = 100000;
  for (let i = 0; i < 10; i++) g.upgradeWeapon('pistol');
  check(g.loadout.pistol.tier === MAX_TIER, `手枪最多升到 ${MAX_TIER} 级`);
  check(!g.upgradeWeapon('pistol'), '满级后不能再升');
}

console.log('\n== 击杀奖励与胖子酸液 ==');
{
  const g = fresh();
  const w = g.spawnZombie('walker', 0, 0, 1) as Zombie;
  g.damageZombie(w, 9999);
  check(g.scrap === 3 && g.stats.kills === 1, `击杀行尸得 3 零件（${g.scrap}）`);

  const g2 = fresh();
  g2.invulnerablePlayer = false;
  g2.player.x = 0;
  g2.player.z = 0;
  const b = g2.spawnZombie('bloater', 1.0, 0, 1) as Zombie;
  g2.damageZombie(b, 99999);
  check(g2.player.hp === 80, `胖子死在身边，玩家被酸液烫 20 点（生命 ${g2.player.hp}）`);

  const g3 = fresh();
  g3.invulnerablePlayer = false;
  g3.player.x = 0;
  g3.player.z = 0;
  const b2 = g3.spawnZombie('bloater', 8, 0, 1) as Zombie;
  g3.damageZombie(b2, 99999);
  check(g3.player.hp === 100, '胖子死在远处，玩家不受影响');
}

// ------------------------------------------------------------------ M6：弹道、爆头、瞄准、动作
// 一条开阔的射击通道：从 (-8, 0.5) 朝 +X 方向 40 米内没有障碍
const LX = -8;
const LZ = 0.5;
function lane(kind: WeaponKind, tier = 0): Game {
  const g = fresh();
  g.player.x = LX;
  g.player.z = LZ;
  setWeapon(g, kind, tier);
  g.input.aimX = LX + 50;
  g.input.aimZ = LZ;
  return g;
}
/** 让子弹在 d 米处飞到高度 y 需要的视线俯仰角（在归零弹道上叠加） */
const pitchFor = (kind: WeaponKind, d: number, y: number) => Math.atan((y - bulletHeightAt(kind, d)) / d);

/** 按住右键直到完全举镜（狙击枪腰射散布很大，精确射击必须开镜） */
function ads(g: Game, z: Zombie): void {
  const x = z.x;
  const zz = z.z;
  g.input.ads = true;
  for (let i = 0; i < 40 && g.player.ads < 1; i++) {
    g.update(STEP);
    pin(z, x, zz);
  }
}

/** 开一枪，跑 frames 帧，返回目标受到的命中 */
function shootAt(g: Game, z: Zombie, frames = 30): Array<{ amount: number; head: boolean; frame: number }> {
  const hits: Array<{ amount: number; head: boolean; frame: number }> = [];
  let f = 0;
  const off = g.events.on('zombieHit', (e) => {
    if (e.zombie === z) hits.push({ amount: e.amount, head: e.head, frame: f });
  });
  const zx = z.x;
  const zz = z.z;
  g.input.fire = true;
  for (f = 0; f < frames; f++) {
    g.update(STEP);
    g.input.fire = false;
    pin(z, zx, zz);
  }
  off();
  return hits;
}

console.log('\n== 爆头与身体 ==');
for (const kind of ['pistol', 'rifle', 'sniper'] as WeaponKind[]) {
  const d = 10;
  const g1 = lane(kind);
  const z1 = g1.spawnZombie('walker', LX + d, LZ, 1e6) as Zombie;
  ads(g1, z1);
  g1.input.aimPitch = pitchFor(kind, d, 1.1);
  const body = shootAt(g1, z1);
  const g2 = lane(kind);
  const z2 = g2.spawnZombie('walker', LX + d, LZ, 1e6) as Zombie;
  ads(g2, z2);
  g2.input.aimPitch = pitchFor(kind, d, z2.def.head.y);
  const head = shootAt(g2, z2);
  const b = body[0];
  const h = head[0];
  check(!!b && !b.head, `${WEAPONS[kind].name}：瞄胸口 10 米打中身体，不算爆头`);
  check(!!h && h.head, `${WEAPONS[kind].name}：瞄头 10 米，算爆头`);
  if (b && h) {
    const ratio = h.amount / b.amount;
    check(Math.abs(ratio / WEAPONS[kind].headMult - 1) < 0.02, `${WEAPONS[kind].name}：爆头伤害 / 身体伤害 = ${ratio.toFixed(2)}（应为 ${WEAPONS[kind].headMult}）`);
  }
}

console.log('\n== 射程与飞行时间 ==');
for (const kind of ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'lmg'] as WeaponKind[]) {
  const R = statsAt(kind, 0).range;
  const inside = Math.min(36, R - 2);
  const g1 = lane(kind);
  const z1 = g1.spawnZombie('walker', LX + inside, LZ, 1e6) as Zombie;
  g1.input.aimPitch = pitchFor(kind, inside, 1.2);
  const hit = shootAt(g1, z1, 60);
  check(hit.length > 0, `${WEAPONS[kind].name}：射程 ${R} 米内（${inside} 米）打得到`);
  if (hit[0]) {
    const t = (hit[0].frame + 1) * STEP;
    const ideal = inside / WEAPONS[kind].muzzle;
    check(t >= ideal - STEP && t <= ideal + 2 * STEP, `${WEAPONS[kind].name}：${inside} 米飞行 ${(t * 1000).toFixed(0)} ms（理论 ${(ideal * 1000).toFixed(0)} ms）`);
  }
  if (R + 3 < 39) {
    const g2 = lane(kind);
    const z2 = g2.spawnZombie('walker', LX + R + 3, LZ, 1e6) as Zombie;
    g2.input.aimPitch = pitchFor(kind, R + 3, 1.2);
    check(shootAt(g2, z2, 60).length === 0, `${WEAPONS[kind].name}：超出射程（${R + 3} 米）打不到`);
  }
}
{
  // 衰减：霰弹枪近处一发远比远处疼
  const near = lane('shotgun');
  const zn = near.spawnZombie('colossus', LX + 3, LZ, 1e6) as Zombie;
  const far = lane('shotgun');
  const zf = far.spawnZombie('colossus', LX + 9, LZ, 1e6) as Zombie;
  const sum = (a: Array<{ amount: number }>) => a.reduce((s, h) => s + h.amount, 0);
  const dn = sum(shootAt(near, zn));
  const df = sum(shootAt(far, zf));
  check(dn > df * 1.4, `霰弹枪 3 米一发（${dn.toFixed(0)}）明显比 9 米（${df.toFixed(0)}）伤害高`);
}

console.log('\n== 掩体：路障挡低不挡高，打地面 ==');
{
  // 路障在玩家前方约 3 米（格 35,40），僵尸在 5 米
  const mk = () => {
    const g = lane('rifle');
    g.addStructure('barricade', 35, 40, true);
    const z = g.spawnZombie('walker', LX + 5, LZ, 1e6) as Zombie;
    return { g, z };
  };
  const a = mk();
  a.g.input.aimPitch = pitchFor('rifle', 5, 0.6);
  check(shootAt(a.g, a.z).length === 0, '瞄腿：子弹被路障挡住');
  const b = mk();
  b.g.input.aimPitch = pitchFor('rifle', 5, b.z.def.head.y);
  const hb = shootAt(b.g, b.z);
  check(hb.length === 1 && hb[0]!.head, '瞄头：子弹从路障上方飞过去爆头');
  const c = mk();
  c.g.input.crouch = true;
  for (let i = 0; i < 30; i++) c.g.update(STEP);
  check(Math.abs(c.g.player.eye - CROUCH_EYE) < 0.02, `蹲下后眼睛高度降到 ${c.g.player.eye.toFixed(2)} 米`);
  c.g.input.aimPitch = 0;
  check(shootAt(c.g, c.z).length === 0, '蹲在路障后平视开火：子弹打在路障上');

  const g = lane('rifle');
  g.input.aimPitch = -0.5;
  let ground = false;
  g.events.on('impact', (e) => {
    if (e.zone === 'ground') ground = true;
  });
  g.input.fire = true;
  g.update(STEP);
  g.input.fire = false;
  for (let i = 0; i < 10; i++) g.update(STEP);
  check(ground, '朝脚下开枪：子弹打在地面上');
}

console.log('\n== 瞄准（右键）==');
{
  const g = lane('sniper');
  g.input.ads = true;
  const t = statsAt('sniper', 0).adsTime;
  for (let i = 0; i < Math.ceil(t / STEP) + 1; i++) g.update(STEP);
  check(g.player.ads === 1, `狙击枪 ${t} 秒内完成举镜`);
  g.input.moveX = 1;
  g.input.sprint = true;
  for (let i = 0; i < 20; i++) g.update(STEP);
  const v = Math.hypot(g.player.vx, g.player.vz);
  check(!g.player.sprinting, '瞄准时不能冲刺');
  check(v < 3.4 * (1 - statsAt('sniper', 0).adsSlow) + 0.05, `瞄准时移动变慢（${v.toFixed(2)} m/s）`);

  // 散布：冲锋枪腰射 vs 瞄准，统计弹着点偏离视线的角度（朝 -Z，几米外就是墙）
  const spreadOf = (ads: boolean) => {
    const s = lane('smg');
    s.input.aimX = LX;
    s.input.aimZ = LZ - 50;
    s.input.ads = ads;
    for (let i = 0; i < 20; i++) s.update(STEP);
    const yaw = s.player.yaw;
    const devs: number[] = [];
    s.events.on('impact', (e) => {
      if (!e.flesh) {
        let d = Math.atan2(e.x - s.player.x, e.z - s.player.z) - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        devs.push(d);
      }
    });
    s.input.fire = true;
    for (let i = 0; i < 600 && devs.length < 60; i++) {
      s.loadout.smg.mag = 30;
      s.player.kickPitch = s.player.kickYaw = 0;
      s.update(STEP);
    }
    return Math.sqrt(devs.reduce((a, d) => a + d * d, 0) / Math.max(1, devs.length));
  };
  const hip = spreadOf(false);
  const ads = spreadOf(true);
  check(hip > 0 && ads < hip * 0.6, `冲锋枪瞄准散布（${((ads * 180) / Math.PI).toFixed(2)}°）明显小于腰射（${((hip * 180) / Math.PI).toFixed(2)}°）`);
}

console.log('\n== 后坐力 ==');
{
  const g = lane('smg');
  g.input.fire = true;
  for (let i = 0; i < 30; i++) g.update(STEP);
  const k = g.player.kickPitch;
  check(k > 0.012, `连射半秒视线被抬起 ${((k * 180) / Math.PI).toFixed(2)}°`);
  g.input.fire = false;
  for (let i = 0; i < 60; i++) g.update(STEP);
  check(g.player.kickPitch < k * 0.1, '松开扳机后后坐力回落');
}

console.log('\n== 蹲伏、滑铲、近战 ==');
{
  const g = lane('rifle');
  g.input.moveX = 1;
  g.input.sprint = true;
  for (let i = 0; i < 30; i++) g.update(STEP);
  const sprintV = Math.hypot(g.player.vx, g.player.vz);
  let slid = false;
  g.events.on('slide', () => (slid = true));
  g.input.crouch = true;
  g.update(STEP);
  g.update(STEP);
  const slideV = Math.hypot(g.player.vx, g.player.vz);
  check(slid && g.player.slide > 0, '冲刺中按蹲 = 滑铲');
  check(slideV > sprintV * 1.05, `滑铲初速（${slideV.toFixed(2)}）比冲刺（${sprintV.toFixed(2)}）快`);
  for (let i = 0; i < 90; i++) g.update(STEP);
  check(g.player.slide <= 0 && g.player.crouch > 0.9, '滑铲结束后保持蹲姿');
  const v = Math.hypot(g.player.vx, g.player.vz);
  check(v < 3.4 * 0.6, `蹲着走得慢（${v.toFixed(2)} m/s）`);

  const m = lane('rifle');
  const w = m.spawnZombie('walker', LX + 1.1, LZ, 1) as Zombie;
  const hp = w.hp;
  m.input.melee = true;
  for (let i = 0; i < 20; i++) {
    m.update(STEP);
    pin(w, LX + 1.1, LZ);
  }
  check(Math.abs(hp - w.hp - MELEE_DAMAGE) < 0.01, `近战命中前方的僵尸，造成 ${(hp - w.hp).toFixed(0)} 伤害`);
  const mag = m.loadout.rifle.mag;
  m.input.melee = true;
  m.update(STEP);
  m.input.fire = true;
  m.update(STEP);
  check(m.loadout.rifle.mag === mag, '近战动作中不能开火');

  const far = lane('rifle');
  const w2 = far.spawnZombie('walker', LX + 3, LZ, 1) as Zombie;
  const hp2 = w2.hp;
  far.input.melee = true;
  for (let i = 0; i < 20; i++) {
    far.update(STEP);
    pin(w2, LX + 3, LZ);
  }
  check(w2.hp === hp2, '近战够不到 3 米外的僵尸');
}

console.log('\n== 狙击 / 轻机枪特性 ==');
{
  const g = lane('sniper', 5);
  const z = g.spawnZombie('walker', LX + 10, LZ, 1) as Zombie;
  ads(g, z);
  g.input.aimPitch = pitchFor('sniper', 10, z.def.head.y);
  const full = statsAt('sniper', 5).mag;
  shootAt(g, z);
  check(!z.alive && g.loadout.sniper.mag === full, `5 级狙击爆头击杀返还 1 发（弹匣 ${g.loadout.sniper.mag}/${full}）`);

  const l = lane('lmg', 5);
  const c = l.spawnZombie('colossus', LX + 8, LZ, 1e6) as Zombie;
  shootAt(l, c, 3);
  check(c.slowT > 0 && c.slowK >= 0.35, '5 级轻机枪命中让僵尸减速');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
