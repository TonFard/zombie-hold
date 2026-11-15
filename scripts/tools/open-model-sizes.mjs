// 读 public/props 下每个 glTF 的包围盒（按节点变换），归一化成「长的水平边沿 X」，写到 src/open/world/model-sizes.json。
// 开放世界的布局是纯 TS（不加载模型），靠这张表算缩放和碰撞。用法：node scripts/tools/open-model-sizes.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/props/manifest.json'), 'utf8'));

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const trs = (n) => {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1];
};
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

const out = {};
for (const [id, a] of Object.entries(manifest.assets)) {
  const g = JSON.parse(fs.readFileSync(path.join(root, 'public/props', a.file), 'utf8'));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const walk = (ni, parent) => {
    const n = g.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh].primitives) {
        const acc = g.accessors[p.attributes.POSITION];
        const [x0, y0, z0] = acc.min;
        const [x1, y1, z1] = acc.max;
        for (const c of [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]]) {
          const v = apply(m, c);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], v[k]);
            hi[k] = Math.max(hi[k], v[k]);
          }
        }
      }
    }
    for (const c of n.children ?? []) walk(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of g.scenes[g.scene ?? 0].nodes) walk(ni, I);
  let [sx, sy, sz] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  if (sz > sx) [sx, sz] = [sz, sx];
  out[id] = [+sx.toFixed(3), +sy.toFixed(3), +sz.toFixed(3)];
}
const dst = path.join(root, 'src/open/world/model-sizes.json');
fs.writeFileSync(dst, `${JSON.stringify(out, null, 1)}\n`);
console.log(`写入 ${path.relative(root, dst)}：${Object.keys(out).length} 个模型`);
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(28), v.join(' × '));
