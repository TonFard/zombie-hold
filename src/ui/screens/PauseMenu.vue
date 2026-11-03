<script setup lang="ts">
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
      <p class="note">每个白天开始时自动保存；夜里退出会丢掉这一夜的进度。放弃会按已经撑过的夜数结算勋章</p>
      <Settings class="slider" />
      <p>按 Esc 继续</p>
    </div>
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
</style>
