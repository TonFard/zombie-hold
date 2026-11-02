// 战斗验证：npm run sim:combat
// 让实测伤害去对账平衡表，并验证穿透、墙体阻挡、范围伤害、灼烧、换弹、买枪升级等逻辑。
import { WEAPON_ORDER, WEAPONS, statsAt, sustainedDps, type WeaponKind } from '../src/game/data/weapons';
import { Game, STEP } from '../src/game/sim';
import type { Zombie } from '../src/game/entities/zombie';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const PX = -8;
const PZ = 6;

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
  for (let tier = 0; tier <= 5; tier++) {
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
  setWeapon(g, 'rifle', 5); // 穿透 2，伤害 30
  const zs = [2.5, 3.6, 4.7, 5.8].map((d) => g.spawnZombie('walker', PX + d, PZ, 1) as Zombie);
  g.input.aimX = PX + 10;
  g.input.aimZ = PZ;
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
  check(g.loadout.pistol.tier === 5, '手枪最多升到 5 级');
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

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部通过');
