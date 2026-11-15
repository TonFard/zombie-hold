/**
 * 开车时右下角的仪表（车名、车速、挡位、转速、油量、改装件）和屏幕中下方那一行车的提示（带一条进度）。
 * 没有 document 的环境（无头测试）里什么都不建，所有方法都是空的。样式在 open.html 的 .veh-* 里。
 */

export interface DashState {
  name: string;
  kmh: number;
  gear: string;
  /** 转速 0..1（相对断油转速） */
  rpm: number;
  red: boolean;
  /** 油量 0..1、文字（「8.0 升 · 约 2.7 公里」）、状态：ok / low（发黄）/ crit（发红、闪）/ empty */
  fuel: number;
  fuelText: string;
  fuelState: 'ok' | 'low' | 'crit' | 'empty';
  /** 装了哪些改装件（短名字） */
  parts: string;
  /** 仪表上面的一行提示（加油机在旁边、没油了……），空 = 不显示 */
  hint: string;
}

export class Dash {
  private readonly prompt: HTMLElement | null = null;
  private readonly promptText: HTMLElement | null = null;
  private readonly promptBar: HTMLElement | null = null;
  private readonly dash: HTMLElement | null = null;
  private readonly el: Record<string, HTMLElement> = {};
  /** 上一次写进去的值：没变就不碰 DOM */
  private readonly last: Record<string, string> = {};

  constructor() {
    if (typeof document === 'undefined') return;
    // 自己挂在 body 上：Hud 构造时会重写 #hud 的内容
    const hud = document.createElement('div');
    hud.id = 'veh-hud';
    document.body.append(hud);
    this.prompt = document.createElement('div');
    this.prompt.className = 'veh-prompt';
    this.prompt.innerHTML = '<span></span><i></i>';
    this.promptText = this.prompt.querySelector('span');
    this.promptBar = this.prompt.querySelector('i');
    this.dash = document.createElement('div');
    this.dash.className = 'veh-dash';
    this.dash.innerHTML =
      '<div class="hint"></div><div class="name"></div><div class="speed"><b>0</b><span>km/h</span></div><div class="gear">1</div><div class="rpm"><i></i></div>' +
      '<div class="fuel"><em>油</em><div class="bar"><i></i><u></u></div><span></span></div><div class="parts"></div>' +
      '<div class="keys">E 下车 · V 视角 · 空格 手刹 · H 喇叭 · L 车灯</div>';
    hud.append(this.prompt, this.dash);
    const q = (sel: string): HTMLElement => this.dash!.querySelector(sel) as HTMLElement;
    this.el = { hint: q('.hint'), name: q('.name'), speed: q('.speed b'), gear: q('.gear'), rpm: q('.rpm i'), fuel: q('.fuel'), fuelBar: q('.fuel .bar i'), fuelText: q('.fuel span'), parts: q('.parts') };
  }

  private text(key: string, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    const e = this.el[key];
    if (e) e.textContent = value;
  }

  private attr(key: string, value: string, apply: (v: string) => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  /** 屏幕中下方的一行；bar ≥ 0 时下面有一条进度（加油） */
  say(text: string, bar = -1): void {
    if (!this.prompt) return;
    this.attr('say', text, (v) => {
      if (v) (this.promptText as HTMLElement).textContent = v;
      (this.prompt as HTMLElement).classList.toggle('show', !!v);
    });
    this.attr('sayBar', bar < 0 ? '' : `${(Math.min(1, bar) * 100).toFixed(0)}%`, (v) => {
      const b = this.promptBar as HTMLElement;
      b.style.display = v ? 'block' : 'none';
      b.style.width = v;
    });
  }

  /** s = null：没在开车，仪表收起来 */
  set(s: DashState | null): void {
    if (!this.dash) return;
    this.attr('show', s ? '1' : '', (v) => (this.dash as HTMLElement).classList.toggle('show', !!v));
    if (!s) return;
    this.text('name', s.name);
    this.text('speed', String(Math.round(s.kmh)));
    this.text('gear', s.gear);
    this.attr('rpm', `${(Math.min(1, s.rpm) * 100).toFixed(0)}%`, (v) => ((this.el.rpm as HTMLElement).style.width = v));
    this.attr('red', s.red ? '1' : '', (v) => (this.el.rpm as HTMLElement).classList.toggle('red', !!v));
    this.attr('fuelBar', `${(Math.max(0, Math.min(1, s.fuel)) * 100).toFixed(0)}%`, (v) => ((this.el.fuelBar as HTMLElement).style.width = v));
    this.text('fuelText', s.fuelText);
    this.attr('fuelState', s.fuelState, (v) => ((this.el.fuel as HTMLElement).className = `fuel ${v}`));
    this.text('parts', s.parts);
    this.attr('partsOn', s.parts ? '1' : '', (v) => ((this.el.parts as HTMLElement).style.display = v ? 'block' : 'none'));
    this.text('hint', s.hint);
    this.attr('hintOn', s.hint ? '1' : '', (v) => ((this.el.hint as HTMLElement).style.display = v ? 'block' : 'none'));
  }
}
