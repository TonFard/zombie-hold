<script setup lang="ts">
import { ref, watch } from 'vue';
import { LEVELS } from '../../game/systems/tdm';
import { hud } from '../hud';
import { TDM_KEYS, TDM_LEVEL_NOTES, ui, type TdmLevel } from '../store';
import Settings from './Settings.vue';

/** 暂停菜单分两页：主页（继续 / 重开 / 放弃）和设置页，不再堆在一起。本局加成在 Tab 面板里 */
const page = ref<'main' | 'settings' | 'confirm'>('main');
/** 对战：重新开一场时用哪一档人机（默认还是这一场的） */
const pick = ref<TdmLevel>(1);
watch(
  () => ui.screen,
  (s) => {
    if (s !== 'pause') return;
    page.value = 'main';
    pick.value = hud.tdm.level;
  },
);
/** 对战里「重新开一场」：没换难度就照原样重开，换了就按新选的那一档开（并记在本机） */
const rematch = (): void => {
  if (pick.value === hud.tdm.level) ui.actions.restart();
  else ui.actions.tdm(pick.value);
};
</script>

<template>
  <div v-if="ui.screen === 'pause'" class="pause">
    <div class="box t-panel t-enter">
      <template v-if="page === 'main'">
        <h2>暂停 <small>PAUSED</small></h2>
        <button class="t-btn gold" @click="ui.actions.resume()">继续游戏</button>
        <template v-if="ui.inTraining">
          <button class="t-btn" @click="page = 'settings'">设置</button>
          <button class="t-btn danger" @click="ui.actions.toLobby()">离开训练场</button>
        </template>
        <template v-else-if="ui.inTdm">
          <button class="t-btn" @click="rematch()">{{ pick === hud.tdm.level ? '重新开一场' : `重新开一场 · 人机${LEVELS[pick].name}` }}</button>
          <div class="lv">
            <span>人机难度</span>
            <div class="t-seg" role="group" aria-label="人机难度">
              <button v-for="(l, i) in LEVELS" :key="l.name" :class="{ on: pick === i }" :aria-pressed="pick === i" data-silent @click="pick = i as TdmLevel">{{ l.name }}{{ hud.tdm.level === i ? ' · 本场' : '' }}</button>
            </div>
          </div>
          <p class="lvnote">{{ TDM_LEVEL_NOTES[pick] }}<template v-if="pick !== hud.tdm.level">（重新开一场才生效）</template></p>
          <button class="t-btn" @click="page = 'settings'">设置</button>
          <button class="t-btn danger" @click="ui.actions.toLobby()">退出对战</button>
          <div class="keys" aria-label="对战按键">
            <div v-for="k in TDM_KEYS" :key="k[0]"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
          </div>
          <p class="nob">对战不吃任何局外加成：大厅的生命、改装、星级都不带进来</p>
        </template>
        <template v-else>
          <button class="t-btn" @click="ui.actions.restart()">重新开始</button>
          <button class="t-btn" @click="page = 'settings'">设置</button>
          <button class="t-btn danger" @click="page = 'confirm'">放弃本局</button>
        </template>
        <p v-if="ui.inTdm" class="hint"><kbd>Esc</kbd> 继续</p>
        <p v-else class="hint"><kbd>Esc</kbd> 继续 · 按住 <kbd>Tab</kbd> 查看本局属性</p>
      </template>

      <template v-else-if="page === 'settings'">
        <h2>设置 <small>SYSTEM</small></h2>
        <Settings class="settings" />
        <button class="t-btn" @click="page = 'main'">返回</button>
      </template>

      <template v-else>
        <h2>放弃本局？ <small>ABORT</small></h2>
        <p class="warn">按已经撑过的夜数结算勋章，回到大厅</p>
        <button class="t-btn danger" @click="ui.actions.abandon()">确认放弃</button>
        <button class="t-btn" @click="page = 'main'">取消</button>
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
  background: rgba(3, 5, 8, 0.68);
  backdrop-filter: blur(4px);
  font-family: var(--hud-font);
  color: var(--t-text);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 360px;
  padding: 24px 28px 22px;
  background: var(--t-panel-strong);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
/* 暂停菜单里设置全部显示，宽一点；对战多一张按键表，也宽一点 */
.box:has(.settings) {
  width: 460px;
}
.box:has(.keys) {
  width: 440px;
}
.lv {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.lv .t-seg {
  flex: 1;
  flex-wrap: nowrap;
}
.lv .t-seg button {
  padding: 6px 4px;
  font-size: 12px;
  letter-spacing: 1px;
}
.lvnote {
  margin: -4px 0 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--t-dim);
}
.keys {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 12px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--t-line);
  font-size: 12px;
  color: var(--t-muted);
}
.keys kbd {
  min-width: 22px;
  margin-right: 8px;
  text-align: center;
  color: var(--t-text);
}
.nob {
  font-size: 11px;
  text-align: center;
  color: var(--t-cyan);
}
h2 {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  padding-bottom: 10px;
  margin-bottom: 8px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 8px;
  color: var(--t-gold-soft);
  border-bottom: 1px solid transparent;
  border-image: linear-gradient(90deg, transparent, rgba(240, 184, 58, 0.55), transparent) 1;
}
h2 small {
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 3px;
  font-weight: 400;
  color: var(--t-dim);
}
.t-btn {
  padding: 11px 0;
  font-size: 15px;
}
.t-btn.danger:hover,
.t-btn.danger:focus-visible {
  background: rgba(232, 85, 63, 0.16);
  border-color: var(--t-red);
  box-shadow: 0 0 22px rgba(232, 85, 63, 0.3);
}
.settings {
  margin-bottom: 8px;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  text-align: center;
  color: var(--t-muted);
}
.warn {
  margin-bottom: 6px;
  font-size: 13px;
  text-align: center;
  color: var(--t-gold-soft);
}
kbd {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid var(--t-line-strong);
  border-radius: 2px;
  font: 600 11px/16px var(--hud-font);
}
</style>
