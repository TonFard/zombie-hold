import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../../game/core/rng';
import { GRID_W } from '../../game/world/grid';

/**
 * 远景（M18）：断崖外面一圈低模剪影——城市楼群、倒塌的高压电塔、山。
 * 不参与碰撞和寻路，也不投影、不受光：一个合并好的网格、一个材质（颜色靠雾混进天空），一次绘制。
 * 目的只是让 80×80 的地图不像一个封闭的方框：站在高处、往路的尽头看时，远处有东西。
 */
export interface Vista {
  group: Group;
  dispose(): void;
}

/** 顶点色：越高越亮一点（被天光照到），底部压暗，看上去有层次 */
function tint(geo: BufferGeometry, base: Color, top: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - minY) / Math.max(1e-6, maxY - minY);
    const c = base.clone().multiplyScalar(0.75 + top * k);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return geo;
}

export function buildVista(seed = 4242): Vista {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const R0 = GRID_W / 2 + 22;
  const city = new Color(0x3a4048);
  const hill = new Color(0x2f3530);
  const steel = new Color(0x2a2c30);
  // 城市楼群：北面和东面（朝着"市中心"的方向），一圈高低不齐的方楼，偶尔一栋塌了半截
  for (let i = 0; i < 70; i++) {
    const a = rng.range(-Math.PI * 0.95, -Math.PI * 0.05); // 北半圈
    const r = R0 + rng.range(8, 40);
    const w = rng.range(5, 14);
    const h = rng.range(10, 46) * (rng.chance(0.15) ? 0.45 : 1);
    const g = new BoxGeometry(w, h, rng.range(5, 12));
    g.rotateY(rng.range(0, Math.PI));
    g.translate(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    parts.push(tint(g, city, 0.4));
  }
  // 山：南面和西面一圈低矮的锥形山丘
  for (let i = 0; i < 26; i++) {
    const a = rng.range(Math.PI * 0.05, Math.PI * 0.95);
    const r = R0 + rng.range(15, 45);
    const h = rng.range(14, 34);
    const g = new CylinderGeometry(rng.range(2, 6), rng.range(22, 40), h, 7, 1);
    g.translate(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    parts.push(tint(g, hill, 0.25));
  }
  // 倒塌的高压电塔：细长的四棱锥 + 横担，几座歪着
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = R0 + rng.range(4, 14);
    const tower = new CylinderGeometry(0.35, 2.2, 24, 4, 1, true);
    const arm = new BoxGeometry(9, 0.4, 0.4);
    arm.translate(0, 9, 0);
    const t = mergeGeometries([tower.toNonIndexed(), arm.toNonIndexed()]) as BufferGeometry;
    if (rng.chance(0.5)) t.rotateZ(rng.range(0.4, 0.9) * (rng.chance(0.5) ? 1 : -1));
    t.rotateY(rng.range(0, Math.PI));
    t.translate(Math.cos(a) * r, 11, Math.sin(a) * r);
    parts.push(tint(t, steel, 0.2));
  }
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))) as BufferGeometry;
  for (const p of parts) p.dispose();
  // 不受光、受雾：远处自然融进天色
  const mat = new MeshBasicMaterial({ vertexColors: true, fog: true });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'vista';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const group = new Group();
  group.add(mesh);
  return {
    group,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
