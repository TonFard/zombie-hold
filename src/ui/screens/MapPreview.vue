<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MAP_BUILDERS, type MapId } from '../../game/world/maps';
import type { MapData } from '../../game/world/types';

/**
 * 出征页中间的战术地图（UI-PLAN 3.2）：从真实的地图数据画一张俯视的战术图——
 * 地面、墙和障碍、房子、刷怪点（红）、发电机（蓝绿）、零件箱（金）——再叠一层雷达扫描。
 * 地图生成是纯逻辑（几毫秒），每张图只建一次缓存起来；锁定的章节画成打码的灰图
 */
const props = defineProps<{ id: MapId; locked: boolean }>();
const el = ref<HTMLCanvasElement | null>(null);
const cache = new Map<MapId, MapData>();

const GROUND = ['#2c3526', '#24272c', '#3a3226', '#3b3c3c', '#3a332b', '#33322f', '#1e3242', '#4a4232', '#2e2820'];
const S = 6;

function draw(): void {
  const c = el.value;
  if (!c) return;
  let m = cache.get(props.id);
  if (!m) {
    m = MAP_BUILDERS[props.id]();
    cache.set(props.id, m);
  }
  const g = m.grid;
  c.width = g.w * S;
  c.height = g.h * S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y);
      ctx.fillStyle = g.solid[i] ? '#0d1014' : (GROUND[g.ground[i] as number] ?? '#222');
      ctx.fillRect(x * S, y * S, S, S);
    }
  }
  // 房子：描一圈浅色轮廓
  ctx.strokeStyle = 'rgba(217, 201, 160, 0.55)';
  ctx.lineWidth = 1;
  for (const h of m.houses) ctx.strokeRect(h.x0 * S + 0.5, h.y0 * S + 0.5, (h.x1 - h.x0) * S - 1, (h.y1 - h.y0) * S - 1);
  // 车、集装箱：暗色块
  for (const p of m.props) {
    if (p.kind !== 'car' && p.kind !== 'container') continue;
    ctx.fillStyle = p.kind === 'car' ? '#4a2c26' : '#22344a';
    ctx.fillRect(p.x0 * S + 1, p.y0 * S + 1, (p.x1 - p.x0) * S - 2, (p.y1 - p.y0) * S - 2);
  }
  const wx = (x: number) => (x + g.w / 2) * S;
  const wz = (z: number) => (z + g.h / 2) * S;
  ctx.fillStyle = '#f0b83a';
  for (const b of m.scrapBoxes) ctx.fillRect(b.cx * S + 1, b.cy * S + 1, S - 2, S - 2);
  for (const s of m.spawns) {
    ctx.fillStyle = 'rgba(232, 85, 63, 0.22)';
    ctx.beginPath();
    ctx.arc(wx(s.x), wz(s.z), 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8553f';
    ctx.beginPath();
    ctx.arc(wx(s.x), wz(s.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#6fd0e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(wx(m.corePos.x), wz(m.corePos.z), 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#6fd0e8';
  ctx.fillRect(wx(m.corePos.x) - 3, wz(m.corePos.z) - 3, 6, 6);
}

onMounted(draw);
watch(() => props.id, draw);
onBeforeUnmount(() => cache.clear());
</script>

<template>
  <div class="map" :class="{ locked }">
    <canvas ref="el" aria-hidden="true"></canvas>
    <div class="grid" aria-hidden="true"></div>
    <div v-if="!locked" class="sweep" aria-hidden="true"></div>
    <div v-if="locked" class="lock">
      <b>🔒</b>
      <span>情报不足 · 通关上一章解锁</span>
    </div>
    <ul class="legend" aria-label="图例">
      <li><i class="core"></i>发电机</li>
      <li><i class="spawn"></i>尸群入口</li>
      <li><i class="box"></i>零件箱</li>
    </ul>
  </div>
</template>

<style scoped>
.map {
  position: relative;
  aspect-ratio: 1;
  height: 100%;
  max-width: 100%;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--t-line);
  background: #0a0d11;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  filter: saturate(0.85) brightness(1.05);
}
.locked canvas {
  filter: grayscale(1) blur(5px) brightness(0.45);
}
/* 10 米一格的坐标网格 */
.grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(111, 208, 232, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(111, 208, 232, 0.08) 1px, transparent 1px);
  background-size: 12.5% 12.5%;
  pointer-events: none;
}
/* 雷达扫描：从中心转一圈的锥形渐变 */
.sweep {
  position: absolute;
  inset: -20%;
  background: conic-gradient(from 0deg, rgba(111, 208, 232, 0.22), transparent 14%, transparent);
  animation: sweep 6s linear infinite;
  pointer-events: none;
  mix-blend-mode: screen;
}
@keyframes sweep {
  to {
    transform: rotate(360deg);
  }
}
.lock {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--t-muted);
  letter-spacing: 4px;
  font-size: 14px;
}
.lock b {
  font-size: 34px;
}
.legend {
  position: absolute;
  left: 10px;
  bottom: 8px;
  display: flex;
  gap: 14px;
  list-style: none;
  padding: 4px 10px;
  background: rgba(4, 6, 10, 0.7);
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--t-muted);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 8px;
  height: 8px;
}
.legend .core {
  border: 2px solid var(--t-cyan);
  border-radius: 50%;
}
.legend .spawn {
  background: var(--t-red);
  border-radius: 50%;
}
.legend .box {
  background: var(--t-gold);
}
@media (prefers-reduced-motion: reduce) {
  .sweep {
    animation: none;
  }
}
</style>
