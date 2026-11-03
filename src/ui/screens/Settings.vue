<script setup lang="ts">
import { computed } from 'vue';
import type { Quality } from '../../game/data/quality';
import { ui } from '../store';

const pct = computed(() => Math.round(ui.save.volume * 100));
const onVolume = (e: Event): void => ui.actions.setVolume(Number((e.target as HTMLInputElement).value) / 100);
/** 灵敏度滑块 20–300（百分比），显示成 0.2–3.0 */
const sensPct = computed(() => Math.round(ui.save.sensitivity * 100));
const sensFill = computed(() => ((sensPct.value - 20) / 280) * 100 + '%');
const onSens = (e: Event): void => ui.actions.setSensitivity(Number((e.target as HTMLInputElement).value) / 100);

const notes: Record<Quality, string> = {
  low: '关闭阴影、光晕、抗锯齿，适合核显',
  mid: '1024 阴影 + 光晕，标准分辨率，无抗锯齿',
  high: '2048 阴影 + 光晕 + 2 倍抗锯齿，高分屏最多 1.25 倍分辨率',
};

const levels: Array<{ id: Quality; name: string }> = [
  { id: 'low', name: '低' },
  { id: 'mid', name: '中' },
  { id: 'high', name: '高' },
];
</script>

<template>
  <div class="settings">
    <label class="row">
      <span class="t">音 量</span>
      <input type="range" min="0" max="100" step="5" :value="pct" :style="{ '--p': pct + '%' }" @input="onVolume" />
      <span class="n">{{ pct }}</span>
    </label>
    <label class="row">
      <span class="t">灵敏度</span>
      <input type="range" min="20" max="300" step="5" :value="sensPct" :style="{ '--p': sensFill }" @input="onSens" />
      <span class="n">{{ (sensPct / 100).toFixed(1) }}</span>
    </label>
    <div class="row">
      <span class="t">画 质</span>
      <div class="seg">
        <button v-for="l in levels" :key="l.id" :class="{ on: ui.save.quality === l.id }" @click="ui.actions.setQuality(l.id)">{{ l.name }}</button>
      </div>
      <span class="n"></span>
    </div>
    <div class="note">{{ notes[ui.save.quality] }}</div>
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  gap: 12px;
  font-size: 13px;
  color: #8f9aa6;
  pointer-events: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.t {
  letter-spacing: 6px;
  width: 64px;
}
.n {
  width: 44px;
  text-align: right;
  color: #d8dee4;
  font-variant-numeric: tabular-nums;
}
.note {
  padding-left: 78px;
  font-size: 11px;
  letter-spacing: 1px;
  color: #6f7c88;
}
input {
  flex: 1;
  min-width: 120px;
  height: 4px;
  appearance: none;
  background: linear-gradient(90deg, #f0b83a var(--p), rgba(255, 255, 255, 0.16) var(--p));
  outline: none;
  cursor: pointer;
}
input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 16px;
  background: #e6dcc0;
  border: 1px solid #0b0f14;
}
input::-moz-range-thumb {
  width: 12px;
  height: 16px;
  background: #e6dcc0;
  border: 1px solid #0b0f14;
  border-radius: 0;
}
.seg {
  flex: 1;
  display: flex;
}
.seg button {
  flex: 1;
  padding: 5px 0;
  background: rgba(10, 14, 18, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-left-width: 0;
  color: #9aa7b3;
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 4px;
  cursor: pointer;
  transition: 0.15s;
}
.seg button:first-child {
  border-left-width: 1px;
}
.seg button:hover {
  color: #fff;
  background: #1d2a36;
}
.seg button.on {
  color: #1a1204;
  background: #f0b83a;
  border-color: #f0b83a;
}
</style>
