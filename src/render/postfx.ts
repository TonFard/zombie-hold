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
  enabled = true;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    w: number,
    h: number,
  ) {
    const target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.55, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
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
  }

  dispose(): void {
    this.composer.dispose();
  }
}
