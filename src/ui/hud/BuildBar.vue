<script setup lang="ts">
import { computed } from 'vue';
import { STRUCTURES, isTurret } from '../../game/data/structures';
import { hud } from '../hud';

const items = computed(() => hud.buildKinds.map((k, i) => ({ kind: k, key: i + 1, def: STRUCTURES[k], turret: isTurret(k) })));
</script>

<template>
  <div v-if="hud.buildMode" class="build">
    <div class="title"><i></i>建造模式<i></i></div>
    <div class="cards">
      <div v-for="it in items" :key="it.kind" class="card" :class="{ on: hud.buildKind === it.kind, poor: hud.scrap < it.def.cost || (it.turret && hud.turrets >= hud.turretCap) }">
        <div class="key">{{ it.key }}</div>
        <div class="name">{{ it.def.name }}</div>
        <div class="cost"><span class="d">◆</span>{{ it.def.cost }}</div>
        <div class="desc">{{ it.def.desc }}</div>
      </div>
    </div>
    <div class="foot">
      <div class="msg" :class="{ ok: hud.buildOk }">{{ hud.buildOk ? '可以放置' : hud.buildMsg }}</div>
      <div v-if="hud.turretCap < 100" class="cap">炮塔 已建 <b>{{ hud.turrets }}</b> / 上限 {{ hud.turretCap }}</div>
    </div>
    <div class="help">
      <span><kbd>左键</kbd>放置（可拖动连放）</span>
      <span><kbd>右键 / X</kbd>拆除（返还 70%）</span>
      <span><kbd>E</kbd>修理附近的建筑 / 发电机</span>
      <span><kbd>F</kbd>退出</span>
    </div>
  </div>
  <div v-else class="tip">按 <kbd>F</kbd>进入建造模式</div>
</template>

<style scoped>
.build {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: var(--hud-font);
  color: var(--hud-text);
  text-shadow: var(--hud-shadow);
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
.title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 6px;
  color: var(--hud-cyan);
}
.title i {
  width: 40px;
  height: 1px;
  background: linear-gradient(90deg, rgba(111, 208, 232, 0), var(--hud-cyan));
}
.title i:last-child {
  transform: scaleX(-1);
}
.cards {
  display: flex;
  gap: 4px;
  justify-content: center;
}
.card {
  position: relative;
  /* 6 张卡在 1280 宽时不能压到左下的血条（血条右端在 308px） */
  width: clamp(84px, 7.4vw, 108px);
  padding: 6px 8px;
  background: var(--hud-panel);
  border-bottom: 2px solid var(--hud-line);
  text-align: left;
  transition: transform 0.12s, background 0.12s;
}
.card.on {
  background: rgba(20, 44, 54, 0.82);
  border-bottom-color: var(--hud-cyan);
  transform: translateY(-4px);
}
.card.poor {
  opacity: 0.6;
}
.card.poor .cost {
  color: #ff6a52;
}
.key {
  position: absolute;
  right: 7px;
  top: 5px;
  font-family: var(--hud-num);
  font-size: 11px;
  color: var(--hud-dim);
}
.card.on .key {
  color: var(--hud-cyan);
}
.name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--hud-text);
  white-space: nowrap;
}
.cost {
  margin-top: 2px;
  font-family: var(--hud-num);
  font-size: 18px;
  font-weight: 600;
  color: var(--hud-accent);
}
.cost .d {
  font-size: 10px;
  margin-right: 4px;
  vertical-align: 2px;
}
.desc {
  display: none;
}
.foot {
  display: flex;
  gap: 18px;
  align-items: center;
  height: 22px;
  margin-top: 6px;
}
.msg {
  font-size: 13px;
  letter-spacing: 2px;
  color: #ff6a52;
}
.msg.ok {
  color: #6aff9a;
}
.cap {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
.cap b {
  font-family: var(--hud-num);
  font-size: 13px;
  color: var(--hud-cyan);
}
.help {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 2px;
  font-size: 11px;
  color: var(--hud-muted);
}
.tip {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
  font-family: var(--hud-font);
  padding: 4px 12px;
  background: var(--hud-panel);
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(220, 228, 236, 0.92);
  text-shadow: var(--hud-shadow);
}
.tip kbd {
  margin-left: 2px;
  opacity: 0.85;
}
</style>
