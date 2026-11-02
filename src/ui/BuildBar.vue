<script setup lang="ts">
import { STRUCTURES, STRUCTURE_ORDER } from '../game/data/structures';
import { hud } from './hud';

const items = STRUCTURE_ORDER.map((k, i) => ({ kind: k, key: i + 1, def: STRUCTURES[k] }));
</script>

<template>
  <div v-if="hud.buildMode" class="build">
    <div class="title">建 造 模 式</div>
    <div class="cards">
      <div v-for="it in items" :key="it.kind" class="card" :class="{ on: hud.buildKind === it.kind, poor: hud.scrap < it.def.cost }">
        <div class="key">{{ it.key }}</div>
        <div class="name">{{ it.def.name }}</div>
        <div class="cost"><span class="d">◆</span>{{ it.def.cost }}</div>
        <div class="desc">{{ it.def.desc }}</div>
      </div>
    </div>
    <div class="help">
      <span><b>左键</b> 放置（可拖动连放）</span>
      <span><b>右键 / X</b> 拆除（返还 70%）</span>
      <span><b>E</b> 修理附近的建筑 / 发电机</span>
      <span><b>B</b> 退出</span>
    </div>
    <div class="msg" :class="{ ok: hud.buildOk }">{{ hud.buildOk ? '可以放置' : hud.buildMsg }}</div>
  </div>
  <div v-else class="tip">按 <b>B</b> 进入建造模式</div>
</template>

<style scoped>
.build {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%) scale(0.92);
  transform-origin: bottom center;
  z-index: 25;
  pointer-events: none;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}
.title {
  font-size: 12px;
  letter-spacing: 10px;
  color: #6fd0e8;
  margin-bottom: 8px;
}
.cards {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.card {
  position: relative;
  width: 136px;
  padding: 8px 10px 8px;
  background: linear-gradient(180deg, rgba(18, 24, 30, 0.88), rgba(10, 14, 18, 0.88));
  border: 1px solid rgba(255, 255, 255, 0.14);
  transition: transform 0.12s, border-color 0.12s;
}
.card.on {
  border-color: #6fd0e8;
  transform: translateY(-6px);
  box-shadow: 0 0 18px rgba(111, 208, 232, 0.35);
}
.card.poor .cost {
  color: #ff6a52;
}
.key {
  position: absolute;
  left: 8px;
  top: 6px;
  font-size: 11px;
  color: #7e8a96;
}
.name {
  font-size: 15px;
  letter-spacing: 3px;
  color: #f1ead6;
  margin-top: 4px;
}
.cost {
  margin: 4px 0;
  font-size: 20px;
  font-weight: 700;
  color: #f0b83a;
}
.cost .d {
  font-size: 13px;
  margin-right: 5px;
}
.desc {
  display: none;
}
.help {
  display: flex;
  gap: 18px;
  justify-content: center;
  margin-top: 10px;
  font-size: 12px;
  color: #8f9aa6;
}
.help b {
  color: #e6dcc0;
  margin-right: 4px;
}
.msg {
  height: 20px;
  margin-top: 6px;
  font-size: 13px;
  letter-spacing: 3px;
  color: #ff6a52;
}
.msg.ok {
  color: #6aff9a;
}
.tip {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
  font-size: 12px;
  letter-spacing: 3px;
  color: rgba(200, 210, 220, 0.55);
}
.tip b {
  color: #e6dcc0;
}
</style>
