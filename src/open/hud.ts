import type { Player } from './player';
import { siteLevel, type Site } from './world/sites';
import { WATER } from './world/terrain';
import type { World } from './world/world';

/**
 * 开放世界的界面：顶部指南针、右上小地图（跟着玩家转）、M 大地图、进入地点的提示、F3 性能面板。
 * 地图是无限的，所以底图按 256 米一块现算现存（32 × 32 像素，一帧最多算一块，约几毫秒），
 * 路、地点、房子每次直接画（就几十条线）。走到 350 米以内的地点才算「发现」，没发现的在地图上是问号。
 */

const TILE = 256;
const TPX = 32;
const MINI_SPAN = 240;
const FULL_SPAN = 2600;
const FULL_PX = 1024;
const LEVEL = ['#7fbf6a', '#b5c55a', '#d9b44a', '#e08a3c', '#e0563c'];
const ROAD_COLOR: Record<string, string> = { highway: '#d8cfa8', road: '#bdb59a', dirt: '#9c8a6c' };

export class Hud {
  readonly stats: HTMLElement;
  private readonly root: HTMLElement;
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly miniN: HTMLElement;
  private readonly full: HTMLElement;
  private readonly fullCtx: CanvasRenderingContext2D;
  private readonly compass: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly tiles = new Map<number, HTMLCanvasElement>();
  private readonly want: Array<{ tx: number; tz: number; d: number }> = [];
  /** 发现过的地点 */
  readonly found = new Set<number>();
  /** 地图上额外的标记（车、死的时候掉的东西）：玩法层每帧可以直接改这个数组 */
  markers: Array<{ x: number; z: number; label: string; color: string }> = [];
  private mapOpen = false;
  private here: Site | null = null;
  private bannerT = 0;
  private drawT = 0;
  private near: Site[] = [];
  private nearT = 0;

  constructor(
    private readonly w: World,
    private readonly p: Player,
  ) {
    this.root = document.getElementById('hud') as HTMLElement;
    this.root.innerHTML = `
      <div class="compass"><div class="strip"></div><div class="mark"></div></div>
      <div class="mini-wrap"><canvas class="mini" width="220" height="220"></canvas><div class="mini-n">N</div><div class="coords"></div><div class="clock"></div></div>
      <div class="banner"></div>
      <div class="stats"></div>
      <div class="hint">点击画面开始 · WASD 移动 · E 拾取 / 上下车 · F 加油 / 改装 / 发电机 · Tab 背包 · 1 2 3 武器 · R 换弹 · Q 手雷 · 4–8 吃喝药暖针 · B 图鉴 · M 地图</div>
      <div class="full"><canvas width="${FULL_PX}" height="${FULL_PX}"></canvas><div class="legend"></div></div>`;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.mini = q<HTMLCanvasElement>('.mini');
    this.miniCtx = this.mini.getContext('2d') as CanvasRenderingContext2D;
    this.miniN = q('.mini-n');
    this.full = q('.full');
    this.fullCtx = (this.full.querySelector('canvas') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
    this.compass = q('.compass .strip');
    this.banner = q('.banner');
    this.stats = q('.stats');
    this.hint = q('.hint');
    this.coords = q('.coords');
    this.clock = q('.clock');
    // 指南针刻度：360° 画三遍，按朝向平移
    const names: Record<number, string> = { 0: '北', 45: '东北', 90: '东', 135: '东南', 180: '南', 225: '西南', 270: '西', 315: '西北' };
    const marks: string[] = [];
    for (let rep = 0; rep < 3; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const label = names[d];
        marks.push(`<span class="${label ? (d % 90 === 0 ? 'big' : 'mid') : ''}">${label ?? '·'}</span>`);
      }
    }
    this.compass.innerHTML = marks.join('');
    q('.legend').innerHTML = `<b>废土</b><br>离起点越远越危险<br>${LEVEL.map((c, i) => `<i style="background:${c}"></i>${'★'.repeat(i + 1)}`).join('<br>')}<br><i style="background:#8a8a8a"></i>？ 还没去过<br><br>M 关闭`;
  }

  toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    this.full.classList.toggle('open', this.mapOpen);
  }

  toggleStats(): void {
    this.stats.classList.toggle('open');
  }

  setLocked(on: boolean): void {
    this.hint.classList.toggle('dim', on);
  }

  /** 一块底图：高度着色 + 山体阴影（光从西北来）+ 水 + 树林 / 荒地的颜色 */
  private makeTile(tx: number, tz: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = TPX;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(TPX, TPX);
    const step = TILE / TPX;
    const N = TPX + 1;
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = this.w.heightAt(tx * TILE + i * step, tz * TILE + j * step);
    const t = this.w.terrain;
    for (let j = 0; j < TPX; j++) {
      for (let i = 0; i < TPX; i++) {
        const k = j * N + i;
        const hh = h[k] as number;
        const o = (j * TPX + i) * 4;
        let r: number;
        let g: number;
        let b: number;
        if (hh < WATER) {
          r = 44;
          g = 70;
          b = 84;
        } else {
          const x = tx * TILE + (i + 0.5) * step;
          const z = tz * TILE + (j + 0.5) * step;
          const dry = t.dry(x, z);
          const f = Math.min(1, t.forest(x, z)) * 0.6;
          const rock = Math.max(0, Math.min(1, (hh - 55) / 45));
          r = (88 + 56 * dry) * (1 - f) + 50 * f;
          g = (104 + 22 * dry) * (1 - f) + 72 * f;
          b = (62 + 24 * dry) * (1 - f) + 46 * f;
          r += (128 - r) * rock;
          g += (124 - g) * rock;
          b += (114 - b) * rock;
          const shade = Math.max(0.45, Math.min(1.3, 0.92 - (((h[k + 1] as number) - hh + (h[k + N] as number) - hh) / step) * 0.55));
          r *= shade;
          g *= shade;
          b *= shade;
        }
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** 画一张地图：中心 (cx, cz)、边长 span 米、转 rot 弧度；S = 画布像素 */
  private draw(ctx: CanvasRenderingContext2D, S: number, cx: number, cz: number, span: number, rot: number, round: boolean): void {
    ctx.save();
    ctx.fillStyle = '#2b3328';
    ctx.fillRect(0, 0, S, S);
    if (round) {
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    const k = S / span;
    ctx.scale(k, k);
    ctx.translate(-cx, -cz);
    const R = round ? span * 0.5 : span * 0.5;
    const pad = round ? span * 0.22 : 0;
    ctx.imageSmoothingEnabled = true;
    for (let tz = Math.floor((cz - R - pad) / TILE); tz <= Math.floor((cz + R + pad) / TILE); tz++) {
      for (let tx = Math.floor((cx - R - pad) / TILE); tx <= Math.floor((cx + R + pad) / TILE); tx++) {
        const tile = this.tiles.get((tx + 32768) * 65536 + (tz + 32768));
        // 多画半个像素，块和块之间不留缝
        if (tile) ctx.drawImage(tile, tx * TILE, tz * TILE, TILE + 0.5 / k, TILE + 0.5 / k);
        else this.want.push({ tx, tz, d: Math.hypot((tx + 0.5) * TILE - cx, (tz + 0.5) * TILE - cz) });
      }
    }
    // 地块
    for (const s of this.near) {
      if (Math.hypot(s.x - cx, s.z - cz) > R * 1.5 + s.r) continue;
      ctx.fillStyle = 'rgba(160,150,128,0.42)';
      for (const l of s.lots) ctx.fillRect(l.x0, l.z0, l.x1 - l.x0, l.z1 - l.z0);
    }
    // 路：先深色描边，再上色
    const edges = this.w.roads.edgesIn(cx - R - pad, cz - R - pad, cx + R + pad, cz + R + pad, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const e of edges) {
        ctx.beginPath();
        for (let i = 0; i < e.pts.length; i += 2) {
          if (i) ctx.lineTo(e.pts[i] as number, e.pts[i + 1] as number);
          else ctx.moveTo(e.pts[i] as number, e.pts[i + 1] as number);
        }
        const wpx = Math.max(e.w, (e.kind === 'highway' ? 2.6 : 1.6) / k);
        ctx.strokeStyle = pass ? (ROAD_COLOR[e.kind] as string) : 'rgba(20,20,20,0.55)';
        ctx.lineWidth = pass ? wpx : wpx + 2 / k;
        ctx.stroke();
      }
    }
    // 房子（内容已经生成的地点才有）
    ctx.fillStyle = '#5a4f45';
    for (const s of this.near) {
      const c = this.w.sites.peek(s);
      if (!c || Math.hypot(s.x - cx, s.z - cz) > R * 1.5 + s.r) continue;
      for (const hh of c.houses) ctx.fillRect(hh.x0, hh.z0, hh.x1 - hh.x0, hh.z1 - hh.z0);
    }
    ctx.restore();
    // 地点的名字（屏幕空间，不跟着转）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${round ? 12 : 17}px "Microsoft YaHei", sans-serif`;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (const s of this.near) {
      const dx = (s.x - cx) * k;
      const dz = (s.z - cz) * k;
      const x = S / 2 + dx * cs - dz * sn;
      const y = S / 2 + dx * sn + dz * cs;
      if (round ? Math.hypot(x - S / 2, y - S / 2) > S / 2 - 16 : x < 10 || y < 20 || x > S - 10 || y > S - 6) continue;
      const known = this.found.has(s.key);
      ctx.fillStyle = known ? (LEVEL[siteLevel(s) - 1] as string) : '#8a8a8a';
      ctx.beginPath();
      ctx.arc(x, y, round ? 4 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = round ? 3 : 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const label = known ? s.name : '？';
      ctx.strokeText(label, x, y - (round ? 8 : 12));
      ctx.fillStyle = '#f2ead8';
      ctx.fillText(label, x, y - (round ? 8 : 12));
    }
    // 标记：小地图上出了圈的贴在圈边上（知道往哪走）
    ctx.font = `bold ${round ? 11 : 15}px "Microsoft YaHei", sans-serif`;
    for (const m of this.markers) {
      const dx = (m.x - cx) * k;
      const dz = (m.z - cz) * k;
      let x = S / 2 + dx * cs - dz * sn;
      let y = S / 2 + dx * sn + dz * cs;
      let far = false;
      if (round) {
        const d = Math.hypot(x - S / 2, y - S / 2);
        const lim = S / 2 - 12;
        if (d > lim) {
          x = S / 2 + ((x - S / 2) / d) * lim;
          y = S / 2 + ((y - S / 2) / d) * lim;
          far = true;
        }
      } else if (x < 10 || y < 20 || x > S - 10 || y > S - 6) continue;
      const r = round ? 4.5 : 7;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      if (far) continue;
      ctx.lineWidth = round ? 3 : 4;
      ctx.strokeText(m.label, x, y - (round ? 8 : 12));
      ctx.fillStyle = '#f2ead8';
      ctx.fillText(m.label, x, y - (round ? 8 : 12));
    }
    ctx.restore();
  }

  /** 玩家箭头：a = 画布上的朝向（0 = 朝上） */
  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, s: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.62, s * 0.7);
    ctx.lineTo(0, s * 0.35);
    ctx.lineTo(-s * 0.62, s * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#ffd36a';
    ctx.strokeStyle = '#1a1408';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  update(dt: number, clock: string): void {
    const p = this.p;
    // 指南针：yaw 0 = 朝南（+z），朝北 = yaw π。刻度 15° 一格，每格 40 px
    const heading = (((((Math.PI - p.yaw) * 180) / Math.PI) % 360) + 360) % 360;
    this.compass.style.transform = `translateX(${-(((heading + 360) / 15) * 40 + 20)}px)`;
    // 附近的地点：半秒查一次
    this.nearT -= dt;
    if (this.nearT <= 0) {
      this.nearT = 0.5;
      this.near = this.w.sites.near(p.x, p.z, FULL_SPAN * 0.75);
      let here: Site | null = null;
      for (const s of this.near) {
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < s.r + 350) this.found.add(s.key);
        if (d < s.r - 12 && (!here || s.r < here.r)) here = s;
      }
      if (here && here !== this.here) {
        const lv = siteLevel(here);
        this.banner.innerHTML = `<div class="name">${here.name}</div><div class="danger" style="color:${LEVEL[lv - 1]}">${'★'.repeat(lv)}${'☆'.repeat(5 - lv)}</div>`;
        this.banner.classList.add('show');
        this.bannerT = 3.2;
      }
      this.here = here;
      this.coords.textContent = `东 ${Math.round(p.x)} · 北 ${Math.round(-p.z)}`;
      this.clock.textContent = clock;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove('show');
    }
    // 地图一秒画 30 次就够了
    this.drawT -= dt;
    if (this.drawT <= 0) {
      this.drawT = 1 / 30;
      this.want.length = 0;
      const S = this.mini.width;
      // 朝向朝上：世界朝向 yaw（朝 +z 为 0）在北朝上的地图里是「朝下」，所以整张图转 yaw - π
      const rot = p.yaw - Math.PI;
      this.draw(this.miniCtx, S, p.x, p.z, MINI_SPAN, rot, true);
      this.arrow(this.miniCtx, S / 2, S / 2, 0, 8);
      // 「北」的标记：北 = -z，转过以后的方向
      const r = S / 2 - 12;
      this.miniN.style.transform = `translate(${S / 2 + Math.sin(rot) * r - 7}px, ${S / 2 - Math.cos(rot) * r - 9}px)`;
      if (this.mapOpen) {
        this.draw(this.fullCtx, FULL_PX, p.x, p.z, FULL_SPAN, 0, false);
        this.arrow(this.fullCtx, FULL_PX / 2, FULL_PX / 2, Math.PI - p.yaw, 11);
      }
    }
    // 底图：一帧最多算一块，先算近的
    if (this.want.length) {
      let best = this.want[0] as { tx: number; tz: number; d: number };
      for (const q of this.want) if (q.d < best.d) best = q;
      const key = (best.tx + 32768) * 65536 + (best.tz + 32768);
      if (!this.tiles.has(key)) {
        if (this.tiles.size > 600) this.tiles.clear();
        this.tiles.set(key, this.makeTile(best.tx, best.tz));
      }
      this.want.length = 0;
    }
  }
}
