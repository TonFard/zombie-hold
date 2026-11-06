<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { hud, radar } from '../hud';

/** 雷达：玩家在中心，视线方向朝上。第一人称看不到身后，全靠它掌握四周的僵尸 */
const SIZE = 168;
const R = SIZE / 2 - 4;
/** 圆边对应多少米 */
const RANGE = 26;
const PX = R / RANGE;
const GRID_W = 80;
const HALF = 40;

const cv = ref<HTMLCanvasElement | null>(null);
let raf = 0;

const ZOMBIE_STYLE = [
  { c: '#ff5a4a', r: 2.6 }, // walker
  { c: '#ffa23a', r: 2.6 }, // runner
  { c: '#b6e04a', r: 4 }, // bloater
  { c: '#ff2f6a', r: 4 }, // breaker
  { c: '#e05cff', r: 6 }, // colossus
  { c: '#9aff3a', r: 3.2 }, // spitter
  { c: '#ff6af0', r: 3.2 }, // screamer
  { c: '#4aa8ff', r: 3.4 }, // 团队死斗：队友
  { c: '#ff4a3a', r: 3.4 }, // 团队死斗：开过枪的敌人
];
const STRUCT_COLOR = ['#c9a24a', '#6fd0e8', '#b0623a'];

function draw(): void {
  raf = requestAnimationFrame(draw);
  const c = cv.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const dpr = c.width / SIZE;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const yaw = radar.yaw;
  const sy = Math.sin(yaw);
  const cyaw = Math.cos(yaw);

  /** 世界坐标 → 雷达上的像素偏移（视线朝上，右手边朝右） */
  const proj = (x: number, z: number): [number, number] => {
    const dx = x - radar.px;
    const dz = z - radar.pz;
    return [(-cyaw * dx + sy * dz) * PX, -(sy * dx + cyaw * dz) * PX];
  };
  /** 超出范围的点贴到圆边上 */
  const clampEdge = (p: [number, number], pad: number): [number, number, boolean] => {
    const d = Math.hypot(p[0], p[1]);
    const lim = R - pad;
    if (d <= lim) return [p[0], p[1], false];
    return [(p[0] / d) * lim, (p[1] / d) * lim, true];
  };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  // 底盘
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9, 13, 18, 0.62)';
  ctx.fill();

  ctx.save();
  ctx.clip();

  // 地形：把阻挡格画成暗色块
  const solid = radar.solid;
  if (solid) {
    ctx.setTransform(dpr * -cyaw * PX, dpr * -sy * PX, dpr * sy * PX, dpr * -cyaw * PX, dpr * cx, dpr * cy);
    // 平移到玩家位置：世界坐标减去玩家坐标
    ctx.translate(-radar.px, -radar.pz);
    const x0 = Math.max(0, Math.floor(radar.px + HALF - RANGE - 1));
    const x1 = Math.min(GRID_W - 1, Math.ceil(radar.px + HALF + RANGE + 1));
    const z0 = Math.max(0, Math.floor(radar.pz + HALF - RANGE - 1));
    const z1 = Math.min(GRID_W - 1, Math.ceil(radar.pz + HALF + RANGE + 1));
    ctx.beginPath();
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (solid[gz * GRID_W + gx]) ctx.rect(gx - HALF, gz - HALF, 1.02, 1.02);
      }
    }
    ctx.fillStyle = 'rgba(150, 165, 180, 0.28)';
    ctx.fill();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 视野扇形
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, -Math.PI / 2 - 0.92, -Math.PI / 2 + 0.92);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fill();

  // 距离圈
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1;
  for (const k of [0.33, 0.66]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * k, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 建筑
  const st = radar.structs;
  for (let i = 0; i < st.length; i += 3) {
    const [x, y] = proj(st[i] as number, st[i + 1] as number);
    if (Math.hypot(x, y) > R) continue;
    ctx.fillStyle = STRUCT_COLOR[st[i + 2] as number] ?? '#c9a24a';
    const s = st[i + 2] === 2 ? 2.4 : 3.6;
    ctx.fillRect(cx + x - s / 2, cy + y - s / 2, s, s);
  }

  // 零件箱
  ctx.fillStyle = '#f0b83a';
  const bx = radar.boxes;
  for (let i = 0; i < bx.length; i += 2) {
    const [x, y] = proj(bx[i] as number, bx[i + 1] as number);
    if (Math.hypot(x, y) > R - 3) continue;
    ctx.beginPath();
    ctx.arc(cx + x, cy + y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 搜刮点（M18）：普通点是黄色空心菱形，危险区是红色三角；超出范围时危险区贴边提示
  const lt = radar.loot;
  for (let i = 0; i < lt.length; i += 3) {
    const danger = lt[i + 2] === 1;
    let p = proj(lt[i] as number, lt[i + 1] as number);
    if (Math.hypot(p[0], p[1]) > R - 5) {
      if (!danger) continue;
      const e = clampEdge(p, 7);
      p = [e[0], e[1]];
    }
    ctx.save();
    ctx.translate(cx + p[0], cy + p[1]);
    if (danger) {
      ctx.fillStyle = '#e8553f';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4.5, 3.5);
      ctx.lineTo(-4.5, 3.5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = '#f0b83a';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-3, -3, 6, 6);
    }
    ctx.restore();
  }

  // 工坊
  {
    const [x, y] = proj(radar.benchX, radar.benchZ);
    if (Math.hypot(x, y) <= R - 4) {
      ctx.strokeStyle = '#e6dcc0';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx + x - 3.5, cy + y - 3.5, 7, 7);
    }
  }

  // 发电机：超出范围时贴在圆边提示方向
  {
    const [x, y, edge] = clampEdge(proj(radar.coreX, radar.coreZ), 7);
    ctx.save();
    ctx.translate(cx + x, cy + y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = edge ? 'rgba(111, 208, 232, 0.75)' : '#6fe3ff';
    ctx.shadowColor = '#6fe3ff';
    ctx.shadowBlur = 8;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }

  // 僵尸：范围内画点，首领超出范围时贴边提示
  const zs = radar.zombies;
  for (let i = 0; i < zs.length; i += 3) {
    const code = zs[i + 2] as number;
    const style = ZOMBIE_STYLE[code] ?? (ZOMBIE_STYLE[0] as { c: string; r: number });
    const p = proj(zs[i] as number, zs[i + 1] as number);
    const d = Math.hypot(p[0], p[1]);
    // 浓雾夜：雷达只看得到一半距离内的僵尸
    if (hud.radarScale < 1 && d > R * hud.radarScale) continue;
    if (d > R - style.r) {
      if (code !== 4) continue;
      const [x, y] = clampEdge(p, 8);
      ctx.fillStyle = style.c;
      ctx.beginPath();
      ctx.arc(cx + x, cy + y, 4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = style.c;
    ctx.beginPath();
    ctx.arc(cx + p[0], cy + p[1], style.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 浓雾夜：虚线标出雷达实际看得到的范围
  if (hud.radarScale < 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * hud.radarScale, 0, Math.PI * 2);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(200, 210, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();

  // 玩家（箭头）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 4.5, cy + 4.5);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx - 4.5, cy + 4.5);
  ctx.closePath();
  ctx.fill();

  // 外圈：细环 + 随朝向转动的方位刻度，北方（地图 -Z）标 N
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 北方在雷达上的方向：proj(x, z - 1) 的偏移方向 = (-sin yaw, cos yaw)
  const nAng = Math.atan2(cyaw, -sy);
  for (let k = 0; k < 12; k++) {
    const a = nAng + (k * Math.PI) / 6;
    const len = k % 3 === 0 ? 6 : 3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + ca * R, cy + sa * R);
    ctx.lineTo(cx + ca * (R - len), cy + sa * (R - len));
    ctx.strokeStyle = k === 0 ? 'rgba(240, 184, 58, 0.95)' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = k === 0 ? 2 : 1;
    ctx.stroke();
  }
  ctx.font = '600 11px Bahnschrift, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0b83a';
  ctx.fillText('N', cx + Math.cos(nAng) * (R - 14), cy + Math.sin(nAng) * (R - 14));
  // 视线方向：外圈顶上一个固定的小三角
  ctx.beginPath();
  ctx.moveTo(cx, cy - R + 3);
  ctx.lineTo(cx - 4, cy - R - 2);
  ctx.lineTo(cx + 4, cy - R - 2);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

onMounted(() => {
  const c = cv.value;
  if (c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
  }
  raf = requestAnimationFrame(draw);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas ref="cv" class="radar" :style="{ width: SIZE + 'px', height: SIZE + 'px' }"></canvas>
</template>

<style scoped>
.radar {
  position: absolute;
  right: 24px;
  top: 18px;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}
</style>
