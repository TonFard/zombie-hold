<script setup lang="ts">
import { computed } from 'vue';
import { CHALLENGES, nightMod } from '../../game/data/modifiers';
import { GRENADE, PULSE, SHOVE } from '../../game/systems/hazards';
import { hud } from '../hud';
import { ui } from '../store';

const x = computed(() => hud.extras);
const mod = computed(() => (x.value.mod ? nightMod(x.value.mod) : null));
const ch = computed(() => CHALLENGES[x.value.challenge as keyof typeof CHALLENGES] ?? null);
const show = computed(() => x.value.on && (ui.screen === 'play' || ui.screen === 'bench') && hud.alive);
/** 技能格的冷却遮罩比例（1 = 刚用完，0 = 就绪） */
const shoveFill = computed(() => Math.min(1, x.value.shoveCd / SHOVE.cd));
const throwFill = computed(() => (x.value.throwing ? 1 : Math.min(1, x.value.throwCd / GRENADE.cd)));
const pulseFill = computed(() => (x.value.pulseCharge > 0 ? 1 - x.value.pulseCharge / PULSE.charge : Math.min(1, x.value.pulseCd / PULSE.cd)));
</script>

<template>
  <template v-if="show">
    <!-- 搜刮点（M18）：站在旁边时提示按住 E 和奖励 -->
    <div v-if="hud.loot.name && hud.phase === 'day'" class="survivor loot" :class="{ danger: hud.loot.danger }" role="status">
      按住 <kbd>E</kbd> 搜刮 · {{ hud.loot.name }}<span class="bar"><i :style="{ width: `${Math.round(hud.loot.pct * 100)}%` }"></i></span><small>{{ hud.loot.reward }}</small>
    </div>
    <!-- 幸存者求救：靠近信号弹时提示按住 E，显示读条 -->
    <div v-if="hud.risk.id === 'survivor' && hud.risk.stage === 1 && hud.phase === 'day'" class="survivor" role="status">
      <template v-if="hud.risk.dist < 1.8">按住 <kbd>E</kbd> 救人<span class="bar"><i :style="{ width: `${Math.round(hud.risk.hold * 100)}%` }"></i></span></template>
      <template v-else>幸存者在红色信号烟处 · {{ Math.round(hud.risk.dist) }} 米</template>
    </div>
    <!-- 右上（雷达下面）：今晚的词缀和挑战，做成任务列表 -->
    <div v-if="mod || ch" class="tasks">
      <div v-if="mod" class="task mod" :class="x.mod">
        <div class="th"><i class="mk"></i>{{ hud.phase === 'night' ? '今晚' : '预告' }}<b>{{ mod.name }}</b></div>
        <div class="td">{{ mod.desc }}</div>
      </div>
      <div v-if="ch" class="task ch" :class="{ done: x.chDone }">
        <div class="th">
          <i class="mk"></i>挑战<b>{{ ch.name }}</b>
          <em v-if="x.chDone">✓ 完成</em>
          <em v-else-if="hud.phase === 'night' && x.chProgress">{{ x.chProgress }}</em>
        </div>
        <div class="td">{{ ch.desc }}</div>
      </div>
    </div>

    <!-- 连杀：准星下方偏右，不挡中心 -->
    <div v-if="x.combo >= 3" :key="x.combo" class="combo">
      <b>{{ x.combo }}</b>
      <div class="cl">
        <span class="c1">连杀</span>
        <span class="c2">零件 ×{{ x.comboMult.toFixed(2) }}</span>
        <span v-if="hud.comboDmg > 0" class="c3">战意 伤害 +{{ Math.round(hud.comboDmg * 100) }}%</span>
      </div>
    </div>

    <!-- 右下（武器上方）：手雷 / 推搡 / 手电 / 脉冲，做成一排技能格 -->
    <div class="tools">
      <div class="chip" :class="{ dim: x.frags + x.fires === 0 || x.throwCd > 0, fire: x.useFire }">
        <kbd>G</kbd>
        <span class="cn">{{ x.useFire ? '燃烧弹' : '手雷' }}</span>
        <span class="cv">{{ x.throwing ? '投掷' : x.throwCd > 0 ? x.throwCd.toFixed(1) + 's' : x.useFire ? x.fires : x.frags }}</span>
        <small v-if="x.fires > 0" class="alt"><kbd class="mini">B</kbd>切换</small>
        <i class="cd" :style="{ height: throwFill * 100 + '%' }"></i>
      </div>
      <div class="chip" :class="{ dim: x.shoveCd > 0 }">
        <kbd>V</kbd>
        <span class="cn">推搡</span>
        <span class="cv" :class="{ ready: x.shoveCd <= 0 }">{{ x.shoveCd > 0 ? x.shoveCd.toFixed(1) + 's' : '就绪' }}</span>
        <i class="cd" :style="{ height: shoveFill * 100 + '%' }"></i>
      </div>
      <div class="chip" :class="{ lit: x.flashOn }">
        <kbd>T</kbd>
        <span class="cn">手电</span>
        <i class="bat"><i :style="{ width: x.battery * 100 + '%' }" :class="{ on: x.flashOn, low: x.battery < 0.2 }"></i></i>
      </div>
      <div class="chip" :class="{ dim: !x.pulseNear || x.pulseCd > 0, hot: x.pulseCharge > 0 }">
        <kbd>Q</kbd>
        <span class="cn">电击脉冲</span>
        <span class="cv" :class="{ ready: x.pulseCharge <= 0 && x.pulseCd <= 0 && x.pulseNear }">{{ x.pulseCharge > 0 ? '充能中' : x.pulseCd > 0 ? Math.ceil(x.pulseCd) + 's' : x.pulseNear ? '就绪' : '靠近发电机' }}</span>
        <i class="cd" :style="{ height: pulseFill * 100 + '%' }"></i>
      </div>
    </div>
  </template>
</template>

<style scoped>
.survivor.loot {
  color: #f0e2b8;
  background: rgba(30, 24, 8, 0.72);
  border-color: rgba(240, 184, 58, 0.5);
}
.survivor.loot .bar i {
  background: var(--t-gold);
}
.survivor.loot.danger {
  color: #ffd8c8;
  border-color: rgba(232, 85, 63, 0.6);
}
.survivor.loot.danger .bar i {
  background: var(--t-red);
}
.survivor small {
  font-size: 12px;
  color: #c8c0a8;
}
.survivor {
  position: fixed;
  left: 50%;
  bottom: 22%;
  transform: translateX(-50%);
  padding: 6px 16px;
  font-size: 14px;
  color: #ffd8c8;
  background: rgba(40, 10, 8, 0.7);
  border: 1px solid rgba(232, 85, 63, 0.5);
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}
.survivor kbd {
  padding: 0 5px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  font: 600 12px/16px inherit;
}
.survivor .bar {
  width: 120px;
  height: 6px;
  background: rgba(255, 255, 255, 0.15);
}
.survivor .bar i {
  display: block;
  height: 100%;
  background: var(--t-red);
}
kbd {
  display: inline-block;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--hud-line-strong);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  font: 600 11px/16px var(--hud-font);
  text-align: center;
  color: var(--hud-text);
  text-shadow: none;
  justify-self: start;
}
kbd.mini {
  min-width: 14px;
  height: 14px;
  margin-right: 3px;
  padding: 0 2px;
  font-size: 9px;
  line-height: 12px;
}

/* ---------- 右上任务列表 ---------- */
.tasks {
  position: fixed;
  right: 24px;
  top: 200px;
  z-index: 20;
  pointer-events: none;
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--hud-font);
  text-shadow: var(--hud-shadow);
}
.task {
  padding: 6px 10px 7px 12px;
  background: linear-gradient(270deg, var(--hud-panel), rgba(9, 13, 18, 0.25));
  border-right: 2px solid var(--hud-danger);
}
.th {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
.th b {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--hud-text);
}
.mk {
  width: 6px;
  height: 6px;
  background: var(--hud-danger);
  transform: rotate(45deg);
}
.td {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--hud-muted);
}
.task.bloodmoon {
  border-color: #d8283a;
}
.task.bloodmoon .mk {
  background: #d8283a;
}
.task.fog {
  border-color: var(--t-muted);
}
.task.fog .mk {
  background: var(--t-muted);
}
.task.blackout {
  border-color: #4a6078;
}
.task.blackout .mk {
  background: #4a6078;
}
.task.elite {
  border-color: var(--hud-accent);
}
.task.elite .mk {
  background: var(--hud-accent);
}
.task.ch {
  border-color: var(--hud-cyan);
}
.task.ch .mk {
  background: var(--hud-cyan);
}
.th em {
  margin-left: auto;
  font-style: normal;
  font-family: var(--hud-num);
  font-size: 12px;
  letter-spacing: 0;
  color: var(--hud-accent);
}
.task.ch.done {
  border-color: var(--hud-ok);
}
.task.ch.done .mk {
  background: var(--hud-ok);
}
.task.ch.done em {
  color: var(--hud-ok);
}

/* ---------- 连杀 ---------- */
.combo {
  position: fixed;
  left: calc(50% + 70px);
  top: calc(50% + 40px);
  z-index: 22;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--hud-font);
  color: var(--hud-accent);
  text-shadow: 0 0 10px rgba(240, 184, 58, 0.45), var(--hud-shadow);
  animation: pop 0.25s ease-out;
  transform-origin: left center;
}
.combo b {
  font-family: var(--hud-num);
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  font-style: italic;
}
.cl {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  padding-left: 8px;
  border-left: 1px solid rgba(240, 184, 58, 0.5);
}
.c1 {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 3px;
}
.c2 {
  font-family: var(--hud-num);
  font-size: 11px;
  color: var(--hud-text);
}
.c3 {
  font-family: var(--hud-num);
  font-size: 11px;
  font-weight: 600;
  color: #ff9a5a;
}
@keyframes pop {
  from {
    transform: scale(1.35);
  }
}
@media (prefers-reduced-motion: reduce) {
  .combo {
    animation: none;
  }
}

/* ---------- 技能格 ---------- */
.tools {
  position: fixed;
  right: 28px;
  bottom: 160px;
  z-index: 20;
  pointer-events: none;
  display: flex;
  gap: 4px;
  font-family: var(--hud-font);
  text-shadow: var(--hud-shadow);
}
.chip {
  position: relative;
  overflow: hidden;
  min-width: 64px;
  height: 50px;
  padding: 5px 6px;
  /* 第一行：按键 + 数值；第二行：名称 / 电量条 / 切换提示 */
  display: grid;
  grid-template-columns: auto 1fr;
  grid-auto-rows: min-content;
  column-gap: 8px;
  row-gap: 3px;
  align-content: start;
  background: var(--hud-panel);
  border-bottom: 2px solid var(--hud-line-strong);
}
.chip .cn {
  grid-column: 1;
  grid-row: 2;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--hud-muted);
  white-space: nowrap;
}
.chip .cv {
  justify-self: end;
  align-self: center;
  position: relative;
  z-index: 1;
  font-family: var(--hud-num);
  font-size: 13px;
  font-weight: 600;
  color: var(--hud-text);
  white-space: nowrap;
}
.chip .cv.ready {
  color: var(--hud-ok);
  font-size: 11px;
}
.chip .alt {
  grid-column: 2;
  grid-row: 2;
  justify-self: end;
  display: flex;
  align-items: center;
  font-size: 9px;
  color: var(--hud-dim);
}
/* 冷却遮罩：从下往上退 */
.chip .cd {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
}
.chip.dim {
  opacity: 0.6;
}
.chip.dim .cv {
  color: var(--hud-muted);
}
.chip.fire {
  border-bottom-color: #ff7a3a;
}
.chip.fire .cv {
  color: #ff9a5a;
}
.chip.lit {
  border-bottom-color: #fff2c8;
}
.chip.hot {
  border-bottom-color: var(--hud-cyan);
}
.chip.hot .cv {
  color: #66e0ff;
}
.bat {
  grid-column: 2;
  grid-row: 1;
  display: block;
  align-self: center;
  width: 100%;
  min-width: 26px;
  height: 5px;
  background: rgba(255, 255, 255, 0.12);
}
.bat i {
  display: block;
  height: 100%;
  background: var(--t-muted);
}
.bat i.on {
  background: #fff2c8;
}
.bat i.low {
  background: var(--hud-danger);
}
</style>
