// 生成雨夜便利店的资产目录 public/assets/konbini/catalog.json + 平台自带的测试样例 glb。
//
// 用法：npm run assets:catalog
//
// 目录是建模（Blender）和平台之间的约定：尺寸、三角形预算、节点名、动画名。
// 商品的款式（SKU）名字和价格直接读游戏代码（src/konbini/atlas.ts、goods.ts），和场景里一一对应。
// 交付的模型放到 public/assets/konbini/models/<id>.glb（有款式的放 models/<id>/<款式>.glb），
// 开发服务器会自动发现，不用改目录；要改尺寸、预算、交互，改 scripts/tools/catalog/*.ts 再跑一次。
import fs from 'node:fs';
import path from 'node:path';
import type { AssetEntry, Catalog } from '../../src/viewer/catalog';
import { building } from './catalog/building';
import { fixtures } from './catalog/fixtures';
import { goods, skuCount } from './catalog/goods';
import { outdoor } from './catalog/outdoor';
import { atm, canCoffee, locker, vending } from './catalog/samples';
import { street } from './catalog/street';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'public/assets/konbini');
const sampleDir = path.join(out, 'samples');
fs.mkdirSync(sampleDir, { recursive: true });
fs.mkdirSync(path.join(out, 'models'), { recursive: true });

const CATEGORIES = [
  { id: 'goods', name: '商品' },
  { id: 'fixture', name: '店内陈设' },
  { id: 'building', name: '店铺本体' },
  { id: 'outdoor', name: '店门口' },
  { id: 'street', name: '街道设施' },
  { id: 'vehicle', name: '车辆' },
  { id: 'neighbor', name: '周边建筑' },
];

const CONVENTIONS = [
  '单位：米。1 Blender 单位 = 1 m，导出前应用全部变换（Ctrl+A → 全部变换）。',
  '朝向：正面朝 +Z（Blender 里朝 −Y），向上 +Y；导出 glTF 时勾选"+Y 向上"（默认就是）。',
  '原点：底面中心（y = 0 贴地，x / z 居中）；目录里标了"原点按约定"的（路灯、吸顶灯）以说明为准。',
  '格式：glb（二进制，贴图打包进去）。不导出相机和灯光。材质用 Principled BSDF（PBR）。',
  '贴图：固有色 / 法线（OpenGL，绿色向上）/ ORM（R = AO、G = 粗糙度、B = 金属度）。商品 ≤ 512 px，其他 ≤ 2048 px，尽量合图。',
  '可动部件：做成单独对象，名字按目录里的节点名；转轴 / 滑动的原点放在铰链或滑轨上。',
  '动画：名字按目录（例如 door_open、locker_01_open），开关类动画只做"打开"一段，平台倒放就是关。',
  '自发光：招牌、灯条、屏幕用 Emission，强度 1 左右（游戏里有 Bloom）。玻璃用 Alpha Blend，粗糙度低。',
  '交付：放进 public/assets/konbini/models/<id>.glb；有款式的放 models/<id>/<款式 id>.glb。刷新平台页面就能看到并自动校验。',
];

const assets: AssetEntry[] = [...goods(), ...fixtures(), ...building(), ...outdoor(), ...street()];

// 平台自带的测试样例：几何简单，但节点、动画、尺寸都按约定做（真正交付后自动被替换）
const samples: Array<[string, string | null, () => Buffer]> = [
  ['atm', null, atm],
  ['vending_machine', 'red_hot', vending],
  ['parcel_locker', null, locker],
  ['goods_can', 'can_01', canCoffee],
];
for (const [id, variant, make] of samples) {
  const file = `samples/${id}${variant ? `__${variant}` : ''}.glb`;
  fs.writeFileSync(path.join(out, file), make());
  const a = assets.find((x) => x.id === id);
  if (!a) throw new Error(`样例 ${id} 在目录里找不到`);
  if (variant) {
    const v = a.variants?.find((x) => x.id === variant);
    if (!v) throw new Error(`样例 ${id} 的款式 ${variant} 在目录里找不到`);
    v.file = file;
    v.status = 'sample';
  } else {
    a.file = file;
    a.status = 'sample';
  }
}

// 自检：id 唯一、尺寸为正、类别存在、每个交互的类型合法
const ids = new Set<string>();
const cats = new Set(CATEGORIES.map((c) => c.id));
const types = new Set(['toggle', 'trigger', 'loop', 'state', 'visibility', 'pick', 'code']);
for (const a of assets) {
  if (ids.has(a.id)) throw new Error(`重复的 id：${a.id}`);
  ids.add(a.id);
  if (!cats.has(a.category)) throw new Error(`${a.id}：未知类别 ${a.category}`);
  if (a.dims.length !== 3 || a.dims.some((d) => !(d > 0))) throw new Error(`${a.id}：尺寸不对 ${a.dims}`);
  const vids = new Set<string>();
  for (const v of a.variants ?? []) {
    if (vids.has(v.id)) throw new Error(`${a.id}：重复的款式 ${v.id}`);
    vids.add(v.id);
  }
  for (const it of a.interactions) {
    if (!types.has(it.type)) throw new Error(`${a.id}：交互 ${it.id} 类型不对 ${it.type}`);
    if ((it.type === 'toggle' || it.type === 'trigger' || it.type === 'loop') && !it.clip) throw new Error(`${a.id}：交互 ${it.id} 缺动画名`);
  }
}

const catalog: Catalog = { title: '雨夜便利店 · 资产库', version: 1, conventions: CONVENTIONS, categories: CATEGORIES, assets };
fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');

const goodsSkus = assets.filter((a) => a.category === 'goods').reduce((s, a) => s + (a.variants?.length ?? 0), 0);
const units = assets.reduce((s, a) => s + (a.variants?.length || 1), 0);
const inter = assets.reduce((s, a) => s + a.interactions.length, 0);
console.log(`资产 ${assets.length} 个，可交付单位 ${units} 件（商品 SKU ${goodsSkus}，游戏里 ${skuCount()}），交互 ${inter} 个，样例 ${samples.length} 个`);
for (const c of CATEGORIES) console.log(`  ${c.name}：${assets.filter((a) => a.category === c.id).length}`);
if (goodsSkus !== skuCount()) throw new Error(`商品 SKU 数（${goodsSkus}）和游戏里（${skuCount()}）对不上`);
console.log(`-> ${path.relative(root, path.join(out, 'catalog.json'))}`);
