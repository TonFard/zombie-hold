import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../../game/core/rng';
import { GRID_H, GRID_W, Ground, type Grid } from '../../game/world/grid';

/** 每格像素数。80×80 格 → 1280×1280 的地面贴图 */
const PPC = 16;
const SIZE = GRID_W * PPC;

// ---- 值噪声（带种子）----
function makeNoise(seed: number) {
  const rng = new Rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    vals[i] = rng.next();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = perm[i] as number;
    perm[i] = perm[j] as number;
    perm[j] = t;
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i] as number;
  const at = (x: number, y: number) => vals[(perm[((x & 255) + (perm[y & 255] as number)) & 511] as number) & 255] as number;
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
  return { noise, fbm };
}

type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

const PAL: Record<number, { a: RGB; b: RGB }> = {
  [Ground.Grass]: { a: hex(0x4b5530), b: hex(0x6e7243) },
  [Ground.Dirt]: { a: hex(0x5a4a38), b: hex(0x7a6850) },
  [Ground.Asphalt]: { a: hex(0x34363a), b: hex(0x4a4c50) },
  [Ground.Concrete]: { a: hex(0x6a6c6e), b: hex(0x8e9092) },
  [Ground.Floor]: { a: hex(0x4f3b2b), b: hex(0x6b5139) },
  [Ground.Gravel]: { a: hex(0x6b665c), b: hex(0x8d877a) },
};

export function makeGroundTexture(grid: Grid, anisotropy: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D;
  const rng = new Rng(4242);
  const { noise, fbm } = makeNoise(77);

  // ---------- 1. 逐像素底色：边界用噪声扭曲，过渡自然 ----------
  const img = ctx.createImageData(SIZE, SIZE);
  const data = img.data;
  const groundAt = (gx: number, gy: number): number => {
    const cx = Math.min(GRID_W - 1, Math.max(0, Math.floor(gx)));
    const cy = Math.min(GRID_H - 1, Math.max(0, Math.floor(gy)));
    return grid.ground[cy * GRID_W + cx] as number;
  };
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const gx = px / PPC;
      const gy = py / PPC;
      const wx = gx + (noise(gx * 1.6, gy * 1.6) - 0.5) * 0.9;
      const wy = gy + (noise(gx * 1.6 + 40, gy * 1.6 + 40) - 0.5) * 0.9;
      const g = groundAt(wx, wy);
      const pal = PAL[g] as { a: RGB; b: RGB };
      const n1 = fbm(gx * 0.9, gy * 0.9);
      const n2 = noise(gx * 7, gy * 7);
      let t = n1 * 0.8 + n2 * 0.25;
      let k = 1;
      // 各地面的专属纹理
      if (g === Ground.Concrete) {
        // 伸缩缝：每 4 格一条
        const jx = px % (PPC * 4);
        const jy = py % (PPC * 4);
        if (jx < 1 || jy < 1) k *= 0.72;
        t = t * 0.7 + noise(gx * 14, gy * 14) * 0.15;
      } else if (g === Ground.Floor) {
        // 木地板：横向条板，错缝
        const row = Math.floor(py / 6);
        const off = ((row * 37) % 5) * 3;
        const seam = (px + off) % 48;
        if (py % 6 === 0 || seam === 0) k *= 0.62;
        k *= 0.88 + ((row * 131 + Math.floor((px + off) / 48) * 71) % 17) / 17 * 0.24;
      } else if (g === Ground.Asphalt) {
        t = t * 0.6 + noise(gx * 18, gy * 18) * 0.4;
      } else if (g === Ground.Gravel) {
        t = noise(gx * 24, gy * 24) * 0.6 + n1 * 0.4;
      } else if (g === Ground.Grass) {
        // 草丛：中频噪声做出深浅斑块
        t = t * 0.6 + noise(gx * 3.1, gy * 3.1) * 0.5;
      }
      const grain = 0.94 + rng.next() * 0.12;
      const i = (py * SIZE + px) * 4;
      data[i] = (pal.a[0] + (pal.b[0] - pal.a[0]) * t) * k * grain;
      data[i + 1] = (pal.a[1] + (pal.b[1] - pal.a[1]) * t) * k * grain;
      data[i + 2] = (pal.a[2] + (pal.b[2] - pal.a[2]) * t) * k * grain;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const cell = (v: number) => v * PPC;
  const isGround = (gx: number, gy: number, g: number) => groundAt(gx, gy) === g;

  // ---------- 2. 路面标线 ----------
  ctx.save();
  ctx.lineCap = 'butt';
  // 道路中线（黄色虚线）
  ctx.strokeStyle = 'rgba(214,170,50,0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([cell(1.4), cell(1.2)]);
  for (const [x0, y0, x1, y1] of [
    [40, 2, 40, 25.6],
    [40, 54.4, 40, 78],
    [2, 40, 25.6, 40],
    [54.4, 40, 78, 40],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cell(x0), cell(y0));
    ctx.lineTo(cell(x1), cell(y1));
    ctx.stroke();
  }
  // 道路边线（白色实线，略微磨损）
  ctx.setLineDash([cell(5), cell(0.3), cell(3), cell(0.2)]);
  ctx.strokeStyle = 'rgba(215,212,200,0.55)';
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [
    [38.15, 2, 38.15, 25.6],
    [41.85, 2, 41.85, 25.6],
    [38.15, 54.4, 38.15, 78],
    [41.85, 54.4, 41.85, 78],
    [2, 38.15, 25.6, 38.15],
    [2, 41.85, 25.6, 41.85],
    [54.4, 38.15, 78, 38.15],
    [54.4, 41.85, 78, 41.85],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cell(x0), cell(y0));
    ctx.lineTo(cell(x1), cell(y1));
    ctx.stroke();
  }
  // 停车场车位线
  ctx.setLineDash([cell(2.2), cell(0.25), cell(1.2), cell(0.2)]);
  ctx.strokeStyle = 'rgba(205,203,190,0.24)';
  ctx.lineWidth = 2;
  for (const y of [57.2, 62.2, 67.2, 72.2]) {
    ctx.beginPath();
    ctx.moveTo(cell(4.2), cell(y));
    ctx.lineTo(cell(31.8), cell(y));
    ctx.stroke();
  }
  for (const y of [57.2, 62.2, 67.2]) {
    for (let x = 6.2; x < 32; x += 3) {
      ctx.beginPath();
      ctx.moveTo(cell(x), cell(y));
      ctx.lineTo(cell(x), cell(y + 5));
      ctx.stroke();
    }
  }
  // 内院：发电机基座和安全黄线
  ctx.strokeStyle = 'rgba(214,170,50,0.7)';
  ctx.lineWidth = 3;
  ctx.setLineDash([cell(0.6), cell(0.4)]);
  ctx.strokeRect(cell(36.6), cell(35.6), cell(6.8), cell(6.8));
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(214,170,50,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cell(27.6), cell(27.6), cell(24.8), cell(24.8));
  // 工坊前的工作区
  ctx.fillStyle = 'rgba(30,30,28,0.35)';
  ctx.fillRect(cell(44.5), cell(30.5), cell(4), cell(3.2));
  ctx.restore();

  // ---------- 3. 裂缝、油渍、血迹、轮胎印 ----------
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const gx = rng.range(3, 77);
    const gy = rng.range(3, 77);
    const g = groundAt(gx, gy);
    if (g !== Ground.Asphalt && g !== Ground.Concrete) continue;
    ctx.strokeStyle = `rgba(14,14,14,${rng.range(0.35, 0.65)})`;
    ctx.lineWidth = rng.range(1, 2.2);
    ctx.beginPath();
    let x = cell(gx);
    let y = cell(gy);
    ctx.moveTo(x, y);
    const a0 = rng.range(0, 6.28);
    for (let s = 0; s < rng.int(5, 12); s++) {
      const a = a0 + rng.range(-0.7, 0.7);
      x += Math.cos(a) * rng.range(6, 18);
      y += Math.sin(a) * rng.range(6, 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 油渍
  for (let i = 0; i < 40; i++) {
    const gx = rng.range(3, 77);
    const gy = rng.range(3, 77);
    const g = groundAt(gx, gy);
    if (g !== Ground.Asphalt && g !== Ground.Concrete && g !== Ground.Gravel) continue;
    const r = cell(rng.range(0.4, 1.3));
    const grad = ctx.createRadialGradient(cell(gx), cell(gy), 0, cell(gx), cell(gy), r);
    grad.addColorStop(0, 'rgba(12,10,8,0.5)');
    grad.addColorStop(1, 'rgba(12,10,8,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cell(gx), cell(gy), r, r * rng.range(0.6, 1), rng.range(0, 3), 0, 6.28);
    ctx.fill();
  }
  // 干涸的血迹：集中在入口附近，暗示发生过什么
  for (const [gx, gy] of [
    [40, 24],
    [52, 40],
    [28, 40],
    [38, 56],
    [41, 32],
    [33, 45],
    [47, 36],
  ] as const) {
    for (let k = 0; k < 6; k++) {
      const x = cell(gx + rng.range(-1.5, 1.5));
      const y = cell(gy + rng.range(-1.5, 1.5));
      const r = cell(rng.range(0.15, 0.55));
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(70,14,10,0.55)');
      grad.addColorStop(1, 'rgba(70,14,10,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.28);
      ctx.fill();
    }
  }
  // 轮胎印
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(14,14,14,0.28)';
  for (let i = 0; i < 16; i++) {
    const gx = rng.range(4, 76);
    const gy = rng.range(4, 76);
    if (!isGround(gx, gy, Ground.Asphalt) && !isGround(gx, gy, Ground.Gravel)) continue;
    const a = rng.range(0, 6.28);
    const len = cell(rng.range(3, 8));
    const curve = rng.range(-0.5, 0.5);
    for (const off of [-3, 3]) {
      ctx.beginPath();
      ctx.moveTo(cell(gx) + off, cell(gy));
      ctx.quadraticCurveTo(cell(gx) + Math.cos(a) * len * 0.5 + off, cell(gy) + Math.sin(a + curve) * len * 0.5, cell(gx) + Math.cos(a) * len + off, cell(gy) + Math.sin(a) * len);
      ctx.stroke();
    }
  }
  ctx.restore();

  // ---------- 4. 草丛点缀 ----------
  for (let i = 0; i < 2600; i++) {
    const gx = rng.range(0, GRID_W);
    const gy = rng.range(0, GRID_H);
    if (!isGround(gx, gy, Ground.Grass)) continue;
    const light = rng.chance(0.5);
    ctx.strokeStyle = light ? 'rgba(130,140,80,0.5)' : 'rgba(40,50,25,0.5)';
    ctx.lineWidth = 1;
    const x = cell(gx);
    const y = cell(gy);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 7));
    ctx.stroke();
  }

  // ---------- 5. 接触阴影：所有障碍物脚下压暗（烘焙环境光遮蔽）----------
  const ao = document.createElement('canvas');
  ao.width = SIZE;
  ao.height = SIZE;
  const actx = ao.getContext('2d') as CanvasRenderingContext2D;
  actx.fillStyle = '#000';
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      if (grid.solid[cy * GRID_W + cx] === 1) actx.fillRect(cx * PPC - 1, cy * PPC - 1, PPC + 2, PPC + 2);
    }
  }
  const blurred = document.createElement('canvas');
  blurred.width = SIZE;
  blurred.height = SIZE;
  const bctx = blurred.getContext('2d') as CanvasRenderingContext2D;
  bctx.filter = 'blur(9px)';
  bctx.drawImage(ao, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();

  // ---------- 6. 地图边缘压暗 ----------
  const edge = ctx.createLinearGradient(0, 0, 0, cell(5));
  edge.addColorStop(0, 'rgba(10,10,8,0.9)');
  edge.addColorStop(1, 'rgba(10,10,8,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, SIZE, cell(5));
  const edge2 = ctx.createLinearGradient(0, SIZE, 0, SIZE - cell(5));
  edge2.addColorStop(0, 'rgba(10,10,8,0.9)');
  edge2.addColorStop(1, 'rgba(10,10,8,0)');
  ctx.fillStyle = edge2;
  ctx.fillRect(0, SIZE - cell(5), SIZE, cell(5));
  const edge3 = ctx.createLinearGradient(0, 0, cell(5), 0);
  edge3.addColorStop(0, 'rgba(10,10,8,0.9)');
  edge3.addColorStop(1, 'rgba(10,10,8,0)');
  ctx.fillStyle = edge3;
  ctx.fillRect(0, 0, cell(5), SIZE);
  const edge4 = ctx.createLinearGradient(SIZE, 0, SIZE - cell(5), 0);
  edge4.addColorStop(0, 'rgba(10,10,8,0.9)');
  edge4.addColorStop(1, 'rgba(10,10,8,0)');
  ctx.fillStyle = edge4;
  ctx.fillRect(SIZE - cell(5), 0, cell(5), SIZE);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}
