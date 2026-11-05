<script setup lang="ts">
import { RARITY_NAME } from '../../game/data/cards';
import { hud } from '../hud';
import { ui } from '../store';
import Settings from './Settings.vue';
</script>

<template>
  <div v-if="ui.screen === 'pause'" class="pause">
    <div class="box">
      <h2>暂 停</h2>
      <button @click="ui.actions.resume()">继 续</button>
      <template v-if="ui.screen === 'pause' && ui.inTraining">
        <button class="danger" @click="ui.actions.toLobby()">离开训练场</button>
      </template>
      <template v-else>
        <button @click="ui.actions.restart()">重新开始</button>
        <button class="danger" @click="ui.actions.abandon()">放弃，回大厅</button>
      </template>
      <Settings class="slider" />
      <p>Esc</p>
    </div>

    <!-- 本局加成：卡牌（带说明）和局外加成 -->
    <aside v-if="!ui.inTraining && (hud.buffs.length || hud.metaLines.length)" class="perks" aria-label="本局加成">
      <h3>本局加成</h3>
      <ul v-if="hud.buffs.length" class="cards">
        <li v-for="b in hud.buffs" :key="b.id" :class="b.rarity">
          <div class="ch">
            <b>{{ b.name }}</b>
            <em v-if="b.n > 1">×{{ b.n }}</em>
            <span class="rar">{{ RARITY_NAME[b.rarity] }}</span>
          </div>
          <div class="cd">{{ b.desc }}<template v-if="b.n > 1">（已叠 {{ b.n }} 张）</template></div>
        </li>
      </ul>
      <p v-else class="empty">还没有选过卡牌：每个黎明可以三选一</p>
      <template v-if="hud.metaLines.length">
        <h4>局外成长</h4>
        <div class="meta">
          <span v-for="l in hud.metaLines" :key="l">{{ l }}</span>
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.pause {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 56px;
  background: rgba(3, 5, 8, 0.7);
  backdrop-filter: blur(3px);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
  text-align: center;
}
h2 {
  font-size: 28px;
  letter-spacing: 18px;
  color: #d9c9a0;
  margin-bottom: 14px;
  font-weight: 300;
}
button {
  padding: 13px 0;
  background: rgba(10, 14, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #d8dee4;
  font-size: 15px;
  letter-spacing: 8px;
  font-family: inherit;
  cursor: pointer;
  transition: 0.15s;
}
button:hover {
  background: #1d2a36;
  border-color: #6fd0e8;
  color: #fff;
}
button.danger:hover {
  background: #3a1c1a;
  border-color: #e8553f;
}
.slider {
  margin-top: 10px;
}
p {
  margin-top: 8px;
  font-size: 12px;
  letter-spacing: 4px;
  color: #6f7c88;
}
p.note {
  max-width: 300px;
  margin: 0 auto;
  letter-spacing: 1px;
  line-height: 1.6;
}

/* ---------- 本局加成 ---------- */
.perks {
  width: 340px;
  max-height: 78vh;
  overflow-y: auto;
  padding: 16px 18px;
  background: rgba(10, 14, 18, 0.8);
  border-top: 2px solid var(--hud-accent);
}
h3 {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 6px;
  color: #d9c9a0;
}
h4 {
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 4px;
  color: var(--hud-cyan);
}
.cards {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cards li {
  --c: #a8b4c0;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid var(--c);
}
.cards li.rare {
  --c: #5ab8f0;
}
.cards li.epic {
  --c: #d08af0;
}
.cards li.curse {
  --c: #e8553f;
}
.ch {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.ch b {
  font-size: 13px;
  font-weight: 600;
  color: #eef1f3;
}
.ch em {
  font-style: normal;
  font-size: 12px;
  color: var(--c);
}
.rar {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--c);
}
.cd {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.5;
  color: #9aa6b2;
}
.empty {
  margin: 0;
  letter-spacing: 1px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.meta span {
  padding: 2px 8px;
  font-size: 11px;
  color: #d8dee4;
  background: rgba(111, 208, 232, 0.1);
  border: 1px solid rgba(111, 208, 232, 0.3);
}
</style>
