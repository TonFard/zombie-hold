import { Box3, Group, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BENTO, BOTTLES, BREADS, CANS, DAILY, MAGAZINES, NOODLES, ONIGIRI, SNACKS, SWEETS } from './atlas';
import type { World } from './ctx';
import type { Kit, Mark } from './kit';

/**
 * 商品：每一件都是单独的实体（单独的包围盒，可以拿起来），但几何体合并在货架的大网格里。
 * 拿走的商品顶点塌缩隐藏；过一会儿店员补货，又会出现。
 * 所有商品都在"朝 +Z"的局部坐标系里建（调用方 push 好货架的位置和朝向），原点在商品底面中心。
 */

export type GoodKind = 'snack' | 'bread' | 'bottle' | 'can' | 'onigiri' | 'bento' | 'noodle' | 'mag' | 'sweet' | 'daily' | 'ice' | 'cup';

export interface Good {
  kind: GoodKind;
  v: number;
  name: string;
  price: number;
}

const PRICES: Record<GoodKind, number[]> = {
  snack: [148, 148, 158, 168, 178, 158],
  bread: [128, 138, 148, 198, 118],
  bottle: [128, 108, 158, 148, 148, 158, 158, 128],
  can: [130, 130, 130, 150, 210, 140, 130, 140],
  onigiri: [150, 170, 130, 130, 180, 130],
  bento: [550, 450, 520, 580],
  noodle: [198, 168, 168, 218],
  mag: [380, 290, 650, 300, 720, 580, 680, 900],
  sweet: [198, 330, 158, 128, 110, 108],
  daily: [298, 248, 398, 328],
  ice: [160],
  cup: [100],
};

export function goodInfo(kind: GoodKind, v: number): Good {
  const names: Record<GoodKind, readonly (string | readonly string[])[]> = {
    snack: SNACKS,
    bread: BREADS,
    bottle: BOTTLES,
    can: CANS,
    onigiri: ONIGIRI,
    bento: BENTO,
    noodle: NOODLES,
    mag: MAGAZINES,
    sweet: SWEETS,
    daily: DAILY,
    ice: ['アイス'],
    cup: ['ホットコーヒー'],
  };
  const n = names[kind][v] as string | readonly string[];
  const name = typeof n === 'string' ? n : (n[0] as string);
  const p = PRICES[kind];
  return { kind, v, name, price: p[v % p.length] as number };
}

/** 商品尺寸（宽、高、深） */
export const SIZE: Record<GoodKind, [number, number, number]> = {
  snack: [0.17, 0.24, 0.07],
  bread: [0.14, 0.13, 0.07],
  bottle: [0.075, 0.24, 0.075],
  can: [0.066, 0.12, 0.066],
  onigiri: [0.11, 0.1, 0.045],
  bento: [0.21, 0.06, 0.15],
  noodle: [0.12, 0.11, 0.12],
  mag: [0.2, 0.27, 0.012],
  sweet: [0.11, 0.08, 0.08],
  daily: [0.12, 0.12, 0.1],
  ice: [0.06, 0.14, 0.03],
  cup: [0.08, 0.1, 0.08],
};

interface ProductRequest {
  mark: Mark;
  kind: GoodKind;
  v: number;
  center: Vector3;
  minY: number;
  tilt: number;
}

interface ProductPackState {
  root: Group;
  requests: ProductRequest[];
  templates: Map<string, Object3D> | null;
  failed: boolean;
}

const productPacks = new WeakMap<World, ProductPackState>();

function hideProceduralProducts(W: World): void {
  const names = new Set(['goods', 'coolerGoods', 'deliGoods', 'mags']);
  W.root.traverse((object) => {
    if (names.has(object.name)) object.visible = false;
  });
}

function attachProductVisual(state: ProductPackState, request: ProductRequest): void {
  const template = state.templates?.get(`${request.kind}-${request.v}`);
  if (!template) return;
  const clone = template.clone(true);
  clone.name = `Blender product | ${request.kind}-${request.v}`;
  clone.position.set(request.center.x, request.minY, request.center.z);
  clone.rotation.x = request.tilt;
  clone.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  });
  clone.visible = !request.mark.hidden;
  state.root.add(clone);
  request.mark.replacement = clone;
}

function productPack(W: World): ProductPackState {
  const existing = productPacks.get(W);
  if (existing) return existing;
  const state: ProductPackState = {
    root: new Group(),
    requests: [],
    templates: null,
    failed: false,
  };
  state.root.name = 'Konbini | Blender product replacements';
  state.root.userData.source = 'product-templates.glb';
  W.add(state.root);
  productPacks.set(W, state);
  const url = `${import.meta.env.BASE_URL}konbini/product-templates.glb`;
  new GLTFLoader().load(
    url,
    ({ scene }) => {
      const templates = new Map<string, Object3D>();
      scene.traverse((object) => {
        // Blender exports spaces in node names as underscores in glTF.
        const name = object.name.replaceAll('_', ' ');
        const prefix = 'Blender product | ';
        if (!name.startsWith(prefix)) return;
        const key = name.slice(prefix.length).trim();
        templates.set(key, object);
      });
      if (!templates.size) {
        state.failed = true;
        console.warn('Konbini Blender product pack contains no named templates.');
        return;
      }
      state.templates = templates;
      for (const request of state.requests) attachProductVisual(state, request);
      hideProceduralProducts(W);
    },
    undefined,
    (error) => {
      state.failed = true;
      console.warn('Konbini Blender product pack failed to load; using procedural products.', error);
    },
  );
  return state;
}

function registerProductVisual(W: World, mark: Mark, kind: GoodKind, v: number, tilt: number): void {
  const state = productPack(W);
  const center = mark.box.getCenter(new Vector3());
  const request: ProductRequest = { mark, kind, v, center, minY: mark.box.min.y, tilt };
  state.requests.push(request);
  if (state.templates) attachProductVisual(state, request);
}

/** 在当前局部坐标 (x, y, z) 放一件商品，返回它的标记（之后可以隐藏） */
export function good(W: World, k: Kit, kind: GoodKind, v: number, x: number, y: number, z: number, tilt = 0): Mark {
  const A = W.atlas;
  k.mark();
  k.push({ x, y, z, rx: tilt });
  const [w, h, d] = SIZE[kind];
  switch (kind) {
    case 'snack': {
      // 鼓鼓的薯片袋：主体 + 上下的封口
      k.box(w, h * 0.86, d, { y: h * 0.07 }, 0xffffff, { tex: A.get(`snack${v}`), faces: ['pz', 'nz'] });
      k.box(w * 1.02, h * 0.07, d * 0.4, { y: h * 0.93 }, 0xd8d8d8);
      k.box(w * 1.02, h * 0.07, d * 0.4, {}, 0xd8d8d8);
      break;
    }
    case 'bread': {
      k.box(w, h, d, {}, 0xf8f6f0, { tex: A.get(`bread${v}`), faces: ['pz', 'py'] });
      break;
    }
    case 'bottle': {
      const r = w / 2;
      const C = BOTTLES[v] as readonly [string, string, string];
      const tea = v === 0 || v === 7;
      const liquid = parseInt((tea ? '#9a8a3a' : v === 2 ? '#3a0a0a' : v === 5 ? '#c8a070' : '#cfe8ff').slice(1), 16);
      k.cyl(r, r, h * 0.12, 12, {}, liquid);
      k.cyl(r, r, h * 0.36, 12, { y: h * 0.12, ry: -Math.PI / 2 }, 0xffffff, { tex: A.get(`bottle${v}`) });
      k.cyl(r, r, h * 0.16, 12, { y: h * 0.48 }, liquid);
      k.cyl(r * 0.42, r, h * 0.22, 12, { y: h * 0.64 }, liquid);
      k.cyl(r * 0.44, r * 0.44, h * 0.08, 8, { y: h * 0.86 }, parseInt(C[1].slice(1), 16));
      break;
    }
    case 'can': {
      const r = w / 2;
      k.cyl(r * 0.88, r, h * 0.06, 12, {}, 0xb8bcc4);
      k.cyl(r, r, h * 0.84, 12, { y: h * 0.06, ry: -Math.PI / 2 }, 0xffffff, { tex: A.get(`can${v}`) });
      k.cyl(r * 0.8, r, h * 0.1, 12, { y: h * 0.9 }, 0xc8ccd4);
      break;
    }
    case 'onigiri': {
      // 三角形的饭团（白色包装）+ 正面的标签 + 下面的海苔
      k.cyl(w * 0.55, w * 0.55, d, 3, { y: w * 0.28, z: d / 2, rx: -Math.PI / 2 }, 0xf6f6f2);
      k.plane(w * 0.5, h * 0.24, { y: h * 0.58, z: d / 2 + 0.002 }, 0xffffff, { tex: A.sub(`onigiri${v}`, 0.14, 0.62, 0.86, 0.92) });
      k.box(w * 0.6, h * 0.22, d * 1.04, { y: 0.002 }, 0x1e2a20);
      break;
    }
    case 'bento': {
      k.box(w, h * 0.7, d, {}, 0x1a1a1a);
      k.box(w, h * 0.3, d, { y: h * 0.7 }, 0xe8eef0, { tex: A.get(`bento${v}`), faces: ['py'] });
      k.box(w, h * 0.1, 0.01, { y: h * 0.5, z: d / 2 }, 0xe8483a);
      break;
    }
    case 'noodle': {
      const r = w / 2;
      k.cyl(r, r * 0.78, h * 0.94, 14, { ry: -Math.PI / 2 }, 0xffffff, { tex: A.get(`noodle${v}`) });
      k.cyl(r * 1.02, r * 1.02, h * 0.06, 14, { y: h * 0.94 }, 0xf0ece0);
      break;
    }
    case 'mag': {
      k.box(w, h, d, {}, 0xf4f4f4, { tex: A.get(`mag${v}`) });
      break;
    }
    case 'sweet': {
      k.box(w, h, d, {}, 0xffffff, { tex: A.get(`sweet${v}`) });
      break;
    }
    case 'daily': {
      k.box(w, h, d, {}, 0xffffff, { tex: A.get(`daily${v}`) });
      break;
    }
    case 'ice': {
      k.box(w, h, d, {}, [0xe85a8a, 0x4ab0e8, 0xf0c040, 0x7ad070][v % 4] as number);
      break;
    }
    case 'cup': {
      k.cyl(w / 2, w * 0.38, h, 12, {}, 0xfafafa);
      k.cyl(w * 0.52, w * 0.52, 0.012, 12, { y: h }, 0x6a3a2a);
      break;
    }
  }
  k.pop();
  const mark = k.end();
  registerProductVisual(W, mark, kind, v, tilt);
  return mark;
}

/** 把一件商品登记成可以拿的交互（拿走 → 隐藏，进购物袋；一段时间后补货） */
export function shelfItem(W: World, k: Kit, m: Mark, g: Good, cart: Cart): void {
  const box = new Box3().copy(m.box).expandByScalar(0.01);
  let goneAt = -1;
  W.interact({
    box,
    label: () => `拿起  ${g.name}  ¥${g.price}`,
    on: () => !m.hidden,
    use: () => {
      k.setHidden(m, true);
      if (m.replacement) m.replacement.visible = false;
      goneAt = cart.time;
      cart.add(g);
      W.sfx.pick();
    },
  });
  cart.restock.push(() => {
    // 拿走 90 秒后、人不在旁边的时候补货
    if (m.hidden && goneAt >= 0 && cart.time - goneAt > 90 && W.player.distanceTo(box.getCenter(_c)) > 4) {
      k.setHidden(m, false);
      if (m.replacement) m.replacement.visible = true;
      goneAt = -1;
    }
  });
}

const _c = new Vector3();

/** 购物车：拿了什么、付没付钱 */
export class Cart {
  time = 0;
  readonly items: Good[] = [];
  readonly restock: Array<() => void> = [];
  paidCount = 0;
  spent = 0;
  private restockT = 0;
  onChange: () => void = () => {};

  add(g: Good): void {
    this.items.push(g);
    this.onChange();
  }

  get unpaid(): number {
    return this.items.length;
  }

  get total(): number {
    return this.items.reduce((s, g) => s + g.price, 0);
  }

  pay(): number {
    const n = this.items.length;
    this.spent += this.total;
    this.paidCount += n;
    this.items.length = 0;
    this.onChange();
    return n;
  }

  update(dt: number): void {
    this.time += dt;
    this.restockT -= dt;
    if (this.restockT <= 0) {
      this.restockT = 2;
      for (const f of this.restock) f();
    }
  }
}
