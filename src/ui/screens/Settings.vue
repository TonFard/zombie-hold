<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Quality } from '../../game/data/quality';
import { ui } from '../store';

/** 只显示一组（大厅设置页按「音频 / 画面 / 操控」分组折叠）；不传就全部显示（暂停菜单） */
const props = defineProps<{ part?: 'audio' | 'video' | 'controls' }>();
const show = (k: 'audio' | 'video' | 'controls'): boolean => !props.part || props.part === k;

const pct = computed(() => Math.round(ui.save.volume * 100));
const onVolume = (e: Event): void => ui.actions.setVolume(Number((e.target as HTMLInputElement).value) / 100);
/** 分类音量（M20） */
const MIX = [
  { k: 'weapons', name: '武器' },
  { k: 'zombies', name: '僵尸' },
  { k: 'world', name: '环境' },
  { k: 'ui', name: '界面' },
] as const;
const mixPct = (k: (typeof MIX)[number]['k']) => Math.round((ui.save.mix?.[k] ?? 1) * 100);
const onMix = (k: string, e: Event): void => ui.actions.setMix(k, Number((e.target as HTMLInputElement).value) / 100);
/** 测试声音：显示声音系统的状态，没声音时帮玩家（和我们）判断是哪一环出了问题 */
const audioState = ref('');
const STATE_TEXT: Record<string, string> = {
  running: '声音系统正常运行。如果还是听不到，检查 Windows 音量合成器里「黎明」有没有被静音、输出设备对不对',
  suspended: '声音被浏览器挂起了，再点一次试试',
  closed: '声音系统被关闭了（可能换过输出设备），已经尝试重建，再点一次',
  none: '声音系统还没启动',
};
const testSound = (): void => {
  audioState.value = ui.actions.testSound();
};
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
    <template v-if="show('audio')">
    <label class="row">
      <span class="t">音 量</span>
      <input type="range" min="0" max="100" step="5" :value="pct" :style="{ '--p': pct + '%' }" @input="onVolume" />
      <span class="n">{{ pct }}</span>
    </label>
    <label v-for="m in MIX" :key="m.k" class="row sub">
      <span class="t">{{ m.name }}</span>
      <input type="range" min="0" max="100" step="5" :value="mixPct(m.k)" :style="{ '--p': mixPct(m.k) + '%' }" @input="onMix(m.k, $event)" />
      <span class="n">{{ mixPct(m.k) }}</span>
    </label>
    <div class="row">
      <span class="t"></span>
      <button class="test" type="button" @click="testSound()">测试声音</button>
      <span class="n"></span>
    </div>
    <div v-if="pct > 0 && pct < 10" class="note warn">音量很低，几乎听不到</div>
    <div v-if="pct === 0" class="note warn">已静音</div>
    <div v-if="audioState" class="note" role="status">{{ STATE_TEXT[audioState] ?? audioState }}</div>
    </template>
    <template v-if="show('controls')">
    <label class="row">
      <span class="t">灵敏度</span>
      <input type="range" min="20" max="300" step="5" :value="sensPct" :style="{ '--p': sensFill }" @input="onSens" />
      <span class="n">{{ (sensPct / 100).toFixed(1) }}</span>
    </label>
    </template>
    <template v-if="show('video')">
    <div class="row">
      <span class="t">画 质</span>
      <div class="seg">
        <button v-for="l in levels" :key="l.id" :class="{ on: ui.save.quality === l.id }" @click="ui.actions.setQuality(l.id)">{{ l.name }}</button>
      </div>
      <span class="n"></span>
    </div>
    <div class="note">{{ notes[ui.save.quality] }}</div>
    </template>
  </div>
</template>

<style scoped>
.row.sub .t {
  font-size: 12px;
  color: var(--t-muted);
  padding-left: 12px;
}
.test {
  padding: 4px 14px;
  background: transparent;
  border: 1px solid rgba(111, 208, 232, 0.5);
  color: var(--t-cyan);
  font: inherit;
  cursor: pointer;
}
.test:hover,
.test:focus-visible {
  background: rgba(111, 208, 232, 0.12);
  outline: none;
}
.note.warn {
  color: var(--t-gold);
}
.settings {
  display: grid;
  gap: 12px;
  font-size: 13px;
  color: var(--t-muted);
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
  color: var(--t-text);
  font-variant-numeric: tabular-nums;
}
.note {
  padding-left: 78px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--t-dim);
}
input {
  flex: 1;
  min-width: 120px;
  height: 4px;
  appearance: none;
  background: linear-gradient(90deg, var(--t-gold) var(--p), rgba(255, 255, 255, 0.16) var(--p));
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
  background: var(--t-gold);
  border-color: var(--t-gold);
}
</style>
