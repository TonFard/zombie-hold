import { HalfFloatType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** 后期：Bloom 让灯光、枪口火光和发电机核心发亮，最后统一做色调映射 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
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
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.55, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
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
    this.composer.insertPass(pass, 1);
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
    this.composer.dispose();
  }
}
