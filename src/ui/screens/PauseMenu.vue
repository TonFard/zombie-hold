<script setup lang="ts">
import { ref, watch } from 'vue';
import { ui } from '../store';
import Settings from './Settings.vue';

/** 暂停菜单分两页：主页（继续 / 重开 / 放弃）和设置页，不再堆在一起。本局加成在 Tab 面板里 */
const page = ref<'main' | 'settings' | 'confirm'>('main');
watch(
  () => ui.screen,
  (s) => {
    if (s === 'pause') page.value = 'main';
  },
);
</script>

<template>
  <div v-if="ui.screen === 'pause'" class="pause">
    <div class="box">
      <template v-if="page === 'main'">
        <h2>暂 停</h2>
        <button class="primary" @click="ui.actions.resume()">继续游戏</button>
        <template v-if="ui.inTraining">
          <button @click="page = 'settings'">设置</button>
          <button class="danger" @click="ui.actions.toLobby()">离开训练场</button>
        </template>
        <template v-else>
          <button @click="ui.actions.restart()">重新开始</button>
          <button @click="page = 'settings'">设置</button>
          <button class="danger" @click="page = 'confirm'">放弃本局</button>
        </template>
        <p class="hint"><kbd>Esc</kbd> 继续 · 按住 <kbd>Tab</kbd> 查看本局属性</p>
      </template>

      <template v-else-if="page === 'settings'">
        <h2>设 置</h2>
        <Settings class="settings" />
        <button @click="page = 'main'">返回</button>
      </template>

      <template v-else>
        <h2>放弃本局？</h2>
        <p class="warn">按已经撑过的夜数结算勋章，回到大厅</p>
        <button class="danger" @click="ui.actions.abandon()">确认放弃</button>
        <button @click="page = 'main'">取消</button>
      </template>
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
  background: rgba(3, 5, 8, 0.72);
  backdrop-filter: blur(4px);
  font-family: var(--hud-font);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  padding: 28px 30px 24px;
  background: rgba(8, 11, 15, 0.92);
  border-top: 2px solid var(--hud-accent);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
h2 {
  margin-bottom: 12px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 10px;
  text-align: center;
  color: #e6dcc0;
}
button {
  padding: 12px 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #d8dee4;
  font: inherit;
  font-size: 15px;
  letter-spacing: 4px;
  cursor: pointer;
  transition: 0.15s;
}
button:hover,
button:focus-visible {
  background: #1d2a36;
  border-color: var(--hud-cyan);
  color: #fff;
  outline: none;
}
button.primary {
  border-color: var(--hud-accent);
  color: var(--hud-accent);
}
button.primary:hover,
button.primary:focus-visible {
  background: var(--hud-accent);
  color: #0b0f14;
}
button.danger:hover,
button.danger:focus-visible {
  background: #3a1c1a;
  border-color: var(--hud-danger);
}
.settings {
  margin-bottom: 8px;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  text-align: center;
  color: var(--hud-muted);
}
.warn {
  margin-bottom: 6px;
  font-size: 13px;
  text-align: center;
  color: #c8b8a0;
}
kbd {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid var(--hud-line-strong);
  border-radius: 2px;
  font: 600 11px/16px var(--hud-font);
}
</style>
