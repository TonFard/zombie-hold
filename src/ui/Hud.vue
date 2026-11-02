<script setup lang="ts">
import { computed } from 'vue';
import { hud } from './hud';

const hpPct = computed(() => Math.max(0, (hud.hp / hud.maxHp) * 100));
const stPct = computed(() => Math.max(0, (hud.stamina / hud.maxStamina) * 100));
const corePct = computed(() => Math.max(0, (hud.coreHp / hud.coreMaxHp) * 100));
const lowHp = computed(() => hud.hp / hud.maxHp < 0.3);
</script>

<template>
  <div class="hud">
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
      <div class="core-bar"><div class="fill" :style="{ width: corePct + '%' }"></div></div>
    </div>

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

    <!-- 准星 -->
    <div v-if="hud.cursorVisible && hud.alive" class="cross" :style="{ transform: `translate(${hud.cursorX}px, ${hud.cursorY}px)` }">
      <i class="t" :style="{ transform: `translate(-50%, ${-hud.spread - 8}px)` }"></i>
      <i class="b" :style="{ transform: `translate(-50%, ${hud.spread}px)` }"></i>
      <i class="l" :style="{ transform: `translate(${-hud.spread - 8}px, -50%)` }"></i>
      <i class="r" :style="{ transform: `translate(${hud.spread}px, -50%)` }"></i>
      <i class="dot"></i>
    </div>

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
  left: 26px;
  top: 22px;
}
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.ico {
  color: #8b97a5;
  font-size: 14px;
  width: 16px;
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
  font-size: 12px;
  color: #7e8a96;
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
  left: 0;
  top: 0;
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
