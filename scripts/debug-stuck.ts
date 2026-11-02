// 临时调试：跑到某一时刻，打印卡住僵尸的完整状态
import { Game, STEP } from '../src/game/sim';
import type { ZombieKind } from '../src/game/data/zombies';
import { INF } from '../src/game/nav/flowfield';

const scenario = process.argv[2] ?? 'A';
const until = Number(process.argv[3] ?? 60);
const g = new Game(Number(process.argv[4] ?? 7));
g.invulnerableCore = true;
g.invulnerablePlayer = true;

if (scenario === 'B') {
  const place = (cx: number, cy: number) => g.addStructure('barricade', cx, cy, true);
  for (let x = 37; x < 43; x++) place(x, 26);
  for (let y = 39; y < 42; y++) place(53, y);
  for (let y = 38; y < 42; y++) place(26, y);
  for (let x = 34; x < 42; x++) place(x, 53);
}

const pick = (): ZombieKind => {
  const r = g.rng.next();
  return r < 0.62 ? 'walker' : r < 0.82 ? 'runner' : r < 0.9 ? 'bloater' : 'breaker';
};
let colossus = false;
for (let t = 0; t < until / STEP; t++) {
  if (t % 60 === 0 && t / 60 < 6) {
    for (let s = 0; s < g.map.spawns.length; s++) {
      for (let k = 0; k < 6; k++) g.spawnAtGate(pick(), s);
      if (!colossus) g.spawnAtGate('colossus', s);
    }
    colossus = true;
  }
  g.update(STEP);
  if (g.zombies.some((z) => z.stuckTime >= 3)) {
    console.log(`首次出现卡住 ≥3s 的时刻: t=${(t * STEP).toFixed(1)}s`);
    break;
  }
}

const { grid } = g;
const stuck = g.zombies.filter((z) => z.stuckTime >= 3).slice(0, 3);
console.log(`僵尸=${g.zombies.length} 卡住(≥3s)=${stuck.length}`);
for (const z of stuck) {
  const ci = grid.indexAt(z.x, z.z);
  const field = g.nav.field(z.goal, z.def.large, ci);
  console.log(`\n${z.kind}#${z.id} pos=(${z.x.toFixed(2)},${z.z.toFixed(2)}) v=(${z.vx.toFixed(2)},${z.vz.toFixed(2)}) goal=${z.goal} state=${z.state}`);
  console.log(`  格=(${grid.cellX(z.x)},${grid.cellY(z.z)}) hasWp=${z.hasWp} wp=(${z.wpX.toFixed(2)},${z.wpZ.toFixed(2)}) noSep=${z.noSepTimer.toFixed(2)}`);
  console.log(`  玩家=(${g.player.x.toFixed(2)},${g.player.z.toFixed(2)}) 到玩家距离=${Math.hypot(g.player.x - z.x, g.player.z - z.z).toFixed(2)} 视线畅通=${grid.sweptClear(z.x, z.z, g.player.x, g.player.z, z.radius * 0.8)}`);
  console.log(`  field.large=${field.large} dist=${(field.dist[ci] as number) >= INF ? 'INF' : (field.dist[ci] as number).toFixed(1)}`);
  let u = field.next[ci] as number;
  const chain: string[] = [];
  for (let k = 0; k < 8 && u >= 0; k++) {
    chain.push(`(${u % 80},${(u / 80) | 0})${grid.structure[u]! >= 0 ? 'S' : ''}`);
    u = field.next[u] as number;
  }
  console.log(`  路径链: ${chain.join(' -> ')}`);
  console.log('  附近僵尸:');
  for (const o of g.zombies) {
    if (o === z) continue;
    const d = Math.hypot(o.x - z.x, o.z - z.z);
    if (d < 3) console.log(`    ${o.kind}#${o.id} d=${d.toFixed(2)} state=${o.state} atk=${o.attackTarget}`);
  }
  // 周围 5x5 的格子
  const cx = grid.cellX(z.x);
  const cy = grid.cellY(z.z);
  for (let dy = -3; dy <= 3; dy++) {
    let line = '  ';
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const here = dx === 0 && dy === 0;
      const ch = grid.isStaticSolid(x, y) ? '#' : grid.structure[grid.idx(x, y)]! >= 0 ? 'B' : grid.inflated()[grid.idx(x, y)] ? '+' : '.';
      line += here ? '@' : ch;
    }
    console.log(line);
  }
}
