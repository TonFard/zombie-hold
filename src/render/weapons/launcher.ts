import { Vector3 } from 'three';
import { GunKit, dark, glow, hole, outline, poly, side, steel, wood, Z, type GunInfo } from './kit-ext';

/** 炼狱榴弹发射器：6 弹巢转轮（每发转 60°）、粗炮管、梯形照门、木护木、手枪握把、肩托 */
export function launcher(k: GunKit): GunInfo {
  const { b, t } = k;
  const dr = t >= 2 ? 0.088 : 0.074;
  const dl = t >= 2 ? 0.15 : 0.12;
  const cz = 0.06;
  const cy = 0.035;

  // ---- 枪托 + 握把（木） ----
  side(
    b,
    outline([
      [-0.04, 0.03],
      [-0.04, -0.02],
      [-0.016, -0.035],
      [-0.036, -0.115],
      [-0.07, -0.11],
      [-0.08, -0.06],
      [-0.36, -0.11],
      [-0.4, -0.11],
      [-0.4, 0.03],
    ]),
    0.044,
    wood(0x5a4030),
    0.006,
  );
  b.rbox(0.05, 0.15, 0.02, 0.005, { y: -0.115, z: -0.405 }, poly(0x16181a));
  for (let i = 0; i < 4; i++) b.box(0.0015, 0.006, 0.024, { x: 0.0225, y: -0.05 - i * 0.016, z: -0.034 + i * 0.004, rx: -0.2 }, wood(0x2a1c10, { jitter: 0 }));

  // ---- 机匣框架 + 扳机 ----
  side(
    b,
    outline(
      [
        [-0.04, -0.03],
        [cz + dl + 0.03, -0.03],
        [cz + dl + 0.03, cy + dr + 0.012],
        [-0.04, 0.035 + 0.03],
      ],
      [],
    ),
    0.03,
    dark(0x30343a),
    0.004,
  );
  b.torus(0.02, 0.004, 8, 16, { y: -0.03, z: 0.03, ry: Z, rz: Math.PI }, dark(0x22252a), Math.PI);
  b.box(0.006, 0.022, 0.005, { y: -0.046, z: 0.03, rx: 0.2 }, steel(0x8a8e92));

  // ---- 转轮（可动：每发转 60°） ----
  const drum = k.part('drum', new Vector3(0, cy, cz));
  drum.tubeZ(dr, dl, 30, { y: cy, z: cz }, steel(0x3a4047));
  drum.tubeZ(dr + 0.004, 0.012, 30, { y: cy, z: cz }, steel(0x6a7078));
  drum.tubeZ(dr + 0.004, 0.012, 30, { y: cy, z: cz + dl - 0.012 }, steel(0x6a7078));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.sin(a) * dr * 0.6;
    const y = cy + Math.cos(a) * dr * 0.6;
    // 弹巢口 + 能看到的榴弹弹头（红色）
    drum.cyl(0.024, 0.024, 0.002, 14, { x, y, z: cz + dl + 0.001, rx: Z }, hole());
    drum.cyl(0.018, 0.018, 0.003, 14, { x, y, z: cz + dl - 0.002, rx: Z }, poly(t >= 5 ? 0xe07a1a : 0xc03a2a));
    // 转轮外侧的凹槽
    const ga = a + Math.PI / 6;
    drum.box(0.006, 0.006, dl * 0.7, { x: Math.sin(ga) * dr, y: cy + Math.cos(ga) * dr - 0.003, z: cz + dl * 0.5, rz: -ga }, dark(0x1c1f22));
  }
  drum.tubeZ(0.012, dl + 0.02, 12, { y: cy, z: cz - 0.01 }, steel(0x8a9096)); // 中轴
  // 4 级：快速装填环（橙色）
  if (t >= 4) drum.torus(dr + 0.01, 0.006, 8, 30, { y: cy, z: cz + dl * 0.5 }, poly(0xe07a1a, { jitter: 0.05 }));

  // ---- 炮管 + 护木 ----
  const bz0 = cz + dl + 0.03;
  const bl = t >= 6 ? 0.36 : 0.3;
  b.tubeZ(0.036, bl, 24, { y: cy, z: bz0 }, dark(0x22252a));
  b.cyl(0.028, 0.028, 0.002, 20, { y: cy, z: bz0 + bl + 0.001, rx: Z }, hole());
  for (let i = 0; i < 3; i++) b.tubeZ(0.039, 0.01, 24, { y: cy, z: bz0 + 0.04 + i * 0.1 }, steel(0x5a6066));
  b.rbox(0.05, 0.05, 0.16, 0.014, { y: cy - 0.08, z: bz0 + 0.1 }, wood(0x6a4a30));
  for (let i = 0; i < 6; i++) b.box(0.052, 0.003, 0.004, { y: cy - 0.055, z: bz0 + 0.04 + i * 0.024 }, wood(0x2a1c10, { jitter: 0 }));
  // 1 级：高爆弹警示环
  if (t >= 1) {
    b.tubeZ(0.0375, 0.024, 24, { y: cy, z: bz0 + 0.2 }, poly(0xc03a2a, { jitter: 0.05 }));
    b.tubeZ(0.0375, 0.01, 24, { y: cy, z: bz0 + 0.226 }, poly(0xd6a824, { jitter: 0.05 }));
  }
  // 3 级：喇叭口
  const mz = bz0 + bl;
  if (t >= 3) b.lathe([[0.036, 0], [0.05, 0.03], [0.054, 0.05], [0.044, 0.05]], 24, { y: cy, z: mz }, dark(0x1a1c20));

  // ---- 梯形照门 + 准星 ----
  // 以前瞄准点正好落在一根横档上（横档占满整个缺口），准星又矮在瞄准线下方 6 厘米，开镜只能看到一根白条。
  // 现在：瞄准线 SY 平行于炮管；梯形照门在 SY 上下留出一个方形窗口（下面两根横档、上面一根顶梁），
  // 准星立柱从炮管顶一直伸到 SY，顶端发光点就是弹着点（= 屏幕中心）。
  // 机匣前沿比 SY 低 1.4 厘米，转轮更低，都挡不到准星点。照门两侧各一个白点，三点连成一线；2 级起换氚光（绿色）
  const SY = cy + dr + 0.026;
  const rail = dark(0x1a1c20, { jitter: 0 });
  const rearDot = t >= 2 ? glow(0x7dff8a, 2.4) : glow(0xf2f2e6, 1.1);
  const frontDot = t >= 2 ? glow(0x9dffa8, 3.2) : glow(0xff8a2a, 2.6);
  const ry0 = cy + dr - 0.01;
  const ry1 = SY + 0.014;
  // 照门座：机匣顶面是斜的（z=0 处只有 0.074~0.075），以前立柱悬在半空。
  // 现在一块垫高座从机匣顶面立到 ry0，立柱往下接到座上（顶端不变）；座顶比下横档低 1 厘米，不挡窗口
  const recvTop = (z: number) => 0.065 + ((cy + dr + 0.012 - 0.065) * (z + 0.04)) / (cz + dl + 0.07);
  const rb0 = recvTop(-0.005) - 0.003; // 压进机匣顶面一点（机匣有倒角）
  b.box(0.032, ry0 + 0.001 - rb0, 0.01, { y: rb0, z: 0.0 }, rail); // 盒子原点在底面
  const postTop = 1.5 * ry1 - 0.5 * ry0; // 立柱原来的顶端高度（保持不变）
  for (const x of [0.012, -0.012]) {
    b.box(0.004, postTop - ry0, 0.004, { x, y: ry0, z: 0.0 }, rail);
    b.box(0.0035, 0.0035, 0.001, { x, y: SY, z: -0.0025 }, rearDot);
  }
  for (const y of [cy + dr + 0.002, SY - 0.014]) b.box(0.028, 0.002, 0.003, { y, z: 0.0 }, rail);
  b.box(0.028, 0.003, 0.003, { y: ry1, z: 0.0 }, rail); // 顶梁：让窗口闭合，像觇孔一样把视线往中间引
  // 准星：底座卡在炮管上，细立柱比窗口窄得多，顶端发光点
  const fz = mz - 0.03;
  const fy0 = cy + 0.03;
  b.box(0.014, 0.008, 0.012, { y: fy0 + 0.004, z: fz }, rail);
  b.box(0.006, SY + 0.004 - fy0, 0.006, { y: (fy0 + SY + 0.004) / 2, z: fz }, rail);
  // 准星离眼睛约 0.45 米，点太小会被发电机这类强光吞掉：顶端做一块深色方片当底衬，上面一个大发光点
  b.box(0.014, 0.014, 0.004, { y: SY, z: fz }, rail);
  b.box(0.009, 0.009, 0.001, { y: SY, z: fz - 0.0025 }, frontDot);

  // 5 级：两侧小炮管 + 发光；7 级：温压装药的黄色标记
  if (t >= 5) {
    for (const s of [-1, 1]) {
      b.tubeZ(0.016, 0.26, 14, { x: s * 0.056, y: cy - 0.01, z: bz0 + 0.02 }, dark(0x22252a));
      b.cyl(0.012, 0.012, 0.002, 12, { x: s * 0.056, y: cy - 0.01, z: bz0 + 0.281, rx: Z }, glow(0xff7a2a, 2.4));
    }
    b.cyl(0.028, 0.028, 0.002, 20, { y: cy, z: mz + 0.002, rx: Z }, glow(0xff7a2a, 1.8));
  }
  if (t >= 7) b.tubeZ(0.0375, 0.016, 24, { y: cy, z: bz0 + 0.14 }, poly(0xe8c020, { jitter: 0.05 }));

  return {
    gripR: new Vector3(0, -0.08, -0.03),
    gripL: new Vector3(0, cy - 0.06, bz0 + 0.1),
    muzzle: new Vector3(0, cy, mz + (t >= 3 ? 0.05 : 0)),
    eject: new Vector3(0.03, 0.03, 0.1),
    sight: new Vector3(0, SY, 0.0), // 准星点中心，和照门两点同高
    eyeRelief: 0.22,
    slideTravel: 0,
    action: 'revolver',
  };
}
