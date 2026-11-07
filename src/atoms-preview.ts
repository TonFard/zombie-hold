import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { atomCacheSize } from './render/world/atoms';
import { buildRoom, RM_JP_06_BEDROOM, roomFloor } from './render/world/roomModule';

/**
 * 原子资产预览页：把一个房间模块（卧室）摆出来，逐个原子检查。
 *
 * 这个页面存在的意义：原子化之后，最容易出的错是「某个零件浮在空中」或者
 * 「某个零件陷进桌面」。这类问题在渲染图里一眼能看出来，在代码里看不出来。
 */

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const atomsOut = document.querySelector<HTMLElement>('#atoms')!;
const callsOut = document.querySelector<HTMLElement>('#calls')!;
const trisOut = document.querySelector<HTMLElement>('#tris')!;
const msOut = document.querySelector<HTMLElement>('#ms')!;

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;

const scene = new Scene();
scene.background = new Color('#20242b');

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.02, 100);
camera.position.set(2.6, 1.9, 3.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(-1.0, 0.85, -0.7);
controls.minDistance = 0.4;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new AmbientLight(0xb9c4d0, 0.9);
const sun = new DirectionalLight(0xfff0d8, 2.2);
sun.position.set(-3.5, 5.0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 3;
sun.shadow.camera.bottom = -3;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0008;
scene.add(hemi, sun);

const root = new Group();
scene.add(root);

// 地板：榻榻米色
const floor = roomFloor(
  RM_JP_06_BEDROOM,
  new MeshStandardMaterial({ color: 0x8a7a52, roughness: 0.92 }),
);
root.add(floor);

void buildRoom(RM_JP_06_BEDROOM, root).then(() => {
  status.style.display = 'none';
  atomsOut.textContent = String(atomCacheSize());
  // 对准书桌：这是原子最密的地方，能一眼看出零件有没有浮空或陷进去。
  const focus = new Vector3(-1.0, 0.85, -0.68);
  controls.target.copy(focus);
  camera.position.set(focus.x + 0.95, focus.y + 0.62, focus.z + 0.95);
  camera.lookAt(focus);
  controls.update();
});

// 开发时用控制台调整机位
(window as unknown as { atomsView?: unknown }).atomsView = { scene, camera, controls, renderer };

let frames = 0;
let last = performance.now();

function loop(): void {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);

  frames++;
  const now = performance.now();
  if (now - last > 500) {
    msOut.textContent = `${((now - last) / frames).toFixed(1)} ms`;
    callsOut.textContent = String(renderer.info.render.calls);
    trisOut.textContent = renderer.info.render.triangles.toLocaleString();
    frames = 0;
    last = now;
  }
}
loop();
