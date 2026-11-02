import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Game } from '../game/sim';
import { Actors } from './actors';
import { statsAt } from '../game/data/weapons';
import { CameraRig, type Look } from './cameraRig';
import { Effects } from './fx/effects';
import { Lighting } from './lighting';
import { Sky } from './sky';
import { ViewModel } from './viewmodel';
import { buildMapView, type MapView } from './mapMesh';
import { PostFX } from './postfx';
import { StructureViews } from './structureViews';

export type Quality = 'low' | 'mid' | 'high';

/** 把游戏状态画出来。逻辑层不依赖这里 */
export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  /** 第一人称的视角，由输入层的同一个对象替换进来 */
  look: Look = { yaw: 0, pitch: 0 };
  readonly lighting: Lighting;
  readonly sky: Sky;
  readonly post: PostFX;
  readonly actors: Actors;
  readonly viewmodel: ViewModel;
  readonly fx: Effects;
  readonly structures: StructureViews;
  private readonly map: MapView;
  quality: Quality = 'high';
  private time = 0;
  /** 昼夜过渡：当前值朝目标值缓慢靠近 */
  private nightCur = 0;
  private nightTarget = 0;
  private readonly offEvents: Array<() => void> = [];
  private readonly onResize = () => this.resize();

  /** 设置目标昼夜（0 黄昏 → 1 深夜）；immediate = true 时立刻切换 */
  setNight(t: number, immediate = false): void {
    this.nightTarget = t;
    if (immediate) {
      this.nightCur = t;
      this.lighting.setNight(t);
    }
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly game: Game,
    fxLayer: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // 程序生成的环境反射：没有它，金属材质（车身、机器、集装箱）会一片死黑
    const pmrem = new PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    envScene.dispose();
    pmrem.dispose();

    this.lighting = new Lighting(this.scene, game.map, 2048);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.map = buildMapView(game.map, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.map.group);
    this.actors = new Actors(this.scene, game);

    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, w, h);
    this.viewmodel = new ViewModel();
    this.post.setOverlay(this.viewmodel.scene, this.viewmodel.camera);
    this.fx = new Effects(this.scene, game, this.rig, this.viewmodel, fxLayer, this.rig.camera, () => ({
      w: canvas.clientWidth || window.innerWidth,
      h: canvas.clientHeight || window.innerHeight,
    }));
    this.structures = new StructureViews(this.scene, game, this.fx);
    // 零件箱被捡走就隐藏，新的一天刷新时再显示
    this.offEvents.push(
      game.events.on('scrapBox', (e) => {
        const g = this.map.scrapBoxes[e.index];
        if (g) g.visible = !e.taken;
      }),
      game.events.on('phase', ({ phase }) => this.setNight(phase === 'night' ? 1 : phase === 'cards' ? 0.5 : 0.1)),
    );
    this.resize();
    window.addEventListener('resize', this.onResize);

    this.rig.focus.set(game.player.x, 0, game.player.z);
  }

  /**
   * 画质档位：
   * 高 = 1.5 倍像素密度 + 2048 阴影 + Bloom + 4 倍 MSAA；
   * 中 = 1 倍像素密度 + 1024 阴影 + Bloom；
   * 低 = 1 倍像素密度 + 无阴影 + 无后期（没有抗锯齿）。
   */
  setQuality(q: Quality): void {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1;
    this.renderer.setPixelRatio(pr);
    this.post.setPixelRatio(pr);
    const sun = this.lighting.sun;
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = q !== 'low';
    this.post.enabled = q !== 'low';
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.rig.setAspect(w / h);
  }

  /** 每帧调用：dt 为真实时间（秒） */
  render(dt: number): void {
    this.time += dt;
    const { game } = this;

    if (Math.abs(this.nightCur - this.nightTarget) > 0.001) {
      const step = dt * 0.35;
      this.nightCur += Math.max(-step, Math.min(step, this.nightTarget - this.nightCur));
      this.lighting.setNight(this.nightCur);
    }
    this.actors.update(dt);
    this.structures.update(dt);
    this.fx.update(dt);

    // 发电机核心脉动
    this.map.coreMaterial.color.setScalar(0.85 + 0.3 * Math.sin(this.time * 3));

    const fps = this.rig.mode === 'fps';
    this.actors.firstPerson = fps;
    if (fps) {
      const p = game.player;
      this.rig.updateFps(dt, {
        x: p.x,
        z: p.z,
        yaw: this.look.yaw,
        pitch: this.look.pitch,
        speed: Math.hypot(p.vx, p.vz),
        sprinting: p.sprinting,
        alive: p.alive,
      });
      this.rig.camera.updateMatrixWorld();
      this.viewmodel.sync(this.rig.camera, this.scene, this.lighting);
      const st = statsAt(p.weapon, p.tier);
      this.viewmodel.update(dt, {
        kind: p.weapon,
        tier: p.tier,
        alive: p.alive,
        lowered: game.buildMode,
        reload: p.reloadTimer > 0 ? 1 - p.reloadTimer / st.reload : -1,
        recoil: p.recoil,
        speed: Math.hypot(p.vx, p.vz),
        sprinting: p.sprinting,
        yaw: this.look.yaw,
        pitch: this.look.pitch,
      });
    }
    this.post.setOverlayVisible(fps && this.viewmodel.visible);
    this.lighting.follow(this.rig.focus.x, this.rig.focus.z, dt);
    this.rig.camera.updateMatrixWorld();
    this.sky.update(this.rig.camera, this.lighting);
    this.post.render(dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    for (const f of this.offEvents) f();
    this.structures.dispose();
    this.sky.dispose();
    this.fx.dispose();
    this.actors.dispose();
    this.post.dispose();
    this.map.dispose();
    this.renderer.dispose();
  }
}
