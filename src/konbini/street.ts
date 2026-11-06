import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PointLight, SpotLight, Vector3 } from 'three';
import { box3, type World } from './ctx';
import { ROAD_A } from './ground';

/**
 * 街道设施：路灯（可以开关）、电线杆 + 下垂的电线、红绿灯（车用 + 行人用，按按钮会提前变灯）、
 * 路牌、护栏、公告栏、小巷里的杂物（啤酒箱、自行车、盆栽、小猫）。
 */
const F = 0.15;
const PI = Math.PI;

export type Go = 'A' | 'B' | 'none';
export interface Street {
  lamps: SpotLight[];
  /** 信号灯给车流看的：现在哪条路可以走（黄灯也算） */
  go: () => Go;
}

export function buildStreet(W: World): Street {
  const lamps = buildLamps(W);
  buildPoles(W);
  const sig = buildSignals(W);
  buildSigns(W);
  buildAlley(W);
  return { lamps, go: sig };
}

// ---------------------------------------------------------------- 路灯
function buildLamps(W: World): SpotLight[] {
  const k = W.kit();
  const out: SpotLight[] = [];
  const spots: Array<[number, number, number]> = [
    // x, z, 灯头朝向（绕 Y）
    [-9.5, 6.3, 0],
    [8.6, -4, PI / 2],
    [17.2, 15.5, -PI / 2],
  ];
  spots.forEach(([x, z, ry]) => {
    k.push({ x, y: F, z, ry });
    k.cyl(0.07, 0.09, 5.2, 10, {}, 0x8a9098);
    k.cyl(0.13, 0.13, 0.4, 10, {}, 0x6a6e76);
    k.tube([new Vector3(0, 5.1, 0), new Vector3(0, 5.5, 0.4), new Vector3(0, 5.55, 1.2)], 0.045, 0x8a9098);
    k.box(0.3, 0.12, 0.6, { y: 5.45, z: 1.35 }, 0x6a6e76);
    k.pop();
    W.solids.add(x - 0.12, F, z - 0.12, x + 0.12, F + 5.3, z + 0.12);
    // 发光的灯罩单独一组（关灯时换成暗色）
    const g = new Group();
    const lk = W.kit();
    lk.push({ x, y: F, z, ry });
    lk.box(0.26, 0.03, 0.54, { y: 5.42, z: 1.35 }, 0xfff2d0, { glow: 3 });
    lk.pop();
    g.add(lk.build('lampGlow'));
    W.add(g);
    const head = new Vector3(x + Math.sin(ry) * 1.35, F + 5.4, z + Math.cos(ry) * 1.35);
    const l = new SpotLight(0xffe8c0, 70, 16, 0.95, 0.55, 1.5);
    l.position.copy(head);
    l.target.position.set(head.x + Math.sin(ry) * 1.2, 0, head.z + Math.cos(ry) * 1.2);
    // 路灯不投影：每盏投影的灯每帧都要把整个场景再画一遍（卡），色阶阴影边缘走动时还会抖
    l.castShadow = false;
    W.add(l);
    W.add(l.target);
    out.push(l);
    const on = { v: true };
    const base = l.intensity;
    W.interact({
      box: box3(x - 0.2, F, z - 0.2, x + 0.2, F + 1.6, z + 0.2),
      label: () => (on.v ? '关掉这盏路灯（检修开关）' : '打开路灯'),
      use: () => {
        on.v = !on.v;
        W.sfx.click();
      },
    });
    // 一盏路灯偶尔接触不良：闪两下
    const flicky = out.length === 2;
    let ft = 6;
    W.tick.push((dt) => {
      let k2 = on.v ? 1 : 0;
      if (flicky && on.v) {
        ft -= dt;
        if (ft < 0) {
          if (ft < -0.6) ft = 8 + Math.random() * 10;
          k2 = Math.random() < 0.5 ? 0.15 : 1;
        }
      }
      l.intensity = base * k2;
      g.visible = k2 > 0.5;
    });
  });
  W.add(k.build('lamps'));
  return out;
}

// ---------------------------------------------------------------- 电线杆 + 电线
function buildPoles(W: World): void {
  const k = W.kit();
  const poles: Vector3[] = [new Vector3(-12, F, 6.3), new Vector3(-7, F, 6.4), new Vector3(9.0, F, 5.2), new Vector3(8.5, F, -8), new Vector3(17.5, F, 6), new Vector3(17.5, F, -10)];
  const H = 8.2;
  poles.forEach((p, i) => {
    k.cyl(0.13, 0.17, H, 12, { x: p.x, y: p.y, z: p.z }, 0x9a9a98);
    // 黄黑相间的防撞套（下半截）
    for (let j = 0; j < 5; j++) k.cyl(0.18, 0.18, 0.22, 12, { x: p.x, y: p.y + 0.1 + j * 0.44, z: p.z }, j % 2 ? 0x1a1a1a : 0xf0c030);
    // 横担 + 绝缘子
    for (const [y, w] of [
      [H - 0.4, 1.6],
      [H - 1.1, 1.2],
    ] as const) {
      const along = i < 3 ? 'z' : 'x';
      k.box(along === 'z' ? 0.1 : w, 0.1, along === 'z' ? w : 0.1, { x: p.x, y: p.y + y, z: p.z }, 0x6a6a6a);
      for (const s of [-0.6, -0.2, 0.2, 0.6]) {
        if (Math.abs(s) * 2 > w) continue;
        k.cyl(0.04, 0.05, 0.12, 8, { x: p.x + (along === 'x' ? s : 0), y: p.y + y + 0.1, z: p.z + (along === 'z' ? s : 0) }, 0xe8e8e0);
      }
    }
    // 变压器（第二根杆子上）
    if (i === 1) {
      k.cyl(0.3, 0.3, 0.9, 14, { x: p.x + 0.35, y: p.y + 5.5, z: p.z }, 0x8a9098);
      k.cyl(0.32, 0.32, 0.06, 14, { x: p.x + 0.35, y: p.y + 6.4, z: p.z }, 0x6a6e76);
    }
    // 杆上的街区编号牌
    k.box(0.02, 0.6, 0.16, { x: p.x + 0.15, y: p.y + 2.4, z: p.z }, 0x1e52b4);
    k.box(0.15, 0.03, 0.03, { x: p.x + 0.08, y: p.y + 4, z: p.z }, 0x555555);
    // 爬杆用的脚钉
    for (let j = 0; j < 8; j++) k.cyl(0.012, 0.012, 0.18, 4, { x: p.x, y: p.y + 2.8 + j * 0.45, z: p.z, rz: PI / 2, ry: (j % 2) * PI }, 0x555555);
    W.solids.add(p.x - 0.2, F, p.z - 0.2, p.x + 0.2, F + H, p.z + 0.2);
  });
  // 电线：相邻两杆之间下垂的悬链，每档 4 根
  const spans: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 4],
    [2, 3],
    [4, 5],
  ];
  for (const [a, b] of spans) {
    const pa = poles[a] as Vector3;
    const pb = poles[b] as Vector3;
    for (const [y, off, sag, r] of [
      [H - 0.3, -0.6, 0.55, 0.012],
      [H - 0.3, 0.6, 0.6, 0.012],
      [H - 1.0, -0.4, 0.75, 0.015],
      [H - 1.0, 0.4, 0.7, 0.01],
    ] as const) {
      const dir = new Vector3().subVectors(pb, pa).normalize();
      const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar(off);
      const pts: Vector3[] = [];
      for (let t = 0; t <= 12; t++) {
        const u = t / 12;
        const p = new Vector3().lerpVectors(pa, pb, u).add(side);
        p.y = F + y - sag * 4 * u * (1 - u);
        pts.push(p);
      }
      k.tube(pts, r, 0x1a1a1e, { seg: 24 });
    }
  }
  // 电线杆到店铺屋顶的入户线
  k.tube([new Vector3(-7, F + H - 1.2, 6.4), new Vector3(-6.6, 6, 2), new Vector3(-6, 4.1, -2.1)], 0.01, 0x1a1a1e, { seg: 16 });
  W.add(k.build('poles'));
}

// ---------------------------------------------------------------- 红绿灯
function buildSignals(W: World): () => Go {
  const k = W.kit();
  // 车用信号灯：装在路口西北角的杆子上，横臂伸到路 A 上方（朝东 / 朝西各一组）
  const px = 9.2;
  const pz = 6.2;
  k.cyl(0.1, 0.12, 5.8, 10, { x: px, y: F, z: pz }, 0x8a9098);
  k.box(0.08, 0.08, 4.2, { x: px, y: F + 5.4, z: pz + 2.1 }, 0x8a9098);
  k.box(4.0, 0.08, 0.08, { x: px + 2.0, y: F + 5.4, z: pz }, 0x8a9098);
  W.solids.add(px - 0.14, F, pz - 0.14, px + 0.14, F + 5.8, pz + 0.14);
  // 灯头位置：A 方向（朝 -X，给从东往西开的车看）+ B 方向（朝 +Z）
  const headA = new Vector3(px + 0.1, F + 5.0, pz + 3.6);
  const headB = new Vector3(px + 3.6, F + 5.0, pz + 0.1);
  const lampMat = (c: number): MeshBasicMaterial => new MeshBasicMaterial({ color: c, toneMapped: false });
  type Lamp = { m: Mesh; on: number; off: number };
  const mkHead = (c: Vector3, ry: number): Lamp[] => {
    k.push({ x: c.x, y: c.y, z: c.z, ry });
    k.box(1.2, 0.42, 0.28, {}, 0x5a6068);
    for (let i = 0; i < 3; i++) {
      k.box(0.36, 0.06, 0.2, { x: -0.4 + i * 0.4, y: 0.38, z: 0.15 }, 0x4a5058); // 遮光帽
    }
    k.pop();
    const out: Lamp[] = [];
    const cols = [0x2aff8a, 0xffc020, 0xff2a20];
    cols.forEach((col, i) => {
      const m = new Mesh(new CylinderGeometry(0.15, 0.15, 0.03, 16), lampMat(0x111111));
      m.position.set(c.x, c.y + 0.21, c.z);
      m.rotation.set(PI / 2, 0, 0);
      m.rotation.order = 'YXZ';
      m.rotation.y = ry;
      const off = -0.4 + i * 0.4;
      m.position.x += Math.cos(ry) * off + Math.sin(ry) * 0.15;
      m.position.z += -Math.sin(ry) * off + Math.cos(ry) * 0.15;
      W.add(m);
      out.push({ m, on: col, off: 0x1a1a1a });
    });
    return out;
  };
  const A = mkHead(headA, PI / 2);
  const B = mkHead(headB, 0);
  // 行人信号灯：路 A 的斑马线两端（朝南 / 朝北）
  const ped: Array<{ red: Mesh; green: Mesh }> = [];
  const mkPed = (x: number, z: number, ry: number): void => {
    k.cyl(0.07, 0.08, 3.0, 8, { x, y: F, z }, 0x8a9098);
    k.push({ x, y: F + 2.2, z, ry });
    k.box(0.34, 0.75, 0.22, {}, 0x5a6068);
    k.box(0.3, 0.04, 0.12, { y: 0.36, z: 0.14 }, 0x4a5058);
    k.box(0.3, 0.04, 0.12, { y: 0.74, z: 0.14 }, 0x4a5058);
    k.pop();
    // 按钮盒
    k.push({ x, y: F + 1.1, z, ry });
    k.box(0.16, 0.24, 0.1, { z: 0.08 }, 0xf0c030);
    k.cyl(0.03, 0.03, 0.02, 10, { y: 0.1, z: 0.13, rx: PI / 2 }, 0xd8202a);
    k.pop();
    W.solids.add(x - 0.1, F, z - 0.1, x + 0.1, F + 3, z + 0.1);
    const red = new Mesh(new BoxGeometry(0.24, 0.3, 0.02), lampMat(0x111111));
    const green = new Mesh(new BoxGeometry(0.24, 0.3, 0.02), lampMat(0x111111));
    for (const [m, y] of [
      [red, 0.55],
      [green, 0.17],
    ] as const) {
      m.position.set(x + Math.sin(ry) * 0.115, F + 2.2 + y, z + Math.cos(ry) * 0.115);
      m.rotation.y = ry;
      W.add(m);
    }
    ped.push({ red, green });
    W.interact({
      box: box3(x - 0.15, F + 0.95, z - 0.15, x + 0.15, F + 1.4, z + 0.15),
      label: () => '按下行人过街按钮',
      use: () => {
        press = true;
        W.sfx.beep();
        W.say('「おまちください」 请稍等，马上变绿灯');
      },
    });
  };
  mkPed(5.4, ROAD_A.z0 - 0.4, PI);
  mkPed(5.4, ROAD_A.z1 + 0.4, 0);
  W.add(k.build('signals'));

  // 相位：A 绿 14s → A 黄 3s → 全红 2s → B 绿 12s → B 黄 3s → 全红 2s
  // 路 A 是绿灯时，横穿路 A 的行人是红灯；B 方向绿灯时行人绿灯（最后 4 秒闪烁）
  const cycle = [
    ['ag', 14],
    ['ay', 3],
    ['r1', 2],
    ['bg', 12],
    ['by', 3],
    ['r2', 2],
  ] as const;
  let phase = 0;
  let t = 0;
  let press = false;
  const set = (L: Lamp[], i: number): void => L.forEach((l, j) => (l.m.material as MeshBasicMaterial).color.setHex(j === i ? l.on : l.off));
  let time = 0;
  W.tick.push((dt) => {
    time += dt;
    t += dt;
    const [name, dur] = cycle[phase] as readonly [string, number];
    // 按了按钮：A 绿灯缩短到最多再等 3 秒
    let d = dur;
    if (press && name === 'ag') d = Math.min(dur, t + 3);
    if (t >= d) {
      t = 0;
      phase = (phase + 1) % cycle.length;
      if (name === 'ag') press = false;
    }
    const n = (cycle[phase] as readonly [string, number])[0];
    set(A, n === 'ag' ? 0 : n === 'ay' ? 1 : 2);
    set(B, n === 'bg' ? 0 : n === 'by' ? 1 : 2);
    const pedGreen = n === 'bg';
    const blink = pedGreen && t > 8 && Math.sin(time * 12) < 0;
    for (const p of ped) {
      (p.red.material as MeshBasicMaterial).color.setHex(pedGreen ? 0x1a1a1a : 0xff3a2a);
      (p.green.material as MeshBasicMaterial).color.setHex(pedGreen && !blink ? 0x2aff9a : 0x1a1a1a);
    }
  });
  return () => {
    const n = (cycle[phase] as readonly [string, number])[0];
    return n === 'ag' || n === 'ay' ? 'A' : n === 'bg' || n === 'by' ? 'B' : 'none';
  };
}


// ---------------------------------------------------------------- 路牌、护栏、公告栏
function buildSigns(W: World): void {
  const A = W.atlas;
  const k = W.kit();
  const sign = (x: number, z: number, ry: number, tile: string, w: number, h: number, y = 2.4, round = false): void => {
    k.cyl(0.04, 0.04, y + h / 2, 8, { x, y: F, z }, 0x9aa0a8);
    k.push({ x, y: F + y, z, ry });
    if (round) k.cyl(w / 2, w / 2, 0.02, 24, { z: 0.04, rx: PI / 2 }, 0xffffff, { tex: A.get(tile), faces: [] });
    k.box(w, h, 0.02, { z: 0.05 }, 0xffffff, { tex: A.get(tile) });
    k.box(w, h, 0.01, { z: 0.035 }, 0x9aa0a8);
    k.pop();
    W.solids.add(x - 0.06, F, z - 0.06, x + 0.06, F + y, z + 0.06);
  };
  // 横断步道标志（斑马线旁）、P 停车标志、地名牌、限速
  sign(4.4, 6.3, 0, 'road0', 0.6, 0.6);
  sign(-7.6, -1.4, 0, 'road1', 0.5, 0.5, 2.0);
  sign(9.6, -5.5, PI / 2, 'road2', 1.4, 0.58, 2.7);
  sign(16.6, 13.6, -PI / 2, 'road3', 0.6, 0.6);
  // 路 B 西侧、路 A 北侧的护栏（白色管栏），留出斑马线和店门口的缺口
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / 1.8));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      k.cyl(0.035, 0.035, 0.85, 8, { x: x0 + (x1 - x0) * u, y: F, z: z0 + (z1 - z0) * u }, 0xe8e8e4);
    }
    for (const y of [0.45, 0.82]) k.tube([new Vector3(x0, F + y, z0), new Vector3(x1, F + y, z1)], 0.025, 0xe8e8e4, { seg: 2 });
    W.solids.add(Math.min(x0, x1) - 0.05, F, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, F + 0.9, Math.max(z0, z1) + 0.05);
  };
  rail(9.75, -18, 9.75, -6.5);
  rail(9.75, -2, 9.75, 1.6);
  rail(-18, 6.75, -11.5, 6.75);
  rail(16.25, -18, 16.25, 1.8);
  rail(16.25, 13.7, 16.25, 18);
  rail(-18, 13.25, 4.8, 13.25);
  // 街角的黄色防撞柱
  for (const [x, z] of [
    [9.7, 6.6],
    [9.0, 6.75],
    [16.3, 6.6],
    [9.7, 13.4],
  ] as const) {
    k.cyl(0.08, 0.08, 0.8, 10, { x, y: F, z }, 0xf0c030);
    k.cyl(0.085, 0.085, 0.08, 10, { x, y: F + 0.55, z }, 0x1a1a1a);
    W.solids.add(x - 0.09, F, z - 0.09, x + 0.09, F + 0.8, z + 0.09);
  }
  // 公告栏：小巷口，带小雨檐，贴着町内会的通知
  {
    const x = -9.5;
    const z = 4.2;
    k.push({ x, y: F, z, ry: PI / 2 });
    for (const s of [-0.75, 0.75]) k.box(0.06, 1.9, 0.06, { x: s }, 0x5a4030);
    k.box(1.6, 0.9, 0.06, { y: 0.85 }, 0x3a6a4a);
    k.box(1.7, 0.04, 0.3, { y: 1.85, z: 0.05, rx: 0.2 }, 0x6a5040);
    for (let i = 0; i < 4; i++) k.box(0.32, 0.44, 0.005, { x: -0.55 + i * 0.37, y: 1.07 + (i % 2) * 0.04 - 0.04, z: 0.033, rz: (i - 1.5) * 0.03 }, 0xffffff, { tex: A.get(`notice${i}`) });
    k.pop();
    W.solids.add(x - 0.1, F, z - 0.8, x + 0.1, F + 1.9, z + 0.8);
    W.interact({
      box: box3(x - 0.1, F + 0.8, z - 0.8, x + 0.15, F + 1.8, z + 0.8),
      label: () => '看看町内会的公告',
      use: () => W.say('夏まつり：8月第一土曜 ／ 防犯パトロール ／ 迷いねこ「しろ」を探しています ／ ゴミ出しは月・木'),
    });
  }
  W.add(k.build('signs'));
}

// ---------------------------------------------------------------- 小巷
function buildAlley(W: World): void {
  const k = W.kit();
  // 啤酒箱 + 空瓶
  for (let i = 0; i < 5; i++) {
    const x = -10.6;
    const z = -6 - (i % 3) * 0.5;
    const y = F + Math.floor(i / 3) * 0.3;
    k.box(0.45, 0.3, 0.35, { x, y, z }, i % 2 ? 0xd8a020 : 0xd8402a);
    for (let j = 0; j < 4; j++) k.cyl(0.03, 0.03, 0.26, 6, { x: x - 0.12 + (j % 2) * 0.24, y: y + 0.05, z: z - 0.08 + Math.floor(j / 2) * 0.16 }, 0x6a3a1a);
  }
  W.solids.add(-10.85, F, -7.2, -10.35, F + 0.65, -5.8);
  // 盆栽（门口的牵牛花、大葱、绿植）
  for (const [x, z, s] of [
    [-10.7, -2.5, 1],
    [-10.7, -1.8, 0.8],
    [-10.7, -3.3, 1.2],
  ] as const) {
    k.cyl(0.16 * s, 0.12 * s, 0.25 * s, 10, { x, y: F, z }, 0xb8603a);
    k.sphere(0.24 * s, { x, y: F + 0.38 * s, z }, 0x3a7a3a, { seg: 8 });
    k.sphere(0.16 * s, { x: x + 0.08, y: F + 0.55 * s, z: z + 0.05 }, 0x4a8a3a, { seg: 7 });
  }
  W.solids.add(-10.95, F, -3.6, -10.45, F + 0.6, -1.6);
  // 室外机 + 煤气表 + 管道（店铺西墙外）
  for (let i = 0; i < 2; i++) {
    const z = -10 + i * 1.2;
    k.box(0.32, 0.6, 0.8, { x: -8.18, y: F, z }, 0xe4e4e0);
    k.cyl(0.22, 0.22, 0.02, 14, { x: -8.35, y: F + 0.3, z, rz: PI / 2 }, 0x333333);
  }
  W.solids.add(-8.4, F, -10.5, -8, F + 0.6, -8.4);
  k.box(0.2, 0.3, 0.15, { x: -8.1, y: F + 1.2, z: -5 }, 0xd8d8d0);
  k.cyl(0.03, 0.03, 3.2, 6, { x: -8.06, y: F, z: -4.6 }, 0x9a9a9a);
  // 小巷深处挂着的灯笼（红）和一盏昏暗的壁灯
  k.cyl(0.18, 0.18, 0.45, 12, { x: -10.8, y: 2.3, z: -12.5 }, 0xd8302a, { glow: 1.3 });
  k.cyl(0.19, 0.19, 0.04, 12, { x: -10.8, y: 2.3, z: -12.5 }, 0x1a1a1a);
  k.cyl(0.19, 0.19, 0.04, 12, { x: -10.8, y: 2.71, z: -12.5 }, 0x1a1a1a);
  const lan = new PointLight(0xff6040, 3, 5, 2);
  lan.position.set(-10.5, 2.4, -12.5);
  W.add(lan);
  // 小猫：小巷里蹲在纸箱上，按 E 会叫
  const cat = new Group();
  const ck = W.kit();
  ck.box(0.5, 0.35, 0.4, {}, 0xb8905a);
  ck.box(0.52, 0.02, 0.42, { y: 0.35 }, 0xa8804a);
  ck.sphere(0.13, { y: 0.47, z: 0.0 }, 0xf4f4f0, { sy: 0.8 });
  ck.sphere(0.09, { y: 0.6, z: 0.1 }, 0xf4f4f0);
  for (const s of [-1, 1]) {
    ck.cyl(0.0, 0.035, 0.07, 4, { x: s * 0.05, y: 0.66, z: 0.09 }, 0xf4f4f0);
    ck.box(0.02, 0.025, 0.005, { x: s * 0.035, y: 0.62, z: 0.185 }, 0x3ab05a);
  }
  ck.tube([new Vector3(0, 0.4, -0.12), new Vector3(0.1, 0.38, -0.2), new Vector3(0.2, 0.45, -0.15)], 0.02, 0xf4f4f0);
  cat.add(ck.build('cat'));
  cat.position.set(-10.5, F, -9.2);
  cat.rotation.y = PI / 2;
  W.add(cat);
  W.solids.add(-10.75, F, -9.45, -10.25, F + 0.4, -8.95);
  let meow = -1;
  W.interact({
    box: box3(-10.75, F, -9.45, -10.25, F + 0.75, -8.95),
    label: () => '摸摸小白猫',
    use: () => {
      meow = 0;
      W.sfx.tone(780, 0.5, 0.06, 'triangle', 0, 0.7);
      W.say('「にゃあ」…是公告栏上走丢的小白（しろ）');
    },
  });
  W.tick.push((dt, t) => {
    cat.rotation.z = Math.sin(t * 1.3) * 0.015;
    if (meow >= 0) {
      meow += dt;
      cat.scale.y = 1 + Math.sin(meow * 20) * 0.03 * Math.max(0, 1 - meow);
      if (meow > 1) meow = -1;
    }
  });
  W.add(k.build('alley'));
}
