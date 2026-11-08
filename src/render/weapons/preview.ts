import { AmbientLight, Box3, DirectionalLight, Group, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, ACESFilmicToneMapping, type Object3D } from 'three';
import { WEAPON_ORDER, type WeaponKind } from '../../game/data/weapons';
import { buildWeapon } from './index';

/**
 * 武器图标和武器台的 3D 预览（M20）：用程序武器模型（buildWeapon，每把枪都有，不依赖 TACZ 文件）。
 *   图标：离屏画一次侧视图，转成 PNG（data URL），武器台列表、工坊、结算页当 <img> 用
 *   预览：武器台右上角一个小画布，可以拖动旋转
 * 只有一个共享的 WebGLRenderer（图标都在第一次请求时画好缓存起来），不占游戏主画布。
 */
let shared: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; holder: Group } | null = null;

function setup(): NonNullable<typeof shared> {
  if (shared) return shared;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 3.2));
  const key = new DirectionalLight(0xfff0dc, 4.5);
  key.position.set(1.5, 2, 3);
  scene.add(key);
  const rim = new DirectionalLight(0x9ccfff, 3.2);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const camera = new PerspectiveCamera(22, 2, 0.05, 20);
  const holder = new Group();
  scene.add(holder);
  shared = { renderer, scene, camera, holder };
  return shared;
}

/** 武器台展示：包围球直径占画面短边的比例 */
const PREVIEW_FILL = 0.8;
/** 武器台展示：取景用的最小包围球半径（米）。长枪约 0.4–0.6，手枪 0.17 */
const PREVIEW_MIN_R = 0.24;

/**
 * 把模型放到画面中间、长边撑满：枪口朝 +Z，所以侧视 = 从 +X 看过去（yaw = 0）。
 * 只在第一次居中（userData.centered），之后每帧只动相机，模型不会被一次次挪走
 */
function frame(obj: Object3D, camera: PerspectiveCamera, aspect: number, yaw: number, pitch: number): void {
  if (!obj.userData.centered) {
    const box = new Box3().setFromObject(obj);
    obj.position.sub(box.getCenter(new Vector3()));
    obj.userData.centered = true;
    obj.userData.radius = box.getSize(new Vector3()).length() / 2;
  }
  // 包围球装进视野：竖直半视角和水平半视角取小的那个。
  // PREVIEW_FILL：包围球直径只占画面短边的这么多，四周留空隙，转起来不会出框。
  // PREVIEW_MIN_R：小于它的枪（手枪 0.17 米）按它来取景，不会被放大成和步枪一样大
  const half = Math.min((camera.fov * Math.PI) / 360, Math.atan(Math.tan((camera.fov * Math.PI) / 360) * aspect));
  const radius = Math.max(obj.userData.radius as number, PREVIEW_MIN_R);
  const r = radius / Math.sin(half) / PREVIEW_FILL;
  camera.aspect = aspect;
  camera.position.set(Math.cos(pitch) * Math.cos(yaw) * r, Math.sin(pitch) * r, Math.cos(pitch) * Math.sin(yaw) * r);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

const icons = new Map<string, string>();

/** 某把枪某个等级的侧视图标（PNG data URL），缓存 */
export function weaponIcon(kind: WeaponKind, tier = 0, w = 240, h = 96): string {
  const key = `${kind}:${tier}:${w}x${h}`;
  const hit = icons.get(key);
  if (hit) return hit;
  const s = setup();
  s.renderer.setSize(w, h, false);
  const m = buildWeapon(kind, tier);
  s.holder.clear();
  s.holder.add(m.group);
  // 图标是纯侧视：按枪的长度撑满宽度（包围球对细长的枪太松）
  const box = new Box3().setFromObject(m.group);
  const size = box.getSize(new Vector3());
  m.group.position.sub(box.getCenter(new Vector3()));
  s.camera.aspect = w / h;
  const tanH = Math.tan((s.camera.fov * Math.PI) / 360);
  const dist = Math.max(size.z / 2 / (tanH * (w / h)), size.y / 2 / tanH) * 1.08 + size.x / 2;
  s.camera.position.set(dist, dist * 0.08, 0);
  s.camera.lookAt(0, 0, 0);
  s.camera.updateProjectionMatrix();
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL('image/png');
  icons.set(key, url);
  return url;
}

/** 所有枪的图标（1 级外观） */
export const allIcons = (): Record<WeaponKind, string> => Object.fromEntries(WEAPON_ORDER.map((k) => [k, weaponIcon(k)])) as Record<WeaponKind, string>;

/**
 * 武器台的 3D 展示（UI-PLAN 3.3）：返回一个画布，默认自动旋转（约 12 秒一圈）；
 * 拖动手动转，松手 3 秒后恢复自动；滚轮缩放 0.6–1.8 倍；换枪时新枪从侧面转进来。
 * 画布跟着容器尺寸走（resize），单独一个渲染器，只在武器台打开时存在。
 * 双持手枪展示两把（一左一右），不是一把
 */
export function createPreview(w = 360, h = 150): { canvas: HTMLCanvasElement; setWeapon(kind: WeaponKind, tier: number, dual?: boolean): void; resize(w: number, h: number): void; dispose(): void } {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 2.6));
  const key = new DirectionalLight(0xfff0dc, 5);
  key.position.set(1.5, 2.2, 3);
  scene.add(key);
  // 轮廓光：一冷一暖从后面打，让深色枪身的边缘亮出来
  const rim = new DirectionalLight(0x9ccfff, 4);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const warm = new DirectionalLight(0xffb070, 2.2);
  warm.position.set(2, -0.5, -2.5);
  scene.add(warm);
  const camera = new PerspectiveCamera(24, w / h, 0.05, 20);
  const holder = new Group();
  scene.add(holder);
  let aspect = w / h;
  let yaw = 0.35;
  let pitch = 0.16;
  let zoom = 1;
  let dragging = false;
  /** 上次手动操作的时间：3 秒内不自动转 */
  let touched = -1e9;
  let lx = 0;
  let ly = 0;
  let raf = 0;
  let last = performance.now();
  /** 换枪动画 0→1：新枪从侧面转 90° 进来，同时放大 */
  let swap = 1;
  let current: Group | null = null;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 一圈 12 秒；刚换枪时转得快一点，然后缓下来
    if (!dragging && now - touched > 3000 && !reduce) yaw += dt * ((Math.PI * 2) / 12);
    if (swap < 1) swap = Math.min(1, swap + dt * 2.6);
    const e = 1 - (1 - swap) ** 3;
    if (current) {
      frame(current, camera, aspect, yaw - (1 - e) * 1.4, pitch);
      // 缩放：沿视线方向把相机推近 / 拉远
      camera.position.multiplyScalar((1 / zoom) * (1.25 - 0.25 * e));
      camera.lookAt(0, 0, 0);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.style.touchAction = 'none';
  const down = (e: PointerEvent) => {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yaw += (e.clientX - lx) * 0.012;
    pitch = Math.max(-0.8, Math.min(0.8, pitch + (e.clientY - ly) * 0.01));
    lx = e.clientX;
    ly = e.clientY;
    touched = performance.now();
  };
  const up = () => {
    dragging = false;
    touched = performance.now();
    el.style.cursor = 'grab';
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = Math.max(0.6, Math.min(1.8, zoom * Math.exp(-e.deltaY * 0.0012)));
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  raf = requestAnimationFrame(loop);
  return {
    canvas: el,
    setWeapon(kind, tier, dual = false) {
      holder.clear();
      // frame() 会挪模型的位置，每次都用新建的模型
      // 双持：左右各一把（左边那把沿 X 镜像）。只沿 X 摆开的话，从侧面看两把完全重叠、像一把，
      // 所以再前后、上下错开一点，枪口各向外撇一点，转到哪个角度都看得出是两把
      const g = new Group();
      if (dual && kind === 'pistol') {
        const right = buildWeapon(kind, tier).group;
        const left = buildWeapon(kind, tier).group;
        left.scale.x = -1;
        right.position.set(0.07, 0.035, 0.07);
        left.position.set(-0.07, -0.035, -0.07);
        right.rotation.y = 0.2;
        left.rotation.y = -0.2;
        g.add(right, left);
      } else {
        g.add(buildWeapon(kind, tier).group);
      }
      holder.add(g);
      current = g;
      swap = reduce ? 1 : 0;
      zoom = 1;
    },
    resize(nw, nh) {
      if (nw < 2 || nh < 2) return;
      aspect = nw / nh;
      renderer.setSize(nw, nh, false);
    },
    dispose() {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      renderer.dispose();
    },
  };
}
