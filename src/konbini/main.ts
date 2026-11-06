import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Ray,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  CanvasTexture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildAtlas, skyline } from './atlas';
import { Sfx } from './audio';
import { buildBuildings } from './buildings';
import { STORE, World } from './ctx';
import { buildFixtures } from './fixtures';
import { Steam } from './fx';
import { buildGround, HALF } from './ground';
import { glassU, kitMats, toonRamp, wetU } from './materials';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';
import { Player } from './player';
import { LAYER_FX, Post } from './post';
import { buildProps } from './props';
import { buildStore } from './store';
import { buildStreet } from './street';
import { skyTex } from './tex';
import { buildTraffic } from './traffic';
import { Weather } from './weather';

/**
 * 雨夜便利店街角：独立页面（konbini.html），和据点防守的代码完全分开，只借用了玩家角色的模型。
 *
 * 两种视角：
 *   模型（默认）：从外面看整个底座，像桌上的收藏模型；鼠标拖动旋转、滚轮缩放
 *   游览：点击画面 / 按 Enter 进入，用角色在里面走（WASD，V 第一 / 第三人称，E 交互）
 * 任何时候：R 下雨 / 停雨，Tab 切换模型 / 游览，H 显示 / 隐藏按键提示
 */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const promptEl = document.getElementById('prompt') as HTMLDivElement;
const sayEl = document.getElementById('say') as HTMLDivElement;
const helpEl = document.getElementById('help') as HTMLDivElement;
const crossEl = document.getElementById('cross') as HTMLDivElement;
const q = new URLSearchParams(location.search);

const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.get('dpr') ? Number(q.get('dpr')) : 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
// 场景基本是静的：阴影只在有东西动的时候重画（见主循环），不再每帧把整个场景画一遍
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new Scene();
const NIGHT = 0x121a30;
scene.fog = new FogExp2(NIGHT, 0.012);
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 220);
camera.layers.enable(LAYER_FX);

// ---------------------------------------------------------------- 世界
const atlas = buildAtlas();
const ramp = toonRamp();
const mats = kitMats(atlas.texture);
// PBR 材质需要环境反射才不会发灰：店里的玻璃、冷柜、金属件有高光；夜里压得很低
{
  const pm = new PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  pm.dispose();
}
const sfx = new Sfx();
const W = new World(scene, atlas, mats, ramp, sfx);
const steam = new Steam(220);
steam.mesh.layers.set(LAYER_FX);
W.add(steam.mesh);

const ground = buildGround(W);
const shell = buildStore(W);
const { cart } = buildFixtures(W, steam);
buildProps(W, cart);
const street = buildStreet(W);
buildBuildings(W);
buildTraffic(W, street.go);
atlas.texture.needsUpdate = true;

// 空调外机的白气（冬夜的雨里会冒一点）
for (let j = 0; j < 3; j++) steam.emit(new Vector3(7.6, 0.6, -10.5 + j * 1.1), 0.6, () => true, 0.2);

const weather = new Weather(W);
weather.rainMesh.layers.set(LAYER_FX);
weather.splashMesh.layers.set(LAYER_FX);

// ---------------------------------------------------------------- 天空、远景、灯光
{
  const sky = new Mesh(new SphereGeometry(160, 24, 12), new MeshBasicMaterial({ map: skyTex('#05070f', '#2a3050'), side: BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  W.tick.push(() => sky.position.copy(camera.position));
  // 远景城市剪影：一圈圆筒，贴在底座外很远的地方（只在游览时看得到，模型视角下藏起来）
  const tex = new CanvasTexture(skyline());
  tex.colorSpace = SRGBColorSpace;
  const ring = new Mesh(new CylinderGeometry(70, 70, 26, 48, 1, true), new MeshBasicMaterial({ map: tex, transparent: true, side: BackSide, fog: false, depthWrite: false }));
  ring.position.y = 9;
  ring.renderOrder = -9;
  scene.add(ring);
  (window as unknown as { __ring: Mesh }).__ring = ring;
}
const hemi = new HemisphereLight(0x5a6aa0, 0x1a1a24, 0.9);
scene.add(hemi);
const amb = new AmbientLight(0x4a5070, 0.5);
scene.add(amb);
// 月光（停雨后变亮一点）：从西北上方斜照，给整个底座一个主方向的阴影
const moon = new DirectionalLight(0x8aa0d8, 0.6);
moon.position.set(-14, 26, -10);
moon.target.position.set(0, 0, 0);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
const sc = moon.shadow.camera;
sc.left = -HALF - 2;
sc.right = HALF + 2;
sc.top = HALF + 2;
sc.bottom = -HALF - 2;
sc.near = 1;
sc.far = 70;
moon.shadow.bias = -0.0008;
moon.shadow.radius = 2;
moon.shadow.normalBias = 0.06;
scene.add(moon, moon.target);

const post = new Post(renderer, scene, camera);
post.mirror.hide.push(...ground.wet, weather.rainMesh, weather.splashMesh, steam.mesh);

// ---------------------------------------------------------------- 玩家 + 镜头
const player = new Player(W, ramp);
let mode: 'model' | 'walk' = q.get('walk') ? 'walk' : 'model';
const orbit = { yaw: -0.65, pitch: 0.62, dist: 66, target: new Vector3(0, 0, 0) };

// ---------------------------------------------------------------- 输入
const keys = new Set<string>();
let locked = false;
let dragging = false;
const last = new Vector2();
let jump = false;
let useE = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (keys.has(e.code)) return;
  keys.add(e.code);
  sfx.unlock();
  switch (e.code) {
    case 'KeyR':
      weather.toggle();
      W.say(weather.raining ? '开始下雨了…' : '雨停了。地上的水要过一阵才会干');
      break;
    case 'KeyV':
      player.third = !player.third;
      break;
    case 'KeyH':
      helpEl.classList.toggle('hide');
      break;
    case 'Tab':
      setMode(mode === 'model' ? 'walk' : 'model');
      break;
    case 'Enter':
      if (mode === 'model') setMode('walk');
      break;
    case 'Space':
      jump = true;
      break;
    case 'KeyE':
      useE = true;
      break;
    case 'KeyT':
      // 调试：立刻变干 / 变湿
      if (q.get('debug')) weather.setWet(weather.wet > 0.5 ? 0 : 1);
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', (e) => {
  sfx.unlock();
  if (mode === 'walk') {
    if (!locked) void canvas.requestPointerLock();
    else if (e.button === 0) useE = true;
    return;
  }
  dragging = true;
  last.set(e.clientX, e.clientY);
});
window.addEventListener('mouseup', () => (dragging = false));
canvas.addEventListener('dblclick', () => {
  if (mode === 'model') setMode('walk');
});
window.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && locked) {
    player.yaw -= e.movementX * 0.0022;
    player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0022));
  } else if (mode === 'model' && dragging) {
    orbit.yaw -= (e.clientX - last.x) * 0.005;
    orbit.pitch = Math.max(0.12, Math.min(1.45, orbit.pitch + (e.clientY - last.y) * 0.004));
    last.set(e.clientX, e.clientY);
  }
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode === 'model') orbit.dist = Math.max(18, Math.min(110, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08)));
  },
  { passive: true },
);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});

function setMode(m: 'model' | 'walk'): void {
  mode = m;
  document.body.dataset.mode = m;
  if (m === 'walk') {
    if (!q.get('nolock')) void canvas.requestPointerLock();
  } else if (document.pointerLockElement) document.exitPointerLock();
}
setMode(mode);

let sayT = 0;
W.say = (s: string): void => {
  sayEl.textContent = s;
  sayEl.classList.add('on');
  sayT = 4.5;
};
cart.onChange = () => {
  if (cart.unpaid) W.say(`购物袋：${cart.unpaid} 件  合计 ¥${cart.total}（去收银台结账）`);
};

// ---------------------------------------------------------------- 主循环
const ray = new Ray();
const camPos = new Vector3();
const dir = new Vector3();
let lastT = performance.now();
let time = 0;
let flick = 0;
let flickOn = 1;
let frameN = 0;
const dbg = { reflect: true };

function frame(now: number): void {
  // requestAnimationFrame and performance.now should share a time origin, but some
  // embedded browsers can report the first RAF timestamp slightly earlier. Never
  // feed a negative delta into the movement / gravity simulation.
  const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
  lastT = now;
  time += dt;
  W.time = time;

  // 玩家（模型视角下也照常模拟：站在原地）
  const fwd = mode === 'walk' ? (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) : 0;
  const side = mode === 'walk' ? (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0) : 0;
  player.update(dt, {
    fwd,
    side,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    crouch: mode === 'walk' && (keys.has('ControlLeft') || keys.has('KeyC')),
    jump: mode === 'walk' && jump,
  });
  jump = false;

  // 镜头
  if (mode === 'walk') {
    player.placeCamera(camera, dt);
    camera.fov = 62;
    weather.setView(28, 14, 20, 22);
    post.tilt = 0;
  } else {
    player.actor.group.visible = true;
    const o = orbit;
    camera.position.set(o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    camera.lookAt(o.target);
    camera.fov = 32;
    // 模型视角：整个底座都要下雨
    weather.setView(44, 16, 140, 40, 0.09);
    post.tilt = 0.6;
  }
  camera.updateProjectionMatrix();
  camPos.copy(camera.position);
  (window as unknown as { __ring: Mesh }).__ring.visible = mode === 'walk';
  scene.fog = mode === 'walk' ? (scene.fog ?? new FogExp2(NIGHT, 0.012)) : null;
  scene.background = null;

  // 天气 + 共享参数
  const rainFocus = mode === 'walk' ? player.pos : new Vector3(0, 0, 0);
  weather.update(dt, time, mode === 'walk' ? camPos : new Vector3(0, 6, 0), rainFocus);
  wetU.uTime.value = time;
  wetU.uWet.value = weather.wet;
  wetU.uRain.value = weather.rain;
  glassU.uWet.value = Math.min(1, weather.rain * 0.7 + weather.wet * 0.3);
  // 停雨后：月光稍亮、雾淡一点、夜空透一点
  const clear = 1 - weather.rain;
  moon.intensity = 0.45 + clear * 0.45;
  if (scene.fog) (scene.fog as FogExp2).density = 0.016 - clear * 0.007;
  sfx.update(weather.rain, player.indoor);

  // 招牌闪烁：大部分时候稳定，偶尔接触不良闪几下
  flick -= dt;
  if (flick < 0) {
    flickOn = Math.random() < 0.6 ? 0.35 : 1;
    flick = flickOn < 1 ? 0.04 + Math.random() * 0.08 : Math.random() < 0.08 ? 0.05 : 2 + Math.random() * 6;
  }
  const hum = 1 + Math.sin(time * 50) * 0.01;
  shell.sideMat.color.setScalar(flickOn * hum);
  shell.frontMat.color.setScalar(0.97 + Math.sin(time * 1.3) * 0.03);
  shell.signLight.intensity = 6 * (0.85 + 0.15 * flickOn);

  // 世界里的动画
  for (const f of W.tick) f(dt, time);
  steam.update(dt);

  // 交互
  let target = null;
  if (mode === 'walk') {
    camera.getWorldDirection(dir);
    ray.set(camera.position, dir);
    const eye = new Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z);
    // 第三人称：射线从镜头出发，但要求离角色 2.2 m 以内
    target = W.pick(ray, player.third ? 6 : 2.6, eye, 2.2);
  }
  const label = target?.label() ?? '';
  promptEl.textContent = label ? `E  ${label}` : '';
  promptEl.classList.toggle('on', !!label);
  crossEl.classList.toggle('hot', !!label);
  if (useE && target) target.use();
  useE = false;
  sayT -= dt;
  if (sayT < 0) sayEl.classList.remove('on');

  // 阴影只画静态的东西，开头几帧画好就不再动（以前每 3 帧重画一次，移动物体的影子一顿一顿地跳）
  if (frameN++ < 3) renderer.shadowMap.needsUpdate = true;
  post.render(time, weather.rain, dbg.reflect);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new Vector2());
  post.setSize(s.x, s.y);
});

// 调试钩子（截图脚本用）
(window as unknown as Record<string, unknown>).__k = {
  W,
  player,
  weather,
  orbit,
  setMode,
  cart,
  renderer,
  post,
  dbg,
  camera,
  STORE,
  shot: (x: number, y: number, z: number, yaw: number, pitch: number, third = false) => {
    setMode('walk');
    player.pos.set(x, y, z);
    player.yaw = yaw;
    player.pitch = pitch;
    player.third = third;
  },
};
