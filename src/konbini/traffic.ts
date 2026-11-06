import { Group, PointLight, Vector3 } from 'three';
import { box3, type Solid, type World } from './ctx';
import { blobShadow } from './fx';
import { HALF, ROAD_A, ROAD_B } from './ground';
import type { Go } from './street';

/**
 * 偶尔开过的车：路 A 东西各一条车道、路 B 一条。遇到红灯会在停止线前停下，前面有人也会让。
 * 车有碰撞，车灯照在湿地面上会有反光（跟着车走的点光源）。按 E 可以让司机按一下喇叭。
 */
const PI = Math.PI;

interface Car {
  g: Group;
  /** 沿车道的位置（-HALF-6 .. HALF+6） */
  s: number;
  v: number;
  lane: 'aE' | 'aW' | 'bS';
  wait: number;
  light: PointLight;
  solid: Solid;
}

function carModel(W: World, color: number, taxi: boolean): Group {
  const k = W.kit();
  // 车头朝 +Z
  k.box(1.6, 0.62, 3.9, { y: 0.28 }, color);
  k.box(1.5, 0.52, 2.0, { y: 0.9, z: -0.25 }, color);
  k.box(1.52, 0.4, 1.6, { y: 0.95, z: -0.25 }, 0x223040); // 车窗
  k.push({ y: 0.92, z: 0.85, rx: -0.75 });
  k.box(1.46, 0.02, 0.6, {}, 0x223040);
  k.pop();
  k.box(1.64, 0.14, 0.12, { y: 0.26, z: 1.95 }, 0xb8bcc4);
  k.box(1.64, 0.14, 0.12, { y: 0.26, z: -1.95 }, 0xb8bcc4);
  for (const [x, z] of [
    [-0.72, 1.25],
    [0.72, 1.25],
    [-0.72, -1.25],
    [0.72, -1.25],
  ] as const) {
    k.cyl(0.3, 0.3, 0.2, 14, { x, y: 0.3, z, rz: PI / 2 }, 0x1a1a1a);
    k.cyl(0.16, 0.16, 0.205, 10, { x, y: 0.3, z, rz: PI / 2 }, 0xa8acb4);
  }
  for (const s of [-1, 1]) {
    k.box(0.36, 0.12, 0.02, { x: s * 0.55, y: 0.66, z: 1.95 }, 0xfff8e0, { glow: 3 });
    k.box(0.3, 0.1, 0.02, { x: s * 0.6, y: 0.68, z: -1.95 }, 0xff2a20, { glow: 2.4 });
  }
  if (taxi) {
    k.box(0.5, 0.18, 0.22, { y: 1.42, z: -0.2 }, 0xfff0a0, { glow: 1.6 }); // 行灯
    k.box(1.62, 0.08, 3.9, { y: 0.6 }, 0xd8a020);
  }
  k.shadows = false;
  const g = k.build('car');
  const b = blobShadow(1);
  b.scale.set(1.0, 1, 2.3);
  g.add(b);
  return g;
}

export function buildTraffic(W: World, go: () => Go): void {
  const cars: Car[] = [];
  const add = (lane: Car['lane'], s: number, color: number, taxi = false): void => {
    const g = carModel(W, color, taxi);
    W.add(g);
    // 车灯只用发光体 + 地面反射表现：跟着车跑的点光源会让整条街的光照每帧都在变（晃）
    const light = new PointLight(0xfff0d0, 0, 0.01, 2);
    light.visible = false;
    cars.push({ g, s, v: 7, lane, wait: 0, light, solid: W.solids.add(0, 0, 0, 0, 0, 0) });
  };
  add('aE', -30, 0x2a3a5a, true);
  add('aW', 10, 0xe8e8e4);
  add('bS', -45, 0x8a2a2a);
  const L = HALF + 8;

  // 车道 → 世界坐标、朝向；停止线位置（s 值）
  const place = (c: Car, out: Vector3): number => {
    switch (c.lane) {
      case 'aE':
        out.set(c.s, 0, ROAD_A.z1 - 1.6);
        return PI / 2;
      case 'aW':
        out.set(-c.s, 0, ROAD_A.z0 + 1.6);
        return -PI / 2;
      default:
        out.set(ROAD_B.x0 + 1.6, 0, c.s);
        return 0;
    }
  };
  // 停止线：aE 在斑马线（x 5.5）之前；aW 在 x 19.5 之前（s = -19.5）；bS 在 z 2 之前
  const stopAt: Record<Car['lane'], number> = { aE: 5.2, aW: -19.8, bS: 1.4 };
  const P = new Vector3();
  const F = new Vector3();
  W.tick.push((dt) => {
    for (const c of cars) {
      const green = go() === (c.lane === 'bS' ? 'B' : 'A');
      const yaw = place(c, P);
      F.set(Math.sin(yaw), 0, Math.cos(yaw));
      let target = 7.5;
      // 红灯：停止线前面减速停下
      const toStop = stopAt[c.lane] - (c.s + 2);
      if (!green && toStop > -0.5 && toStop < 18) target = Math.max(0, Math.min(target, toStop * 0.9));
      // 前方有人（玩家）：让行
      const pl = W.player;
      const dx = pl.x - P.x;
      const dz = pl.z - P.z;
      const ahead = dx * F.x + dz * F.z;
      const lat = Math.abs(dx * F.z - dz * F.x);
      if (ahead > 0 && ahead < 9 && lat < 1.4 && pl.y < 1) target = Math.min(target, Math.max(0, (ahead - 3) * 0.8));
      // 前车
      for (const o of cars) {
        if (o === c || o.lane !== c.lane) continue;
        const gap = o.s - c.s;
        if (gap > 0 && gap < 12) target = Math.min(target, Math.max(0, (gap - 6) * 0.9));
      }
      c.v += Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), dt * (target < c.v ? 9 : 3));
      c.s += c.v * dt;
      if (c.s > L) {
        // 开出底座以后，过一段随机的时间再出现
        c.wait += dt;
        c.g.visible = false;
        c.solid.on = false;
        if (c.wait > 6 + Math.random() * 20) {
          c.wait = 0;
          c.s = -L;
        }
        continue;
      }
      // 底座外面不画（车从底座边缘"开进来"）
      const inside = Math.abs(P.x) < HALF + 0.5 && Math.abs(P.z) < HALF + 0.5;
      c.g.visible = inside;
      void c.light;
      c.g.position.copy(P);
      c.g.rotation.y = yaw;
      c.light.position.copy(P).addScaledVector(F, 3.2).setY(0.7);
      // 碰撞盒（转成轴对齐）
      const hx = Math.abs(F.x) * 2 + Math.abs(F.z) * 0.8;
      const hz = Math.abs(F.z) * 2 + Math.abs(F.x) * 0.8;
      Object.assign(c.solid, { minx: P.x - hx, maxx: P.x + hx, minz: P.z - hz, maxz: P.z + hz, miny: 0, maxy: 1.5, on: true });
    }
  });
  for (const c of cars) {
    const b = box3(0, 0, 0, 0, 0, 0);
    W.interact({
      box: b,
      label: () => '向司机挥挥手',
      on: () => {
        b.min.set(c.solid.minx, 0, c.solid.minz);
        b.max.set(c.solid.maxx, 1.5, c.solid.maxz);
        return c.g.visible;
      },
      use: () => W.sfx.horn(),
    });
  }
}
