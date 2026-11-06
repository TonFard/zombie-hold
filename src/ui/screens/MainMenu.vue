<script setup lang="ts">
import { computed, ref } from 'vue';
import { version } from '../../../package.json';
import { CHAPTER_BY_ID } from '../../game/data/chapters';
import { DIFFICULTIES } from '../../game/data/difficulty';
import { fmtTime, ui } from '../store';

/**
 * 标题页（UI-PLAN 3.1）：电影式主菜单。左侧品牌 + 纵向菜单，右侧透出 3D 据点（镜头在 boot.ts 里缓缓环绕）。
 * 音量 / 灵敏度 / 画质全部移进大厅的「设置」；操作说明改成一个按需打开的浮层。
 */
const s = computed(() => ui.save);
const meta = computed(() => ui.save.meta);
const cp = computed(() => ui.checkpoint);
const chapter = computed(() => CHAPTER_BY_ID[meta.value.lastChapter ?? 'outpost']);
/** 副标题里的"第 n 天 · 地点"：有存档用存档的天数，否则是剧情里的第 41 天 */
const status = computed(() => (cp.value ? `第 ${cp.value.night} 天 · ${DIFFICULTIES[cp.value.difficulty].name}` : '疫情爆发第 41 天'));
/** Electron 窗口里才有"退出游戏"（浏览器里关不掉自己的标签页） */
const desktop = /Electron/i.test(navigator.userAgent);
const help = ref(false);

const openSettings = (): void => {
  ui.actions.enterLobby();
  ui.lobbyTab = 'settings';
};
const quit = (): void => window.close();
</script>

<template>
  <div v-if="ui.screen === 'menu'" class="menu">
    <div class="shade" aria-hidden="true"></div>
    <div class="scan" aria-hidden="true"></div>

    <main class="left t-enter">
      <div class="logo">
        <h1>黎明</h1>
        <h2>DAWN <span>·</span> SURVIVAL PROTOCOL</h2>
      </div>
      <p class="tag">黎明之后，没有安全区。</p>
      <p class="where"><i></i>{{ status }} · {{ chapter.place }}</p>

      <nav class="items" aria-label="主菜单">
        <button v-if="cp" class="item hot" @click="ui.actions.continueRun()">
          <b>继续生存</b><small>CONTINUE · 第 {{ cp.night }} 天 · 生命 {{ cp.hp }}/{{ cp.maxHp }}</small>
        </button>
        <button class="item" :class="{ hot: !cp }" @click="ui.actions.enterLobby()">
          <b>{{ cp ? '指挥中心' : '开始生存' }}</b><small>{{ cp ? 'COMMAND · 出征 / 武器台 / 军械库' : 'NEW GAME · 进入据点' }}</small>
        </button>
        <button class="item" @click="ui.actions.training()"><b>训练场</b><small>TRAINING · 试枪、练爆头</small></button>
        <button class="item" @click="help = true"><b>操作说明</b><small>CONTROLS</small></button>
        <button class="item" @click="openSettings()"><b>设置</b><small>SETTINGS · 音量 / 画质 / 灵敏度</small></button>
        <button v-if="desktop" class="item" @click="quit()"><b>退出游戏</b><small>EXIT</small></button>
      </nav>
    </main>

    <footer class="bar">
      <span class="live"><i></i>SURVIVAL STATUS: {{ cp ? 'ACTIVE' : 'STANDBY' }}</span>
      <template v-if="s.runs > 0">
        <span>最远 <b>第 {{ s.bestNight }} 夜</b></span>
        <span>单局击杀 <b>{{ s.bestKills }}</b></span>
        <span>通关 <b>{{ s.wins }}</b></span>
        <span v-if="s.bestWinTime > 0">最快 <b>{{ fmtTime(s.bestWinTime) }}</b></span>
      </template>
      <span class="ver">BUILD {{ version }}</span>
    </footer>

    <!-- 操作说明浮层 -->
    <div v-if="help" class="help-wrap" role="dialog" aria-modal="true" aria-label="操作说明" @click.self="help = false" @keydown.esc="help = false">
      <div class="help t-panel t-enter">
        <div class="t-head">操作说明 <small>CONTROLS</small></div>
        <div class="cols">
          <div class="keys">
            <div><b>W A S D</b><span>移动</span></div>
            <div><b>鼠标</b><span>转动视角（点击画面锁定鼠标）</span></div>
            <div><b>左键 / 右键</b><span>射击 / 瞄准</span></div>
            <div><b>Shift</b><span>冲刺</span></div>
            <div><b>C</b><span>蹲下；冲刺中按 = 滑铲</span></div>
            <div><b>R</b><span>换弹</span></div>
            <div><b>1 – 7</b><span>切换武器</span></div>
            <div><b>V</b><span>近战 + 推搡</span></div>
            <div><b>G / B</b><span>手雷 / 切换爆炸 · 燃烧</span></div>
          </div>
          <div class="keys">
            <div><b>T</b><span>手电筒（会引来僵尸）</span></div>
            <div><b>Q</b><span>发电机旁：电击脉冲</span></div>
            <div><b>F</b><span>建造模式</span></div>
            <div><b>E</b><span>工坊 / 修理 / 搜刮</span></div>
            <div><b>I</b><span>检视武器</span></div>
            <div><b>Tab</b><span>属性 · 武器 · 战况</span></div>
            <div><b>Enter</b><span>提前开始夜晚</span></div>
            <div><b>Esc</b><span>暂停</span></div>
          </div>
        </div>
        <ul class="rules">
          <li><b>白天</b>搜刮零件箱，建路障、炮塔、地刺，在工坊升级武器。</li>
          <li><b>夜晚</b>僵尸从各个入口涌向发电机。路障能引导它们绕路，盯着右上角的雷达。</li>
          <li><b>黎明</b>每撑过一夜，三张卡牌选一张强化。你倒下或发电机被毁就输了，撑过第 10 夜获胜。</li>
        </ul>
        <button class="t-btn close" autofocus @click="help = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  inset: 0;
  z-index: 60;
  color: var(--t-text);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
}
/* 只压暗左边 45%：右边留给 3D 场景 */
.shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(4, 6, 10, 0.94) 0%, rgba(4, 6, 10, 0.82) 26%, rgba(4, 6, 10, 0.3) 46%, transparent 68%), linear-gradient(0deg, rgba(4, 6, 10, 0.75), transparent 22%);
  pointer-events: none;
}
/* 很淡的扫描线 */
.scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
.left {
  position: absolute;
  left: 7vw;
  top: 50%;
  transform: translateY(-54%);
  width: min(460px, 40vw);
}
.left.t-enter {
  animation-name: menu-in;
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(calc(-54% + 10px));
  }
  to {
    opacity: 1;
    transform: translateY(-54%);
  }
}
.logo h1 {
  font-size: 68px;
  line-height: 1;
  letter-spacing: 22px;
  color: var(--t-red);
  font-weight: 800;
  text-shadow: 0 0 40px rgba(232, 85, 63, 0.45), 0 2px 6px #000;
}
.logo h2 {
  margin-top: 14px;
  font-family: var(--t-mono);
  font-size: 15px;
  font-weight: 400;
  letter-spacing: 6px;
  color: var(--t-gold-soft);
}
.logo h2 span {
  color: var(--t-red);
}
.tag {
  margin-top: 26px;
  font-size: 16px;
  letter-spacing: 5px;
  color: #c9c1ab;
}
.where {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.where i,
.live i {
  width: 6px;
  height: 6px;
  background: var(--t-cyan);
  box-shadow: 0 0 8px var(--t-cyan);
  animation: blink 2.4s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.items {
  margin-top: 42px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 1px solid var(--t-line);
}
.item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 0 9px 22px;
  background: transparent;
  border: 0;
  color: #b8c1ca;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s var(--t-ease), padding 0.15s var(--t-ease), background 0.15s var(--t-ease);
}
.item b {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 8px;
}
.item small {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--t-dim);
}
/* 选中指示：左边一道金线 + 三角 */
.item::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--t-gold);
  transform: scaleY(0);
  transition: transform 0.15s var(--t-ease);
}
.item:hover,
.item:focus-visible {
  outline: none;
  color: #fff;
  padding-left: 30px;
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.12), transparent 70%);
}
.item:hover::before,
.item:focus-visible::before {
  transform: scaleY(1);
}
.item:hover small,
.item:focus-visible small {
  color: var(--t-gold-soft);
}
.item.hot b {
  color: #ffc9bb;
}
.item.hot::after {
  content: '▸';
  position: absolute;
  left: 6px;
  top: 10px;
  color: var(--t-red);
  font-size: 14px;
}
.item.hot:hover::after,
.item.hot:focus-visible::after {
  left: 12px;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 12px 7vw;
  border-top: 1px solid var(--t-line);
  background: rgba(4, 6, 10, 0.55);
  font-family: var(--t-mono);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-dim);
}
.bar b {
  color: var(--t-gold-soft);
  font-weight: 600;
}
.live {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--t-cyan);
}
.ver {
  margin-left: auto;
}
.help-wrap {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  background: rgba(4, 6, 10, 0.55);
}
.help {
  width: min(720px, 90vw);
  padding: 22px 26px;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 28px;
}
.keys {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #aeb8c2;
}
.keys div {
  display: flex;
  gap: 12px;
}
.keys b {
  min-width: 92px;
  font-family: var(--t-mono);
  color: #f1e8cc;
  font-weight: 600;
}
.rules {
  list-style: none;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--t-line);
  display: grid;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: #aeb8c2;
}
.rules b {
  color: var(--t-gold);
  margin-right: 10px;
}
.close {
  margin-top: 16px;
}
@media (prefers-reduced-motion: reduce) {
  .where i,
  .live i {
    animation: none;
  }
}
</style>
