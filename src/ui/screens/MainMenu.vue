<script setup lang="ts">
import { computed } from 'vue';
import { fmtTime, ui } from '../store';
import Settings from './Settings.vue';

const s = computed(() => ui.save);
const hasRecord = computed(() => s.value.runs > 0);
</script>

<template>
  <div v-if="ui.screen === 'menu'" class="menu">
    <div class="left">
      <div class="logo">
        <h1>尸潮</h1>
        <h2>死 守</h2>
      </div>
      <p class="tag">守住发电机，撑过十个夜晚</p>

      <button class="start" @click="ui.actions.enterLobby()">进 入 据 点</button>
      <div v-if="ui.checkpoint" class="cont">
        有一局没打完（第 {{ ui.checkpoint.night }} 天）
        <button data-silent @click="ui.actions.continueRun()">继续</button>
      </div>
      <Settings class="vol" />

      <div v-if="hasRecord" class="record">
        <div><span>最远</span><b>第 {{ s.bestNight }} 夜</b></div>
        <div><span>单局击杀</span><b>{{ s.bestKills }}</b></div>
        <div><span>通关</span><b>{{ s.wins }} 次</b></div>
        <div v-if="s.bestWinTime > 0"><span>最快通关</span><b>{{ fmtTime(s.bestWinTime) }}</b></div>
      </div>
    </div>

    <div class="right">
      <div class="panel">
        <h3>操作</h3>
        <div class="keys">
          <div><b>W A S D</b><span>前后左右移动</span></div>
          <div><b>鼠标</b><span>转动视角（点击画面锁定鼠标）</span></div>
          <div><b>左键</b><span>射击 / 建造时放置</span></div>
          <div><b>右键</b><span>瞄准（建造模式下拆除）</span></div>
          <div><b>Shift</b><span>冲刺</span></div>
          <div><b>C</b><span>蹲下；冲刺中按 = 滑铲</span></div>
          <div><b>V</b><span>近战 + 推搡（冷却 4 秒）</span></div>
          <div><b>G / B</b><span>扔手雷 / 切换爆炸 · 燃烧</span></div>
          <div><b>T</b><span>手电筒（会引来僵尸）</span></div>
          <div><b>Q</b><span>发电机旁：电击脉冲</span></div>
          <div><b>R</b><span>换弹</span></div>
          <div><b>I</b><span>检视武器</span></div>
          <div><b>1 – 7</b><span>切换武器</span></div>
          <div><b>F</b><span>建造模式（准星指的格子）</span></div>
          <div><b>E</b><span>工坊旁：打开武器工坊（白天）；其他时候修理附近建筑 / 发电机</span></div>
          <div><b>Enter</b><span>提前开始夜晚</span></div>
          <div><b>Esc</b><span>暂停</span></div>
        </div>
      </div>
      <div class="panel">
        <h3>玩法</h3>
        <ul>
          <li><b>白天</b>搜刮地图上的零件箱，建路障、炮塔、地刺，在工坊升级武器。</li>
          <li><b>夜晚</b>僵尸从六个入口涌来，目标是发电机。路障能引导它们绕路，堵死了它们才会拆。看不到身后？盯着右上角的雷达。</li>
          <li><b>黎明</b>每撑过一夜，从三张卡牌里选一张强化。</li>
          <li><b>胜负</b>你死亡或发电机被毁就输了；撑过第 10 夜获胜。</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 7vw;
  background: linear-gradient(90deg, rgba(5, 8, 12, 0.92) 0%, rgba(5, 8, 12, 0.6) 42%, rgba(5, 8, 12, 0.15) 100%);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
}
.left {
  width: 420px;
}
.logo h1 {
  font-size: 92px;
  line-height: 1;
  letter-spacing: 26px;
  color: #e8553f;
  text-shadow: 0 0 50px rgba(232, 85, 63, 0.55);
  font-weight: 800;
}
.logo {
  width: fit-content;
}
.logo h2 {
  font-size: 40px;
  margin-top: 8px;
  padding-right: 26px;
  text-align: justify;
  text-align-last: justify;
  color: #d9c9a0;
  font-weight: 300;
}
.tag {
  margin: 24px 0 36px;
  font-size: 15px;
  letter-spacing: 6px;
  color: #8fa0b2;
}
.start {
  padding: 16px 64px;
  background: transparent;
  border: 1px solid #e8553f;
  color: #ffb4a4;
  font-size: 18px;
  letter-spacing: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: 0.2s;
}
.start:hover {
  background: #e8553f;
  color: #fff;
  box-shadow: 0 0 36px rgba(232, 85, 63, 0.6);
}
.cont {
  margin-top: 14px;
  font-size: 13px;
  color: #8fa0b2;
  letter-spacing: 2px;
}
.cont button {
  margin-left: 10px;
  padding: 4px 14px;
  background: transparent;
  border: 1px solid #f0b83a;
  color: #f0b83a;
  font-family: inherit;
  cursor: pointer;
}
.cont button:hover {
  background: #f0b83a;
  color: #0b0f14;
}
.vol {
  width: 340px;
  margin-top: 28px;
}
.record {
  margin-top: 32px;
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 10px 36px;
  width: fit-content;
  font-size: 13px;
  color: #7e8a96;
}
.record span {
  letter-spacing: 3px;
  margin-right: 10px;
}
.record b {
  color: #e6dcc0;
  font-size: 16px;
}
.right {
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  background: rgba(10, 14, 18, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 16px 20px;
  backdrop-filter: blur(3px);
}
h3 {
  font-size: 12px;
  letter-spacing: 8px;
  color: #6fd0e8;
  margin-bottom: 10px;
  font-weight: 400;
}
.keys {
  display: grid;
  gap: 5px;
  font-size: 13px;
  color: #aeb8c2;
}
.keys div {
  display: flex;
  gap: 14px;
}
.keys b {
  min-width: 78px;
  color: #f1e8cc;
  font-weight: 600;
}
ul {
  list-style: none;
  display: grid;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: #aeb8c2;
}
li b {
  color: #f0b83a;
  margin-right: 10px;
}
</style>
