import { HalfFloatType, Vector2, WebGLRenderTarget, type Material, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type Sprite, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { makeGradeLut } from './grade';
import type { Data3DTexture } from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * 后期：GTAO（环境光遮蔽，墙角、车底、箱底变暗）→ Bloom（灯光、枪口火光发亮）→ 色调映射。
 * GTAO 要把场景再画一遍法线和深度，绘制调用接近翻倍，所以只在高画质开、按半分辨率算
 */
export class PostFX {
  private readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly ao: GTAOPass;
  /** 调色（M19）：白天 / 夜晚两张 LUT，按昼夜切换（中间过渡用 intensity 淡入淡出） */
  private readonly grade: LUTPass;
  private readonly lutDay: Data3DTexture;
  private readonly lutNight: Data3DTexture;
  /** AO 的分辨率比例（相对 CSS 像素）：0 = 关 */
  private aoScale = 0;
  private overlayScene: Scene | null = null;
  private overlayCamera: PerspectiveCamera | null = null;
  private overlayPass: RenderPass | null = null;
  private overlayOn = false;
  /** CSS 像素尺寸：光晕按这个尺寸算，不跟着像素密度放大 */
  private cssW: number;
  private cssH: number;
  enabled = true;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    w: number,
    h: number,
  ) {
    this.cssW = w;
    this.cssH = h;
    const target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // 半径按米算：1.2 米左右能盖住车底、墙角，又不会把整面墙都压暗
    this.ao = new GTAOPass(scene, camera, w, h);
    // 地面上的大块遮蔽已经由 bakedLight 烘焙了（所有画质都有）；这里补烘焙做不到的：竖直缝隙、道具之间、车轮拱、门框
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 2, thickness: 1.5, distanceFallOff: 1, scale: 1.6, samples: 16 });
    this.ao.updatePdMaterial({ radius: 6, samples: 12 });
    this.ao.blendIntensity = 1;
    this.ao.enabled = false;
    // GTAO 画法线 / 深度那一遍会把场景里所有网格都当成实心的画进去，包括透明的光柱、光环、污水、贴花：
    // 光柱（一根细长的空心圆柱）就在 AO 里变成两块黑色的板子，污水边上随视角出现黑晕、走动时一闪一闪。
    // 这里让它只画不透明物体：透明 / 加色混合的网格在 AO 这一遍临时藏起来
    const hideOverride = (this.ao as unknown as { _overrideVisibility: () => void })._overrideVisibility.bind(this.ao);
    const cache = (this.ao as unknown as { _visibilityCache: Object3D[] })._visibilityCache;
    (this.ao as unknown as { _overrideVisibility: () => void })._overrideVisibility = () => {
      hideOverride();
      scene.traverse((o) => {
        if (!o.visible) return;
        const m = (o as Mesh).material as Material | Material[] | undefined;
        if ((o as Sprite).isSprite) {
          o.visible = false;
          cache.push(o);
          return;
        }
        if (!m) return;
        const mats = Array.isArray(m) ? m : [m];
        if (mats.every((x) => !x.depthWrite)) {
          o.visible = false;
          cache.push(o);
        }
      });
    };
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.55, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // 调色放在色调映射之后（LUT 是按显示空间的颜色做的）
    this.lutDay = makeGradeLut(0);
    this.lutNight = makeGradeLut(1);
    this.grade = new LUTPass({ lut: this.lutDay, intensity: 1 });
    this.composer.addPass(this.grade);
  }

  /** 昼夜（0 白天 – 1 夜晚）：过了一半换夜晚那张 LUT，切换点附近强度压低一点，看不出跳变；?grade=0 关掉 */
  setNight(t: number, enabled = true): void {
    this.grade.enabled = enabled;
    this.grade.lut = t < 0.5 ? this.lutDay : this.lutNight;
    this.grade.intensity = 0.7 + 0.3 * Math.abs(t - 0.5) * 2;
  }

  setSize(w: number, h: number): void {
    this.cssW = w;
    this.cssH = h;
    this.composer.setSize(w, h);
    this.fitBloom();
  }

  /**
   * 光晕本身就是模糊的，按 1.5 倍像素密度去算只是白白多出两倍多的像素（5 级 mip 都跟着放大），
   * 所以固定按 CSS 像素算，最后再拉伸叠回去，看不出区别。
   * composer.setSize / setPixelRatio 会把所有 pass 设成乘过像素密度的尺寸，之后要再覆盖一次。
   */
  private fitBloom(): void {
    this.bloom.setSize(this.cssW, this.cssH);
    if (this.aoScale > 0) this.ao.setSize(Math.round(this.cssW * this.aoScale), Math.round(this.cssH * this.aoScale));
  }

  /** 环境光遮蔽：scale = 相对 CSS 像素的分辨率（0.5 = 半分辨率），0 = 关 */
  setAO(scale: number): void {
    this.aoScale = scale;
    this.ao.enabled = scale > 0 && !this.crowded;
    this.fitBloom();
  }

  get aoOn(): boolean {
    return this.aoScale > 0;
  }

  /** 场上僵尸太多：临时关掉 AO（画质设置不变，人少了自动回来） */
  private crowded = false;
  crowd(on: boolean): void {
    if (on === this.crowded) return;
    this.crowded = on;
    this.ao.enabled = this.aoScale > 0 && !on;
  }

  /** 场景渲染目标的 MSAA 采样数（0 = 关）。改了要把旧的缓冲释放掉才会按新采样数重建 */
  setSamples(n: number): void {
    const c = this.composer;
    if (c.renderTarget1.samples === n) return;
    c.renderTarget1.samples = n;
    c.renderTarget2.samples = n;
    c.renderTarget1.dispose();
    c.renderTarget2.dispose();
  }

  /**
   * 叠加一个场景在世界之上（第一人称的枪和手）：先清深度再画，所以不会被墙和僵尸挡住或穿进去。
   * 同时参与后期，枪口火光也能产生光晕。
   */
  setOverlay(scene: Scene, camera: PerspectiveCamera): void {
    this.overlayScene = scene;
    this.overlayCamera = camera;
    const pass = new RenderPass(scene, camera);
    pass.clear = false;
    pass.clearDepth = true;
    this.overlayPass = pass;
    // 枪和手画在 AO 之后：AO 只算世界，不然整把枪会被当成挡住光的东西压暗
    this.composer.insertPass(pass, 2);
  }

  setOverlayVisible(v: boolean): void {
    this.overlayOn = v;
    if (this.overlayPass) this.overlayPass.enabled = v;
  }

  render(dt: number): void {
    if (this.enabled) {
      this.composer.render(dt);
      return;
    }
    const r = this.renderer;
    r.render(this.scene, this.camera);
    if (this.overlayOn && this.overlayScene && this.overlayCamera) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlayScene, this.overlayCamera);
      r.autoClear = auto;
    }
  }

  setPixelRatio(pr: number): void {
    this.composer.setPixelRatio(pr);
    this.fitBloom();
  }

  dispose(): void {
    this.ao.dispose();
    this.lutDay.dispose();
    this.lutNight.dispose();
    this.composer.dispose();
  }
}
