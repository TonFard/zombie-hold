// 商品：12 个品类，每一款（SKU）对应场景里图集的一张包装贴图，名字和价格直接取游戏代码，保证一一对应。
import { BENTO, BOTTLES, BREADS, CANS, DAILY, MAGAZINES, NOODLES, ONIGIRI, SNACKS, SWEETS } from '../../../src/konbini/atlas';
import { goodInfo, SIZE, type GoodKind } from '../../../src/konbini/goods';
import type { AssetEntry, Variant } from '../../../src/viewer/catalog';

const pick = { id: 'pick', label: '拿起 / 放回', type: 'pick' as const, note: '游戏里：前排商品可以拿，拿走后隐藏并加入购物袋，90 秒后人不在附近时补货' };

function skus(kind: GoodKind, list: readonly (string | readonly string[])[], prefix: string): Variant[] {
  return list.map((n, i) => {
    const info = goodInfo(kind, i);
    const color = typeof n === 'string' ? undefined : (n[1] as string);
    return { id: `${prefix}_${String(i + 1).padStart(2, '0')}`, name: info.name, price: info.price, color, status: 'pending' as const };
  });
}

const dims = (k: GoodKind): [number, number, number] => {
  const [w, h, d] = SIZE[k];
  return [w, h, d];
};

interface G {
  kind: GoodKind;
  name: string;
  list: readonly (string | readonly string[])[];
  budget: number;
  tile: string;
  notes: string;
}

const G: G[] = [
  { kind: 'snack', name: '薯片袋', list: SNACKS, budget: 300, tile: 'snack0..5', notes: '鼓起来的软包装袋，上下有压边封口；正反两面印刷。' },
  { kind: 'bread', name: '袋装面包', list: BREADS, budget: 250, tile: 'bread0..4', notes: '透明袋装面包，正面和顶面印刷。' },
  { kind: 'bottle', name: '瓶装饮料（PET）', list: BOTTLES, budget: 600, tile: 'bottle0..7', notes: 'PET 瓶：瓶身液体色 + 中段一圈标签 + 瓶肩收口 + 瓶盖（瓶盖用标签第二色）。茶类液体 #9a8a3a，可乐 #3a0a0a，奶茶 #c8a070，其余透明水色。' },
  { kind: 'can', name: '罐装饮料', list: CANS, budget: 400, tile: 'can0..7', notes: '铝罐：罐底、罐身一圈印刷、罐顶收口和拉环。' },
  { kind: 'onigiri', name: '饭团', list: ONIGIRI, budget: 200, tile: 'onigiri0..5', notes: '三角饭团，白色包装，正面标签贴纸（口味名），底部海苔，中间红色撕带。' },
  { kind: 'bento', name: '便当', list: BENTO, budget: 400, tile: 'bento0..3', notes: '黑色便当盒 + 透明盖（盖顶面印菜品俯视图）+ 侧面红色腰封。' },
  { kind: 'noodle', name: '杯面', list: NOODLES, budget: 300, tile: 'noodle0..3', notes: '上大下小的纸杯，侧面一圈印刷，顶部纸盖。' },
  { kind: 'mag', name: '杂志', list: MAGAZINES, budget: 100, tile: 'mag0..7', notes: '薄平装杂志，封面印刷；在杂志架上后仰 0.3 rad 摆放。' },
  { kind: 'sweet', name: '甜点 / 糖果', list: SWEETS, budget: 200, tile: 'sweet0..5', notes: '小盒包装，正面印刷。' },
  { kind: 'daily', name: '日用品', list: DAILY, budget: 200, tile: 'daily0..3', notes: '纸巾、牙膏、电池、口罩的小盒包装。' },
];

export function goods(): AssetEntry[] {
  const out: AssetEntry[] = G.map((g) => ({
    id: `goods_${g.kind}`,
    name: g.name,
    category: 'goods',
    dims: dims(g.kind),
    budget: g.budget,
    maxTexture: 512,
    status: 'pending',
    source: `goods.ts good('${g.kind}')`,
    notes: `${g.notes} 包装贴图对应图集 ${g.tile}。所有款式共用同一个网格，只换贴图。`,
    variantLabel: 'SKU',
    interactions: [pick],
    variants: skus(g.kind, g.list, g.kind),
  }));
  // 冰淇淋：游戏里只有一种名字（アイス），颜色有 4 种
  out.push({
    id: 'goods_ice',
    name: '冰淇淋（雪糕）',
    category: 'goods',
    dims: dims('ice'),
    budget: 200,
    maxTexture: 512,
    status: 'pending',
    source: "goods.ts good('ice')",
    notes: '卧式冰柜里的雪糕，只用颜色区分口味（#e85a8a / #4ab0e8 / #f0c040 / #7ad070）。',
    variantLabel: 'SKU',
    interactions: [{ id: 'buy', label: '拿一支', type: 'code', note: '游戏里：冰柜盖滑开后才能拿，¥160 加入购物袋' }],
    variants: ['苺', 'ソーダ', 'バニラ', '抹茶'].map((n, i) => ({ id: `ice_${String(i + 1).padStart(2, '0')}`, name: `アイス（${n}）`, price: 160, color: ['#e85a8a', '#4ab0e8', '#f0c040', '#7ad070'][i], status: 'pending' as const })),
  });
  // 热饮 / 熟食：不在货架上，由设施"做"出来
  out.push({
    id: 'goods_coffee_cup',
    name: '咖啡纸杯（ホット S）',
    category: 'goods',
    dims: [0.08, 0.1, 0.08],
    budget: 200,
    maxTexture: 512,
    status: 'pending',
    source: 'fixtures.ts 咖啡机 cup',
    notes: '白色纸杯，上大下小，红色杯套，杯口深褐色咖啡。咖啡机出杯时出现。¥100',
    interactions: [],
  });
  out.push({
    id: 'goods_karaage',
    name: '炸鸡块（からあげ 5 個入）',
    category: 'goods',
    dims: [0.07, 0.03, 0.07],
    budget: 150,
    maxTexture: 512,
    status: 'pending',
    count: 18,
    source: 'fixtures.ts 热食柜',
    notes: '单颗炸鸡块，略扁的不规则球，两种炸色 #c87a30 / #e8a040。热食柜里两层各 9 颗。¥238 / 份',
    interactions: [],
  });
  out.push({
    id: 'goods_oden_bowl',
    name: '关东煮（一碗）',
    category: 'goods',
    dims: [0.14, 0.07, 0.14],
    budget: 400,
    maxTexture: 512,
    status: 'pending',
    source: 'fixtures.ts 关东煮（游戏里没有碗的模型）',
    notes: '新增：外带纸碗，里面萝卜、鸡蛋、竹轮。游戏里现在只是文字提示，有模型后可以在锅前出现。¥210',
    interactions: [],
  });
  return out;
}

/** 校对用：商品总款数 */
export function skuCount(): number {
  return [SNACKS, BREADS, BOTTLES, CANS, ONIGIRI, BENTO, NOODLES, MAGAZINES, SWEETS, DAILY].reduce((s, l) => s + l.length, 0) + 4;
}
