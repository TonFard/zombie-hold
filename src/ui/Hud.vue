<script setup lang="ts">
import { computed } from 'vue';
import { hud } from './hud';
import Radar from './Radar.vue';
import { fmtTime, ui } from './store';

const bossPct = computed(() => Math.max(0, (hud.bossHp / hud.bossMax) * 100));
const hpPct = computed(() => Math.max(0, (hud.hp / hud.maxHp) * 100));
const stPct = computed(() => Math.max(0, (hud.stamina / hud.maxStamina) * 100));
const corePct = computed(() => Math.max(0, (hud.coreHp / hud.coreMaxHp) * 100));
const lowHp = computed(() => hud.hp / hud.maxHp < 0.3);
</script>

<template>
  <div v-if="ui.screen !== 'menu' && ui.screen !== 'result'" class="hud">
    <!-- 受伤时的红色边缘 -->
    <div class="hurt" :style="{ opacity: hud.hurt * 0.85 }"></div>
    <div v-if="lowHp && hud.alive" class="low-hp"></div>

    <!-- 左上：零件和击杀 -->
    <div class="tl">
      <div class="row"><span class="ico scrap">◆</span><span class="num">{{ hud.scrap }}</span><span class="lbl">零件</span></div>
      <div class="row"><span class="ico">✕</span><span class="num sm">{{ hud.kills }}</span><span class="lbl">击杀</span></div>
    </div>

    <!-- 上中：发电机 -->
    <div class="tc">
      <div class="core-name">发 电 机</div>
      <div class="core-bar" :class="{ hit: hud.coreHurt > 0.05 }"><div class="fill" :style="{ width: corePct + '%' }"></div></div>
      <div v-if="hud.phase === 'day'" class="phase">
        <span class="p day">白天 · 第 {{ hud.night }} 天</span>
        <span class="tm">{{ fmtTime(hud.dayTimer) }}</span>
        <span class="k"><b>Enter</b> 开始夜晚</span>
      </div>
      <div v-else-if="hud.phase === 'night'" class="phase">
        <span class="p night">第 {{ hud.night }} 夜</span>
        <span class="tm">剩余 {{ hud.remaining }}</span>
      </div>
      <div v-if="hud.bossName" class="boss">
        <div class="bn">{{ hud.bossName }}</div>
        <div class="bb"><div class="bf" :style="{ width: bossPct + '%' }"></div></div>
      </div>
    </div>

    <div v-if="hud.benchNear" class="prompt">按 <b>F</b> 打开武器工坊</div>

    <!-- 左下：生命和体力 -->
    <div class="bl">
      <div class="hp" :class="{ low: lowHp }">
        <div class="fill" :style="{ width: hpPct + '%' }"></div>
        <span class="txt">{{ hud.hp }} / {{ hud.maxHp }}</span>
      </div>
      <div class="stamina"><div class="fill" :style="{ width: stPct + '%' }"></div></div>
    </div>

    <!-- 右下：武器与弹药 -->
    <div class="br">
      <div class="wname">{{ hud.weaponName }}</div>
      <div class="pips">
        <span v-for="i in 5" :key="i" class="pip" :class="{ on: i <= hud.tier }"></span>
      </div>
      <div class="ammo" :class="{ empty: hud.mag === 0 }">
        <span class="cur">{{ hud.mag }}</span><span class="max"> / {{ hud.magMax }}</span>
      </div>
      <div class="reload"><div v-if="hud.reload >= 0" class="fill" :style="{ width: hud.reload * 100 + '%' }"></div></div>
      <div class="hint">{{ hud.reload >= 0 ? '换弹中…' : hud.mag === 0 ? '按 R 换弹' : '' }}</div>
    </div>

    <Radar v-if="hud.alive" />

    <!-- 受击方向：红色扇形指向打你的僵尸 -->
    <div v-for="(m, i) in hud.hurtMarks" :key="i" class="hurtdir" :style="{ transform: `rotate(${m.a}rad)`, opacity: Math.min(1, m.life * 1.3) }"><i></i></div>

    <!-- 命中 / 击杀标记 -->
    <div v-if="hud.alive && (hud.hit > 0.02 || hud.kill > 0.02)" class="hitm" :class="{ crit: hud.hitCrit, kill: hud.kill > 0.02 }" :style="{ opacity: Math.max(hud.hit, hud.kill) }">
      <i v-for="n in 4" :key="n" :style="{ transform: `rotate(${45 + (n - 1) * 90}deg) translateY(${hud.kill > 0.02 ? -17 : -13}px)` }"></i>
    </div>

    <!-- 准星：固定在屏幕中心；建造模式下按能不能放置变色 -->
    <div v-if="hud.locked && hud.alive" class="cross" :class="{ ok: hud.buildMode && hud.buildOk, bad: hud.buildMode && !hud.buildOk }">
      <i class="t" :style="{ transform: `translate(-50%, ${-hud.spread - 8}px)` }"></i>
      <i class="b" :style="{ transform: `translate(-50%, ${hud.spread}px)` }"></i>
      <i class="l" :style="{ transform: `translate(${-hud.spread - 8}px, -50%)` }"></i>
      <i class="r" :style="{ transform: `translate(${hud.spread}px, -50%)` }"></i>
      <i class="dot"></i>
    </div>

    <div v-if="!hud.locked && hud.alive && ui.screen === 'play'" class="lockhint">点击画面，继续游戏</div>
    <div v-if="!hud.alive" class="dead">你倒下了</div>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
}
.hurt {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(120, 0, 0, 0) 38%, rgba(170, 10, 10, 0.95) 100%);
  transition: opacity 0.05s;
}
.low-hp {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 140px 30px rgba(140, 0, 0, 0.45);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.tl {
  position: absolute;
  left: 20px;
  top: 16px;
  padding: 8px 16px 4px 12px;
  background: rgba(8, 12, 16, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.ico {
  color: #9aa7b5;
  font-size: 14px;
  width: 18px;
  text-align: center;
}
.ico.scrap {
  color: #f0b83a;
  font-size: 18px;
}
.num {
  font-size: 28px;
  font-weight: 700;
  color: #f3e9cf;
  letter-spacing: 1px;
}
.num.sm {
  font-size: 18px;
  color: #cfd6dd;
}
.lbl {
  font-size: 13px;
  color: #a4b0bc;
  letter-spacing: 3px;
}
.tc {
  position: absolute;
  left: 50%;
  top: 20px;
  transform: translateX(-50%);
  width: min(380px, 50vw);
  text-align: center;
}
.core-name {
  font-size: 11px;
  letter-spacing: 8px;
  color: #6fd0e8;
  margin-bottom: 5px;
}
.core-bar {
  height: 9px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(111, 208, 232, 0.5);
  padding: 1px;
}
.core-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #1f7f98, #6fe3ff);
  transition: width 0.15s linear;
}
.phase {
  margin: 10px auto 0;
  width: max-content;
  max-width: 100%;
  padding: 7px 20px;
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: baseline;
  font-size: 14px;
  color: #b7c3cf;
  letter-spacing: 3px;
  background: rgba(8, 12, 16, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
}
.phase .p {
  font-size: 17px;
  font-weight: 700;
}
.phase .p.day {
  color: #f0c85a;
}
.phase .p.night {
  color: #e8553f;
}
.phase .tm {
  font-size: 24px;
  font-weight: 700;
  color: #f3e9cf;
  letter-spacing: 2px;
}
.phase .k {
  font-size: 12px;
  color: #93a0ac;
}
.phase .k b {
  color: #e6dcc0;
}
.boss {
  margin-top: 12px;
}
.bn {
  font-size: 12px;
  letter-spacing: 8px;
  color: #e5a44b;
  margin-bottom: 4px;
}
.bb {
  height: 10px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(230, 164, 75, 0.6);
  padding: 1px;
}
.bf {
  height: 100%;
  background: linear-gradient(90deg, #74351e, #e6a44b);
  transition: width 0.12s linear;
}
.prompt {
  position: absolute;
  left: 50%;
  top: 62%;
  transform: translateX(-50%);
  padding: 8px 22px;
  background: rgba(10, 14, 18, 0.75);
  border: 1px solid rgba(240, 184, 58, 0.6);
  color: #e6dcc0;
  letter-spacing: 4px;
  font-size: 14px;
  animation: bob 1.6s ease-in-out infinite;
}
.prompt b {
  color: #f0b83a;
}
@keyframes bob {
  50% {
    transform: translateX(-50%) translateY(-4px);
  }
}
.bl {
  position: absolute;
  left: 26px;
  bottom: 26px;
  width: 270px;
}
.hp {
  position: relative;
  height: 20px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.hp .fill {
  height: 100%;
  background: linear-gradient(90deg, #8b1d1a, #e04a38);
  transition: width 0.12s linear;
}
.hp.low .fill {
  background: linear-gradient(90deg, #a01010, #ff3a2a);
}
.hp .txt {
  position: absolute;
  inset: 0;
  text-align: center;
  font-size: 12px;
  line-height: 20px;
  letter-spacing: 2px;
  color: #fff;
}
.stamina {
  margin-top: 6px;
  height: 6px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.stamina .fill {
  height: 100%;
  background: linear-gradient(90deg, #2a7f8a, #5ee0ec);
}
.br {
  position: absolute;
  right: 30px;
  bottom: 24px;
  text-align: right;
  min-width: 220px;
}
.wname {
  font-size: 13px;
  letter-spacing: 4px;
  color: #aab6c3;
}
.pips {
  margin: 5px 0 2px;
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
.pip {
  width: 16px;
  height: 4px;
  background: rgba(255, 255, 255, 0.14);
}
.pip.on {
  background: #f0b83a;
  box-shadow: 0 0 6px rgba(240, 184, 58, 0.7);
}
.ammo .cur {
  font-size: 44px;
  font-weight: 700;
  color: #f3e9cf;
  letter-spacing: 2px;
}
.ammo .max {
  font-size: 18px;
  color: #7e8a96;
}
.ammo.empty .cur {
  color: #ff5a45;
}
.reload {
  height: 4px;
  margin-top: 2px;
  background: rgba(0, 0, 0, 0.5);
}
.reload .fill {
  height: 100%;
  background: #f0b83a;
}
.hint {
  height: 16px;
  margin-top: 3px;
  font-size: 12px;
  letter-spacing: 3px;
  color: #ff8a6a;
}
.cross {
  position: absolute;
  left: 50%;
  top: 50%;
}
.cross i {
  position: absolute;
  left: 0;
  top: 0;
  background: #f2f2ea;
  box-shadow: 0 0 3px #000;
}
.cross .t,
.cross .b {
  width: 2px;
  height: 8px;
}
.cross .l,
.cross .r {
  width: 8px;
  height: 2px;
}
.cross .dot {
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: #ff4a3a;
}
.core-bar.hit {
  border-color: #ff6a55;
  box-shadow: 0 0 14px rgba(255, 90, 70, 0.85);
}
.hurtdir {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}
.hurtdir i {
  position: absolute;
  left: -80px;
  top: -210px;
  width: 160px;
  height: 46px;
  background: linear-gradient(to bottom, rgba(230, 30, 20, 0.95), rgba(230, 30, 20, 0));
  clip-path: polygon(14% 0, 86% 0, 100% 100%, 0 100%);
}
.hitm {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}
.hitm i {
  position: absolute;
  left: -1px;
  top: -5px;
  width: 2px;
  height: 10px;
  background: #fff;
  box-shadow: 0 0 3px #000;
}
.hitm.crit i {
  background: #ffd04a;
}
.hitm.kill i {
  background: #ff4a3a;
  width: 3px;
  height: 13px;
  left: -1.5px;
  top: -6.5px;
}
.cross.ok i {
  background: #7dff9a;
}
.cross.bad i {
  background: #ff6a5a;
}
.lockhint {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  padding: 14px 40px;
  background: rgba(8, 12, 16, 0.78);
  border: 1px solid rgba(240, 184, 58, 0.7);
  color: #f0d890;
  font-size: 18px;
  letter-spacing: 8px;
  animation: bob 1.6s ease-in-out infinite;
}
.dead {
  position: absolute;
  left: 50%;
  top: 40%;
  transform: translate(-50%, -50%);
  font-size: 44px;
  letter-spacing: 16px;
  color: #d84a3a;
  text-shadow: 0 0 30px rgba(216, 74, 58, 0.7);
}
</style>
