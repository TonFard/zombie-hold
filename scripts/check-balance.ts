// 武器平衡检查：npm run check:balance
// 把"手枪最弱，哪怕升满"变成可执行的约束，而不是口头承诺。
import { MAX_TIER, WEAPON_ORDER, WEAPONS, statsAt, sustainedDps, totalUpgradeCost, type WeaponKind } from '../src/game/data/weapons';
import { EYE_HEIGHT, bulletHeightAt, flightTime } from '../src/game/data/ballistics';
import { STRUCTURES, TURRETS, turretDps, type TurretKind } from '../src/game/data/structures';

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

console.log('\n== 持续单体 DPS（含换弹）==');
console.log('  武器          ' + Array.from({ length: MAX_TIER + 1 }, (_, t) => (t ? `${t}级` : '基础').padStart(6)).join('  '));
const TIERS = Array.from({ length: MAX_TIER + 1 }, (_, t) => t);
const dps = {} as Record<WeaponKind, number[]>;
for (const k of WEAPON_ORDER) {
  dps[k] = TIERS.map((t) => sustainedDps(statsAt(k, t)));
  console.log(`  ${WEAPONS[k].name.padEnd(10, '　')} ${dps[k].map((v) => v.toFixed(1).padStart(6)).join('  ')}`);
}

// "满级手枪"按原来的 5 级比：6–8 级是后期的手感升级（瞄准更快、更准），不能让手枪追上别的枪
const pistolMax = (dps.pistol as number[])[5] as number;
const pistolTop = (dps.pistol as number[])[MAX_TIER] as number;
const others = WEAPON_ORDER.filter((k) => k !== 'pistol');

console.log('\n== 约束 ==');
for (const k of others) {
  const t1 = (dps[k] as number[])[1] as number;
  const margin = (t1 / pistolMax - 1) * 100;
  check(margin >= 5, `${WEAPONS[k].name} 只升 1 级（${t1.toFixed(1)}）就比满级手枪（${pistolMax.toFixed(1)}）高至少 5%（实际 +${margin.toFixed(1)}%）`);
}
for (const k of others) {
  const base = (dps[k] as number[])[0] as number;
  const pBase = (dps.pistol as number[])[0] as number;
  check(base >= pBase * 1.5, `${WEAPONS[k].name} 基础 DPS 至少是手枪基础的 1.5 倍（${base.toFixed(1)} vs ${pBase.toFixed(1)}）`);
}
for (const k of others) {
  const mx = (dps[k] as number[])[MAX_TIER] as number;
  check(mx >= pistolTop * 1.8, `${WEAPONS[k].name} ${MAX_TIER} 级 DPS 至少是 ${MAX_TIER} 级手枪的 1.8 倍（${mx.toFixed(1)} vs ${pistolTop.toFixed(1)}）`);
}

const p = statsAt('pistol', MAX_TIER);
check(p.pierce === 0 && p.aoe === 0 && p.burn === 0 && p.ramp === 0 && p.split === 0 && p.pellets === 1, '满级手枪没有穿透 / 范围 / 灼烧 / 射速递增 / 分裂 / 多弹丸');
const pistolSpent = totalUpgradeCost('pistol', 5);
for (const k of others) {
  const entry = WEAPONS[k].price + (WEAPONS[k].upgrades[0]?.cost ?? 0) + (WEAPONS[k].upgrades[1]?.cost ?? 0);
  check(pistolSpent < entry, `手枪升到 5 级总花费（${pistolSpent}）低于买 ${WEAPONS[k].name} 并升 2 级（${entry}）`);
}

// 升级必须单调不降：每一级都不能让 DPS 变低
for (const k of WEAPON_ORDER) {
  const arr = dps[k] as number[];
  let mono = true;
  for (let i = 1; i < arr.length; i++) if ((arr[i] as number) < (arr[i - 1] as number)) mono = false;
  check(mono, `${WEAPONS[k].name} 每一级升级都不会降低 DPS`);
}

console.log('\n== 弹道（M6）==');
// 子弹在有效射程内的下坠不能太夸张，飞行时间也要够快，否则"指哪打哪"的手感就没了
for (const k of WEAPON_ORDER) {
  const d = WEAPONS[k];
  if (d.muzzle <= 0) continue; // 榴弹发射器是抛物线弹，不算
  const R = statsAt(k, 0).range;
  const drop = Math.abs(bulletHeightAt(k, R) - EYE_HEIGHT);
  const flight = flightTime(k, R);
  check(drop < 0.5, `${d.name} 在射程 ${R} 米处偏离瞄准线 < 0.5 米（${drop.toFixed(2)}）`);
  check(flight < 0.3, `${d.name} 飞到射程 ${R} 米用时 < 0.3 秒（${flight.toFixed(3)}）`);
}
// 全爆头的手枪也不能超过满 1 级的其他枪（爆头倍率 × 持续 DPS）
{
  const ph = sustainedDps(statsAt('pistol', 5)) * WEAPONS.pistol.headMult;
  for (const k of others) {
    if (WEAPONS[k].muzzle <= 0) continue; // 榴弹靠爆炸，没有爆头
    const t1 = (dps[k] as number[])[1] as number;
    check(ph < t1 * WEAPONS[k].headMult, `全爆头的满级手枪（${ph.toFixed(1)}）不超过全爆头的 1 级${WEAPONS[k].name}（${(t1 * WEAPONS[k].headMult).toFixed(1)}）`);
  }
}

console.log('\n== 炮塔（M10）==');
// 新炮塔各有所长，但单体"每零件 DPS"不能碾压自动炮塔，否则旧炮塔就没人建了
{
  const base = turretDps('turret') / STRUCTURES.turret.cost;
  for (const k of ['hmg', 'flamer', 'mortar'] as TurretKind[]) {
    const per = turretDps(k) / STRUCTURES[k].cost;
    check(per <= base * 1.05, `${STRUCTURES[k].name} 每零件单体 DPS（${per.toFixed(3)}）不超过自动炮塔（${base.toFixed(3)}）的 105%`);
  }
  check(TURRETS.hmg.range > TURRETS.turret.range && STRUCTURES.hmg.hp > STRUCTURES.turret.hp, '重机枪塔射程更远、更耐打');
  check(TURRETS.mortar.range > TURRETS.hmg.range && TURRETS.mortar.minRange > 0, '迫击炮射程最远，但有最小射程');
  check(TURRETS.flamer.range < TURRETS.turret.range && TURRETS.flamer.cone > 0, '喷火塔射程短、打扇形');
}

console.log('');
if (failures.length) {
  console.log(`未通过 ${failures.length} 项`);
  process.exit(1);
}
console.log('全部通过');
