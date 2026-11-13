// 量道具模型在人身高范围内的实际截面：npx tsx scripts/tools/measure-props.ts [id...]
// 按 realProps.ts 的归一化（包围盒水平居中、长边转到 X、底面落到 y=0）读全部顶点，
// 输出模型尺寸，以及 0–1.8 米（按 --h 指定的摆放高度缩放后）这一截的水平范围和中心偏移。
// 用来核对碰撞体（格子 / 圆柱）和看得见的外形是否对得上
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'public/props';
const args = process.argv.slice(2);
const hAt = args.indexOf('--h');
const placeH = hAt >= 0 ? Number(args[hAt + 1]) : 0;
const pctAt = args.indexOf('--pct');
const groundPct = pctAt >= 0 ? Number(args[pctAt + 1]) : 0;
const ids = args.filter((a, i) => !a.startsWith('--') && (hAt < 0 || i !== hAt + 1) && (pctAt < 0 || i !== pctAt + 1));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')) as { assets: Record<string, { file: string }> };

type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] = (o[j * 4 + i] as number) + (a[k * 4 + i] as number) * (b[j * 4 + k] as number);
  return o;
};
const I: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
interface Node { matrix?: M4; rotation?: number[]; scale?: number[]; translation?: number[]; mesh?: number; children?: number[] }
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

/** 一个 glTF 的全部顶点（世界空间） */
function vertices(file: string): Float64Array {
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    nodes: Node[];
    meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number }>;
    bufferViews: Array<{ buffer: number; byteOffset?: number; byteStride?: number }>;
    buffers: Array<{ uri: string }>;
    scenes: Array<{ nodes: number[] }>;
    scene?: number;
  };
  const bufs = g.buffers.map((b) => fs.readFileSync(path.join(path.dirname(file), decodeURIComponent(b.uri))));
  const out: number[] = [];
  const walk = (ni: number, parent: M4) => {
    const n = g.nodes[ni] as Node;
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      for (const pr of g.meshes[n.mesh]?.primitives ?? []) {
        const acc = g.accessors[pr.attributes.POSITION];
        if (!acc) continue;
        const bv = g.bufferViews[acc.bufferView] as { buffer: number; byteOffset?: number; byteStride?: number };
        const buf = bufs[bv.buffer] as Buffer;
        const stride = bv.byteStride ?? 12;
        const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride;
          const x = buf.readFloatLE(o);
          const y = buf.readFloatLE(o + 4);
          const z = buf.readFloatLE(o + 8);
          out.push(
            (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
            (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
            (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
          );
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const r of g.scenes[g.scene ?? 0]?.nodes ?? []) walk(r, I);
  return Float64Array.from(out);
}

const f = (v: number) => v.toFixed(2).padStart(6);
for (const id of ids.length ? ids : Object.keys(manifest.assets)) {
  const a = manifest.assets[id];
  if (!a) {
    console.log(`${id}: manifest 里没有`);
    continue;
  }
  const v = vertices(path.join(ROOT, a.file));
  const n = v.length / 3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, v[i * 3] as number); x1 = Math.max(x1, v[i * 3] as number);
    y0 = Math.min(y0, v[i * 3 + 1] as number); y1 = Math.max(y1, v[i * 3 + 1] as number);
    z0 = Math.min(z0, v[i * 3 + 2] as number); z1 = Math.max(z1, v[i * 3 + 2] as number);
  }
  if (groundPct > 0) {
    const ys = Array.from({ length: n }, (_, i) => v[i * 3 + 1] as number).sort((p, q) => p - q);
    y0 = ys[Math.floor(groundPct * (n - 1))] as number;
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const H = y1 - y0;
  const s = placeH > 0 ? placeH / H : 1;
  console.log(`${id}  顶点 ${n}  尺寸 ${f(x1 - x0)} × ${f(H)} × ${f(z1 - z0)}  摆放缩放 ${s.toFixed(3)}`);
  // 缩放后每 0.3 米一层：这一层顶点的水平范围（相对包围盒中心 = 碰撞体中心）
  for (let lo = 0; lo < 1.8; lo += 0.3) {
    let ax0 = Infinity, ax1 = -Infinity, az0 = Infinity, az1 = -Infinity, k = 0;
    for (let i = 0; i < n; i++) {
      const y = ((v[i * 3 + 1] as number) - y0) * s;
      if (y < lo || y >= lo + 0.3) continue;
      const x = ((v[i * 3] as number) - cx) * s;
      const z = ((v[i * 3 + 2] as number) - cz) * s;
      ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); az0 = Math.min(az0, z); az1 = Math.max(az1, z);
      k++;
    }
    if (!k) {
      console.log(`  ${lo.toFixed(1)}–${(lo + 0.3).toFixed(1)} 米：没有顶点`);
      continue;
    }
    console.log(`  ${lo.toFixed(1)}–${(lo + 0.3).toFixed(1)} 米：x ${f(ax0)} … ${f(ax1)}  z ${f(az0)} … ${f(az1)}  中心偏移 (${f((ax0 + ax1) / 2)}, ${f((az0 + az1) / 2)})  半宽 ${f(Math.max(ax1 - ax0, az1 - az0) / 2)}  顶点 ${k}`);
  }
}
