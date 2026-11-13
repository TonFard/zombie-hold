import { lootAvailable } from '../../game/systems/loot';
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  type Texture,
  Group,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Quality } from '../../game/data/quality';
import { GRID_H, GRID_W } from '../../game/world/grid';
import type { Game } from '../../game/sim';
import { MELEE_TIME } from '../../game/systems/player';
import { Actors } from '../actors/actors';
import { adsAt } from '../../game/data/weapons';
import { CameraRig, type Look } from './cameraRig';
import { Effects } from '../fx/effects';
import { Lighting } from './lighting';
import { Sky } from './sky';
import { ViewModel } from '../weapons/viewmodel';
import { buildMapView, type MapView } from '../world/mapMesh';
import { PostFX } from './postfx';
import { StructureViews } from '../world/structureViews';
import { ExtrasView } from '../world/extrasView';
import { SoldierViews } from '../actors/soldiers';
import { buildRealProps, loadPropsManifest, type RealProps } from '../world/realProps';
import { buildContactShadows, type ContactShadows } from '../world/contactShadows';
import { buildVista, type Vista } from '../world/vista';
import { buildMapDecals, type MapDecals } from '../world/mapDecals';
import { bakeLight, type BakedLight } from '../world/bakedLight';
import { buildRealSurfaces, hasStructs, realWallStyles, STRUCT_KINDS, type RealSurfaces } from '../world/realSurfaces';

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
  readonly extras: ExtrasView;
  readonly soldiers: SoldierViews;
  private readonly map: MapView;
  private realProps: RealProps | null = null;
  private contact: ContactShadows | null = null;
  private vista: Vista | null = null;
  private mapDecals: MapDecals | null = null;
  private realSurfaces: RealSurfaces | null = null;
  /** 烘焙的环境光遮蔽 + 室内遮光（所有档位都开，每像素一次贴图采样） */
  private readonly baked: BakedLight;
  private disposed = false;
  /** 写实资源已经换上（截图脚本用来判断加载完成） */
  realReady = false;
  /** 地图（写实资源或回退的程序地图）可以显示了 */
  worldReady = false;
  onWorldReady: (() => void) | null = null;
  private markReady(): void {
    if (this.worldReady || this.disposed) return;
    this.worldReady = true;
    this.onWorldReady?.();
  }
  /** 当前用的屋顶（每栋房子一个）：玩家在哪栋房子里，那栋的屋面就藏起来 */
  private roofs: Group[] = [];
  private insideHouse = -1;
  quality: Quality = 'high';
  private time = 0;
  /** 昼夜过渡：当前值朝目标值缓慢靠近 */
  private nightCur = 0;
  /** 白天 / 夜晚的环境反射（M19）：过了一半就换夜晚那张，强度本来就由 lighting 按昼夜调 */
  private envDay: Texture | null = null;
  private envNight: Texture | null = null;
  private gradeOn = new URLSearchParams(window.location.search).get('grade') !== '0';
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
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
    this.baked = bakeLight(game.map);
    // ?baked=0：关掉烘焙光照（对比截图用）
    const bakedOn = new URLSearchParams(window.location.search).get('baked') !== '0';
    if (!bakedOn) this.baked.patch = () => {};
    this.baked.patchTree(this.map.group);
    // 地面贴花（M19）：油污、积水、轮胎印、裂缝，固定种子（?decals=0 关掉）
    if (new URLSearchParams(window.location.search).get('decals') !== '0') {
      this.mapDecals = buildMapDecals(game.map);
      this.scene.add(this.mapDecals.group);
    }
    // 远景（M18）：断崖外的城市 / 山 / 电塔剪影，一次绘制（?vista=0 关掉）
    if (new URLSearchParams(window.location.search).get('vista') !== '0') {
      this.vista = buildVista();
      this.scene.add(this.vista.group);
    }
    // 接触阴影：所有画质都开（?contact=0 关掉，对比截图用）
    if (new URLSearchParams(window.location.search).get('contact') !== '0') {
      this.contact = buildContactShadows(game.map);
      if (this.contact) this.scene.add(this.contact.group);
    }
    // 写实道具异步加载，好了再把对应的程序道具撤掉。加载期间界面盖着加载画面（onWorldReady），
    // 不会先看到旧的程序地图再跳成新的
    void loadPropsManifest().then(async (m) => {
      if (!m || this.disposed) {
        this.markReady();
        return;
      }
      const aniso = this.renderer.capabilities.getMaxAnisotropy();
      const [real, surf] = await Promise.all([buildRealProps(game.map, m, this.renderer), buildRealSurfaces(game.map, m, aniso)]);
      if (this.disposed) {
        real.dispose();
        surf.dispose();
        return;
      }
      this.realProps = real;
      this.realSurfaces = surf;
      const skip = new Set(real.replaced);
      if (hasStructs(m)) for (const k of STRUCT_KINDS) skip.add(k);
      this.map.rebuild({ skip, keep: new Set(real.fallback), trimWalls: realWallStyles(m), cliffs: !real.cliffs });
      this.scene.add(real.group, surf.walls);
      for (const o of [real.group, surf.walls, this.map.group, ...surf.roofs]) this.baked.patchTree(o);
      if (surf.ground) this.baked.patchTree(surf.ground);
      if (surf.ground) {
        this.map.hideGround();
        this.scene.add(surf.ground);
      }
      if (surf.roofs.some((r) => r.children.length)) {
        for (const r of this.map.roofs) r.visible = false;
        this.roofs = surf.roofs;
        for (const r of surf.roofs) this.scene.add(r);
      }
      if (real.envMap) this.scene.environment = real.envMap;
      this.envDay = real.envMap;
      this.envNight = real.envNight;
      this.realReady = true;
      // 新模型和材质的着色器先编译好，不然第一眼看到它们的那一帧会卡一下
      try {
        await this.renderer.compileAsync(this.scene, this.rig.camera);
      } catch {
        // 不支持异步编译的环境：第一帧渲染时同步编译
      }
      this.markReady();
    }).catch((e: unknown) => {
      console.warn('写实地图加载失败，用程序地图：', e);
      this.markReady();
    });
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
    this.actors.neckSpurt = (x, y, z) => this.fx.neckSpurt(x, y, z);
    this.structures = new StructureViews(this.scene, game, this.fx);
    this.soldiers = new SoldierViews(this.scene, game);
    this.extras = new ExtrasView(this.scene, game, this.fx, this.rig, this.lighting);
    // 零件箱被捡走就隐藏，新的一天刷新时再显示
    this.offEvents.push(
      game.events.on('scrapBox', (e) => {
        const g = this.map.scrapBoxes[e.index];
        if (g) g.visible = !e.taken;
      }),
      game.events.on('lootTaken', (e) => this.fx.chips(e.x, e.z, [1, 0.8, 0.3], 14, 0.9)),
      game.events.on('phase', ({ phase }) => this.setNight(phase === 'night' ? 1 : phase === 'cards' ? 0.5 : phase === 'training' ? 0 : 0.1)),
    );
    this.resize();
    window.addEventListener('resize', this.onResize);

    this.rig.focus.set(game.player.x, 0, game.player.z);
  }

  /**
   * 画质档位：
   * 高 = 最高 1.25 倍像素密度 + 2048 阴影 + 半分辨率 GTAO + Bloom + 2 倍 MSAA；
   * 中 = 1 倍像素密度 + 1024 阴影 + Bloom（无抗锯齿）；
   * 低 = 1 倍像素密度 + 无阴影 + 无后期（没有抗锯齿）。
   * 以前高画质是 1.5 倍像素密度再叠 4 倍 MSAA（中画质也带着 MSAA），像素量是中画质的 2.25 倍、
   * 每个像素还要算 9 盏点光源和阴影，是高画质卡的主要原因。MSAA 已经负责抗锯齿，像素密度再往上加收益很小。
   */
  /**
   * 渲染实验（M19，?render=1 的面板用）：实时开关各个效果，对比用。返回当前状态。
   * 只动显示，不碰逻辑；画质切换仍然走 setQuality
   */
  renderToggle(key: 'ao' | 'grade' | 'decals' | 'vista' | 'contact' | 'shadows', on?: boolean): boolean {
    switch (key) {
      case 'ao':
        if (on !== undefined) this.post.setAO(on ? 0.5 : 0);
        return this.post.aoOn;
      case 'grade':
        if (on !== undefined) this.gradeOn = on;
        return this.gradeOn;
      case 'decals':
        if (on !== undefined && this.mapDecals) this.mapDecals.group.visible = on;
        return !!this.mapDecals?.group.visible;
      case 'vista':
        if (on !== undefined && this.vista) this.vista.group.visible = on;
        return !!this.vista?.group.visible;
      case 'contact':
        if (on !== undefined && this.contact) this.contact.group.visible = on;
        return !!this.contact?.group.visible;
      case 'shadows':
        if (on !== undefined) this.lighting.sun.castShadow = on;
        return this.lighting.sun.castShadow;
    }
  }

  /** 渲染实验面板：上一帧（含后期、阴影）一共多少次绘制、多少三角形 */
  private frameStats = { calls: 0, tris: 0 };
  renderStats(): { calls: number; tris: number } {
    return this.frameStats;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 1.25) : 1;
    this.renderer.setPixelRatio(pr);
    this.post.setPixelRatio(pr);
    // MSAA 是高画质里最贵的一项（实测关掉它帧耗时减半）：高画质 2 倍、中画质不开
    this.post.setSamples(q === 'high' ? 2 : 0);
    const sun = this.lighting.sun;
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = q !== 'low';
    this.post.enabled = q !== 'low';
    this.mapDecals?.setQuality(q);
    if (this.extras) this.extras.ambient = q !== 'low';
    this.actors.shadows = q === 'high';
    // 环境光遮蔽：只在高画质开（半分辨率）。?ao=0 / ?ao=1 强制关 / 开，对比截图用
    const aoQ = new URLSearchParams(window.location.search).get('ao');
    this.post.setAO(aoQ === '0' ? 0 : aoQ === '1' || q === 'high' ? 0.5 : 0);
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
    this.soldiers.update(dt);
    this.fx.night = this.nightCur;
    this.fx.update(dt);
    this.extras.update(dt);

    // 发电机核心脉动
    this.map.coreMaterial.color.setScalar(0.85 + 0.3 * Math.sin(this.time * 3));
    // 零件箱光柱脉动，靠近时光环放大
    // 搜刮点（M18）：能搜的时候才亮（白天、没搜过、危险区是本局开放的那一处）；污水一直在
    this.map.lootMarks.forEach((m, i) => {
      const on = lootAvailable(game, i);
      for (const c of m.children) if (c.name === 'scrapBeacon') c.visible = on;
    });
    this.map.updateBeacons(this.time, game.player.x, game.player.z, this.nightCur);
    // 尸潮（> 40 只）时关掉 AO：GTAO 要把整个场景再画一遍，70 只僵尸时绘制调用会翻倍到 1200+（M19 实测）
    let living = 0;
    for (const z of game.zombies) if (z.alive) living++;
    this.post.crowd(living > 40);
    // 调色跟着当前的昼夜（M19）；?grade=0 关掉
    this.post.setNight(this.nightCur, this.gradeOn);
    // 环境反射：夜里换偏冷的夜空 HDRI
    const env = this.nightCur > 0.5 && this.envNight ? this.envNight : this.envDay;
    if (env && this.scene.environment !== env) this.scene.environment = env;

    const fps = this.rig.mode === 'fps';
    if (fps) {
      const p = game.player;
      // 视线 = 鼠标 + 逻辑层的后坐力（和子弹用的是同一个角度，准星就是弹着点）
      this.rig.updateFps(dt, {
        x: p.x,
        z: p.z,
        yaw: this.look.yaw,
        pitch: this.look.pitch + p.kickPitch,
        speed: Math.hypot(p.vx, p.vz),
        sprinting: p.sprinting,
        alive: p.alive,
        eye: p.eye,
        ads: p.ads,
        zoom: adsAt(p.weapon, p.tier).zoom,
        kickYaw: p.kickYaw,
        sliding: p.slide > 0,
      });
      this.rig.camera.updateMatrixWorld();
      this.viewmodel.sync(this.rig.camera, this.scene, this.lighting);
      // 身上带的几把枪的模型先加载好，切枪时不用等（已经在加载 / 加载好的直接跳过）
      for (const k of game.carried()) this.viewmodel.ensureTacz(game.config.guns[k]);
      this.viewmodel.update(dt, {
        kind: p.weapon,
        scope: adsAt(p.weapon, p.tier).scope,
        tier: p.tier,
        alive: p.alive,
        lowered: game.buildMode || game.hz.throwT > 0,
        reload: p.reloadTimer > 0 ? 1 - p.reloadTimer / p.reloadTotal : -1,
        recoil: p.recoil,
        speed: Math.hypot(p.vx, p.vz),
        sprinting: p.sprinting,
        yaw: this.look.yaw,
        pitch: this.look.pitch,
        ads: p.ads,
        melee: p.meleeTimer > 0 ? 1 - p.meleeTimer / MELEE_TIME : -1,
        crouch: p.crouch,
        sliding: p.slide > 0,
        sprintOut: p.sprintOut,
        mag: game.loadout[p.weapon].mag,
        magMax: game.statsOf(p.weapon, p.tier).mag,
        // 速度投到视线方向：前方 = (sin yaw, cos yaw)，右方 = (-cos yaw, sin yaw)
        fwd: p.vx * Math.sin(this.look.yaw) + p.vz * Math.cos(this.look.yaw),
        side: -p.vx * Math.cos(this.look.yaw) + p.vz * Math.sin(this.look.yaw),
        gun: game.config.guns[p.weapon],
      });
      // TACZ 枪的摄像机动画（开枪、换弹时镜头的轻微晃动）
      this.rig.camera.quaternion.multiply(this.viewmodel.cameraAnim);
    }
    // 瞄准镜完全举起时，镜框遮罩由界面层画，枪模藏起来
    const scoped = fps && adsAt(game.player.weapon, game.player.tier).scope && game.player.ads > 0.85;
    this.post.setOverlayVisible(fps && this.viewmodel.visible && !scoped);
    this.updateRoofs();
    this.lighting.follow(this.rig.focus.x, this.rig.focus.z, dt);
    this.rig.camera.updateMatrixWorld();
    this.sky.update(this.rig.camera, this.lighting);
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.post.render(dt);
    this.frameStats.calls = info.render.calls;
    this.frameStats.tris = info.render.triangles;
    info.autoReset = true;
  }

  /**
   * 第一人称：玩家进了哪栋房子，那栋的屋面就不投影（不然屋里一片黑，阳光照不进窗户以外的地方也挺真实，
   * 但窗户进光靠的就是屋面不挡）——这里简单处理：屋里时屋面不画，天花板留着挡天空。
   * 俯视镜头（菜单、大厅）：所有屋面都画。
   */
  private updateRoofs(): void {
    const roofs = this.roofs.length ? this.roofs : this.map.roofs;
    const p = this.game.player;
    const cx = Math.floor(p.x + GRID_W / 2);
    const cy = Math.floor(p.z + GRID_H / 2);
    const fps = this.rig.mode === 'fps';
    let inside = -1;
    this.game.map.houses.forEach((h, i) => {
      if (cx > h.x0 && cx < h.x1 - 1 && cy > h.y0 && cy < h.y1 - 1) inside = i;
    });
    if (inside === this.insideHouse && fps) return;
    this.insideHouse = inside;
    roofs.forEach((r, i) => {
      const top = r.getObjectByName('roof:top');
      if (top) top.visible = !fps || i !== inside;
    });
  }

  /** 标题页装饰：发电机灯光呼吸 + 地面薄雾飘移 */
  private fogMotes: Group | null = null;
  menuFlicker(t: number): void {
    // 发电机灯光呼吸：hemisphere intensity 在 0.9–1.1 之间慢慢正弦波动
    this.lighting.hemi.intensity = this.lighting.hemi.intensity * (0.98 + 0.02 * Math.sin(t * 3.14));
    // 薄雾：第一次调用时创建 20 个半透明 Sprite，之后每帧飘移
    if (!this.fogMotes) {
      const g = new Group();
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.18)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new CanvasTexture(c);
      for (let i = 0; i < 20; i++) {
        const mat = new SpriteMaterial({ map: tex, transparent: true, opacity: 0.12 + Math.random() * 0.1, depthWrite: false });
        const sp = new Sprite(mat);
        sp.position.set((Math.random() - 0.5) * 40, 0.3 + Math.random() * 1.2, (Math.random() - 0.5) * 40);
        sp.scale.setScalar(2 + Math.random() * 3);
        sp.userData.vx = (Math.random() - 0.5) * 0.3;
        sp.userData.vz = (Math.random() - 0.5) * 0.15;
        g.add(sp);
      }
      this.scene.add(g);
      this.fogMotes = g;
    }
    for (const sp of this.fogMotes.children) {
      sp.position.x += (sp.userData.vx as number) * 0.016;
      sp.position.z += (sp.userData.vz as number) * 0.016;
      // 飘出 25 米就绕回来
      if (Math.abs(sp.position.x) > 25) sp.position.x *= -0.9;
      if (Math.abs(sp.position.z) > 25) sp.position.z *= -0.9;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.realProps?.dispose();
    this.contact?.dispose();
    this.vista?.dispose();
    this.mapDecals?.dispose();
    this.realSurfaces?.dispose();
    this.baked.dispose();
    window.removeEventListener('resize', this.onResize);
    for (const f of this.offEvents) f();
    this.structures.dispose();
    this.soldiers.dispose();
    this.extras.dispose();
    this.sky.dispose();
    this.fx.dispose();
    this.actors.dispose();
    this.post.dispose();
    this.map.dispose();
    this.renderer.dispose();
  }
}
