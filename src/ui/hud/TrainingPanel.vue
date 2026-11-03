<script setup lang="ts">
import { computed } from 'vue';
import { EYE_HEIGHT, bulletHeightAt } from '../../game/data/ballistics';
import { WEAPONS } from '../../game/data/weapons';
import { TRAINING_RANGES } from '../../game/systems/training';
import { hud } from '../hud';
import { ui } from '../store';

const t = computed(() => hud.training);
const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0);

/** 当前武器在每个靶距上的弹道偏离（厘米，正 = 比瞄准线高）；榴弹走抛物线，不显示 */
const drops = computed(() => {
  const k = hud.weaponKind;
  if (WEAPONS[k].muzzle <= 0) return [];
  return TRAINING_RANGES.map((d) => ({ d, cm: Math.round((bulletHeightAt(k, d) - EYE_HEIGHT) * 100) }));
});
</script>

<template>
  <div v-if="ui.screen === 'training'" class="tp">
    <div class="h"><i></i>训练场</div>
    <div class="row"><span>命中</span><b>{{ t.hits }}</b></div>
    <div class="row"><span>爆头命中</span><b>{{ t.headHits }} <small>{{ pct(t.headHits, t.hits) }}%</small></b></div>
    <div class="row"><span>击杀</span><b>{{ t.kills }}</b></div>
    <div class="row"><span>爆头击杀</span><b>{{ t.headKills }} <small>{{ pct(t.headKills, t.kills) }}%</small></b></div>
    <div v-if="t.hits > 0" class="row last" :class="{ head: t.lastHead }"><span>上一发</span><b>{{ t.lastDist.toFixed(1) }} 米{{ t.lastHead ? ' · 爆头' : '' }}</b></div>

    <template v-if="ui.dropHint && drops.length">
      <div class="h sub">弹道偏离（{{ hud.weaponName }}）</div>
      <div v-for="x in drops" :key="x.d" class="row"><span>{{ x.d }} 米</span><b :class="{ low: x.cm < -10 }">{{ x.cm > 0 ? '+' : '' }}{{ x.cm }} 厘米</b></div>
    </template>
    <div class="keys"><kbd>H</kbd>{{ ui.dropHint ? '隐藏' : '显示' }}弹道提示<kbd class="gap">Esc</kbd>菜单</div>
  </div>
</template>

<style scoped>
/* 左上，零件 / 击杀条下面 */
.tp {
  position: fixed;
  left: 24px;
  top: 70px;
  z-index: 20;
  pointer-events: none;
  width: 220px;
  padding: 10px 12px;
  background: linear-gradient(90deg, var(--hud-panel), rgba(9, 13, 18, 0.3));
  border-left: 2px solid var(--hud-cyan);
  font-family: var(--hud-font);
  font-size: 12px;
  color: var(--hud-muted);
  text-shadow: var(--hud-shadow);
}
.h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 4px;
  color: var(--hud-cyan);
}
.h i {
  width: 6px;
  height: 6px;
  background: var(--hud-cyan);
  transform: rotate(45deg);
}
.h.sub {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--hud-line);
  letter-spacing: 1px;
  color: var(--hud-muted);
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}
.row b {
  font-family: var(--hud-num);
  font-weight: 600;
  color: var(--hud-text);
}
.row small {
  margin-left: 4px;
  font-weight: 400;
  color: var(--hud-accent);
}
.row.last.head b {
  color: var(--hud-accent);
}
.row b.low {
  color: #ffb4a4;
}
.keys {
  display: flex;
  align-items: center;
  margin-top: 8px;
  font-size: 11px;
  color: var(--hud-dim);
}
kbd {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  margin-right: 5px;
  padding: 0 4px;
  border: 1px solid var(--hud-line-strong);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  font: 600 10px/14px var(--hud-font);
  text-align: center;
  color: var(--hud-text);
  text-shadow: none;
}
kbd.gap {
  margin-left: 12px;
}
</style>
