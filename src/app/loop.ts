import { STEP } from '../game/sim';

/**
 * 主循环：requestAnimationFrame + 固定步长模拟。
 * simulate(STEP) 每个固定步调用若干次；frame(dt) 每帧调用一次（渲染、HUD）。
 */
export class Loop {
  private acc = 0;
  private last = performance.now();
  private raf = 0;

  constructor(
    private readonly hooks: {
      /** 本帧是否推进模拟 */
      shouldSimulate: () => boolean;
      /** 推进模拟之前（读取输入） */
      beforeSimulate: (dt: number) => void;
      simulate: (step: number) => void;
      /** 模拟之后、渲染之前（音频等跟着模拟走的东西） */
      afterSimulate: (dt: number) => void;
      frame: (dt: number) => void;
    },
  ) {}

  start(): void {
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      // rAF 给的时间戳可能早于初始化结束时的 performance.now()（初始化很慢时差好几秒），
      // 不夹住下限的话 dt 是负数，模拟会被一个很大的负欠账卡住好几秒
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.hooks.shouldSimulate()) {
        this.hooks.beforeSimulate(dt);
        this.acc += dt;
        while (this.acc >= STEP) {
          this.hooks.simulate(STEP);
          this.acc -= STEP;
        }
        this.hooks.afterSimulate(dt);
      }
      this.hooks.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
