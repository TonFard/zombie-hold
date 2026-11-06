// 把一张地图的网格画成俯视图（每格 8 像素）：npx tsx scripts/tools/map-png.ts outpost out.ppm
// 输出 PPM（不需要额外依赖），再用 Python/PIL 转 png。地面按类型上色，墙 / 道具 / 刷怪点 / 发电机 / 零件箱叠在上面
import fs from 'node:fs';
import { MAP_BUILDERS, type MapId } from '../../src/game/world/maps';

const id = (process.argv[2] ?? 'outpost') as MapId;
const out = process.argv[3] ?? `.logs/map-${id}.ppm`;
const m = MAP_BUILDERS[id]();
const g = m.grid;
const S = 8;
const W = g.w * S;
const H = g.h * S;
const px = new Uint8Array(W * H * 3);
// 地面颜色：草 / 沥青 / 土 / 混凝土 / 室内 / 碎石 / 水 / 沙 / 泥
const GROUND: Array<[number, number, number]> = [
  [74, 92, 58], [52, 54, 58], [112, 92, 66], [128, 126, 120], [120, 100, 80], [104, 100, 92], [40, 70, 96], [170, 150, 110], [80, 64, 48],
];
const put = (x: number, y: number, c: [number, number, number]) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
};
const cell = (cx: number, cy: number, c: [number, number, number], inset = 0) => {
  for (let y = inset; y < S - inset; y++) for (let x = inset; x < S - inset; x++) put(cx * S + x, cy * S + y, c);
};
for (let cy = 0; cy < g.h; cy++) {
  for (let cx = 0; cx < g.w; cx++) {
    const i = g.idx(cx, cy);
    cell(cx, cy, GROUND[g.ground[i] as number] ?? [255, 0, 255]);
    if (g.solid[i]) cell(cx, cy, [24, 24, 26], 0);
  }
}
const PROP: Record<string, [number, number, number]> = {
  car: [200, 80, 60], container: [70, 120, 190], tree: [40, 70, 34], wall: [24, 24, 26], crate: [170, 130, 70], barrel: [210, 160, 40], sandbag: [150, 140, 100],
};
for (const p of m.props) {
  const c = PROP[p.kind];
  if (!c) continue;
  for (let cy = p.y0; cy < p.y1; cy++) for (let cx = p.x0; cx < p.x1; cx++) cell(cx, cy, c, 1);
}
const dot = (wx: number, wz: number, c: [number, number, number], r: number) => {
  const x0 = Math.round((wx + g.w / 2) * S);
  const y0 = Math.round((wz + g.h / 2) * S);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(x0 + x, y0 + y, c);
};
for (const s of m.spawns) dot(s.x, s.z, [230, 50, 50], 9);
for (const b of m.scrapBoxes) cell(b.cx, b.cy, [250, 210, 60], 1);
dot(m.corePos.x, m.corePos.z, [110, 210, 240], 12);
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(px)]));
console.log(`${out} ${W}x${H} spawns=${m.spawns.length} boxes=${m.scrapBoxes.length} props=${m.props.length}`);
