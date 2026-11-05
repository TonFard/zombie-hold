<script setup lang="ts">
import { computed } from 'vue';
import { DIFFICULTIES } from '../../game/data/difficulty';
import { fmtTime, ui } from '../store';

const r = computed(() => ui.result);
const reasonText = computed(() => {
  if (!r.value) return '';
  if (r.value.won) return '发电机撑到了天亮';
  if (r.value.reason === 'abandon') return '放弃了这一局';
  return r.value.reason === 'core' ? '发电机被摧毁了' : '你倒下了';
});
/** 勋章明细：只列出有数的项 */
const lines = computed(() => {
  const m = r.value?.medals;
  if (!m) return [];
  return [
    ['撑过的夜晚', m.nights],
    ['击败首领', m.bosses],
    ['击杀', m.kills],
    ['爆头击杀', m.headshots],
    ['通关', m.win],
    ['夜间挑战', m.challenges],
  ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;
});
</script>

<template>
  <div v-if="ui.screen === 'result' && r" class="result" :class="{ won: r.won }">
    <div class="box">
      <h1>{{ r.won ? '你守住了' : '失 败' }}</h1>
      <h2>{{ reasonText }} · {{ DIFFICULTIES[r.difficulty].name }}</h2>
      <div class="stats">
        <div><span>{{ r.won ? '撑过' : '止步于' }}</span><b>{{ r.won ? '全部 10 夜' : `第 ${r.night} 夜` }}</b></div>
        <div><span>击杀</span><b>{{ r.kills }}<small v-if="r.headshotKills"> · 爆头 {{ r.headshotKills }}</small></b></div>
        <div><span>获得零件</span><b>{{ r.scrap }}</b></div>
        <div><span>用时</span><b>{{ fmtTime(r.time) }}</b></div>
      </div>
      <div v-if="r.medals.total > 0" class="medals">
        <div class="mh">勋 章 <b>+{{ r.medals.total }}</b></div>
        <div v-for="[k, v] in lines" :key="k" class="ml"><span>{{ k }}</span><i>{{ v }}</i></div>
        <div v-if="r.medals.mult !== 1" class="ml"><span>难度倍率</span><i>×{{ r.medals.mult }}</i></div>
        <div class="ml own"><span>现有勋章</span><i>{{ ui.save.meta.medals }}</i></div>
        <div v-if="r.supplies > 0" class="ml own"><span>补给 +{{ r.supplies }}</span><i>现有 {{ ui.save.meta.supplies }}</i></div>
      </div>
      <div v-if="ui.achievements.length" class="achv">
        <div v-for="a in ui.achievements" :key="a">成就达成 · {{ a }}</div>
      </div>
      <div v-if="r.newBest" class="best">新纪录</div>
      <div class="btns">
        <button v-if="ui.canEndless" class="primary" @click="ui.actions.endless()">继续：无尽模式</button>
        <button :class="{ primary: !ui.canEndless }" @click="ui.actions.restart()">再来一局</button>
        <button @click="ui.actions.toLobby()">回大厅</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(40, 0, 0, 0.78), rgba(4, 0, 0, 0.95));
  animation: fade 0.8s ease both;
}
.result.won {
  background: radial-gradient(ellipse at center, rgba(40, 32, 6, 0.78), rgba(4, 3, 0, 0.95));
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
.box {
  text-align: center;
  min-width: 380px;
}
h1 {
  font-size: 62px;
  letter-spacing: 22px;
  color: #d84a3a;
  text-shadow: 0 0 40px rgba(216, 74, 58, 0.6);
  font-weight: 800;
}
.won h1 {
  color: #f0b83a;
  text-shadow: 0 0 40px rgba(240, 184, 58, 0.6);
}
h2 {
  margin: 10px 0 30px;
  font-size: 15px;
  letter-spacing: 8px;
  color: #9aa6b2;
  font-weight: 300;
}
.stats {
  display: grid;
  gap: 10px;
  margin: 0 auto 24px;
  width: 300px;
  text-align: left;
  font-size: 14px;
}
.stats div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 6px;
}
.stats span {
  color: #7e8a96;
  letter-spacing: 4px;
}
.stats b {
  color: #f1e8cc;
  font-size: 18px;
}
.stats small {
  font-size: 12px;
  color: #c8a85a;
}
.medals {
  width: 300px;
  margin: 0 auto 22px;
  padding: 12px 16px;
  border: 1px solid rgba(240, 184, 58, 0.35);
  background: rgba(240, 184, 58, 0.06);
  text-align: left;
  font-size: 13px;
}
.mh {
  letter-spacing: 6px;
  color: #c8a85a;
  margin-bottom: 8px;
}
.mh b {
  float: right;
  font-size: 20px;
  letter-spacing: 0;
  color: #f0b83a;
}
.ml {
  display: flex;
  justify-content: space-between;
  color: #8f9aa6;
  padding: 2px 0;
}
.ml i {
  font-style: normal;
  color: #e6dcc0;
}
.ml.own {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.achv {
  margin: -8px auto 18px;
  font-size: 13px;
  letter-spacing: 2px;
  color: #f0b83a;
  line-height: 1.8;
}
.best {
  display: inline-block;
  margin-bottom: 20px;
  padding: 3px 18px;
  border: 1px solid #f0b83a;
  color: #f0b83a;
  letter-spacing: 8px;
  font-size: 12px;
}
.btns {
  display: flex;
  gap: 14px;
  justify-content: center;
}
button {
  padding: 13px 34px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #d8dee4;
  font-size: 14px;
  letter-spacing: 6px;
  font-family: inherit;
  cursor: pointer;
  transition: 0.15s;
}
button:hover {
  background: #1d2a36;
  border-color: #6fd0e8;
}
button.primary {
  border-color: #e8553f;
  color: #ffb4a4;
}
button.primary:hover {
  background: #e8553f;
  color: #fff;
}
</style>
