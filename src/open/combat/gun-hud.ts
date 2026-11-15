/**
 * 武器的界面（自己的 DOM，挂在 body 上）：
 *   准星：四条短线，间距跟着现在的散布走；瞄准时淡出，近战 / 空手时只留中间一个点；
 *   命中提示：打中身体白色的叉，爆头红色，击杀更大、停得更久；
 *   用东西（打针、吃、包扎）的进度：准星外面的一圈；
 *   瞄准镜的镜框（满举镜时）；
 *   右下角的武器栏：名字、弹匣 / 背包里的备弹、换弹进度、三个槽位。开车时整个藏起来（那个位置是仪表盘）。
 * 每帧只在数值变了的时候才动 DOM。
 */

const CSS = `
.ars { position: fixed; inset: 0; pointer-events: none; user-select: none; z-index: 3; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; }
.ars.off { display: none; }
.ars-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --g: 10px; }
.ars-cross i { position: absolute; background: #f4f1e8; box-shadow: 0 0 0 1px #0009; border-radius: 1px; }
.ars-cross .t, .ars-cross .b { left: -1px; width: 2px; height: 9px; }
.ars-cross .l, .ars-cross .r { top: -1px; height: 2px; width: 9px; }
.ars-cross .t { bottom: var(--g); }
.ars-cross .b { top: var(--g); }
.ars-cross .l { right: var(--g); }
.ars-cross .r { left: var(--g); }
.ars-cross b { position: absolute; left: -1.5px; top: -1.5px; width: 3px; height: 3px; border-radius: 50%; background: #f4f1e8; box-shadow: 0 0 0 1px #0009; }
.ars-cross.dot i { display: none; }
.ars-hit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
.ars-hit i { position: absolute; left: -1px; top: -1px; width: 2px; height: 11px; background: #fff; box-shadow: 0 0 2px #000; border-radius: 1px; transform-origin: 1px 1px; }
.ars-hit i:nth-child(1) { transform: rotate(45deg) translateY(8px); }
.ars-hit i:nth-child(2) { transform: rotate(135deg) translateY(8px); }
.ars-hit i:nth-child(3) { transform: rotate(225deg) translateY(8px); }
.ars-hit i:nth-child(4) { transform: rotate(315deg) translateY(8px); }
.ars-hit.head i { background: #ff5a44; }
.ars-hit.kill i { background: #ff3a2a; height: 14px; width: 3px; }
.ars-scope { position: absolute; inset: 0; display: none; background: radial-gradient(circle at 50% 50%, #0000 0, #0000 39.5vh, #000c 40vh, #000 41vh); }
.ars-scope.on { display: block; }
.ars-scope::before, .ars-scope::after { content: ''; position: absolute; background: #000c; }
.ars-scope::before { left: 50%; top: calc(50% - 40vh); width: 1px; height: 80vh; }
.ars-scope::after { top: 50%; left: calc(50% - 40vh); height: 1px; width: 80vh; }
.ars-scope b { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%; background: #e0563c; }
.ars-panel { position: absolute; right: 26px; bottom: 26px; min-width: 250px; padding: 10px 14px 10px; border-radius: 8px; background: linear-gradient(#0b0e12b0, #0b0e12e0); box-shadow: 0 6px 24px #0008; color: #f2ead8; }
.ars-panel .name { font-size: 13px; letter-spacing: .12em; color: #ffffffb0; }
.ars-panel .name b { font-weight: normal; }
.ars-panel .ammo { margin-top: 1px; height: 46px; display: flex; align-items: baseline; gap: 8px; font-family: Consolas, monospace; white-space: nowrap; }
.ars-panel .ammo b { font-size: 40px; line-height: 46px; font-weight: bold; color: #f4efe2; }
.ars-panel .ammo b.low { color: #ffb14a; }
.ars-panel .ammo b.empty { color: #ff5a44; }
.ars-panel .ammo span { font-size: 20px; color: #ffffffa0; }
.ars-panel .ammo em { margin-left: auto; font: normal 12px 'Microsoft YaHei', sans-serif; color: #ffffff80; }
.ars-panel .bar { height: 4px; margin: 2px 0 8px; border-radius: 2px; background: #ffffff14; overflow: hidden; }
.ars-panel .bar i { display: block; height: 100%; width: 0; background: #ffd36a; }
.ars-panel .slots { display: flex; gap: 6px; }
.ars-panel .s { flex: 1; min-width: 0; padding: 4px 6px; border: 1px solid #ffffff22; border-radius: 4px; font-size: 12px; color: #ffffff80; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ars-panel .s u { display: inline-block; margin-right: 5px; text-decoration: none; font: bold 11px Consolas, monospace; color: #ffffff60; }
.ars-panel .s.on { border-color: #ffd36a; color: #f2ead8; background: #ffd36a1c; }
.ars-panel .s.on u { color: #ffd36a; }
.ars-panel .s.none { color: #ffffff40; }
.ars-tip { position: absolute; left: 50%; top: calc(50% + 46px); transform: translateX(-50%); padding: 3px 10px; border-radius: 3px; background: #0008; font-size: 13px; letter-spacing: .08em; color: #ffd36a; white-space: nowrap; }
.ars-tip:empty { display: none; }
.ars-use { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; display: none; background: conic-gradient(#ffd36a calc(var(--p, 0) * 1%), #ffffff2e 0); -webkit-mask: radial-gradient(circle, #0000 18px, #000 19px); mask: radial-gradient(circle, #0000 18px, #000 19px); filter: drop-shadow(0 0 2px #000a); }
.ars-use.on { display: block; }
.ars-panel .name span { float: right; letter-spacing: .04em; color: #ffd36ac0; }
`;

/** 武器模块每帧填好，flush() 把变了的写进 DOM */
export interface HudModel {
  /** 整个界面显示不显示（开车、死了、开着背包时不显示） */
  show: boolean;
  /** 准星：gun = 四条线，dot = 只有中间的点，none = 不显示 */
  cross: 'gun' | 'dot' | 'none';
  /** 准星张开多少（像素）、瞄准进度（准星跟着淡出） */
  gap: number;
  ads: number;
  /** 瞄准镜的镜框 */
  scope: boolean;
  name: string;
  /** 手上是枪：显示弹匣 / 备弹；不是就只显示名字 */
  gun: boolean;
  loaded: number;
  mag: number;
  /** 背包里的备弹；-1 = 不用背包里的（借来的枪、弹药箱旁边），显示 ∞ */
  reserve: number;
  ammoName: string;
  /** 换弹进度 0–1，-1 = 没在换 */
  reload: number;
  /** 三个槽位里的东西（空 = ''），现在选的是哪个（-1 = 空手） */
  slots: [string, string, string];
  cur: number;
  /** 准星下面的一行小字（「按 R 换弹」「没有子弹」） */
  tip: string;
  /** 正在用东西：进度 0–1（-1 = 没在用） */
  use: number;
  /** 背包里有几颗手雷（0 = 不显示） */
  nades: number;
}

export class GunHud {
  readonly model: HudModel = { show: false, cross: 'none', gap: 10, ads: 0, scope: false, name: '', gun: false, loaded: 0, mag: 0, reserve: 0, ammoName: '', reload: -1, slots: ['', '', ''], cur: -1, tip: '', use: -1, nades: 0 };

  private readonly root: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly hit: HTMLElement;
  private readonly scope: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly name: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly loaded: HTMLElement;
  private readonly reserve: HTMLElement;
  private readonly ammoName: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly slots: HTMLElement[];
  private readonly tip: HTMLElement;
  private readonly use: HTMLElement;
  private readonly nade: HTMLElement;
  /** 上一次写进 DOM 的值 */
  private readonly last: Record<string, string | number | boolean> = {};
  private readonly lastSlot: string[] = ['\u0000', '\u0000', '\u0000'];
  private readonly lastOn: boolean[] = [false, false, false];
  private hitT = 0;
  private hitLen = 0.2;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'ars off';
    root.innerHTML = `
      <div class="ars-scope"><b></b></div>
      <div class="ars-cross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
      <div class="ars-hit"><i></i><i></i><i></i><i></i></div>
      <div class="ars-use"></div>
      <div class="ars-tip"></div>
      <div class="ars-panel">
        <div class="name"><b></b><span></span></div>
        <div class="ammo"><b></b><span></span><em></em></div>
        <div class="bar"><i></i></div>
        <div class="slots"><div class="s"></div><div class="s"></div><div class="s"></div></div>
      </div>`;
    document.body.append(root);
    const q = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.root = root;
    this.cross = q('.ars-cross');
    this.hit = q('.ars-hit');
    this.scope = q('.ars-scope');
    this.panel = q('.ars-panel');
    this.name = q('.ars-panel .name b');
    this.nade = q('.ars-panel .name span');
    this.use = q('.ars-use');
    this.ammo = q('.ars-panel .ammo');
    this.loaded = q('.ars-panel .ammo b');
    this.reserve = q('.ars-panel .ammo span');
    this.ammoName = q('.ars-panel .ammo em');
    this.bar = q('.ars-panel .bar i');
    this.slots = [...root.querySelectorAll('.ars-panel .s')] as HTMLElement[];
    this.tip = q('.ars-tip');
  }

  /** 打中了：闪一下命中提示 */
  hitMark(head: boolean, kill: boolean): void {
    this.hit.className = `ars-hit${kill ? ' kill' : head ? ' head' : ''}`;
    this.hitLen = kill ? 0.34 : 0.2;
    this.hitT = this.hitLen;
  }

  /** 值变了才返回 true（并记下新值） */
  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last[key] === v) return false;
    this.last[key] = v;
    return true;
  }

  flush(dt: number): void {
    const m = this.model;
    if (this.changed('show', m.show)) this.root.classList.toggle('off', !m.show);
    if (!m.show) {
      this.hitT = 0;
      return;
    }
    // ---- 准星
    const cross = m.scope ? 'none' : m.cross;
    if (this.changed('cross', cross)) {
      this.cross.style.display = cross === 'none' ? 'none' : '';
      this.cross.classList.toggle('dot', cross === 'dot');
    }
    if (cross === 'gun') {
      const g = Math.round(m.gap * 2) / 2;
      if (this.changed('gap', g)) this.cross.style.setProperty('--g', `${g}px`);
    }
    const op = cross === 'gun' ? Math.round(Math.max(0, 1 - m.ads * 1.6) * 20) / 20 : 1;
    if (this.changed('crossOp', op)) this.cross.style.opacity = String(op);
    if (this.changed('scope', m.scope)) this.scope.classList.toggle('on', m.scope);
    // ---- 命中提示：先放大一点再缩回去、淡出
    if (this.hitT > 0) {
      this.hitT -= dt;
      const k = Math.max(0, this.hitT / this.hitLen);
      this.hit.style.opacity = String(Math.min(1, k * 1.6));
      this.hit.style.transform = `scale(${(1 + 0.35 * k).toFixed(2)})`;
    } else if (this.changed('hitOff', true)) this.hit.style.opacity = '0';
    if (this.hitT > 0) this.last.hitOff = false;
    if (this.changed('tip', m.tip)) this.tip.textContent = m.tip;
    // ---- 用东西的进度圈（每 2% 动一次）
    const use = m.use < 0 ? -1 : Math.round(Math.min(1, m.use) * 50) * 2;
    if (this.changed('use', use)) {
      this.use.classList.toggle('on', use >= 0);
      if (use >= 0) this.use.style.setProperty('--p', String(use));
    }
    if (this.changed('nades', m.nades)) this.nade.textContent = m.nades > 0 ? `Q 手雷 ×${m.nades}` : '';
    // ---- 武器栏
    if (this.changed('name', m.name)) this.name.textContent = m.name;
    if (this.changed('gun', m.gun)) {
      this.ammo.style.display = m.gun ? '' : 'none';
      this.bar.parentElement!.style.visibility = m.gun ? '' : 'hidden';
    }
    if (m.gun) {
      if (this.changed('loaded', m.loaded)) this.loaded.textContent = String(m.loaded);
      const tone = m.loaded <= 0 ? 'empty' : m.loaded <= Math.max(1, Math.floor(m.mag * 0.25)) ? 'low' : '';
      if (this.changed('tone', tone)) this.loaded.className = tone;
      if (this.changed('reserve', m.reserve)) this.reserve.textContent = m.reserve < 0 ? '/ ∞' : `/ ${m.reserve}`;
      if (this.changed('ammoName', m.ammoName)) this.ammoName.textContent = m.ammoName;
      const r = m.reload < 0 ? 0 : Math.round(m.reload * 50) * 2;
      if (this.changed('reload', r)) this.bar.style.width = `${r}%`;
    }
    for (let i = 0; i < 3; i++) {
      const text = m.slots[i] as string;
      const on = m.cur === i;
      if (this.lastSlot[i] !== text || this.lastOn[i] !== on) {
        this.lastSlot[i] = text;
        this.lastOn[i] = on;
        const el = this.slots[i] as HTMLElement;
        el.className = `s${on ? ' on' : ''}${text ? '' : ' none'}`;
        el.innerHTML = `<u>${i + 1}</u>${text || '空'}`;
      }
    }
    void this.panel;
  }
}
