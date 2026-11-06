// 平台自带的测试样例：几何很简单，但节点名、动画名、尺寸、原点都严格按目录约定，
// 用来验证平台本身（视图、交互、校验）能用，也给建模那边当"交付格式"的参照。
// 真正的模型放进 models/ 以后会自动替换样例。
import { box, cyl, geo, Glb, normalFromHeight, qy } from './glb';

const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255].map((v) => Math.pow(v, 2.2)) as [number, number, number];

/** 钣金面板的法线贴图：横向的压筋 + 四周一圈凹槽 */
function panelNormal(): Buffer {
  const N = 256;
  return normalFromHeight(N, N, (x, y) => {
    const rib = Math.sin((y / N) * Math.PI * 2 * 12) * 0.5 + 0.5;
    const ex = Math.min(x, N - 1 - x);
    const ey = Math.min(y, N - 1 - y);
    const groove = Math.min(ex, ey) < 6 ? -1.2 : 0;
    return rib * 0.6 + groove;
  });
}

export function atm(): Buffer {
  const g = new Glb();
  const nm = g.png(panelNormal());
  const body = g.material({ name: 'atm_body', color: hex(0xe8e8e4), roughness: 0.55, normalImage: nm });
  const dark = g.material({ name: 'atm_dark', color: hex(0x2a2c30), roughness: 0.4 });
  const red = g.material({ name: 'atm_glow_red', color: hex(0xd8202a), emissive: [1.0, 0.15, 0.15] });
  const idle = g.material({ name: 'screen_idle', color: hex(0x103050), emissive: [0.15, 0.4, 0.9] });
  const bal = g.material({ name: 'screen_balance', color: hex(0x104030), emissive: [0.2, 0.9, 0.45] });
  const b = geo();
  box(b, 0.62, 1.55, 0.56, 0, 0, -0.03);
  const k = geo();
  box(k, 0.5, 0.05, 0.06, 0, 0.9, 0.28);
  box(k, 0.5, 0.02, 0.05, 0, 0.62, 0.275);
  const top = geo();
  box(top, 0.62, 0.22, 0.56, 0, 1.55, -0.03);
  const s0 = geo();
  box(s0, 0.44, 0.27, 0.004, 0, 1.11, 0.252);
  const s1 = geo();
  box(s1, 0.44, 0.27, 0.004, 0, 1.11, 0.252);
  const nScreen0 = g.node({ name: 'screen_idle', mesh: g.mesh('screen_idle', [[s0, idle]]) });
  const nScreen1 = g.node({ name: 'screen_balance', mesh: g.mesh('screen_balance', [[s1, bal]]) });
  g.node({ name: 'atm', mesh: g.mesh('atm_body', [[b, body], [k, dark], [top, red]]), children: [nScreen0, nScreen1] }, true);
  return g.toBuffer();
}

export function vending(): Buffer {
  const g = new Glb();
  const nm = g.png(panelNormal());
  const red = g.material({ name: 'vend_body', color: hex(0xd8202a), roughness: 0.35, metalness: 0.2, normalImage: nm });
  const panel = g.material({ name: 'vend_panel', color: hex(0xf2f0e8), emissive: [0.9, 0.88, 0.8] });
  const dark = g.material({ name: 'vend_dark', color: hex(0x1a1a1a), roughness: 0.5 });
  const can = g.material({ name: 'can_coffee', color: hex(0x5a3a2a), roughness: 0.3, metalness: 0.8 });
  const b = geo();
  box(b, 0.98, 1.83, 0.72, 0, 0, -0.03);
  const p = geo();
  box(p, 0.92, 1.4, 0.01, 0, 0.37, 0.335);
  const d = geo();
  box(d, 0.98, 0.06, 0.78, 0, 1.83, 0);
  box(d, 0.6, 0.14, 0.05, -0.1, 0.12, 0.355);
  const c = geo();
  cyl(c, 0.033, 0.12, 16, 0, 0, 0);
  const canNode = g.node({ name: 'can', mesh: g.mesh('can', [[c, can]]), translation: [-0.1, 0.13, 0.33], scale: [0.001, 0.001, 0.001] });
  g.node({ name: 'vending_machine', mesh: g.mesh('vending_body', [[b, red], [p, panel], [d, dark]]), children: [canNode] }, true);
  // 出货：0.6 秒后罐子出现在出货口，停 1.6 秒后消失
  const s = 0.001;
  g.animation('dispense', [
    { node: canNode, path: 'scale', times: [0, 0.6, 0.65, 2.2, 2.25], values: [s, s, s, 1, 1, 1, 1, 1, 1, 1, 1, 1, s, s, s] },
    { node: canNode, path: 'translation', times: [0, 0.6, 0.8, 2.25], values: [-0.1, 0.25, 0.33, -0.1, 0.25, 0.33, -0.1, 0.13, 0.33, -0.1, 0.13, 0.33] },
  ]);
  return g.toBuffer();
}

export function locker(): Buffer {
  const g = new Glb();
  const body = g.material({ name: 'locker_body', color: hex(0xc8cacc), roughness: 0.5, metalness: 0.3 });
  const door = g.material({ name: 'locker_door', color: hex(0xdcdee0), roughness: 0.45, metalness: 0.3 });
  const screen = g.material({ name: 'locker_screen', color: hex(0x1a1a2a), emissive: [0.15, 0.4, 1.0] });
  const sign = g.material({ name: 'locker_sign', color: hex(0xffffff), emissive: [0.85, 0.85, 0.85] });
  const handle = g.material({ name: 'locker_handle', color: hex(0x555555), roughness: 0.4, metalness: 0.8 });
  const b = geo();
  box(b, 0.96, 1.95, 0.5, 0, 0, -0.01);
  const sc = geo();
  box(sc, 0.22, 0.3, 0.01, 0, 0.75, 0.245);
  const sg = geo();
  box(sg, 0.96, 0.24, 0.01, 0, 1.71, 0.245);
  const children: number[] = [];
  const cw = 0.96 / 3;
  const ch = 1.66 / 5;
  let n = 0;
  const anims: Array<{ name: string; node: number }> = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      if (c === 1 && (r === 2 || r === 3)) continue;
      n++;
      const name = `locker_${String(n).padStart(2, '0')}`;
      const dg = geo();
      box(dg, cw - 0.012, ch - 0.012, 0.02, (cw - 0.012) / 2, 0, 0.01);
      const hg = geo();
      box(hg, 0.012, 0.06, 0.012, cw - 0.05, ch / 2 - 0.03, 0.026);
      const node = g.node({ name, mesh: g.mesh(name, [[dg, door], [hg, handle]]), translation: [-0.48 + c * cw + 0.006, 0.05 + r * ch, 0.24] });
      children.push(node);
      anims.push({ name: `${name}_open`, node });
    }
  }
  g.node({ name: 'parcel_locker', mesh: g.mesh('locker_body', [[b, body], [sc, screen], [sg, sign]]), children }, true);
  // 转轴在门的左边，往外（+Z）开 110°
  for (const a of anims) {
    const q0 = qy(0);
    const q1 = qy(-1.9);
    g.animation(a.name, [{ node: a.node, path: 'rotation', times: [0, 0.45], values: [...q0, ...q1] }]);
  }
  return g.toBuffer();
}

export function canCoffee(): Buffer {
  const g = new Glb();
  const m = g.material({ name: 'can_coffee', color: hex(0x5a3a2a), roughness: 0.3, metalness: 0.75 });
  const top = g.material({ name: 'can_top', color: hex(0xc8ccd4), roughness: 0.25, metalness: 0.9 });
  const body = geo();
  cyl(body, 0.033, 0.104, 16, 0, 0.006, 0);
  const ends = geo();
  cyl(ends, 0.029, 0.006, 16, 0, 0, 0);
  cyl(ends, 0.029, 0.01, 16, 0, 0.11, 0);
  g.node({ name: 'can_01', mesh: g.mesh('can_01', [[body, m], [ends, top]]) }, true);
  return g.toBuffer();
}
