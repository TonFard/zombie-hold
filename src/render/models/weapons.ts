import { Group, Vector3 } from 'three';
import type { WeaponKind } from '../../game/data/weapons';
import { Builder, toGroup, type Style } from '../kit';

/**
 * 武器模型。局部坐标：原点在后握把（右手位置），枪口朝 +Z，上方为 +Y，单位为米。
 * 每升一级会多出可见的配件（弹鼓、瞄具、枪口装置、发光件……），所以武器等级一眼能看出来。
 */
export interface WeaponModel {
  group: Group;
  /** 右手（扳机手）和左手（托举手）的握点 */
  gripR: Vector3;
  gripL: Vector3;
  muzzle: Vector3;
  /** 抛壳口 */
  eject: Vector3;
}

const steel = (c = 0x4c535a, o: Partial<Style> = {}): Style => ({ color: c, mat: 'metal', jitter: 0.1, ao: 0.1, aoH: 0.3, ...o });
const dark = (c = 0x2b2e33, o: Partial<Style> = {}): Style => ({ color: c, mat: 'metal', jitter: 0.08, ao: 0.05, aoH: 0.3, ...o });
const poly = (c = 0x1b1c1e, o: Partial<Style> = {}): Style => ({ color: c, jitter: 0.08, ao: 0.05, aoH: 0.3, ...o });
const wood = (c = 0x6b4a2e, o: Partial<Style> = {}): Style => ({ color: c, jitter: 0.2, ao: 0.1, aoH: 0.3, ...o });
const glow = (c: number, k = 2): Style => ({ color: c, mat: 'glow', glow: k });

// 枪的零件经常沿 Z 轴放置的圆柱：rx = π/2 让圆柱轴线朝 +Z
const Z = Math.PI / 2;

function pistol(b: Builder, t: number): Pick<WeaponModel, 'gripR' | 'gripL' | 'muzzle' | 'eject'> {
  const slideLen = 0.2 + (t >= 1 ? 0.035 : 0);
  const slideCol = t >= 5 ? 0x9aa1a8 : 0x5a6169;
  // 套筒、枪身、握把
  b.rbox(0.034, 0.042, slideLen, 0.008, { y: 0.03, z: slideLen / 2 - 0.035 }, steel(slideCol));
  b.rbox(0.03, 0.03, 0.18, 0.006, { y: 0.0, z: 0.06 }, poly());
  b.rbox(0.032, 0.115, 0.046, 0.01, { y: -0.115, z: -0.012, rx: -0.14 }, poly(0x202224));
  // 握把防滑纹
  for (let i = 0; i < 4; i++) b.box(0.034, 0.004, 0.044, { y: -0.06 - i * 0.022, z: -0.016 - i * 0.003, rx: -0.14 }, poly(0x0e0f10, { jitter: 0 }));
  // 套筒后部拉栓纹
  for (let i = 0; i < 4; i++) b.box(0.036, 0.03, 0.004, { y: 0.034, z: -0.028 + i * 0.01 }, dark(0x22252a, { jitter: 0 }));
  // 抛壳口
  b.box(0.036, 0.012, 0.04, { y: 0.05, z: 0.03 }, dark(0x15171a, { jitter: 0 }));
  // 枪口
  b.cyl(0.0085, 0.0085, t >= 1 ? 0.05 : 0.02, 8, { y: 0.03, z: slideLen - 0.04, rx: Z }, dark(0x14161a));
  // 护圈、扳机
  b.box(0.018, 0.01, 0.06, { y: -0.03, z: 0.09 }, poly());
  b.box(0.018, 0.034, 0.008, { y: -0.062, z: 0.118 }, poly());
  b.box(0.008, 0.02, 0.01, { y: -0.026, z: 0.07 }, steel(0x8a8e92));
  // 准星、照门
  b.box(0.006, 0.012, 0.008, { y: 0.072, z: slideLen - 0.05 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.026, 0.01, 0.008, { y: 0.072, z: -0.022 }, dark());
  // 击锤
  if (t >= 3) {
    b.box(0.004, 0.018, 0.012, { x: -0.004, y: 0.064, z: -0.04 }, steel(0xc0c4c8, { jitter: 0 }));
    b.box(0.004, 0.018, 0.012, { x: 0.004, y: 0.064, z: -0.04 }, steel(0xc0c4c8, { jitter: 0 }));
  } else {
    b.box(0.01, 0.016, 0.014, { y: 0.064, z: -0.04 }, dark());
  }
  // 弹匣：2 级加长
  const magExtra = t >= 2 ? 0.05 : 0;
  b.rbox(0.026, 0.02 + magExtra, 0.04, 0.005, { y: -0.2 - magExtra, z: -0.004, rx: -0.14 }, steel(0x3a3f45));
  b.box(0.032, 0.014, 0.05, { y: -0.2 - magExtra, z: -0.004, rx: -0.14 }, poly(0x101112));
  // 4 级：喇叭口弹匣井
  if (t >= 4) b.box(0.05, 0.022, 0.07, { y: -0.185, z: -0.012, rx: -0.14 }, steel(0x6a7078));
  // 5 级：红点镜
  if (t >= 5) {
    b.rbox(0.022, 0.02, 0.05, 0.004, { y: 0.074, z: 0.02 }, dark(0x16181a));
    b.box(0.014, 0.014, 0.004, { y: 0.09, z: 0.043 }, glow(0xff2a1a, 2.4));
    b.box(0.003, 0.003, 0.003, { y: 0.094, z: 0.04 }, glow(0xff6a5a, 3));
  }
  return {
    gripR: new Vector3(0, -0.075, -0.004),
    gripL: new Vector3(0.028, -0.082, 0.02),
    muzzle: new Vector3(0, 0.03, slideLen - 0.03 + (t >= 1 ? 0.05 : 0.02)),
    eject: new Vector3(0.02, 0.05, 0.03),
  };
}

function smg(b: Builder, t: number): Pick<WeaponModel, 'gripR' | 'gripL' | 'muzzle' | 'eject'> {
  // 机匣
  b.rbox(0.048, 0.062, 0.24, 0.01, { y: 0.0, z: 0.1 }, dark(0x30343a));
  b.box(0.036, 0.012, 0.22, { y: 0.062, z: 0.1 }, steel(0x5a6068));
  for (let i = 0; i < 9; i++) b.box(0.038, 0.006, 0.008, { y: 0.07, z: 0.0 + i * 0.024 }, dark(0x22252a, { jitter: 0 }));
  // 枪管护套（带散热孔）
  b.rbox(0.04, 0.042, 0.2, 0.008, { y: 0.01, z: 0.32 }, steel(0x484e55));
  for (let i = 0; i < 5; i++) b.box(0.044, 0.014, 0.012, { y: 0.024, z: 0.25 + i * 0.035 }, dark(0x14161a, { jitter: 0 }));
  const barrelLen = t >= 4 ? 0.12 : 0.06;
  b.cyl(0.0095, 0.0095, barrelLen, 8, { y: 0.03, z: 0.42, rx: Z }, dark(0x14161a));
  const muzzleZ = 0.42 + barrelLen;
  // 手枪握把
  b.rbox(0.034, 0.11, 0.042, 0.01, { y: -0.1, z: 0.0, rx: -0.3 }, poly(0x1e2022));
  for (let i = 0; i < 4; i++) b.box(0.036, 0.004, 0.04, { y: -0.05 - i * 0.022, z: -0.012 - i * 0.007, rx: -0.3 }, poly(0x0e0f10, { jitter: 0 }));
  // 扳机护圈
  b.box(0.018, 0.01, 0.07, { y: -0.04, z: 0.07 }, poly());
  b.box(0.008, 0.02, 0.008, { y: -0.03, z: 0.07 }, steel(0x8a8e92));
  // 弹匣：直弹匣，2 级以上换成弹鼓
  if (t >= 2) {
    b.cyl(0.07, 0.07, 0.06, 14, { x: -0.03, y: -0.09, z: 0.14, rz: Z }, steel(0x3f454c));
    b.cyl(0.072, 0.072, 0.012, 14, { x: 0.03, y: -0.09, z: 0.14, rz: Z }, steel(0x70767e));
    b.cyl(0.02, 0.02, 0.07, 8, { x: -0.03, y: -0.09, z: 0.14, rz: Z }, dark());
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(0.012, 0.008, 0.012, { x: 0.04, y: -0.09 + Math.sin(a) * 0.045, z: 0.14 + Math.cos(a) * 0.045 }, dark(0x14161a, { jitter: 0 }));
    }
  } else {
    b.rbox(0.03, 0.17, 0.04, 0.006, { y: -0.17, z: 0.14, rx: 0.1 }, steel(0x353a40));
    if (t >= 1) b.box(0.032, 0.02, 0.042, { y: -0.17, z: 0.134 }, poly(0xc03a2a, { jitter: 0.05 })); // 1 级：钢芯弹的红色标记
  }
  // 前握把
  b.rbox(0.03, 0.08, 0.035, 0.008, { y: -0.075, z: 0.32 }, poly(0x2a2c2e));
  // 枪托：折叠钢丝，3 级换成厚枪托
  if (t >= 3) {
    b.rbox(0.04, 0.09, 0.22, 0.012, { y: -0.015, z: -0.13, rx: 0.06 }, poly(0x242628));
    b.rbox(0.042, 0.1, 0.02, 0.006, { y: -0.02, z: -0.25, rx: 0.06 }, poly(0x0e0f10));
    b.box(0.03, 0.03, 0.06, { y: 0.02, z: -0.08 }, dark());
  } else {
    b.rod([0.012, 0.0, -0.01], [0.012, -0.02, -0.26], 0.006, dark(), 5);
    b.rod([-0.012, 0.0, -0.01], [-0.012, -0.02, -0.26], 0.006, dark(), 5);
    b.rod([0.012, 0.0, -0.1], [-0.012, 0.0, -0.1], 0.005, dark(), 5);
    b.box(0.036, 0.07, 0.012, { y: -0.055, z: -0.265 }, dark());
  }
  // 照门准星
  b.box(0.006, 0.02, 0.006, { y: 0.07, z: 0.4 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.03, 0.016, 0.006, { y: 0.07, z: 0.02 }, dark());
  // 4 级：补偿器
  if (t >= 4) {
    b.cyl(0.016, 0.016, 0.05, 8, { y: 0.03, z: muzzleZ, rx: Z }, dark(0x1c1e22));
    for (let i = 0; i < 3; i++) b.box(0.036, 0.006, 0.008, { y: 0.03, z: muzzleZ + 0.012 + i * 0.012 }, dark(0x0a0a0c, { jitter: 0 }));
  }
  // 5 级：过热散热片和发光热管
  if (t >= 5) {
    for (let i = 0; i < 7; i++) b.box(0.05, 0.05, 0.006, { y: 0.01, z: 0.24 + i * 0.026 }, steel(0x7a828a));
    b.box(0.006, 0.006, 0.2, { x: 0.026, y: 0.012, z: 0.32 }, glow(0xff8a2a, 2.2));
    b.box(0.006, 0.006, 0.2, { x: -0.026, y: 0.012, z: 0.32 }, glow(0xff8a2a, 2.2));
  }
  return {
    gripR: new Vector3(0, -0.07, -0.01),
    gripL: new Vector3(0, -0.07, 0.32),
    muzzle: new Vector3(0, 0.03, muzzleZ + (t >= 4 ? 0.05 : 0)),
    eject: new Vector3(0.03, 0.04, 0.1),
  };
}

function shotgun(b: Builder, t: number): Pick<WeaponModel, 'gripR' | 'gripL' | 'muzzle' | 'eject'> {
  // 枪托与握把：枪托前端要顶到机匣后端（z≈-0.04），中心在 z=-0.2，长 0.32
  b.rbox(0.042, 0.1, 0.34, 0.012, { y: -0.035, z: -0.2, rx: 0.06 }, wood());
  b.rbox(0.044, 0.12, 0.02, 0.006, { y: -0.045, z: -0.36, rx: 0.06 }, poly(0x1c1c1e));
  b.rbox(0.034, 0.09, 0.042, 0.01, { y: -0.08, z: -0.012, rx: -0.2 }, wood(0x5a3c24));
  // 机匣
  b.rbox(0.05, 0.07, 0.24, 0.01, { y: 0.0, z: 0.08 }, dark(0x30343a));
  b.box(0.052, 0.022, 0.14, { y: 0.0, z: 0.08 }, steel(0x6a7078)); // 抛壳口
  b.box(0.01, 0.03, 0.01, { x: 0.026, y: 0.01, z: 0.06 }, steel(0xb8943c)); // 黄铜弹壳
  // 枪管
  const choke = t >= 1;
  b.cyl(0.0145, 0.0145, 0.55, 10, { y: 0.032, z: 0.2, rx: Z }, dark(0x22252a));
  b.cyl(choke ? 0.02 : 0.0165, choke ? 0.02 : 0.0165, 0.04, 10, { y: 0.032, z: 0.71, rx: Z }, dark(0x14161a));
  // 管状弹仓（2 级加长）
  const tube = 0.4 + (t >= 2 ? 0.12 : 0);
  b.cyl(0.0125, 0.0125, tube, 8, { y: -0.012, z: 0.2, rx: Z }, steel(0x3a3f45));
  b.cyl(0.016, 0.016, 0.015, 8, { y: -0.012, z: 0.2 + tube, rx: Z }, steel(0x6a7078));
  // 泵动护木
  b.rbox(0.05, 0.05, 0.17, 0.014, { y: -0.036, z: 0.36 }, wood(0x7a5632));
  for (let i = 0; i < 6; i++) b.box(0.052, 0.004, 0.006, { y: -0.02, z: 0.3 + i * 0.026 }, wood(0x2a1c10, { jitter: 0 }));
  // 准星
  b.box(0.005, 0.014, 0.006, { y: 0.058, z: 0.74 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.008, 0.008, 0.5, { y: 0.054, z: 0.2 }, steel(0x484e55)); // 瞄准条
  // 扳机护圈
  b.box(0.018, 0.01, 0.07, { y: -0.04, z: 0.06 }, dark());
  b.box(0.008, 0.02, 0.008, { y: -0.03, z: 0.05 }, steel(0x8a8e92));
  // 3 级：散热罩（十弹丸，枪管更粗）
  if (t >= 3) {
    b.rbox(0.04, 0.026, 0.3, 0.008, { y: 0.056, z: 0.34 }, steel(0x5a6068));
    for (let i = 0; i < 6; i++) b.box(0.042, 0.01, 0.014, { y: 0.07, z: 0.22 + i * 0.045 }, dark(0x14161a, { jitter: 0 }));
  }
  // 4 级：侧挂弹袋，红色霰弹
  if (t >= 4) {
    b.box(0.012, 0.045, 0.1, { x: -0.03, y: 0.0, z: 0.09 }, poly(0x3a2c20));
    for (let i = 0; i < 4; i++) {
      b.cyl(0.011, 0.011, 0.045, 8, { x: -0.04, y: 0.0, z: 0.055 + i * 0.026, rx: 0 }, poly(0xb8341e, { jitter: 0.1 }));
      b.cyl(0.0115, 0.0115, 0.012, 8, { x: -0.04, y: 0.0, z: 0.055 + i * 0.026 }, steel(0xb8943c));
    }
  }
  // 5 级：龙息弹，枪口和枪管上的发光裂纹
  if (t >= 5) {
    b.cyl(0.026, 0.02, 0.04, 10, { y: 0.032, z: 0.73, rx: Z }, glow(0xff5a1a, 2.4));
    b.box(0.004, 0.004, 0.34, { x: 0.016, y: 0.04, z: 0.38 }, glow(0xff7a2a, 2.2));
    b.box(0.004, 0.004, 0.34, { x: -0.016, y: 0.04, z: 0.38 }, glow(0xff7a2a, 2.2));
    b.cyl(0.0125, 0.0125, 0.03, 8, { y: -0.012, z: 0.2 + tube + 0.0, rx: Z }, glow(0xff7a2a, 1.6));
  }
  return {
    gripR: new Vector3(0, -0.075, -0.012),
    gripL: new Vector3(0, -0.04, 0.36),
    muzzle: new Vector3(0, 0.032, 0.77),
    eject: new Vector3(0.03, 0.03, 0.08),
  };
}

function rifle(b: Builder, t: number): Pick<WeaponModel, 'gripR' | 'gripL' | 'muzzle' | 'eject'> {
  // 机匣上下部
  b.rbox(0.05, 0.062, 0.26, 0.008, { y: 0.0, z: 0.1 }, dark(0x2c3036));
  b.rbox(0.05, 0.05, 0.2, 0.008, { y: -0.04, z: 0.08 }, steel(0x3c4148));
  b.box(0.012, 0.03, 0.04, { x: 0.026, y: 0.02, z: 0.07 }, steel(0x70767e)); // 拉机柄
  b.box(0.052, 0.018, 0.05, { y: 0.01, z: 0.14 }, dark(0x14161a, { jitter: 0 })); // 抛壳口
  // 上导轨
  for (let i = 0; i < 12; i++) b.box(0.022, 0.008, 0.01, { y: 0.064, z: -0.02 + i * 0.02 }, dark(0x22252a, { jitter: 0 }));
  // 手枪握把、枪托（前端顶到机匣）
  b.rbox(0.034, 0.1, 0.044, 0.01, { y: -0.1, z: -0.02, rx: -0.25 }, poly(0x1e2022));
  b.rbox(0.042, 0.088, 0.3, 0.01, { y: -0.03, z: -0.17, rx: 0.04 }, poly(0x242628));
  b.rbox(0.044, 0.1, 0.02, 0.006, { y: -0.036, z: -0.32, rx: 0.04 }, poly(0x0e0f10));
  // 护木
  b.rbox(0.058, 0.06, 0.28, 0.012, { y: 0.0, z: 0.35 }, poly(0x2a2c2e));
  for (let i = 0; i < 6; i++) b.box(0.06, 0.012, 0.008, { y: 0.02, z: 0.24 + i * 0.045 }, dark(0x0e0f10, { jitter: 0 }));
  // 枪管 + 消焰器
  b.cyl(0.0105, 0.0105, 0.2, 8, { y: 0.012, z: 0.49, rx: Z }, dark(0x14161a));
  const hider = 0.045;
  b.cyl(0.0165, 0.0165, hider, 8, { y: 0.012, z: 0.66, rx: Z }, dark(0x1c1e22));
  for (let i = 0; i < 3; i++) b.box(0.036, 0.006, 0.007, { y: 0.012, z: 0.672 + i * 0.012 }, dark(0x0a0a0c, { jitter: 0 }));
  // 准星座、照门
  b.box(0.012, 0.045, 0.012, { y: 0.03, z: 0.6 }, steel(0x484e55));
  b.box(0.005, 0.03, 0.005, { y: 0.075, z: 0.6 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.03, 0.02, 0.01, { y: 0.075, z: 0.0 }, dark());
  // 弹匣（4 级加长）
  const magH = t >= 4 ? 0.2 : 0.15;
  b.rbox(0.032, magH, 0.048, 0.006, { y: -0.04 - magH, z: 0.14, rx: 0.2 }, steel(0x353a40));
  b.box(0.034, 0.016, 0.05, { y: -0.04 - magH, z: 0.14 + magH * 0.17, rx: 0.2 }, poly(0x0e0f10));
  if (t >= 3) b.box(0.034, 0.03, 0.05, { y: -0.04 - magH * 0.4, z: 0.14 + magH * 0.07, rx: 0.2 }, poly(0x0a0a0c, { jitter: 0 })); // 穿甲弹：黑色涂装
  // 1 级：加高的准星翼
  if (t >= 1) {
    b.box(0.003, 0.03, 0.01, { x: -0.014, y: 0.075, z: 0.6 }, steel(0xd8d8d0, { jitter: 0 }));
    b.box(0.003, 0.03, 0.01, { x: 0.014, y: 0.075, z: 0.6 }, steel(0xd8d8d0, { jitter: 0 }));
  }
  // 2 级：导气管
  if (t >= 2) {
    b.cyl(0.006, 0.006, 0.36, 6, { y: 0.045, z: 0.28, rx: Z }, steel(0x70767e));
    b.box(0.014, 0.014, 0.025, { y: 0.03, z: 0.56 }, steel(0x70767e));
  }
  // 3 级：枪口制退器
  if (t >= 3) {
    b.cyl(0.022, 0.022, 0.07, 8, { y: 0.012, z: 0.705, rx: Z }, dark(0x1a1c20));
    for (let i = 0; i < 4; i++) b.box(0.05, 0.007, 0.01, { y: 0.012, z: 0.72 + i * 0.014 }, dark(0x050506, { jitter: 0 }));
  }
  // 5 级：倍镜 + 蓝色发光前握把
  if (t >= 5) {
    b.cyl(0.022, 0.022, 0.15, 10, { y: 0.1, z: 0.07, rx: Z }, dark(0x16181a));
    b.cyl(0.027, 0.027, 0.03, 10, { y: 0.1, z: 0.19, rx: Z }, dark(0x16181a));
    b.cyl(0.022, 0.022, 0.004, 10, { y: 0.1, z: 0.221, rx: Z }, glow(0x4aa8ff, 1.8));
    b.box(0.02, 0.03, 0.04, { y: 0.075, z: 0.05 }, dark());
    b.box(0.02, 0.03, 0.04, { y: 0.075, z: 0.14 }, dark());
    b.rbox(0.03, 0.08, 0.035, 0.008, { y: -0.1, z: 0.42 }, poly(0x1a1c1e));
    b.box(0.006, 0.06, 0.006, { x: 0.016, y: -0.095, z: 0.42 }, glow(0x4aa8ff, 2.2));
  }
  return {
    gripR: new Vector3(0, -0.075, -0.02),
    gripL: new Vector3(0, -0.01, t >= 5 ? 0.44 : 0.4),
    muzzle: new Vector3(0, 0.012, 0.7 + (t >= 3 ? 0.08 : 0.0)),
    eject: new Vector3(0.03, 0.02, 0.14),
  };
}

function launcher(b: Builder, t: number): Pick<WeaponModel, 'gripR' | 'gripL' | 'muzzle' | 'eject'> {
  // 枪托、握把（前端顶到机匣后端 z≈-0.06）
  b.rbox(0.045, 0.1, 0.34, 0.012, { y: -0.045, z: -0.23, rx: 0.06 }, wood(0x5a4030));
  b.rbox(0.046, 0.12, 0.02, 0.006, { y: -0.055, z: -0.4, rx: 0.06 }, poly(0x16181a));
  b.rbox(0.038, 0.1, 0.048, 0.01, { y: -0.1, z: -0.01, rx: -0.2 }, wood(0x4a3424));
  // 机匣
  b.rbox(0.07, 0.085, 0.2, 0.012, { y: -0.005, z: 0.04 }, dark(0x30343a));
  // 转轮弹仓：2 级更大
  const dr = t >= 2 ? 0.095 : 0.078;
  const dl = t >= 2 ? 0.16 : 0.13;
  b.cyl(dr, dr, dl, 16, { y: 0.035, z: 0.12, rx: Z }, steel(0x3f454c));
  b.cyl(dr + 0.004, dr + 0.004, 0.012, 16, { y: 0.035, z: 0.12, rx: Z }, steel(0x70767e));
  b.cyl(dr + 0.004, dr + 0.004, 0.012, 16, { y: 0.035, z: 0.12 + dl - 0.012, rx: Z }, steel(0x70767e));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cyl(0.026, 0.026, 0.01, 8, { x: Math.sin(a) * dr * 0.62, y: 0.035 + Math.cos(a) * dr * 0.62, z: 0.12 + dl, rx: Z }, dark(0x0a0a0c, { jitter: 0 }));
  }
  // 粗枪管 + 护木
  b.cyl(0.036, 0.036, 0.36, 12, { y: 0.035, z: 0.12 + dl, rx: Z }, dark(0x22252a));
  b.cyl(0.042, 0.042, 0.02, 12, { y: 0.035, z: 0.4, rx: Z }, steel(0x70767e));
  b.rbox(0.05, 0.05, 0.16, 0.012, { y: -0.055, z: 0.34 }, wood(0x6a4a30));
  b.rod([0, -0.03, 0.26], [0, -0.02, 0.4], 0.008, steel(0x70767e), 5);
  // 梯形照门
  b.box(0.006, 0.05, 0.006, { y: 0.075, z: 0.04 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.03, 0.006, 0.006, { y: 0.1, z: 0.04 }, steel(0xd8d8d0, { jitter: 0 }));
  b.box(0.008, 0.03, 0.01, { y: 0.088, z: 0.52 }, steel(0xd8d8d0, { jitter: 0 }));
  // 扳机
  b.box(0.018, 0.01, 0.07, { y: -0.044, z: 0.05 }, dark());
  b.box(0.008, 0.02, 0.008, { y: -0.034, z: 0.04 }, steel(0x8a8e92));
  // 1 级：高爆弹的红色警示环
  if (t >= 1) {
    b.cyl(0.039, 0.039, 0.03, 12, { y: 0.035, z: 0.3, rx: Z }, poly(0xc03a2a, { jitter: 0.05 }));
    b.cyl(0.039, 0.039, 0.012, 12, { y: 0.035, z: 0.34, rx: Z }, poly(0xd6a824, { jitter: 0.05 }));
  }
  // 3 级：喇叭口枪口
  if (t >= 3) {
    b.cone(0.07, 0.07, 12, { y: 0.035, z: 0.52, rx: -Z }, dark(0x1a1c20));
  }
  // 4 级：快速装填环（橙色）
  if (t >= 4) {
    b.torus(dr + 0.012, 0.01, 6, 16, { y: 0.035, z: 0.19 }, poly(0xe07a1a, { jitter: 0.05 }));
    b.box(0.012, 0.05, 0.03, { x: dr + 0.02, y: 0.035, z: 0.19 }, steel(0xb0b4b8));
  }
  // 5 级：集束，两侧各挂一根小炮管，枪口发光
  if (t >= 5) {
    for (const s of [-1, 1]) {
      b.cyl(0.018, 0.018, 0.3, 8, { x: s * 0.058, y: 0.025, z: 0.26, rx: Z }, dark(0x22252a));
      b.cyl(0.02, 0.02, 0.008, 8, { x: s * 0.058, y: 0.025, z: 0.56, rx: Z }, glow(0xff7a2a, 2.4));
      b.box(0.012, 0.012, 0.04, { x: s * 0.04, y: 0.04, z: 0.22 }, steel(0x70767e));
    }
    b.cyl(0.03, 0.03, 0.006, 12, { y: 0.035, z: 0.585, rx: Z }, glow(0xff7a2a, 2.0));
  }
  return {
    gripR: new Vector3(0, -0.08, -0.006),
    gripL: new Vector3(0, -0.04, 0.34),
    muzzle: new Vector3(0, 0.035, t >= 3 ? 0.6 : 0.52),
    eject: new Vector3(0.03, 0.03, 0.1),
  };
}

export function buildWeapon(kind: WeaponKind, tier: number): WeaponModel {
  const b = new Builder();
  const t = Math.max(0, Math.min(5, tier));
  const fn = { pistol, smg, shotgun, rifle, launcher }[kind];
  const info = fn(b, t);
  const group = toGroup(b.build());
  return { group, ...info };
}
