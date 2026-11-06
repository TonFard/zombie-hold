import { Group, Vector3 } from 'three';
import { box3, type World } from './ctx';
import type { Cart } from './goods';
import { goodInfo } from './goods';
import { STALLS } from './ground';
import { glassGroup, glassKit } from './store';

/**
 * 店门口的东西：自动贩卖机（买饮料会掉出来）、扭蛋机、伞架（可以拿伞）、垃圾桶、地垫、
 * 自行车（车铃）、送货面包车（喇叭）、邮筒、店前护栏、空调外机。
 */
const F = 0.15;
const PI = Math.PI;

export interface Props {
  /** 玩家现在是不是撑着伞 */
  umbrella: () => boolean;
}

export function buildProps(W: World, cart: Cart): Props {
  const A = W.atlas;
  const k = W.kit();

  // ---------------------------------------------------------------- 自动贩卖机 ×2（店铺正面东侧，朝南）
  for (let i = 0; i < 2; i++) {
    const x = 5.1 + i * 1.05;
    const z = -1.62;
    k.push({ x, y: F, z });
    k.box(0.98, 1.83, 0.75, {}, i ? 0x1e64c8 : 0xd8202a);
    k.box(0.92, 1.7, 0.01, { y: 0.07, z: 0.376 }, 0xffffff, { tex: A.get(`vend${i}`), glow: 1.05 });
    k.box(0.98, 0.06, 0.78, { y: 1.83 }, 0x2a2a2a);
    k.box(0.6, 0.14, 0.12, { x: -0.1, y: 0.12, z: 0.39 }, 0x111111); // 出货口
    k.pop();
    W.solids.add(x - 0.49, F, z - 0.375, x + 0.49, F + 1.9, z + 0.375);
    // 掉出来的罐子（出货口里）
    const can = new Group();
    const ck = W.kit();
    ck.cyl(0.033, 0.033, 0.12, 10, { rz: PI / 2, x: 0.06 }, i ? 0x3ab0e0 : 0x5a3a2a);
    can.add(ck.build('can'));
    can.position.set(x - 0.1, F + 0.15, z + 0.4);
    can.visible = false;
    W.add(can);
    let drop = -1;
    W.interact({
      box: box3(x - 0.49, F, z + 0.3, x + 0.49, F + 1.83, z + 0.42),
      label: () => (drop >= 0 ? '' : `贩卖机：买一罐${i ? '冰' : '热'}饮  ¥130`),
      on: () => drop < 0,
      use: () => {
        drop = 0;
        W.sfx.beep();
        setTimeout(() => W.sfx.clunk(), 500);
      },
    });
    W.tick.push((dt) => {
      if (drop < 0) return;
      drop += dt;
      can.visible = drop > 0.6 && drop < 2.2;
      if (drop > 2.2) {
        drop = -1;
        cart.add(goodInfo('can', i ? 3 : 0));
        cart.pay(); // 贩卖机是投币的，直接算已付款
        W.say(`ガコン！  拿到一罐${i ? 'サイダー' : 'COFFEE'}`);
      }
    });
  }
  // 贩卖机旁边的回收箱
  k.box(0.45, 0.8, 0.4, { x: 6.85, y: F, z: -1.75 }, 0x2a8a4a);
  k.box(0.2, 0.08, 0.01, { x: 6.85, y: F + 0.6, z: -1.549 }, 0x111111);
  W.solids.add(6.62, F, -1.95, 7.08, F + 0.8, -1.55);

  // ---------------------------------------------------------------- 扭蛋机（门西侧）
  {
    const x = -0.6;
    const z = -1.75;
    k.box(0.5, 0.75, 0.42, { x, y: F, z }, 0xd8202a);
    k.box(0.3, 0.08, 0.02, { x, y: F + 0.55, z: z + 0.21 }, 0x222222);
    k.cyl(0.06, 0.06, 0.03, 12, { x, y: F + 0.42, z: z + 0.21, rx: PI / 2 }, 0xc0c4cc);
    const gk = glassKit(W, 0xffffff, 0.08, false);
    gk.box(0.48, 0.5, 0.4, { x, y: F + 0.75, z }, 0xffffff);
    W.add(glassGroup(gk.build()));
    for (let j = 0; j < 22; j++) k.sphere(0.05, { x: x - 0.17 + (j % 5) * 0.085, y: F + 0.8 + Math.floor(j / 5) * 0.075, z: z - 0.12 + ((j * 7) % 4) * 0.07 }, [0xff5a8a, 0x5ab0ff, 0xffd040, 0x7ad070, 0xffffff][j % 5] as number, { seg: 8 });
    k.box(0.5, 0.04, 0.42, { x, y: F + 1.25, z }, 0xd8202a);
    W.solids.add(x - 0.25, F, z - 0.21, x + 0.25, F + 1.3, z + 0.21);
    W.interact({
      box: box3(x - 0.25, F, z - 0.21, x + 0.25, F + 1.3, z + 0.23),
      label: () => '扭蛋机  ¥200 转一次',
      use: () => {
        const prizes = ['小猫钥匙扣', '迷你便当模型', '雨伞挂件', '饭团造型橡皮', '青蛙公仔', '自动贩卖机磁贴'];
        W.sfx.click();
        setTimeout(() => W.sfx.clunk(), 600);
        W.say(`咔啦咔啦…  抽到了「${prizes[Math.floor(Math.random() * prizes.length)]}」`);
      },
    });
  }

  // ---------------------------------------------------------------- 伞架：拿一把透明伞 / 放回去
  {
    const x = 2.55;
    const z = -1.6;
    k.box(0.5, 0.06, 0.3, { x, y: F, z }, 0x8a8e96);
    k.box(0.5, 0.05, 0.3, { x, y: F + 0.55, z }, 0x8a8e96);
    for (const dx of [-0.24, 0.24]) k.box(0.02, 0.6, 0.3, { x: x + dx, y: F, z }, 0x8a8e96);
    for (let j = 0; j < 4; j++) k.box(0.01, 0.05, 0.28, { x: x - 0.18 + j * 0.12, y: F + 0.55, z }, 0x6a6e76);
    const umb = new Group();
    const uk = W.kit();
    const cols = [0xe8eef4, 0x1d3d8f, 0xe8eef4, 0xd8202a, 0xe8eef4];
    cols.forEach((c, j) => {
      uk.cyl(0.025, 0.06, 0.75, 6, { x: -0.2 + j * 0.1, y: 0.08, z: (j % 2) * 0.06 - 0.03, rz: (j - 2) * 0.05 }, c);
      uk.cyl(0.006, 0.006, 0.18, 4, { x: -0.2 + j * 0.1 + (j - 2) * 0.04, y: 0.83, z: (j % 2) * 0.06 - 0.03 }, 0x333333);
      uk.torus(0.035, 0.007, { x: -0.2 + j * 0.1 + (j - 2) * 0.04 + 0.035, y: 1.01, z: (j % 2) * 0.06 - 0.03 }, 0x333333, { arc: PI });
    });
    umb.add(uk.build('umbrellas'));
    umb.position.set(x, F, z);
    W.add(umb);
    W.solids.add(x - 0.26, F, z - 0.16, x + 0.26, F + 0.65, z + 0.16);
    const taken = (): boolean => W.holdingUmbrella;
    W.interact({
      box: box3(x - 0.26, F, z - 0.16, x + 0.26, F + 1.1, z + 0.18),
      label: () => (taken() ? '把伞放回伞架' : '借一把透明雨伞'),
      use: () => {
        W.holdingUmbrella = !W.holdingUmbrella;
        W.sfx.umbrella();
        W.say(W.holdingUmbrella ? '撑开了一把透明伞（雨点会打在伞上）' : '把伞放回去了');
      },
    });
  }

  // ---------------------------------------------------------------- 门口：地垫、垃圾桶、烟灰缸
  k.plane(1.8, 0.9, { x: 1, y: F + 0.012, z: -1.4, rx: -PI / 2 }, 0xffffff, { tex: A.get('mat') });
  k.plane(1.6, 0.9, { x: 1, y: 0.3 + 0.006, z: -2.6, rx: -PI / 2 }, 0xffffff, { tex: A.get('mat') });
  {
    const x = -2.1;
    const z = -1.62;
    k.box(1.4, 0.95, 0.5, { x, y: F, z }, 0xe8e8e4);
    k.box(1.4, 0.18, 0.01, { x, y: F + 0.72, z: z + 0.251 }, 0xffffff, { tex: A.get('trash') });
    for (let j = 0; j < 3; j++) k.box(0.22, 0.1, 0.01, { x: x - 0.46 + j * 0.46, y: F + 0.55, z: z + 0.252 }, 0x111111);
    k.box(1.42, 0.05, 0.52, { x, y: F + 0.95, z }, 0x8a8e96);
    W.solids.add(x - 0.7, F, z - 0.25, x + 0.7, F + 1.0, z + 0.25);
    W.interact({
      box: box3(x - 0.7, F, z - 0.25, x + 0.7, F + 1.0, z + 0.27),
      label: () => (cart.paidCount ? '把空瓶空罐扔掉' : '分类垃圾桶'),
      use: () => {
        W.sfx.clunk();
        W.say('分好类扔掉了（燃えるゴミ / 缶・びん / ペットボトル）');
      },
    });
  }

  // ---------------------------------------------------------------- 店前护栏 + 车挡
  for (let x = -7.5; x < 7.6; x += 3) {
    if (x > -6.6 && x < 5) continue; // 停车场出入口
    k.cyl(0.04, 0.04, 0.85, 8, { x, y: F, z: 6.5 }, 0xe8e8e4);
  }
  k.tube([new Vector3(-7.5, F + 0.8, 6.5), new Vector3(-6.6, F + 0.8, 6.5)], 0.03, 0xe8e8e4);
  for (const x of STALLS) {
    k.box(1.6, 0.12, 0.16, { x, y: F, z: -0.95 }, 0xf0c030); // 车挡（黄）
    k.box(0.4, 0.121, 0.161, { x: x - 0.4, y: F, z: -0.95 }, 0x2a2a2a);
    k.box(0.4, 0.121, 0.161, { x: x + 0.4, y: F, z: -0.95 }, 0x2a2a2a);
    W.solids.add(x - 0.8, F, -1.03, x + 0.8, F + 0.12, -0.87);
  }

  // ---------------------------------------------------------------- 空调外机 ×3（店铺东墙外）
  for (let j = 0; j < 3; j++) {
    const z = -10.5 + j * 1.1;
    k.push({ x: 7.38, y: F, z, ry: PI / 2 });
    k.box(0.85, 0.65, 0.3, {}, 0xe4e4e0);
    k.plane(0.6, 0.45, { x: -0.08, y: 0.33, z: 0.151 }, 0xffffff, { tex: A.get('ac') });
    k.box(0.8, 0.04, 0.28, { y: -0.0 }, 0x8a8e96);
    k.pop();
    k.cyl(0.02, 0.02, 2, 6, { x: 7.08 + 0.02, y: F + 0.4, z: z + 0.25 }, 0xd8d8d4);
    W.solids.add(7.2, F, z - 0.43, 7.55, F + 0.65, z + 0.43);
  }
  k.box(0.08, 0.08, 3.4, { x: 7.12, y: 2.4, z: -9.4 }, 0xd8d8d4); // 冷媒管的套管

  // ---------------------------------------------------------------- 邮筒（红色，人行道转角）
  {
    const x = 8.8;
    const z = 3.4;
    k.cyl(0.24, 0.24, 1.1, 18, { x, y: F, z }, 0xd8202a);
    k.sphere(0.24, { x, y: F + 1.1, z }, 0xd8202a, { sy: 0.5 });
    k.box(0.3, 0.05, 0.02, { x, y: F + 0.9, z: z + 0.235 }, 0x111111);
    k.box(0.22, 0.14, 0.02, { x, y: F + 0.6, z: z + 0.237 }, 0xf4f4f4);
    k.cyl(0.26, 0.26, 0.04, 18, { x, y: F, z }, 0x222222);
    W.solids.add(x - 0.25, F, z - 0.25, x + 0.25, F + 1.2, z + 0.25);
    W.interact({
      box: box3(x - 0.25, F, z - 0.25, x + 0.25, F + 1.25, z + 0.27),
      label: () => '邮筒  投一封信',
      use: () => {
        W.sfx.plop();
        W.say('信寄出去了。收集时间：平日 9:30 / 15:00');
      },
    });
  }

  W.add(k.build('props'));
  buildBikes(W);
  buildVan(W);
  return { umbrella: () => W.holdingUmbrella };
}


/** 停车场西边的自行车（一排 4 辆），按 E 打铃 */
function buildBikes(W: World): void {
  const k = W.kit();
  const colors = [0x5ab0d8, 0xe8e8e4, 0xd84a6a, 0x3a3a40];
  // 自行车停车架
  k.box(0.06, 0.05, 4.2, { x: -6.6, y: F, z: 1.4 }, 0x8a8e96);
  for (let j = 0; j < 4; j++) {
    const z = -0.1 + j * 1.0;
    const x = -6.6;
    k.push({ x, y: F, z, ry: PI / 2 + (j % 2 ? 0.08 : -0.06) });
    const c = colors[j] as number;
    for (const dx of [-0.52, 0.52]) {
      k.torus(0.32, 0.025, { x: dx, y: 0.34 }, 0x1a1a1a, { seg: 24 });
      k.torus(0.26, 0.006, { x: dx, y: 0.34 }, 0xc8ccd4, { seg: 16 });
      k.cyl(0.03, 0.03, 0.08, 8, { x: dx, y: 0.34, z: -0.04, rx: PI / 2 }, 0x999999);
    }
    // 车架（ママチャリ：低横梁）
    k.tube([new Vector3(-0.52, 0.34, 0), new Vector3(-0.08, 0.36, 0), new Vector3(0.38, 0.72, 0)], 0.022, c);
    k.tube([new Vector3(-0.08, 0.36, 0), new Vector3(-0.12, 0.72, 0)], 0.022, c);
    k.tube([new Vector3(0.52, 0.34, 0), new Vector3(0.42, 0.68, 0), new Vector3(0.38, 0.95, 0)], 0.018, 0xc8ccd4);
    k.box(0.22, 0.05, 0.1, { x: -0.14, y: 0.74 }, 0x2a2a2a); // 坐垫
    k.box(0.04, 0.03, 0.5, { x: 0.37, y: 0.95 }, 0xc8ccd4); // 车把
    k.box(0.32, 0.22, 0.3, { x: 0.62, y: 0.7 }, 0x9aa0a8); // 前车筐
    k.box(0.4, 0.03, 0.18, { x: -0.6, y: 0.62 }, 0x9aa0a8); // 后货架
    k.torus(0.32, 0.03, { x: -0.52, y: 0.34, z: 0.06 }, c, { arc: PI * 0.6, seg: 10 }); // 挡泥板
    k.cyl(0.025, 0.025, 0.03, 10, { x: 0.36, y: 0.95, z: 0.16 }, 0xe8c040); // 车铃
    k.pop();
    W.solids.add(x - 0.15, F, z - 0.9, x + 0.15, F + 1.0, z + 0.9);
    W.interact({
      box: box3(x - 0.3, F + 0.2, z - 0.9, x + 0.3, F + 1.05, z + 0.9),
      label: () => '按一下车铃',
      use: () => W.sfx.bell(),
    });
  }
  W.add(k.build('bikes'));
}

/** 停在店前车位上的白色厢式面包车（送货车），按 E 按喇叭、开关车灯 */
function buildVan(W: World): void {
  const A = W.atlas;
  const k = W.kit();
  const x = STALLS[1] as number;
  const z = 1.6;
  k.push({ x, y: F, z, ry: PI });
  const body = 0xf2f2ee;
  // 车身（车头朝 +Z = 朝店）
  k.box(1.7, 1.55, 3.6, { y: 0.32, z: -0.3 }, body);
  k.box(1.7, 0.9, 0.85, { y: 0.32, z: 1.9 }, body);
  k.push({ y: 1.22, z: 1.48, rx: -0.55 });
  k.box(1.6, 0.03, 0.95, {}, 0x2a3a4a); // 前挡风玻璃（深色）
  k.pop();
  k.box(1.71, 0.5, 1.2, { y: 1.22, z: 0.8 }, 0x2a3a4a); // 侧窗
  k.box(1.72, 0.06, 4.5, { y: 0.32, z: 0.1 }, 0x8a8e96); // 腰线
  k.box(1.74, 0.22, 0.12, { y: 0.32, z: 2.33 }, 0xc8ccd4); // 保险杠
  k.box(1.74, 0.22, 0.12, { y: 0.32, z: -2.15 }, 0xc8ccd4);
  k.box(0.33, 0.165, 0.01, { y: 0.42, z: 2.4 }, 0xffffff, { tex: A.get('plate') });
  k.box(0.33, 0.165, 0.01, { y: 0.6, z: -2.16, ry: PI }, 0xffffff, { tex: A.get('plate'), faces: ['pz', 'nz'] });
  k.box(1.5, 0.6, 0.01, { y: 0.9, z: -2.11, ry: PI }, 0x1d3d8f, { faces: [] });
  // 车侧的店名贴纸
  for (const s of [-1, 1]) k.box(0.01, 0.4, 2.2, { x: s * 0.856, y: 0.75, z: -0.6 }, 0xffffff, { tex: A.sub('sign', 0, 0.55, 1, 1), faces: [s > 0 ? 'px' : 'nx'] });
  // 车轮
  for (const [wx, wz] of [
    [-0.78, 1.5],
    [0.78, 1.5],
    [-0.78, -1.3],
    [0.78, -1.3],
  ] as const) {
    k.cyl(0.32, 0.32, 0.22, 16, { x: wx, y: 0.32, z: wz, rz: PI / 2 }, 0x1a1a1a);
    k.cyl(0.18, 0.18, 0.225, 12, { x: wx, y: 0.32, z: wz, rz: PI / 2 }, 0xb8bcc4);
  }
  // 后视镜
  for (const s of [-1, 1]) k.box(0.12, 0.16, 0.06, { x: s * 0.92, y: 1.15, z: 1.5 }, 0x2a2a2a);
  k.pop();
  // 车灯：发光部件单独一组，按 E 开关
  const lk = W.kit();
  lk.push({ x, y: F, z, ry: PI });
  for (const s of [-1, 1]) {
    lk.box(0.3, 0.14, 0.02, { x: s * 0.62, y: 0.72, z: 2.33 }, 0xfff8e0, { glow: 2.5 });
    lk.box(0.14, 0.3, 0.02, { x: s * 0.75, y: 0.6, z: -2.14 }, 0xff2a20, { glow: 2.2 });
  }
  lk.pop();
  const lights = lk.build('vanLights');
  lights.visible = false;
  W.add(lights);
  W.add(k.build('van'));
  // 车身碰撞（两段：车厢 + 车头）
  W.solids.add(x - 0.86, F, z - 2.5, x + 0.86, F + 1.9, z + 2.2);
  W.interact({
    box: box3(x - 0.9, F + 0.3, z - 2.5, x + 0.9, F + 1.9, z + 2.3),
    label: () => (lights.visible ? '关掉车灯 / 按喇叭' : '打开车灯 / 按喇叭'),
    use: () => {
      lights.visible = !lights.visible;
      W.sfx.horn();
    },
  });
}
