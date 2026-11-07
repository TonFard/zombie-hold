// 资产平台（assets.html）：给建模用的资产浏览器。
//
// 左边是目录（catalog.json 里的资产 + 款式），右边是 3D 预览（已交付的 glb），
// 下面是规格（尺寸、预算、节点名、动画名）。开发服务器下 /__konbini-assets.json
// 列出 public/assets/konbini/models/ 下已交付的模型，刷新就自动认领。
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AssetEntry, Catalog, Variant } from './catalog-types';

const CATALOG_URL = `${import.meta.env.BASE_URL}assets/konbini/catalog.json`;
const MODELS_BASE = `${import.meta.env.BASE_URL}assets/konbini/`;

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header>
    <h1>资产平台</h1>
    <div class="meta" id="meta">读取目录…</div>
  </header>
  <main>
    <aside id="list"><div class="pad">读取目录…</div></aside>
    <section id="stage">
      <canvas id="c"></canvas>
      <div id="hint">选中左边的资产查看规格和预览</div>
    </section>
  </main>
  <footer id="spec"><div class="pad">选中一个资产查看规格</div></footer>
`;

const listEl = root.querySelector<HTMLDivElement>('#list')!;
const specEl = root.querySelector<HTMLDivElement>('#spec')!;
const metaEl = root.querySelector<HTMLDivElement>('#meta')!;
const hintEl = root.querySelector<HTMLDivElement>('#hint')!;
const canvas = root.querySelector<HTMLCanvasElement>('#c')!;

// ---------------------------------------------------------------- 3D 场景
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;

const scene = new Scene();
scene.background = new Color('#14171c');

const camera = new PerspectiveCamera(40, 1, 0.01, 500);
camera.position.set(1.6, 1.1, 1.9);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new AmbientLight(0xb9c4d0, 0.85));
const sun = new DirectionalLight(0xfff0d8, 2.1);
sun.position.set(-2.5, 4.0, 2.0);
sun.castShadow = true;
scene.add(sun);

const grid = new GridHelper(4, 20, 0x2a3038, 0x232830);
grid.position.y = -0.001;
scene.add(grid);

const modelRoot = new Group();
scene.add(modelRoot);

const loader = new GLTFLoader();

function resize(): void {
  const r = canvas.parentElement!.getBoundingClientRect();
  const w = Math.max(2, Math.floor(r.width));
  const h = Math.max(2, Math.floor(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function frameBox(box: Box3): void {
  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.9 + 0.15;
  const dir = new Vector3(0.85, 0.6, 1).normalize().multiplyScalar(dist);
  camera.position.copy(center).add(dir);
  controls.target.copy(center);
  controls.minDistance = maxDim * 0.4;
  controls.maxDistance = maxDim * 12;
  controls.update();
}

function clearModel(): void {
  modelRoot.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as { dispose?: () => void } | { dispose?: () => void }[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
    else mat?.dispose?.();
  });
  modelRoot.clear();
}

/** 加载一个 glb：按目录尺寸摆正并框住它 */
async function showModel(url: string): Promise<void> {
  clearModel();
  try {
    const gltf = await loader.loadAsync(url);
    modelRoot.add(gltf.scene);
    const box = new Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) return;
    // 原点在底面中心：把包围盒底面挪到 y = 0
    modelRoot.position.set(0, -box.min.y, 0);
    box.setFromObject(gltf.scene);
    frameBox(box);
    hintEl.textContent = '';
  } catch {
    hintEl.textContent = '模型加载失败';
  }
}

// ---------------------------------------------------------------- 目录
interface CatalogFile extends AssetEntry {
  file?: string;
}

let catalog: Catalog | null = null;
/** 已交付的模型：路径 → 修改时间 */
let delivered: Record<string, number> = {};

async function loadDelivered(): Promise<void> {
  try {
    const r = await fetch('/__konbini-assets.json', { cache: 'no-store' });
    if (r.ok) delivered = (await r.json()) as Record<string, number>;
  } catch {
    delivered = {};
  }
}

/** 某个资产已交付的 glb 路径（相对 assets/konbini/） */
function deliveredFile(a: CatalogFile, v?: Variant): string | null {
  if (v?.file) return v.file;
  if (a.file) return a.file;
  if (a.variants && a.variants.length === 1 && a.variants[0]?.file) return a.variants[0].file;
  // models/<id>.glb 或 models/<id>/<variant>.glb
  if (delivered[`models/${a.id}.glb`]) return `models/${a.id}.glb`;
  for (const va of a.variants ?? []) {
    if (delivered[`models/${a.id}/${va.id}.glb`]) return `models/${a.id}/${va.id}.glb`;
  }
  return null;
}

function statusOf(a: CatalogFile, v?: Variant): 'pending' | 'sample' | 'delivered' {
  if (deliveredFile(a, v)) return 'delivered';
  if (v?.status === 'sample' || a.status === 'sample') return 'sample';
  return 'pending';
}

const STATUS_TEXT: Record<string, string> = { pending: '待交付', sample: '样例', delivered: '已交付' };

function selectAsset(a: CatalogFile, v?: Variant): void {
  const file = deliveredFile(a, v);
  if (file) void showModel(MODELS_BASE + file);
  else {
    clearModel();
    frameBox(new Box3(new Vector3(-0.3, 0, -0.3), new Vector3(0.3, 0.6, 0.3)));
    hintEl.textContent = '还没有模型：按右边的规格做，放进 public/assets/konbini/models/';
  }
  renderSpec(a, v);
}

function renderSpec(a: CatalogFile, v?: Variant): void {
  const rows: string[] = [];
  const push = (k: string, val: string): void => {
    rows.push(`<div class="row"><span class="k">${k}</span><span class="v">${val}</span></div>`);
  };
  push('尺寸', `${a.dims.map((d) => d.toFixed(2)).join(' × ')} m`);
  if (a.budget) push('三角形预算', String(a.budget));
  if (a.count) push('场景数量', String(a.count));
  if (a.maxTexture) push('贴图上限', `${a.maxTexture} px`);
  push('状态', STATUS_TEXT[statusOf(a, v)] ?? a.status);
  if (a.source) push('出处', a.source);
  if (a.notes) push('说明', a.notes);
  if (a.origin === 'custom') push('原点', '按说明（不是底面中心）');
  const inter = a.interactions ?? [];
  if (inter.length) {
    push('可动部件', inter.map((i) => `${i.label}<em>${i.type}${i.clip ? ` · ${i.clip}` : ''}${i.nodes?.length ? ` · ${i.nodes.join(', ')}` : ''}</em>`).join('、'));
  }
  if (v) {
    push('款式', `${v.name}（${v.id}）`);
    if (v.price !== undefined) push('价格', `¥${v.price}`);
  }
  specEl.innerHTML = `<div class="pad"><h2>${a.name}<small>${a.id}</small></h2>${rows.map((r) => r).join('')}</div>`;
}

function renderList(): void {
  if (!catalog) return;
  const parts: string[] = [];
  for (const c of catalog.categories) {
    const assets = catalog.assets.filter((a) => a.category === c.id);
    if (!assets.length) continue;
    parts.push(`<div class="cat">${c.name}<em>${assets.length}</em></div>`);
    for (const a of assets) {
      const st = statusOf(a);
      parts.push(`<div class="item" data-id="${a.id}"><span class="n">${a.name}</span><span class="s ${st}">${STATUS_TEXT[st]}</span></div>`);
      const vs = a.variants ?? [];
      for (const v of vs) {
        const sv = statusOf(a, v);
        parts.push(`<div class="item var" data-id="${a.id}" data-v="${v.id}"><span class="n">└ ${v.name}</span><span class="s ${sv}">${STATUS_TEXT[sv]}</span></div>`);
      }
    }
  }
  listEl.innerHTML = parts.join('');
}

listEl.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.item');
  if (!el || !catalog) return;
  const id = el.dataset.id!;
  const a = catalog.assets.find((x) => x.id === id);
  if (!a) return;
  const vid = el.dataset.v;
  const v = vid ? (a.variants ?? []).find((x) => x.id === vid) : undefined;
  listEl.querySelectorAll('.item.sel').forEach((x) => x.classList.remove('sel'));
  el.classList.add('sel');
  selectAsset(a, v);
});

async function boot(): Promise<void> {
  await loadDelivered();
  try {
    const r = await fetch(CATALOG_URL, { cache: 'no-store' });
    catalog = (await r.json()) as Catalog;
  } catch {
    listEl.innerHTML = '<div class="pad">读不到 catalog.json，先跑 npm run assets:catalog</div>';
    return;
  }
  const units = catalog.assets.reduce((s, a) => s + (a.variants?.length || 1), 0);
  metaEl.textContent = `${catalog.title} · ${catalog.assets.length} 个资产 / ${units} 件 · v${catalog.version}`;
  renderList();
  resize();
}

function loop(): void {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
}
loop();
resize();
void boot();
