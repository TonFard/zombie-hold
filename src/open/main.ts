import { ACESFilmicToneMapping, EquirectangularReflectionMapping, PCFShadowMap, PMREMGenerator, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Texture } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Lighting } from '../render/core/lighting';
import { PostFX } from '../render/core/postfx';
import { Sky } from '../render/core/sky';
import { loadPropsManifest } from '../render/world/realProps';
import { Arsenal } from './combat/arsenal';
import { Horde } from './combat/horde';
import { Raiders } from './combat/raiders';
import { DayCycle } from './daycycle';
import type { ArsenalApi, GameMode, HordeApi, RaidersApi, WeatherApi } from './game/api';
import { Game } from './game/game';
import { nullArsenal, nullHorde, nullRaiders, nullWeather } from './game/nulls';
import { unlockAudio } from './game/sound';
import { Hud } from './hud';
import { Player } from './player';
import { QualityControl } from './quality';
import { Garage } from './vehicles/garage';
import { buildFloraView } from './render/flora';
import { buildGrassView } from './render/grass';
import { VIEW, buildGroundView } from './render/ground';
import { buildSitesView, precompile } from './render/sitesView';
import { Weather } from './weather';
import { World } from './world/world';

/**
 * 开放世界（废土）入口：open.html。无限地图：只生成玩家周围，走到哪生成到哪。
 * 调试：?seed=数字 换世界；?q=min|low|mid|high 固定画质（不给 = 自动，F4 切换，见 quality.ts）；?hour=几点；window.__open 给截图脚本用。
 * 玩法层（背包、生存状态、拾取、天气、丧尸、武器）的入口是 game/game.ts，模块之间的约定在 game/api.ts。
 */

const params = new URLSearchParams(window.location.search);
/** ?mode=bio = 生化模式（单独一局）；不给 = 生存世界 */
const mode: GameMode = params.get('mode') === 'bio' ? 'bio' : 'survival';
const status = document.getElementById('status') as HTMLElement;
const setStatus = (s: string) => {
  status.textContent = s;
  status.style.display = s ? '' : 'none';
};

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
const quality = new QualityControl(renderer, params.get('q'));

const scene = new Scene();
const camera = new PerspectiveCamera(74, 1, 0.08, VIEW * 1.25);
camera.rotation.order = 'YXZ';

const t0 = performance.now();
const world = new World(Number(params.get('seed')) || 20261114);

const lighting = new Lighting(scene, { lamps: [] }, 2048, 96);
{
  // 阴影只覆盖身边 ±45 米，跟着玩家走
  const cam = lighting.sun.shadow.camera;
  cam.left = cam.bottom = -45;
  cam.right = cam.top = 45;
  cam.far = 220;
  cam.updateProjectionMatrix();
}
const sky = new Sky();
sky.mesh.scale.setScalar(900);
sky.clouds = 0.55;
scene.add(sky.mesh);
{
  // 阴天、雷暴的夜里星星不该透过云层照出来。共用的 sky.ts 不动：只改开放世界这一个天空的着色器；
  // 三处里有一处对不上（sky.ts 以后改了）就整个不改，照原样画
  const m = sky.mesh.material as unknown as { fragmentShader: string; needsUpdate: boolean };
  const A = '  if (uCloud > 0.0 && d.y > 0.0) {';
  const B = '    col = mix(col, mix(cLow, cTop, lit), dens * smoothstep(0.015, 0.2, d.y) * 0.9);';
  const C = 'star * uNight * uNight * 1.8;';
  const f = m.fragmentShader;
  if (f.split(A).length === 2 && f.split(B).length === 2 && f.split(C).length === 2) {
    m.fragmentShader = f
      .replace(A, `  float cloudDens = 0.0;\n${A}`)
      .replace(B, `${B}\n    cloudDens = dens;`)
      .replace(C, 'star * uNight * uNight * 1.8 * (1.0 - cloudDens);');
    m.needsUpdate = true;
  }
}

const player = new Player(world, world.sites.spawn());
const post = new PostFX(renderer, scene, camera, window.innerWidth, window.innerHeight);
const clock = new DayCycle(scene, lighting, sky, post);
// 雾：约 1.1 公里处完全融进天色，远山只剩轮廓
clock.fogBase = 0.0019;
clock.set(Number(params.get('hour') ?? 9));

setStatus('加载地面贴图……');
const manifest = await loadPropsManifest();
if (!manifest) {
  setStatus('没有找到 public/props/manifest.json（先跑 npm run props:import）');
  throw new Error('no props manifest');
}
const aniso = renderer.capabilities.getMaxAnisotropy();
const ground = await buildGroundView(world, manifest.textures, aniso);
scene.add(ground.group);
const loadEnv = async (file: string | null | undefined): Promise<Texture | null> => {
  if (!file) return null;
  try {
    const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}props/${file}`);
    hdr.mapping = EquirectangularReflectionMapping;
    const pm = new PMREMGenerator(renderer);
    const tex = pm.fromEquirectangular(hdr).texture;
    pm.dispose();
    hdr.dispose();
    return tex;
  } catch {
    return null;
  }
};
setStatus('加载植被……');
const flora = await buildFloraView(world, manifest.assets, renderer);
scene.add(flora.group);
const grass = buildGrassView(ground, 1, (x, z, r) => world.sites.housesNear(x, z, r));
scene.add(grass.group);
const sites = await buildSitesView(world, manifest, renderer, scene, aniso, (lamps) => lighting.setLamps(lamps));
scene.add(sites.group);
const envDay = await loadEnv(manifest.hdri);
if (envDay) scene.environment = envDay;

setStatus('生成地形……');
await new Promise((r) => setTimeout(r, 20));
camera.position.set(player.x, 0, player.z);
ground.settle(camera);
flora.settle(camera);
setStatus('加载地点……');
await sites.settle(camera);
player.teleport(player.x, player.z);
setStatus('加载车辆……');
// ?cars=0 不放车（测帧率时对比用）
const garage = await Garage.load(world, aniso, world.sites.spawn(), params.get('cars') !== '0');
scene.add(garage.group);
// 玩法层：背包 / 生存状态 / 拾取（game），天气，丧尸，武器。三个模块只通过 game.ctx 互相调用
const keys = new Set<string>();
const hud = new Hud(world, player);
/** 传送：先把那里的地形、地点加载好，人才不会掉进还没生成的地面里 */
function teleport(x: number, z: number, yaw = player.yaw, pitch = 0): void {
  camera.position.set(x, 0, z);
  ground.settle(camera);
  flora.settle(camera);
  void sites.settle(camera).then(() => {
    // 地点的地板是后加载出来的：加载好以后再落一次脚
    if (Math.hypot(player.x - x, player.z - z) < 0.5) player.teleport(x, z);
  });
  player.teleport(x, z);
  player.yaw = yaw;
  player.pitch = pitch;
}
const game = new Game({ world, player, camera, scene, renderer, lighting, post, sky, clock, quality, garage, hud, keys, params, mode, assets: manifest.assets, teleport });
/** 一个模块出错不拖垮别的模块和整个页面：每个模块只报第一次错，之后照常往下跑 */
const failed = new Set<string>();
const report = (name: string, e: unknown): void => {
  if (failed.has(name)) return;
  failed.add(name);
  console.error(`[open] ${name} 出错`, e);
};
function safe(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    report(name, e);
  }
}
/** 建模块：起不来就用空实现顶上 */
async function make<T>(name: string, build: () => T | Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await build();
  } catch (e) {
    report(`${name}（启动）`, e);
    return fallback();
  }
}
const weather: WeatherApi = await make('weather', () => new Weather(game.ctx), nullWeather);
setStatus('加载丧尸……');
const horde: HordeApi = await make('horde', () => Horde.create(game.ctx), nullHorde);
setStatus('加载武器……');
const arsenal: ArsenalApi = await make('arsenal', () => Arsenal.create(game.ctx), nullArsenal);
setStatus('加载幸存者……');
const raiders: RaidersApi = await make('raiders', () => Raiders.create(game.ctx), nullRaiders);
game.attach(weather, horde, arsenal, raiders);
// 有存档就接着玩（人、车、背包、捡走了哪些东西、几点了）
safe('game.start', () => game.start());
// 喇叭、引擎、撞车的声音会把丧尸引过来，带枪的人也听得见
garage.onNoise = (x, z, radius) => {
  safe('horde.noise', () => horde.noise(x, z, radius));
  safe('raiders.noise', () => raiders.noise(x, z, radius));
};
// 画质档位先落下去再编译着色器（最低档没有阴影，着色器不一样）
quality.bind({ lighting, post, flora, grass, sites, weather, horde, raiders, resize });
await precompile(renderer, scene, camera);
setStatus('');
const loadMs = performance.now() - t0;

// ---------------------------------------------------------------- 画质：四档 + 自动，见 quality.ts（F4 切换）
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const r = quality.ratio;
  renderer.setPixelRatio(r);
  renderer.setSize(w, h, false);
  post.setPixelRatio(r);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
let ftAvg = 16;
let ftWorst = 0;
function autoQuality(dt: number): void {
  ftAvg += (dt * 1000 - ftAvg) * 0.05;
  quality.frame(dt);
}

// ---------------------------------------------------------------- 输入
const nolock = params.get('nolock') === '1';
let locked = false;
/** 鼠标：左键开火 / 挥击，右键瞄准（?nolock=1 的测试脚本直接改这两个值） */
const input = { fire: false, ads: false };
/** 左键按下过（还没被 arsenal.update 看到）：点得很快的一下也算一枪 */
let fireTap = false;
const statsBox = hud.stats;
window.addEventListener('keydown', (e) => {
  unlockAudio();
  keys.add(e.code);
  if (e.code === 'Tab') e.preventDefault();
  let taken = false;
  if (!e.repeat) safe('key', () => (taken = game.key(e.code) || (!garage.driving && !game.busy && arsenal.key(e.code))));
  if (taken) return;
  if (!e.repeat && !game.busy) {
    if (e.code === 'KeyV') garage.toggleView();
    if (e.code === 'KeyH') garage.horn(true);
    if (e.code === 'KeyL') garage.toggleLights(clock.night);
  }
  if (e.code === 'Space' && garage.driving) e.preventDefault();
  if (e.code === 'F3') {
    e.preventDefault();
    hud.toggleStats();
  }
  if (e.code === 'F4') {
    e.preventDefault();
    if (!e.repeat) quality.cycle();
  }
  if (e.code === 'KeyM') hud.toggleMap();
  // 调试：跳到下一个时间点。有了饿、渴、冷以后这就是作弊键，只在开着性能面板（F3）时有效
  if (e.code === 'KeyN' && statsBox.classList.contains('open')) clock.set([7, 12, 18, 23].find((h) => h > clock.hours + 0.1) ?? 7);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyH') garage.horn(false);
});
window.addEventListener('blur', () => {
  keys.clear();
  input.fire = input.ads = false;
});
canvas.addEventListener('click', () => {
  // 刚按 Esc 退出锁定又马上点画面，浏览器会拒绝（Promise 失败）：不算错，再点一下就行
  if (!nolock && !locked && !game.busy) void (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
});
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  // 第一下点击是用来锁定鼠标的，不开火
  if (!locked && !nolock) return;
  if (e.button === 0) {
    input.fire = true;
    fireTap = true;
  }
  if (e.button === 2) input.ads = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.ads = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener(
  'wheel',
  (e) => {
    if ((locked || nolock) && !garage.driving && !game.busy) safe('wheel', () => arsenal.wheel(Math.sign(e.deltaY)));
  },
  { passive: true },
);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  hud.setLocked(locked);
  if (!locked) input.fire = input.ads = false;
});
document.addEventListener('mousemove', (e) => {
  if (!locked || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  if (garage.driving) {
    garage.look(e.movementX, e.movementY);
    return;
  }
  if (game.busy) return;
  const sens = 0.0022 * arsenal.lookScale;
  player.yaw -= e.movementX * sens;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * sens));
});

// ---------------------------------------------------------------- 主循环
let last = performance.now();
const frame = { calls: 0, tris: 0, ms: 0 };
let statT = 0;
/** 每一段最慢的一次（毫秒）：找「卡一下」是谁干的。gap = 两帧之间、主循环以外花的时间（异步加载、垃圾回收） */
const prof: Record<string, number> = { move: 0, game: 0, ground: 0, flora: 0, grass: 0, sites: 0, hud: 0, render: 0, gap: 0 };
let profT = 0;
const lap = (name: string): void => {
  const t = performance.now();
  if (t - profT > (prof[name] as number)) prof[name] = t - profT;
  profT = t;
};
let lastEnd = performance.now();
const _camDir = new Vector3();
/** 最慢的那一次渲染：在哪、那一帧新编译了几个着色器、新传了几张贴图 / 几个网格 */
let slow = { ms: 0, x: 0, z: 0, programs: 0, textures: 0, geometries: 0 };
/** 调试：不走路，直接以这个速度（米/秒）往前飞，测高速移动时的生成压力（开车的速度） */
let fly = 0;
/**
 * 调试：?cap=60 把帧率限制在 60（无头浏览器没有垂直同步，一秒画几百帧，测卡顿时和真实情况不一样）。
 * 按固定节拍走：下一帧的时刻 = 上一帧该画的时刻 + 16.7 毫秒。不能写成「距上一帧够久了才画」——
 * 那样帧间隔会被凑成回调周期的整数倍，量出来的帧率偏低，自动画质还会跟着误降分辨率
 */
const capStep = params.get('cap') ? 1000 / Number(params.get('cap')) : 0;
let capNext = 0;
function tick(now: number): void {
  if (capStep) {
    if (now < capNext - 0.5) {
      requestAnimationFrame(tick);
      return;
    }
    capNext = Math.max(capNext + capStep, now - capStep);
  }
  const dt = Math.min(0.1, (now - last) / 1000);
  // 真实的帧间隔（帧率显示和自动画质用）：dt 截到了 0.1 秒，一帧几秒的机器上会显示成十几帧、自动画质也迟迟不动
  const realDt = Math.min(1, (now - last) / 1000);
  ftWorst = Math.max(ftWorst * 0.995, now - last);
  last = now;
  const tf = performance.now();
  if (tf - lastEnd > (prof.gap as number)) prof.gap = tf - lastEnd;
  profT = tf;
  if (fly) {
    player.x += Math.sin(player.yaw) * fly * dt;
    player.z += Math.cos(player.yaw) * fly * dt;
    player.feet = world.groundAt(player.x, player.z);
  } else if (!garage.driving) {
    // 开着背包、死了：站着不动
    const still = game.busy;
    player.update(dt, {
      fwd: still ? 0 : (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      side: still ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      sprint: !still && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && game.canSprint && !input.fire && !input.ads,
      jump: !still && keys.has('Space'),
      crouch: !still && (keys.has('KeyC') || keys.has('ControlLeft')),
    });
  }
  // 武器：开火、换弹、切枪（后坐力在这里改视角，所以在摆相机之前）
  const usable = !fly && !garage.driving && !game.busy;
  const fireNow = (input.fire || fireTap) && usable;
  fireTap = false;
  safe('arsenal.update', () => arsenal.update(dt, { fire: fireNow, ads: input.ads && usable, active: usable }));
  lap('move');
  const sp = player.speed;
  const bobK = player.onGround && !fly ? Math.min(1, sp / 4) : 0;
  const by = Math.abs(Math.sin(player.bob * Math.PI)) * 0.045 * bobK;
  const bx = Math.sin(player.bob * Math.PI) * 0.03 * bobK;
  garage.update(dt, keys, clock.night, player);
  const inCar = garage.camera(camera, dt);
  if (inCar) {
    // 指南针 / 小地图跟着相机转
    camera.getWorldDirection(_camDir);
    player.yaw = Math.atan2(_camDir.x, _camDir.z);
  } else {
    camera.position.set(player.x - Math.cos(player.yaw) * bx, player.feet + player.eye + by, player.z + Math.sin(player.yaw) * bx);
    camera.rotation.set(player.pitch, player.yaw + Math.PI, 0);
    camera.updateMatrixWorld();
  }

  clock.update(dt);
  // 天气在钟之后：它在钟定好的光、雾、天空上再改
  safe('weather.update', () => weather.update(dt));
  lighting.follow(player.x, player.z, dt, player.feet);
  sky.update(camera, lighting);
  safe('horde.update', () => horde.update(dt));
  safe('raiders.update', () => raiders.update(dt));
  safe('game.update', () => game.update(dt));
  // 视角模型（枪 / 近战武器 / 空手）、开镜的视野
  safe('arsenal.view', () => arsenal.view(camera, dt, inCar));
  lap('game');

  // 新地形每帧最多花 3 毫秒生成：开车时也不会卡一下
  ground.update(camera, 3);
  lap('ground');
  flora.update(camera, dt, 1.5);
  lap('flora');
  grass.update(camera, dt);
  lap('grass');
  sites.update(camera);
  lap('sites');

  const info = renderer.info;
  info.autoReset = false;
  info.reset();
  const pb = info.programs?.length ?? 0;
  const tb = info.memory.textures;
  const gb = info.memory.geometries;
  const rt0 = performance.now();
  post.render(dt);
  const rms = performance.now() - rt0;
  if (rms > slow.ms) slow = { ms: Math.round(rms), x: Math.round(player.x), z: Math.round(player.z), programs: (info.programs?.length ?? 0) - pb, textures: info.memory.textures - tb, geometries: info.memory.geometries - gb };
  frame.calls = info.render.calls;
  frame.tris = info.render.triangles;
  info.autoReset = true;
  lap('render');
  autoQuality(realDt);
  hud.update(dt, `${clock.label()} · ${weather.label()}`);
  lap('hud');
  lastEnd = performance.now();
  frame.ms = lastEnd - tf;
  statT -= dt;
  if (statT <= 0 && statsBox.classList.contains('open')) {
    statT = 0.25;
    const g = ground.stats();
    statsBox.innerHTML = [
      `${(1000 / Math.max(1, ftAvg)).toFixed(0)} fps · 本帧 CPU ${frame.ms.toFixed(1)} ms · 最慢帧 ${ftWorst.toFixed(0)} ms`,
      `绘制 ${frame.calls} 次 · ${(frame.tris / 1e6).toFixed(2)} M 三角形 · 画质 ${quality.label} · 分辨率 ×${quality.ratio.toFixed(2)}`,
      `地形块 显示 ${g.shown} / 缓存 ${g.chunks} · 待生成 ${g.queue} · 近处植被 ${flora.stats().near} · 远树 ${flora.stats().far}`,
      `位置 ${player.x.toFixed(0)}, ${player.z.toFixed(0)} · 高 ${player.feet.toFixed(1)} · 离出生点 ${(Math.hypot(player.x, player.z) / 1000).toFixed(2)} km`,
      `地点 ${sites.stats().sites}（加载中 ${sites.stats().building}）· 道具 ${sites.stats().inst} 件 · 模型 ${sites.stats().models} 种`,
      `${clock.label()} · ${weather.label()} · 丧尸 ${horde.count} · 人 ${raiders.count} · 加载 ${(loadMs / 1000).toFixed(1)} s`,
      `显卡 ${quality.gpu}`,
    ].join('<br>');
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 截图 / 调试钩子
(window as unknown as { __open: unknown }).__open = {
  world,
  player,
  camera,
  scene,
  renderer,
  lighting,
  ground,
  flora,
  grass,
  sites,
  hud,
  clock,
  quality,
  keys,
  garage,
  game,
  weather,
  horde,
  arsenal,
  raiders,
  mode,
  input,
  failed,
  go(x: number, z: number, yaw = player.yaw, pitch = 0) {
    teleport(x, z, yaw, pitch);
  },
  setHour(h: number) {
    clock.set(h);
  },
  fly(v: number) {
    fly = v;
    ftWorst = 0;
    for (const k of Object.keys(prof)) prof[k] = 0;
    slow = { ms: 0, x: 0, z: 0, programs: 0, textures: 0, geometries: 0 };
  },
  showStats() {
    statsBox.classList.add('open');
  },
  stats: () => ({ fps: 1000 / ftAvg, worst: ftWorst, ...frame, scale: quality.ratio, tier: quality.tier, quality: quality.label, gpu: quality.gpu, ground: ground.stats(), flora: flora.stats(), sites: sites.stats(), loadMs, slow, prof: Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, Math.round(v * 10) / 10])) }),
};
