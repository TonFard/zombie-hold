// 道具落地检查：npm run check:props [-- id...] [--verbose]
// 读 public/props 下每个 glTF，按节点变换算出每个网格的包围盒，用和运行时一样的 groundOf() 算落地点。
// 失败条件：没有网格贴地（车要至少 2 个：轮子），说明模型本身是悬空的。--dump id 看每个网格的高度
import fs from 'node:fs';
import path from 'node:path';
import { groundOf, type MeshBox } from '../../src/render/world/ground-fit';

const ROOT = 'public/props';
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('--'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')) as { assets: Record<string, { file: string }> };

type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] = (o[j * 4 + i] as number) + (a[k * 4 + i] as number) * (b[j * 4 + k] as number);
  return o;
};
const I: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
interface Node { matrix?: M4; rotation?: number[]; scale?: number[]; translation?: number[]; mesh?: number; children?: number[]; name?: string }
function local(n: Node): M4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = (n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number];
  const [sx, sy, sz] = (n.scale ?? [1, 1, 1]) as [number, number, number];
  const [tx, ty, tz] = (n.translation ?? [0, 0, 0]) as [number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m: M4, x: number, y: number, z: number): [number, number, number] => [
  (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
  (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
  (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
];

/** 一个 glTF 里每个网格（世界空间）的包围盒 */
export function meshBoxes(file: string): MeshBox[] {
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    nodes: Node[];
    meshes: Array<{ name?: string; primitives: Array<{ attributes: { POSITION: number } }> }>;
    accessors: Array<{ min?: number[]; max?: number[] }>;
    scenes: Array<{ nodes: number[] }>;
    scene?: number;
  };
  const out: MeshBox[] = [];
  const walk = (ni: number, parent: M4) => {
    const n = g.nodes[ni] as Node;
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const pr of g.meshes[n.mesh]?.primitives ?? []) {
        const acc = g.accessors[pr.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        for (const cx of [acc.min[0], acc.max[0]] as number[]) for (const cy of [acc.min[1], acc.max[1]] as number[]) for (const cz of [acc.min[2], acc.max[2]] as number[]) {
          const p = apply(m, cx, cy, cz);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k] as number, p[k] as number);
            hi[k] = Math.max(hi[k] as number, p[k] as number);
          }
        }
      }
      if (Number.isFinite(lo[1])) out.push({ name: n.name ?? g.meshes[n.mesh]?.name ?? `mesh${n.mesh}`, min: lo, max: hi });
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const r of g.scenes[g.scene ?? 0]?.nodes ?? []) walk(r, I);
  return out;
}

// --dump id：只打印这个模型每个网格的包围盒（底、顶、水平面积），看哪些是轮胎、哪些是碎片
const dumpAt = args.indexOf('--dump');
if (dumpAt >= 0) {
  const id = args[dumpAt + 1] as string;
  const boxes = meshBoxes(path.join(ROOT, (manifest.assets[id] as { file: string }).file));
  const fit = groundOf(boxes);
  for (const b of [...boxes].sort((p, q) => p.min[1] - q.min[1])) {
    const a = (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]);
    console.log(`${b.name.padEnd(14)} 底 ${b.min[1].toFixed(2).padStart(6)} 顶 ${b.max[1].toFixed(2).padStart(6)}  宽 ${(b.max[0] - b.min[0]).toFixed(2).padStart(5)} 深 ${(b.max[2] - b.min[2]).toFixed(2).padStart(5)} 面积 ${a.toFixed(2).padStart(6)}${fit.contact.includes(b.name) ? '  ← 贴地' : ''}`);
  }
  console.log(`落地点 ${fit.y.toFixed(2)}，高 ${fit.height.toFixed(2)}，贴地网格：${fit.contact.join(', ')}`);
  process.exit(0);
}

// 摆放检查：叠放的集装箱，第二层的底要正好落在第一层的顶上（以前用 h / layers 平均分，模型实际高度
// 和平均值不一样时两层之间有缝或互相穿插）。这里按 realProps 的 fit() 规则复算一遍
const cont = ['container_rust', 'container_blue'].map((id) => {
  const f = manifest.assets[id];
  return f ? groundOf(meshBoxes(path.join(ROOT, f.file))).height : 0;
});
console.log(`集装箱模型高：锈 ${cont[0]?.toFixed(2)}、蓝 ${cont[1]?.toFixed(2)}（叠放时按各自缩放后的高度摞起来）`);

let fails = 0;
for (const [id, a] of Object.entries(manifest.assets)) {
  if (only.length && !only.includes(id)) continue;
  const file = path.join(ROOT, a.file);
  if (!fs.existsSync(file) || !file.endsWith('.gltf')) continue;
  const fit = groundOf(meshBoxes(file));
  // 至少有一个网格贴地。车轮常和车身合在一个网格里，包围盒分不出轮子，所以车是否悬空还要看截图
  const need = 1;
  const ok = fit.contact.length >= need;
  if (!ok) fails++;
  if (verbose || !ok) console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(26)} 高 ${fit.height.toFixed(2)}  贴地网格 ${fit.contact.length} 个${ok ? '' : `（要求 ≥ ${need}）`}`);
}
console.log(fails ? `${fails} 个模型没有贴地的网格` : '全部模型都有贴地的网格');
if (fails) process.exit(1);
