import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** 地面用的可平铺贴图（程序绘制） */

let s = 77;
const rnd = (): number => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};

function make(size: number, draw: (g: CanvasRenderingContext2D, n: number) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  draw(g, size);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 在 n×n 画布上撒点（可平铺：越界的点在对边再画一次） */
function speckle(g: CanvasRenderingContext2D, n: number, count: number, rmax: number, colors: string[]): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const r = 0.5 + rnd() * rmax;
    g.fillStyle = colors[Math.floor(rnd() * colors.length)] as string;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) g.fillRect(x + dx, y + dy, r, r);
  }
}

export function asphaltTex(): CanvasTexture {
  s = 11;
  return make(512, (g, n) => {
    g.fillStyle = '#4a4e58';
    g.fillRect(0, 0, n, n);
    speckle(g, n, 9000, 1.6, ['#3e424c', '#565a64', '#5e626c', '#383c46']);
    speckle(g, n, 500, 2.4, ['#6a6e78', '#30343c']);
    // 补丁和裂缝
    g.fillStyle = 'rgba(30,32,40,0.35)';
    g.fillRect(n * 0.1, n * 0.55, n * 0.32, n * 0.2);
    g.strokeStyle = 'rgba(25,26,32,0.6)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      let x = rnd() * n;
      let y = rnd() * n;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < 10; i++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.3) * 24;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** 人行道的方砖（每张 = 1.2 m，4×4 块） */
export function paverTex(): CanvasTexture {
  s = 23;
  return make(512, (g, n) => {
    g.fillStyle = '#6c6a66';
    g.fillRect(0, 0, n, n);
    const k = n / 4;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const v = 128 + Math.floor((rnd() - 0.5) * 26);
        g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`;
        g.fillRect(i * k + 3, j * k + 3, k - 6, k - 6);
      }
    }
    speckle(g, n, 3000, 1.3, ['rgba(70,68,64,0.5)', 'rgba(170,168,160,0.4)']);
  });
}

/** 停车场 / 店前的水泥地（每张 = 3 m，带伸缩缝） */
export function concreteTex(): CanvasTexture {
  s = 37;
  return make(512, (g, n) => {
    g.fillStyle = '#8a8a88';
    g.fillRect(0, 0, n, n);
    speckle(g, n, 6000, 1.5, ['#7e7e7c', '#969694', '#848482']);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,60,60,${0.03 + rnd() * 0.05})`;
      g.beginPath();
      g.ellipse(rnd() * n, rnd() * n, 20 + rnd() * 60, 10 + rnd() * 40, rnd() * 3, 0, 7);
      g.fill();
    }
    g.fillStyle = '#5a5a5a';
    g.fillRect(0, 0, n, 3);
    g.fillRect(0, 0, 3, n);
  });
}

/** 店内地砖（每张 = 1.2 m，2×2 块） */
export function storeTileTex(): CanvasTexture {
  s = 41;
  return make(256, (g, n) => {
    g.fillStyle = '#b8b2a6';
    g.fillRect(0, 0, n, n);
    const k = n / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#ece6da' : '#e2dccf';
        g.fillRect(i * k + 2, j * k + 2, k - 4, k - 4);
      }
    }
    speckle(g, n, 600, 1, ['rgba(160,150,140,0.35)']);
  });
}

/** 后场、小巷的旧水泥 */
export function oldConcreteTex(): CanvasTexture {
  s = 53;
  return make(512, (g, n) => {
    g.fillStyle = '#6a6c6c';
    g.fillRect(0, 0, n, n);
    speckle(g, n, 7000, 1.8, ['#5e6060', '#767878', '#545656']);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(30,40,30,${0.04 + rnd() * 0.08})`;
      g.beginPath();
      g.ellipse(rnd() * n, rnd() * n, 10 + rnd() * 50, 6 + rnd() * 30, rnd() * 3, 0, 7);
      g.fill();
    }
  });
}

/** 楼房外墙：瓷砖墙面 */
export function wallTex(base: string, line: string, bw = 8, bh = 16): CanvasTexture {
  s = 61;
  return make(256, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    g.fillStyle = line;
    for (let y = 0; y < n; y += bh) g.fillRect(0, y, n, 1);
    for (let y = 0; y < n; y += bh) for (let x = (y / bh) % 2 ? bw / 2 : 0; x < n; x += bw * 4) g.fillRect(x, y, 1, bh);
    speckle(g, n, 800, 1.5, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.05)']);
    // 雨水留下的竖向污渍
    for (let i = 0; i < 14; i++) {
      const x = rnd() * n;
      const gr = g.createLinearGradient(0, 0, 0, n);
      gr.addColorStop(0, 'rgba(0,0,0,0.12)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + rnd() * 6, n * (0.3 + rnd() * 0.7));
    }
  });
}

/** 夜空背景：竖向渐变 */
export function skyTex(top: string, bottom: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
