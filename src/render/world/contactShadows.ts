import { CanvasTexture, Group, InstancedMesh, LinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { MapData, PropKind } from '../../game/world/types';
import { rectOf } from './props/kit';

/**
 * 接触阴影：车、集装箱、发电机、沙袋等底下贴一张柔和的暗色贴片，让它们"压"在地上。
 *
 * 太阳阴影只给出一个方向的投影，物体和地面交界那一圈（真实世界里最暗的地方）是空的，看上去像浮着。
 * 这张贴片补的就是那一圈。全部画质都开：一个 InstancedMesh、一张 64×64 的贴图，成本可以忽略。
 *
 * 注意：它只补"接触感"，不修位置。模型落地点错了要在 realProps 里修（见 check:props），不能靠它遮。
 */

/** 哪些道具底下要贴，以及贴片比道具的格子范围大多少（米）、有多暗 */
const KINDS: Partial<Record<PropKind, { pad: number; alpha: number }>> = {
  car: { pad: 0.6, alpha: 0.75 },
  container: { pad: 0.5, alpha: 0.7 },
  sandbag: { pad: 0.2, alpha: 0.45 },
  crate: { pad: 0.15, alpha: 0.45 },
  barrel: { pad: 0.15, alpha: 0.45 },
  dumpster: { pad: 0.4, alpha: 0.6 },
  generator: { pad: 0.45, alpha: 0.65 },
  pallet: { pad: 0.15, alpha: 0.4 },
  pump: { pad: 0.2, alpha: 0.45 },
  barrier: { pad: 0.12, alpha: 0.4 },
  workbench: { pad: 0.2, alpha: 0.45 },
};

/** 径向渐变：中间实、边缘柔，做成圆角矩形的形状（按道具长宽拉伸后接近底面轮廓） */
function shadowTexture(): CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 超椭圆距离：p=4 时是圆角矩形
      const u = Math.abs((x + 0.5) / S - 0.5) * 2;
      const v = Math.abs((y + 0.5) / S - 0.5) * 2;
      const d = Math.pow(u ** 4 + v ** 4, 0.25);
      // 0.4 以内满黑，往外平滑衰减到 1
      const t = Math.min(1, Math.max(0, (d - 0.4) / 0.6));
      const a = (1 - t * t * (3 - 2 * t)) * 255;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export interface ContactShadows {
  group: Group;
  count: number;
  dispose(): void;
}

export function buildContactShadows(map: MapData): ContactShadows | null {
  const list: Array<{ x: number; z: number; w: number; d: number; ry: number; alpha: number }> = [];
  for (const p of map.props) {
    const k = KINDS[p.kind];
    if (!k) continue;
    const r = rectOf(p);
    // 宽 = 长边（rectOf 把长边算成 L），朝向和 realProps 的摆放一致：长边沿 X 或 Z
    list.push({ x: r.cx, z: r.cz, w: r.L + k.pad * 2, d: r.T + k.pad * 2, ry: r.horiz ? 0 : Math.PI / 2, alpha: k.alpha });
  }
  if (!list.length) return null;

  const tex = shadowTexture();
  // 暗度按种类只有几档：每档一个 InstancedMesh、一个材质（opacity 就是暗度），不需要改着色器
  const mats = new Map<number, MeshBasicMaterial>();
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const group = new Group();
  group.name = 'contactShadows';
  const byAlpha = new Map<number, typeof list>();
  for (const s of list) {
    let a = byAlpha.get(s.alpha);
    if (!a) byAlpha.set(s.alpha, (a = []));
    a.push(s);
  }
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  for (const [alpha, items] of byAlpha) {
    // 贴图是黑色 + alpha 形状，map 和 alpha 一起采样（alphaMap 只读绿色通道，黑色贴图会全透明）
    const mat = new MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, opacity: alpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mats.set(alpha, mat);
    const mesh = new InstancedMesh(geo, mat, items.length);
    items.forEach((s, i) => {
      q.setFromAxisAngle(up, s.ry);
      // 离地 2 厘米 + 多边形偏移：不和地面打架
      mesh.setMatrixAt(i, m.compose(pos.set(s.x, 0.02, s.z), q, scl.set(s.w, 1, s.d)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // 画在不透明物体之后、其他透明物体之前
    mesh.renderOrder = -1;
    group.add(mesh);
  }
  return {
    group,
    count: list.length,
    dispose() {
      geo.dispose();
      for (const mat of mats.values()) mat.dispose();
      tex.dispose();
    },
  };
}
