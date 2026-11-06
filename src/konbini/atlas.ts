import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { Tile } from './kit';

/**
 * 所有招牌、海报、商品包装、标识都画在一张 4096² 的画布图集上（程序绘制，没有外部图片）。
 * 文字用系统日文字体；品牌是原创的「ヨルマート / YORU MART」。
 */

const JP = `'Yu Gothic UI','Yu Gothic','Meiryo','Hiragino Sans','Noto Sans JP','Microsoft YaHei',sans-serif`;
const SIZE = 4096;
const PAD = 6;

type Ctx2 = CanvasRenderingContext2D;
type Draw = (g: Ctx2, w: number, h: number) => void;

export class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly g: Ctx2;
  readonly texture: CanvasTexture;
  private readonly tiles = new Map<string, Tile>();
  private x = 0;
  private y = 0;
  private rowH = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.g = this.canvas.getContext('2d') as Ctx2;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = LinearMipmapLinearFilter;
  }

  /** 分配一块 w×h 的区域并画上内容 */
  add(name: string, w: number, h: number, draw: Draw): Tile {
    if (this.x + w + PAD * 2 > SIZE) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + h + PAD * 2 > SIZE) throw new Error(`atlas full at ${name}`);
    const ox = this.x + PAD;
    const oy = this.y + PAD;
    const g = this.g;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, w, h);
    g.restore();
    // 往四周复制一圈边缘像素，避免 mipmap 时混进隔壁的颜色
    g.drawImage(this.canvas, ox, oy, w, 1, ox, oy - PAD, w, PAD);
    g.drawImage(this.canvas, ox, oy + h - 1, w, 1, ox, oy + h, w, PAD);
    g.drawImage(this.canvas, ox, oy - PAD, 1, h + PAD * 2, ox - PAD, oy - PAD, PAD, h + PAD * 2);
    g.drawImage(this.canvas, ox + w - 1, oy - PAD, 1, h + PAD * 2, ox + w, oy - PAD, PAD, h + PAD * 2);
    // 半像素内缩，采样不越界
    const t: Tile = { u0: (ox + 0.5) / SIZE, u1: (ox + w - 0.5) / SIZE, v0: 1 - (oy + h - 0.5) / SIZE, v1: 1 - (oy + 0.5) / SIZE };
    this.tiles.set(name, t);
    this.x += w + PAD * 2;
    this.rowH = Math.max(this.rowH, h + PAD * 2);
    return t;
  }

  get(name: string): Tile {
    const t = this.tiles.get(name);
    if (!t) throw new Error(`no tile ${name}`);
    return t;
  }

  /** 一张贴图里的子区域（u/v 是 0..1 相对坐标） */
  sub(name: string, u0: number, v0: number, u1: number, v1: number): Tile {
    const t = this.get(name);
    const du = t.u1 - t.u0;
    const dv = t.v1 - t.v0;
    return { u0: t.u0 + du * u0, u1: t.u0 + du * u1, v0: t.v0 + dv * v0, v1: t.v0 + dv * v1 };
  }
}

// ---------------------------------------------------------------- 绘图小工具

export function font(px: number, weight = 800): string {
  return `${weight} ${px}px ${JP}`;
}

/** 在宽度 maxW 内居中写字，放不下就缩小 */
export function text(g: Ctx2, s: string, x: number, y: number, maxW: number, px: number, color: string, weight = 800, align: CanvasTextAlign = 'center'): void {
  let size = px;
  g.font = font(size, weight);
  while (g.measureText(s).width > maxW && size > 6) {
    size -= 1;
    g.font = font(size, weight);
  }
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** 竖排文字（日文海报） */
function vtext(g: Ctx2, s: string, x: number, y0: number, px: number, color: string, gap = 1.05): void {
  g.font = font(px, 900);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...s].forEach((c, i) => {
    if (c === 'ー') {
      g.save();
      g.translate(x, y0 + i * px * gap);
      g.rotate(Math.PI / 2);
      g.fillText(c, 0, 0);
      g.restore();
    } else g.fillText(c, x, y0 + i * px * gap);
  });
}

function rr(g: Ctx2, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}


let seed = 1234567;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

// ---------------------------------------------------------------- 内容

/** 商品包装：名字 + 底色（零食、面包、饮料、罐装、饭团……） */
export const SNACKS = [
  ['のり塩', '#2e8b3a'],
  ['うすしお', '#2a62c8'],
  ['コンソメ', '#7a2fa0'],
  ['チーズ', '#f08a1a'],
  ['わさび', '#86b82a'],
  ['カレー', '#c8402a'],
] as const;
export const BREADS = [
  ['あんぱん', '#c8282a'],
  ['クリーム', '#efc020'],
  ['メロン', '#6cb84a'],
  ['食パン', '#f4f0e6'],
  ['ロール', '#2a9a5a'],
] as const;
export const BOTTLES = [
  ['緑茶', '#2f7a3a', '#cfe8b0'],
  ['天然水', '#4aa0e8', '#e8f6ff'],
  ['ソーダ', '#e8323a', '#3a0a0a'],
  ['オレンジ', '#f08a1a', '#ffd080'],
  ['レモン', '#f0d020', '#fff6c0'],
  ['ミルクティー', '#c8a070', '#f0e0c8'],
  ['スポーツ', '#2a58c8', '#e0f0ff'],
  ['麦茶', '#a86a2a', '#6a3a10'],
] as const;
export const CANS = [
  ['COFFEE', '#5a3a2a'],
  ['BLACK', '#1c1c1e'],
  ['微糖', '#c8a060'],
  ['サイダー', '#3ab0e0'],
  ['ENERGY', '#38b860'],
  ['ピーチ', '#f08aa0'],
  ['コーンスープ', '#f0c030'],
  ['お汁粉', '#8a2a3a'],
] as const;
export const ONIGIRI = ['しゃけ', 'ツナマヨ', '梅', '昆布', '明太子', 'おかか'] as const;
export const BENTO = ['唐揚げ弁当', 'のり弁', '幕の内', 'ハンバーグ'] as const;
export const NOODLES = [
  ['ラーメン', '#d8282a'],
  ['うどん', '#f0f0e8'],
  ['そば', '#3a3a3a'],
  ['焼そば', '#f0a020'],
] as const;
export const SWEETS = [
  ['プリン', '#f6d060'],
  ['ロールケーキ', '#f4c8c8'],
  ['チョコ', '#5a2a1a'],
  ['グミ', '#e04aa0'],
  ['ガム', '#3ac0b0'],
  ['キャンディ', '#f07030'],
] as const;
export const DAILY = [
  ['ティッシュ', '#e8f0ff'],
  ['歯みがき', '#3a8ae0'],
  ['電池', '#f0c020'],
  ['マスク', '#f8f8f8'],
] as const;
export const MAGAZINES = ['週刊ヨル', 'JUMPER', 'CAR LIFE', 'まんが王', 'Gourmet', 'GAME★', 'Fashion', '旅とカメラ'] as const;
export const CATS = ['ドリンク', 'お弁当・おにぎり', 'パン・サンド', 'お菓子', '雑誌', '日用品', 'アイス', '冷凍食品', 'カップ麺', 'デザート'] as const;

function snackBag(name: string, color: string): Draw {
  return (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 0, w, h * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, h * 0.9, w, h * 0.1);
    text(g, 'POTATO', w / 2, h * 0.08, w * 0.8, h * 0.08, '#ffffffcc', 700);
    text(g, name, w / 2, h * 0.36, w * 0.9, h * 0.22, '#ffffff', 900);
    g.fillStyle = '#f6cc48';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(w * (0.3 + i * 0.2), h * (0.68 + (i % 2) * 0.04), w * 0.14, h * 0.07, 0.3 * i, 0, Math.PI * 2);
      g.fill();
    }
  };
}

function bread(name: string, color: string): Draw {
  return (g, w, h) => {
    g.fillStyle = '#f8f6f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, 0, w, h * 0.38);
    text(g, name, w / 2, h * 0.19, w * 0.9, h * 0.24, color === '#f4f0e6' ? '#c83a2a' : '#ffffff', 900);
    g.fillStyle = '#c87a3a';
    g.beginPath();
    g.ellipse(w / 2, h * 0.68, w * 0.32, h * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8a860';
    g.beginPath();
    g.ellipse(w / 2, h * 0.64, w * 0.24, h * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  };
}

function bottleLabel(name: string, color: string, ink: string): Draw {
  return (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, h * 0.1, w, h * 0.06);
    g.fillRect(0, h * 0.84, w, h * 0.06);
    for (const x of [0.25, 0.75]) text(g, name, w * x, h * 0.5, w * 0.42, h * 0.5, ink, 900);
  };
}

function canLabel(name: string, color: string): Draw {
  return (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, h * 0.36, w, h * 0.28);
    for (const x of [0.25, 0.75]) text(g, name, w * x, h * 0.5, w * 0.45, h * 0.24, color, 900);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(0, h * 0.08, w, h * 0.05);
  };
}

function onigiri(name: string): Draw {
  return (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1e2a20';
    g.beginPath();
    g.moveTo(w * 0.2, h);
    g.lineTo(w * 0.5, h * 0.42);
    g.lineTo(w * 0.8, h);
    g.fill();
    g.fillStyle = '#e83a3a';
    g.fillRect(w * 0.46, 0, w * 0.08, h);
    rr(g, w * 0.14, h * 0.08, w * 0.72, h * 0.3, 8);
    g.fillStyle = '#ffffff';
    g.fill();
    text(g, name, w / 2, h * 0.23, w * 0.66, h * 0.2, '#c8282a', 900);
  };
}

function bentoTop(name: string, k: number): Draw {
  return (g, w, h) => {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fafaf4';
    rr(g, w * 0.05, h * 0.08, w * 0.42, h * 0.84, 6);
    g.fill();
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(220,220,210,0.9)';
      g.fillRect(w * (0.08 + rnd() * 0.36), h * (0.12 + rnd() * 0.74), 3, 2);
    }
    g.fillStyle = '#c83a2a';
    g.beginPath();
    g.arc(w * 0.26, h * 0.5, w * 0.04, 0, 7);
    g.fill();
    const foods = [
      ['#b8702a', '#d89040'],
      ['#2e7a2e', '#f0d040'],
      ['#7a3a20', '#f0f0e0'],
      ['#8a4a2a', '#c8a050'],
    ][k % 4] as [string, string];
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? foods[1] : foods[0];
      g.beginPath();
      g.ellipse(w * (0.58 + (i % 3) * 0.12), h * (0.3 + Math.floor(i / 3) * 0.36), w * 0.07, h * 0.13, rnd(), 0, 7);
      g.fill();
    }
    g.fillStyle = '#e8483a';
    g.fillRect(w * 0.52, h * 0.78, w * 0.44, h * 0.16);
    text(g, name, w * 0.74, h * 0.86, w * 0.42, h * 0.13, '#ffffff', 900);
  };
}

function noodle(name: string, color: string): Draw {
  return (g, w, h) => {
    g.fillStyle = '#f8f4ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, h * 0.2, w, h * 0.5);
    for (const x of [0.25, 0.75]) text(g, name, w * x, h * 0.45, w * 0.44, h * 0.32, color === '#f0f0e8' ? '#c82a2a' : '#ffffff', 900);
    g.fillStyle = '#e8b030';
    g.fillRect(0, h * 0.78, w, h * 0.08);
  };
}

function magazine(title: string, k: number): Draw {
  return (g, w, h) => {
    const hue = (k * 47) % 360;
    g.fillStyle = `hsl(${hue},70%,55%)`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = `hsl(${(hue + 180) % 360},60%,${k % 2 ? 85 : 30}%)`;
    g.beginPath();
    g.arc(w * 0.5, h * 0.62, w * 0.32, 0, 7);
    g.fill();
    // 漫画风的人物剪影（只是形状）
    g.fillStyle = `hsl(${hue},40%,${k % 2 ? 25 : 90}%)`;
    g.beginPath();
    g.arc(w * 0.5, h * 0.52, w * 0.13, 0, 7);
    g.fill();
    g.fillRect(w * 0.3, h * 0.64, w * 0.4, h * 0.36);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h * 0.22);
    text(g, title, w / 2, h * 0.11, w * 0.9, h * 0.15, `hsl(${hue},80%,40%)`, 900);
    g.fillStyle = '#f0e020';
    g.fillRect(w * 0.06, h * 0.8, w * 0.34, h * 0.1);
    text(g, '特集', w * 0.23, h * 0.85, w * 0.3, h * 0.07, '#c82020', 900);
  };
}

function smallPack(name: string, color: string): Draw {
  return (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    rr(g, w * 0.08, h * 0.3, w * 0.84, h * 0.4, 6);
    g.fill();
    text(g, name, w / 2, h * 0.5, w * 0.78, h * 0.26, color === '#f8f8f8' || color === '#e8f0ff' ? '#3a6ad0' : color, 900);
  };
}

/** 价签条：黄 / 白相间的价格 */
function priceRail(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const prices = ['148', '298', '448', '128', '198', '348', '168', '248', '108', '398'];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    if (i % 3 === 1) {
      g.fillStyle = '#ffe23a';
      g.fillRect(x + 4, 2, w / n - 8, h - 4);
    }
    text(g, `¥${prices[i]}`, x + w / n / 2, h / 2, w / n - 10, h * 0.7, i % 3 === 1 ? '#d8202a' : '#222', 900);
  }
}

function catSign(name: string, k: number): Draw {
  const colors = ['#1e5ab4', '#d8402a', '#2a9a5a', '#e88a1a', '#7a3ab0', '#1a8aa0', '#2a7ad8', '#4a5ad0', '#c82a3a', '#d84a8a'];
  return (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = colors[k % colors.length] as string;
    g.fillRect(0, 0, h * 0.35, h);
    g.fillRect(0, h * 0.86, w, h * 0.14);
    text(g, name, w / 2 + h * 0.15, h * 0.45, w - h * 0.6, h * 0.56, colors[k % colors.length] as string, 900);
  };
}

/** 主招牌：深蓝底 + 月亮标志 + 三色条纹 */
function mainSign(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#fbfbf6';
  g.fillRect(0, 0, w, h);
  const stripes = ['#1d3d8f', '#24b0a0', '#f28a24'];
  stripes.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(0, h * (0.62 + i * 0.12), w, h * 0.1);
  });
  // 月亮标志
  const cx = w * 0.12;
  const cy = h * 0.32;
  g.fillStyle = '#1d3d8f';
  g.beginPath();
  g.arc(cx, cy, h * 0.24, 0, 7);
  g.fill();
  g.fillStyle = '#ffd448';
  g.beginPath();
  g.arc(cx - h * 0.04, cy, h * 0.16, 0, 7);
  g.fill();
  g.fillStyle = '#1d3d8f';
  g.beginPath();
  g.arc(cx + h * 0.04, cy - h * 0.04, h * 0.14, 0, 7);
  g.fill();
  text(g, 'YORU MART', w * 0.48, h * 0.32, w * 0.5, h * 0.42, '#1d3d8f', 900);
  text(g, 'ヨルマート', w * 0.84, h * 0.32, w * 0.22, h * 0.3, '#f28a24', 900);
}

function poleSign(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#fbfbf6';
  g.fillRect(0, 0, w, h);
  const stripes = ['#1d3d8f', '#24b0a0', '#f28a24'];
  stripes.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(0, h * (0.68 + i * 0.09), w, h * 0.07);
  });
  g.fillStyle = '#1d3d8f';
  g.beginPath();
  g.arc(w / 2, h * 0.28, w * 0.3, 0, 7);
  g.fill();
  g.fillStyle = '#ffd448';
  g.beginPath();
  g.arc(w / 2 - w * 0.05, h * 0.28, w * 0.2, 0, 7);
  g.fill();
  g.fillStyle = '#1d3d8f';
  g.beginPath();
  g.arc(w / 2 + w * 0.05, h * 0.28 - w * 0.05, w * 0.18, 0, 7);
  g.fill();
  text(g, 'YORU MART', w / 2, h * 0.56, w * 0.9, h * 0.1, '#1d3d8f', 900);
}

function poster(kind: number): Draw {
  return (g, w, h) => {
    switch (kind) {
      case 0: // おでん
        g.fillStyle = '#f6efe0';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#d8282a';
        g.fillRect(0, 0, w, h * 0.08);
        vtext(g, 'おでん', w * 0.7, h * 0.22, w * 0.3, '#2a1a10');
        g.fillStyle = '#d8282a';
        rr(g, w * 0.08, h * 0.12, w * 0.4, w * 0.4, w * 0.2);
        g.fill();
        text(g, '70円', w * 0.28, h * 0.12 + w * 0.2, w * 0.34, w * 0.14, '#fff', 900);
        for (let i = 0; i < 4; i++) {
          g.fillStyle = ['#e8c070', '#f4f0e0', '#a86a3a', '#f0e8c0'][i] as string;
          g.beginPath();
          g.arc(w * (0.18 + (i % 2) * 0.22), h * (0.6 + Math.floor(i / 2) * 0.14), w * 0.1, 0, 7);
          g.fill();
        }
        break;
      case 1: // 肉まん
        g.fillStyle = '#d8302a';
        g.fillRect(0, 0, w, h);
        vtext(g, '肉まん', w * 0.5, h * 0.14, w * 0.34, '#fff8e0');
        g.fillStyle = '#fff4e0';
        g.beginPath();
        g.arc(w * 0.5, h * 0.82, w * 0.26, Math.PI, 0);
        g.fill();
        text(g, '新発売', w / 2, h * 0.94, w * 0.8, w * 0.12, '#ffe040', 900);
        break;
      case 2: // ホットコーヒー
        g.fillStyle = '#3a2418';
        g.fillRect(0, 0, w, h);
        text(g, 'HOT', w / 2, h * 0.12, w * 0.8, w * 0.22, '#f2a040', 900);
        text(g, 'COFFEE', w / 2, h * 0.24, w * 0.8, w * 0.14, '#fff', 900);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(w * 0.3, h * 0.4);
        g.lineTo(w * 0.7, h * 0.4);
        g.lineTo(w * 0.64, h * 0.78);
        g.lineTo(w * 0.36, h * 0.78);
        g.fill();
        g.fillStyle = '#c86a2a';
        g.fillRect(w * 0.33, h * 0.52, w * 0.34, h * 0.08);
        text(g, 'S 100円', w / 2, h * 0.88, w * 0.8, w * 0.12, '#ffd448', 900);
        break;
      case 3: // からあげ
        g.fillStyle = '#ffd040';
        g.fillRect(0, 0, w, h);
        text(g, 'からあげ', w / 2, h * 0.14, w * 0.9, w * 0.2, '#c8282a', 900);
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i % 2 ? '#b8682a' : '#d8883a';
          g.beginPath();
          g.ellipse(w * (0.25 + (i % 3) * 0.25), h * (0.45 + Math.floor(i / 3) * 0.18), w * 0.13, w * 0.1, i, 0, 7);
          g.fill();
        }
        text(g, '5個入 ¥238', w / 2, h * 0.88, w * 0.9, w * 0.13, '#2a1a10', 900);
        break;
      case 4: // キャンペーン
        g.fillStyle = '#1d3d8f';
        g.fillRect(0, 0, w, h);
        text(g, '2個で', w / 2, h * 0.2, w * 0.8, w * 0.2, '#fff', 900);
        text(g, '10%OFF', w / 2, h * 0.4, w * 0.9, w * 0.26, '#ffd448', 900);
        text(g, 'SALE', w / 2, h * 0.58, w * 0.8, w * 0.14, '#fff', 900);
        g.fillStyle = '#24b0a0';
        g.fillRect(0, h * 0.8, w, h * 0.2);
        text(g, '対象のお菓子', w / 2, h * 0.9, w * 0.8, w * 0.1, '#fff', 800);
        break;
      default: // アルバイト募集
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#24b0a0';
        g.fillRect(0, 0, w, h * 0.3);
        text(g, 'スタッフ', w / 2, h * 0.1, w * 0.8, w * 0.14, '#fff', 900);
        text(g, '募集中', w / 2, h * 0.21, w * 0.8, w * 0.18, '#fff', 900);
        text(g, '時給 1,200円〜', w / 2, h * 0.45, w * 0.9, w * 0.12, '#d8282a', 900);
        text(g, '深夜歓迎', w / 2, h * 0.6, w * 0.8, w * 0.12, '#1d3d8f', 900);
        text(g, '店内スタッフまで', w / 2, h * 0.85, w * 0.9, w * 0.08, '#333', 700);
    }
  };
}

function notice(k: number): Draw {
  return (g, w, h) => {
    const bg = ['#fff8e8', '#e8f4ff', '#fff0f0', '#f0ffe8'][k % 4] as string;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const [t, s, c] = (
      [
        ['夏まつり', '8月第一土曜 町内会', '#d8402a'],
        ['防犯パトロール', '夜道に気をつけましょう', '#1d5ab4'],
        ['迷いねこ', 'しろい ねこ を さがしています', '#c8282a'],
        ['ゴミ出しルール', '燃えるゴミ 月・木', '#2a8a4a'],
      ] as const
    )[k % 4];
    g.fillStyle = c;
    g.fillRect(0, 0, w, h * 0.22);
    text(g, t, w / 2, h * 0.11, w * 0.9, h * 0.15, '#fff', 900);
    g.strokeStyle = '#99999966';
    for (let i = 0; i < 6; i++) {
      g.fillStyle = '#88888855';
      g.fillRect(w * 0.1, h * (0.5 + i * 0.07), w * (0.5 + rnd() * 0.3), 3);
    }
    text(g, s, w / 2, h * 0.36, w * 0.9, h * 0.07, '#333', 700);
    if (k % 4 === 2) {
      g.fillStyle = '#f4f4f4';
      g.beginPath();
      g.arc(w * 0.75, h * 0.8, w * 0.12, 0, 7);
      g.fill();
    }
  };
}

function vending(k: number): Draw {
  return (g, w, h) => {
    const body = ['#d8202a', '#1e64c8'][k % 2] as string;
    g.fillStyle = body;
    g.fillRect(0, 0, w, h);
    // 上半部分：样品陈列窗（亮）
    g.fillStyle = '#f4f8ff';
    g.fillRect(w * 0.06, h * 0.06, w * 0.88, h * 0.5);
    const rows = 3;
    const cols = 6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const can = CANS[(r * cols + c + k * 3) % CANS.length] as readonly [string, string];
        const x = w * (0.1 + c * 0.135);
        const y = h * (0.09 + r * 0.16);
        g.fillStyle = can[1];
        rr(g, x, y, w * 0.1, h * 0.1, 4);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(x, y + h * 0.04, w * 0.1, h * 0.02);
        // 价格 + 按钮
        g.fillStyle = '#222';
        g.fillRect(x, y + h * 0.11, w * 0.1, h * 0.025);
        text(g, r === 0 ? '130' : '160', x + w * 0.05, y + h * 0.122, w * 0.09, h * 0.02, '#ff4a3a', 800);
        g.fillStyle = r === 2 && c > 3 ? '#ff6040' : '#40d0ff';
        g.fillRect(x + w * 0.03, y + h * 0.137, w * 0.04, h * 0.01);
      }
    }
    // 下半部分：投币口、显示、出货口
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(w * 0.06, h * 0.6, w * 0.88, h * 0.02);
    g.fillStyle = '#222';
    g.fillRect(w * 0.66, h * 0.62, w * 0.24, h * 0.12);
    g.fillStyle = '#40ff90';
    g.fillRect(w * 0.69, h * 0.64, w * 0.18, h * 0.03);
    g.fillStyle = '#bbb';
    g.fillRect(w * 0.72, h * 0.69, w * 0.12, h * 0.01);
    text(g, k % 2 ? 'つめた〜い' : 'あったか〜い', w * 0.32, h * 0.66, w * 0.5, h * 0.04, '#fff', 900);
    text(g, k % 2 ? 'COLD DRINK' : 'HOT & COLD', w * 0.32, h * 0.72, w * 0.5, h * 0.03, '#fff', 800);
    g.fillStyle = '#111';
    g.fillRect(w * 0.12, h * 0.82, w * 0.6, h * 0.12);
    g.fillStyle = '#333';
    g.fillRect(w * 0.14, h * 0.84, w * 0.56, h * 0.04);
  };
}

function atm(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#e8e8e4';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#d8202a';
  g.fillRect(0, 0, w, h * 0.22);
  text(g, 'ATM', w * 0.4, h * 0.11, w * 0.6, h * 0.16, '#fff', 900);
  text(g, '24H', w * 0.82, h * 0.11, w * 0.24, h * 0.08, '#fff', 900);
  g.fillStyle = '#1a1a1e';
  g.fillRect(w * 0.08, h * 0.28, w * 0.84, h * 0.36);
  g.fillStyle = '#1e5ab4';
  g.fillRect(w * 0.14, h * 0.31, w * 0.72, h * 0.3);
  text(g, 'いらっしゃいませ', w / 2, h * 0.36, w * 0.6, h * 0.04, '#fff', 800);
  const btn = ['お引出し', 'お預入れ', '残高照会', 'お振込み'];
  btn.forEach((b, i) => {
    const x = w * (0.18 + (i % 2) * 0.34);
    const y = h * (0.41 + Math.floor(i / 2) * 0.09);
    g.fillStyle = '#ffffff';
    rr(g, x, y, w * 0.3, h * 0.065, 10);
    g.fill();
    text(g, b, x + w * 0.15, y + h * 0.033, w * 0.26, h * 0.03, '#1e5ab4', 800);
  });
  g.fillStyle = '#222';
  g.fillRect(w * 0.3, h * 0.78, w * 0.4, h * 0.03);
}

function atmScreen(on: boolean): Draw {
  return (g, w, h) => {
    g.fillStyle = on ? '#2a8a4a' : '#1e5ab4';
    g.fillRect(0, 0, w, h);
    if (on) {
      text(g, 'お取引ありがとうございました', w / 2, h * 0.4, w * 0.9, h * 0.12, '#fff', 800);
      text(g, '残高 ¥ 12,480', w / 2, h * 0.65, w * 0.8, h * 0.14, '#ffe040', 900);
    } else {
      text(g, 'いらっしゃいませ', w / 2, h * 0.16, w * 0.8, h * 0.12, '#fff', 800);
      const btn = ['お引出し', 'お預入れ', '残高照会', 'お振込み'];
      btn.forEach((b, i) => {
        const x = w * (0.06 + (i % 2) * 0.47);
        const y = h * (0.3 + Math.floor(i / 2) * 0.33);
        g.fillStyle = '#ffffff';
        rr(g, x, y, w * 0.41, h * 0.25, 12);
        g.fill();
        text(g, b, x + w * 0.205, y + h * 0.125, w * 0.36, h * 0.12, '#1e5ab4', 800);
      });
    }
  };
}

function lockers(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#1d2a4a';
  g.fillRect(0, 0, w, h * 0.12);
  text(g, '宅配便ロッカー  PARCEL LOCKER', w / 2, h * 0.06, w * 0.92, h * 0.07, '#fff', 900);
  g.fillStyle = '#d4d6d8';
  g.fillRect(0, h * 0.12, w, h * 0.88);
}

function copier(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#f0f0ec';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a2a2e';
  g.fillRect(w * 0.1, h * 0.1, w * 0.5, h * 0.4);
  g.fillStyle = '#3a9ae0';
  g.fillRect(w * 0.13, h * 0.14, w * 0.44, h * 0.32);
  text(g, 'マルチコピー', w * 0.35, h * 0.3, w * 0.4, h * 0.1, '#fff', 800);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = ['#f0c020', '#40c060', '#e04040', '#3a7ae0', '#aaa', '#aaa'][i] as string;
    g.fillRect(w * (0.66 + (i % 2) * 0.14), h * (0.14 + Math.floor(i / 2) * 0.12), w * 0.1, h * 0.08);
  }
  text(g, 'COPY / PRINT / FAX', w / 2, h * 0.75, w * 0.9, h * 0.1, '#555', 800);
}

function roadSigns(g: Ctx2, w: number, h: number, kind: number): void {
  if (kind === 0) {
    // 横断步道（蓝底白三角 + 行人）
    g.fillStyle = '#1e52b4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = w * 0.04;
    g.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(w / 2, h * 0.14);
    g.lineTo(w * 0.86, h * 0.84);
    g.lineTo(w * 0.14, h * 0.84);
    g.fill();
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.arc(w * 0.52, h * 0.38, w * 0.05, 0, 7);
    g.fill();
    g.lineWidth = w * 0.045;
    g.strokeStyle = '#1a1a1a';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.45);
    g.lineTo(w * 0.47, h * 0.62);
    g.lineTo(w * 0.38, h * 0.76);
    g.moveTo(w * 0.47, h * 0.62);
    g.lineTo(w * 0.58, h * 0.76);
    g.moveTo(w * 0.4, h * 0.52);
    g.lineTo(w * 0.6, h * 0.56);
    g.stroke();
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 4; i++) g.fillRect(w * (0.24 + i * 0.14), h * 0.79, w * 0.08, h * 0.03);
  } else if (kind === 1) {
    // P 停车
    g.fillStyle = '#1e52b4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = w * 0.05;
    g.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
    text(g, 'P', w / 2, h * 0.52, w * 0.8, h * 0.8, '#fff', 900);
  } else if (kind === 2) {
    // 地名方向牌
    g.fillStyle = '#1e52b4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    text(g, '夜川町 2-7', w / 2, h * 0.36, w * 0.86, h * 0.3, '#fff', 900);
    text(g, 'Yorukawa-cho 2-7', w / 2, h * 0.72, w * 0.86, h * 0.18, '#fff', 700);
  } else {
    // 限速 30
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.48, 0, 7);
    g.fill();
    g.strokeStyle = '#d8202a';
    g.lineWidth = w * 0.1;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.4, 0, 7);
    g.stroke();
    text(g, '30', w / 2, h * 0.53, w * 0.6, h * 0.5, '#1e52b4', 900);
  }
}

function acFace(g: Ctx2, w: number, h: number): void {
  g.fillStyle = '#e4e4e0';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a3a3a';
  g.beginPath();
  g.arc(w * 0.36, h / 2, h * 0.4, 0, 7);
  g.fill();
  g.strokeStyle = '#9a9a9a';
  g.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.arc(w * 0.36, h / 2, h * (0.06 + i * 0.05), 0, 7);
    g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(w * 0.36 - h * 0.4, h * (0.2 + i * 0.2));
    g.lineTo(w * 0.36 + h * 0.4, h * (0.2 + i * 0.2));
    g.stroke();
  }
  g.fillStyle = '#c8c8c4';
  for (let i = 0; i < 8; i++) g.fillRect(w * 0.8, h * (0.14 + i * 0.09), w * 0.12, h * 0.04);
}

function windowTile(k: number): Draw {
  return (g, w, h) => {
    const lit = k % 3 !== 2;
    g.fillStyle = lit ? (k % 3 ? '#ffd890' : '#ffe8b8') : '#1a2030';
    g.fillRect(0, 0, w, h);
    if (lit) {
      g.fillStyle = k % 2 ? '#e8b060' : '#f0c8a0';
      g.fillRect(0, 0, w * 0.3, h);
      g.fillRect(w * 0.7, 0, w * 0.3, h);
      g.fillStyle = 'rgba(120,80,40,0.35)';
      g.fillRect(w * 0.45, h * 0.5, w * 0.18, h * 0.5);
    } else {
      g.fillStyle = '#2a3448';
      for (let i = 0; i < 8; i++) g.fillRect(0, h * (i / 8), w, h * 0.06);
    }
    g.fillStyle = '#3a3a40';
    g.fillRect(w * 0.48, 0, w * 0.04, h);
  };
}

/** 远景城市剪影：一圈楼 + 亮着的窗 */
export function skyline(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 4096;
  c.height = 512;
  const g = c.getContext('2d') as Ctx2;
  g.clearRect(0, 0, c.width, c.height);
  seed = 99;
  for (let layer = 0; layer < 2; layer++) {
    let x = 0;
    while (x < c.width) {
      const bw = 60 + rnd() * 160;
      const bh = (layer ? 120 : 220) + rnd() * (layer ? 160 : 260);
      const top = c.height - bh;
      g.fillStyle = layer ? '#141a2c' : '#0c1020';
      g.fillRect(x, top, bw, bh);
      for (let wy = top + 10; wy < c.height - 10; wy += 14) {
        for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          if (rnd() < 0.18) {
            g.fillStyle = rnd() < 0.7 ? '#f0c878' : '#9ad0f0';
            g.globalAlpha = layer ? 0.9 : 0.55;
            g.fillRect(wx, wy, 6, 7);
            g.globalAlpha = 1;
          }
        }
      }
      if (rnd() < 0.15) {
        g.fillStyle = '#ff3030';
        g.fillRect(x + bw / 2 - 2, top - 6, 4, 4);
      }
      x += bw + rnd() * 20;
    }
  }
  return c;
}

/** 构建全部贴图 */
export function buildAtlas(): Atlas {
  seed = 1234567;
  const A = new Atlas();
  A.add('white', 8, 8, (g, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
  });
  A.add('sign', 1536, 192, mainSign);
  A.add('poleSign', 256, 512, poleSign);
  A.add('h24', 256, 128, (g, w, h) => {
    g.fillStyle = '#1d3d8f';
    g.fillRect(0, 0, w, h);
    text(g, 'OPEN', w / 2, h * 0.3, w * 0.8, h * 0.3, '#ffd448', 900);
    text(g, '24 HOURS', w / 2, h * 0.7, w * 0.86, h * 0.28, '#fff', 900);
  });
  SNACKS.forEach(([n, c], i) => A.add(`snack${i}`, 128, 160, snackBag(n, c)));
  BREADS.forEach(([n, c], i) => A.add(`bread${i}`, 128, 128, bread(n, c)));
  BOTTLES.forEach(([n, c, k], i) => A.add(`bottle${i}`, 256, 64, bottleLabel(n, c, k)));
  CANS.forEach(([n, c], i) => A.add(`can${i}`, 192, 96, canLabel(n, c)));
  ONIGIRI.forEach((n, i) => A.add(`onigiri${i}`, 112, 96, onigiri(n)));
  BENTO.forEach((n, i) => A.add(`bento${i}`, 192, 128, bentoTop(n, i)));
  NOODLES.forEach(([n, c], i) => A.add(`noodle${i}`, 256, 64, noodle(n, c)));
  MAGAZINES.forEach((n, i) => A.add(`mag${i}`, 112, 150, magazine(n, i)));
  SWEETS.forEach(([n, c], i) => A.add(`sweet${i}`, 112, 80, smallPack(n, c)));
  DAILY.forEach(([n, c], i) => A.add(`daily${i}`, 112, 112, smallPack(n, c)));
  CATS.forEach((n, i) => A.add(`cat${i}`, 384, 72, catSign(n, i)));
  A.add('price', 1024, 36, priceRail);
  for (let i = 0; i < 6; i++) A.add(`poster${i}`, 240, 360, poster(i));
  for (let i = 0; i < 4; i++) A.add(`notice${i}`, 160, 220, notice(i));
  for (let i = 0; i < 2; i++) A.add(`vend${i}`, 384, 768, vending(i));
  A.add('atm', 256, 384, atm);
  A.add('atmScr0', 256, 160, atmScreen(false));
  A.add('atmScr1', 256, 160, atmScreen(true));
  A.add('lockers', 384, 512, lockers);
  A.add('copier', 256, 160, copier);
  for (let i = 0; i < 4; i++) A.add(`road${i}`, i === 2 ? 384 : 160, 160, (g, w, h) => roadSigns(g, w, h, i));
  A.add('ac', 192, 144, acFace);
  for (let i = 0; i < 6; i++) A.add(`win${i}`, 96, 128, windowTile(i));
  A.add('mat', 384, 128, (g, w, h) => {
    g.fillStyle = '#1a2a48';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a3e66';
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    text(g, 'WELCOME', w / 2, h / 2, w * 0.8, h * 0.44, '#3a5a90', 900);
  });
  A.add('door', 256, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#24b0a0';
    rr(g, w * 0.1, h * 0.15, w * 0.8, h * 0.7, 12);
    g.fill();
    text(g, '自動ドア', w / 2, h / 2, w * 0.7, h * 0.4, '#fff', 900);
  });
  A.add('hot', 384, 64, (g, w, h) => {
    g.fillStyle = '#d8202a';
    g.fillRect(0, 0, w, h);
    text(g, 'あったか〜い  HOT', w / 2, h / 2, w * 0.9, h * 0.6, '#fff', 900);
  });
  A.add('coffee', 192, 192, (g, w, h) => {
    g.fillStyle = '#2a1a12';
    g.fillRect(0, 0, w, h);
    text(g, 'CAFE', w / 2, h * 0.18, w * 0.8, h * 0.16, '#f2a040', 900);
    ['ホット S', 'ホット L', 'アイス S', 'カフェラテ'].forEach((s, i) => {
      g.fillStyle = i < 2 ? '#c83a2a' : '#2a6ac8';
      rr(g, w * 0.1, h * (0.34 + i * 0.15), w * 0.8, h * 0.12, 8);
      g.fill();
      text(g, s, w / 2, h * (0.4 + i * 0.15), w * 0.7, h * 0.08, '#fff', 800);
    });
  });
  A.add('regi', 256, 96, (g, w, h) => {
    g.fillStyle = '#2a9a5a';
    g.fillRect(0, 0, w, h);
    text(g, 'レジ', w * 0.4, h / 2, w * 0.5, h * 0.62, '#fff', 900);
    text(g, 'REGISTER', w * 0.8, h * 0.5, w * 0.3, h * 0.2, '#e0ffe8', 800);
  });
  A.add('regScr', 128, 96, (g, w, h) => {
    g.fillStyle = '#103050';
    g.fillRect(0, 0, w, h);
    text(g, '合計', w * 0.3, h * 0.3, w * 0.4, h * 0.2, '#9ad0ff', 800);
    text(g, '¥ 0', w * 0.65, h * 0.62, w * 0.6, h * 0.3, '#40ff90', 900);
  });
  A.add('cigs', 512, 256, (g, w, h) => {
    g.fillStyle = '#222';
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 16; c++) {
        g.fillStyle = `hsl(${(c * 37 + r * 71) % 360},${30 + ((c * 13) % 50)}%,${40 + ((r * 17 + c * 7) % 40)}%)`;
        g.fillRect(c * (w / 16) + 3, r * (h / 6) + 4, w / 16 - 6, h / 6 - 14);
        g.fillStyle = '#ffffff';
        g.fillRect(c * (w / 16) + 3, r * (h / 6) + h / 6 - 9, w / 16 - 6, 6);
      }
    }
  });
  A.add('trash', 384, 64, (g, w, h) => {
    const t = [
      ['燃えるゴミ', '#d8402a'],
      ['缶・びん', '#2a6ac8'],
      ['ペットボトル', '#2a9a5a'],
    ];
    t.forEach(([s, c], i) => {
      g.fillStyle = c as string;
      g.fillRect((i * w) / 3, 0, w / 3, h);
      text(g, s as string, ((i + 0.5) * w) / 3, h / 2, w / 3 - 12, h * 0.42, '#fff', 900);
    });
  });
  A.add('plate', 128, 64, (g, w, h) => {
    g.fillStyle = '#f4f4ea';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a6a3a';
    g.lineWidth = 4;
    g.strokeRect(3, 3, w - 6, h - 6);
    text(g, '夜川 500', w / 2, h * 0.28, w * 0.7, h * 0.22, '#2a6a3a', 800);
    text(g, 'さ 12-07', w / 2, h * 0.66, w * 0.86, h * 0.4, '#2a6a3a', 900);
  });
  A.add('oden', 256, 128, (g, w, h) => {
    g.fillStyle = '#c89a50';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) + 0.5) * (w / 3);
      const y = (Math.floor(i / 3) + 0.5) * (h / 3);
      g.fillStyle = '#8a5a20';
      g.fillRect(x - w / 6 + 2, y - h / 6 + 2, w / 3 - 4, h / 3 - 4);
      g.fillStyle = ['#f4f0e0', '#e8b060', '#a86a3a', '#f6e8a0', '#d89a60', '#ffffff', '#c8702a', '#f0d8a0', '#e8c080'][i] as string;
      g.beginPath();
      g.ellipse(x, y, w / 10, h / 9, i, 0, 7);
      g.fill();
    }
  });
  A.add('ice', 256, 128, (g, w, h) => {
    g.fillStyle = '#e8f4ff';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i++) {
      g.fillStyle = `hsl(${(i * 53) % 360},70%,${55 + (i % 3) * 10}%)`;
      g.fillRect((i % 8) * (w / 8) + 3, Math.floor(i / 8) * (h / 3) + 4, w / 8 - 6, h / 3 - 8);
      g.fillStyle = '#fff';
      g.fillRect((i % 8) * (w / 8) + 6, Math.floor(i / 8) * (h / 3) + 12, w / 8 - 12, 5);
    }
  });
  A.add('sale', 256, 160, (g, w, h) => {
    g.fillStyle = '#1d3d8f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.strokeRect(8, 8, w - 16, h - 16);
    text(g, '2個で10%OFF', w / 2, h * 0.42, w * 0.86, h * 0.3, '#fff', 900);
    text(g, 'SALE', w / 2, h * 0.74, w * 0.5, h * 0.2, '#ffd448', 900);
  });
  A.add('queue', 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#2a9a5a';
    rr(g, 4, 4, w - 8, h - 8, 20);
    g.fill();
    // 脚印
    g.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(w * 0.22 + s * 18, h * 0.5, 12, 26, 0, 0, 7);
      g.fill();
    }
    text(g, 'こちらにお並びください', w * 0.62, h * 0.5, w * 0.62, h * 0.18, '#fff', 800);
  });
  A.add('exit', 192, 64, (g, w, h) => {
    g.fillStyle = '#2aa85a';
    g.fillRect(0, 0, w, h);
    text(g, '非常口  EXIT', w / 2, h / 2, w * 0.9, h * 0.5, '#fff', 900);
  });
  A.add('staff', 192, 64, (g, w, h) => {
    g.fillStyle = '#3a3a40';
    g.fillRect(0, 0, w, h);
    text(g, 'STAFF ONLY', w / 2, h / 2, w * 0.86, h * 0.5, '#fff', 900);
  });
  A.add('wc', 192, 64, (g, w, h) => {
    g.fillStyle = '#2a6ac8';
    g.fillRect(0, 0, w, h);
    text(g, 'トイレ  WC', w / 2, h / 2, w * 0.86, h * 0.5, '#fff', 900);
  });
  A.add('menu', 256, 96, (g, w, h) => {
    g.fillStyle = '#fff8e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8202a';
    g.fillRect(0, 0, w, h * 0.3);
    text(g, 'ホットスナック', w / 2, h * 0.15, w * 0.9, h * 0.22, '#fff', 900);
    text(g, 'からあげ  ¥238', w / 2, h * 0.5, w * 0.8, h * 0.18, '#333', 800);
    text(g, 'フランク  ¥150', w / 2, h * 0.76, w * 0.8, h * 0.18, '#333', 800);
  });
  A.add('noodleShelf', 256, 64, (g, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
  });
  A.add('clock', 128, 128, (g, w, h) => {
    g.fillStyle = '#fafafa';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.48, 0, 7);
    g.fill();
    g.strokeStyle = '#333';
    g.lineWidth = 4;
    g.stroke();
    g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.sin(a) * w * 0.38, h / 2 - Math.cos(a) * h * 0.38);
      g.lineTo(w / 2 + Math.sin(a) * w * 0.43, h / 2 - Math.cos(a) * h * 0.43);
      g.stroke();
    }
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + w * 0.2, h / 2 + h * 0.08);
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 - w * 0.05, h / 2 - h * 0.32);
    g.stroke();
  });
  return A;
}
