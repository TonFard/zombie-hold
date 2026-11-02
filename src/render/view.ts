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
import { CameraRig } from './cameraRig';
import { Effects } from './fx/effects';
import { Lighting } from './lighting';
import { buildMapView, type MapView } from './mapMesh';
import { PostFX } from './postfx';
import { StructureViews } from './structureViews';

/** 把游戏状态画出来。逻辑层不依赖这里 */
export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly lighting: Lighting;
  readonly post: PostFX;
  readonly actors: Actors;
  readonly fx: Effects;
  readonly structures: StructureViews;
  private readonly map: MapView;
  private time = 0;
  private readonly onResize = () => this.resize();

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
    this.map = buildMapView(game.map, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.map.group);
    this.actors = new Actors(this.scene, game);

    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, w, h);
    this.fx = new Effects(this.scene, game, this.rig, this.actors, fxLayer, this.rig.camera, () => ({
      w: canvas.clientWidth || window.innerWidth,
      h: canvas.clientHeight || window.innerHeight,
    }));
    this.structures = new StructureViews(this.scene, game, this.fx);
    this.resize();
    window.addEventListener('resize', this.onResize);

    this.rig.focus.set(game.player.x, 0, game.player.z);
    this.rig.setGoal(game.player.x, game.player.z);
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

    this.actors.update(dt);
    this.structures.update(dt);
    this.fx.update(dt);

    // 发电机核心脉动
    this.map.coreMaterial.color.setScalar(0.85 + 0.3 * Math.sin(this.time * 3));

    if (!this.rig.free) {
      // 镜头略微偏向瞄准的方向，让玩家能看到前方更多
      const p = game.player;
      const lx = Math.max(-3.5, Math.min(3.5, (game.input.aimX - p.x) * 0.2));
      const lz = Math.max(-3.5, Math.min(3.5, (game.input.aimZ - p.z) * 0.2));
      this.rig.setGoal(p.x, p.z, lx, lz);
    }
    this.rig.update(dt);
    this.lighting.follow(this.rig.focus.x, this.rig.focus.z, dt);
    this.post.render(dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.structures.dispose();
    this.fx.dispose();
    this.actors.dispose();
    this.post.dispose();
    this.map.dispose();
    this.renderer.dispose();
  }
}
