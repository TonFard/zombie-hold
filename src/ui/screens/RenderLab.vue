<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { App } from '../../app/boot';

/**
 * 渲染实验面板（M19）：URL 加 ?render=1 出现在右下角（只在开发环境）。
 * 实时开关各个效果、切昼夜和画质，看帧时间和绘制调用——每一项画面改动先在这里调好再定。
 */
const props = defineProps<{ render: App['render'] }>();

const KEYS = [
  { k: 'ao', name: 'GTAO 环境光遮蔽' },
  { k: 'contact', name: '接触阴影' },
  { k: 'shadows', name: '太阳阴影' },
  { k: 'decals', name: '地面贴花' },
  { k: 'grade', name: '调色 LUT' },
  { k: 'vista', name: '远景' },
] as const;
type Key = (typeof KEYS)[number]['k'];

const on = reactive<Record<Key, boolean>>({ ao: false, contact: false, shadows: false, decals: false, grade: false, vista: false });
const night = ref(0.1);
const quality = ref<'low' | 'mid' | 'high'>('high');
const stats = reactive({ ms: 0, calls: 0, tris: 0 });

const refresh = () => {
  for (const { k } of KEYS) on[k] = props.render.toggle(k);
};
const flip = (k: Key) => {
  on[k] = props.render.toggle(k, !on[k]);
};
const setNight = (e: Event) => {
  night.value = Number((e.target as HTMLInputElement).value);
  props.render.night(night.value);
};
const setQ = (q: 'low' | 'mid' | 'high') => {
  quality.value = q;
  props.render.quality(q);
  refresh();
};

let raf = 0;
let last = performance.now();
let acc = 0;
let frames = 0;
const tick = () => {
  const now = performance.now();
  acc += now - last;
  last = now;
  frames++;
  if (acc > 500) {
    stats.ms = acc / frames;
    const s = props.render.stats();
    stats.calls = s.calls;
    stats.tris = s.tris;
    acc = 0;
    frames = 0;
  }
  raf = requestAnimationFrame(tick);
};
onMounted(() => {
  refresh();
  raf = requestAnimationFrame(tick);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <aside class="lab" aria-label="渲染实验">
    <h3>渲染实验</h3>
    <div class="st">
      <span>{{ stats.ms.toFixed(1) }} ms</span><span>{{ stats.calls }} 次绘制</span><span>{{ (stats.tris / 1e6).toFixed(2) }}M 三角形</span>
    </div>
    <label v-for="x in KEYS" :key="x.k" class="row">
      <input type="checkbox" :checked="on[x.k]" @change="flip(x.k)" />{{ x.name }}
    </label>
    <label class="row">昼夜 <input type="range" min="0" max="1" step="0.05" :value="night" @input="setNight" /></label>
    <div class="row seg">
      <button v-for="q in (['low', 'mid', 'high'] as const)" :key="q" type="button" :class="{ on: quality === q }" @click="setQ(q)">{{ { low: '低', mid: '中', high: '高' }[q] }}</button>
    </div>
  </aside>
</template>

<style scoped>
.lab {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 150;
  width: 220px;
  padding: 10px 12px;
  background: rgba(8, 11, 15, 0.88);
  border: 1px solid rgba(111, 208, 232, 0.35);
  color: var(--t-text);
  font-size: 12px;
  pointer-events: auto;
}
h3 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--t-cyan);
}
.st {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: var(--t-gold);
  font-variant-numeric: tabular-nums;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.row input[type='range'] {
  flex: 1;
}
.seg button {
  flex: 1;
  padding: 2px 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--t-muted);
  font: inherit;
  cursor: pointer;
}
.seg button.on {
  color: var(--t-gold);
  border-color: var(--t-gold);
}
</style>
