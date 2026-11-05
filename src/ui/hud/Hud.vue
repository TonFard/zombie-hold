<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../hud';
import { MAX_TIER } from '../../game/data/weapons';
import Radar from './Radar.vue';
import { fmtTime, ui } from '../store';

const bossPct = computed(() => Math.max(0, (hud.bossHp / hud.bossMax) * 100));
const hpPct = computed(() => Math.max(0, (hud.hp / hud.maxHp) * 100));
const stPct = computed(() => Math.max(0, (hud.stamina / hud.maxStamina) * 100));
const corePct = computed(() => Math.max(0, (hud.coreHp / hud.coreMaxHp) * 100));
const lowHp = computed(() => hud.hp / hud.maxHp < 0.3);
/** 弹匣剩余比例：弹药条平时显示它，换弹时改成换弹进度 */
const magPct = computed(() => (hud.magMax > 0 ? Math.max(0, (hud.mag / hud.magMax) * 100) : 0));
/** 弹匣快空（≤ 25%）时弹药数变琥珀色提醒 */
const lowMag = computed(() => hud.mag > 0 && hud.magMax > 0 && hud.mag / hud.magMax <= 0.25);
/** 姿态标签：蹲伏 / 滑铲 */
const stance = computed(() => (hud.sliding ? '滑铲' : hud.crouch > 0.5 ? '蹲伏' : ''));
/** 瞄准镜完全举起：画镜框，隐藏普通准星 */
const scoped = computed(() => hud.scope && hud.ads > 0.85);
/** 腰射准星随瞄准淡出（铁瞄 / 红点由枪模自己提供） */
const crossAlpha = computed(() => (hud.buildMode ? 1 : Math.max(0, 1 - hud.ads * 1.6)));
/** 机瞄瞄准时留一个很淡的中心点：背光很强（发电机、爆炸）时照门看不清，也知道子弹往哪去 */
const adsDot = computed(() => (!hud.scope && !hud.buildMode ? Math.max(0, hud.ads - 0.6) * 0.9 : 0));
/** 减少动态效果：零件数直接跳到真实值，不滚动 */
const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const scrapNum = computed(() => (reduced ? hud.scrap : hud.scrapShown));
const gainOn = computed(() => hud.scrapGain.life > 0.02 && hud.scrapGain.n > 0);
/** 白天才提示零件箱（夜里去搜刮是送死，不催） */
const showBoxes = computed(() => hud.phase === 'day' && hud.boxesTotal > 0 && hud.alive && ui.screen !== 'training');
</script>

<template>
  <div v-if="ui.screen !== 'menu' && ui.screen !== 'lobby' && ui.screen !== 'result'" class="hud">
    <!-- 受伤时的红色边缘 -->
    <div class="hurt" :style="{ opacity: hud.hurt * 0.85 }"></div>
    <div v-if="lowHp && hud.alive" class="low-hp"></div>

    <!-- 左上：零件和击杀；下面是零件箱进度和本局卡牌 -->
    <div class="tlcol">
      <div class="tl" :class="{ gain: gainOn }">
        <div class="stat">
          <span class="ico scrap">◆</span>
          <span class="num">{{ scrapNum }}</span>
          <span class="lbl">零件</span>
          <span v-if="gainOn" :key="hud.scrapGain.bump" class="gainchip" :class="{ box: hud.scrapGain.box }" :style="{ opacity: Math.min(1, hud.scrapGain.life * 2.2) }">
            +{{ hud.scrapGain.n }}<small v-if="hud.scrapGain.box">零件箱</small>
          </span>
        </div>
        <i class="sep"></i>
        <div class="stat">
          <span class="ico">✕</span>
          <span class="num sm">{{ hud.kills }}</span>
          <span class="lbl">击杀</span>
        </div>
      </div>
      <div v-if="showBoxes" class="boxes" :class="{ near: hud.boxDist < 6 }">
        <i class="bx"></i>
        <span>零件箱</span>
        <b>{{ hud.boxesLeft }}</b><span class="of">/ {{ hud.boxesTotal }}</span>
        <template v-if="hud.boxesLeft > 0">
          <i class="vr"></i>
          <span>最近 <b>{{ Math.round(hud.boxDist) }}</b> 米</span>
        </template>
        <template v-else><i class="vr"></i><span>今天已搜刮完</span></template>
      </div>
      <div v-if="hud.buffs.length" class="buffs" aria-label="本局卡牌">
        <span v-for="b in hud.buffs" :key="b.id" class="buff" :class="[b.rarity, { proc: (hud.procs[b.id] ?? 0) > 0.05 }]" :style="{ '--proc': hud.procs[b.id] ?? 0 }">
          {{ b.name }}<em v-if="b.n > 1">×{{ b.n }}</em>
        </span>
      </div>
    </div>

    <!-- 上中：发电机、阶段、首领 -->
    <div class="tc">
      <div class="obj-head">
        <span class="obj-name">发电机</span>
        <span class="obj-pct" :class="{ hit: hud.coreHurt > 0.05 }">{{ Math.ceil(corePct) }}%</span>
      </div>
      <div class="core-bar" :class="{ hit: hud.coreHurt > 0.05, low: corePct < 35 }"><div class="fill" :style="{ width: corePct + '%' }"></div></div>
      <div v-if="hud.phase === 'day'" class="phase">
        <span class="p day">白天 · 第 {{ hud.night }} 天</span>
        <i class="vr"></i>
        <span class="tm">{{ fmtTime(hud.dayTimer) }}</span>
        <i class="vr"></i>
        <span class="k"><kbd>Enter</kbd>开始夜晚</span>
      </div>
      <div v-else-if="hud.phase === 'night'" class="phase">
        <span class="p night">第 {{ hud.night }} 夜</span>
        <i class="vr"></i>
        <span class="k">剩余</span>
        <span class="tm">{{ hud.remaining }}</span>
      </div>
      <div v-if="hud.bossName" class="boss">
        <div class="boss-head">
          <i class="bmk"></i>
          <span class="bn">{{ hud.bossName }}</span>
          <span class="bp">{{ Math.ceil(bossPct) }}%</span>
        </div>
        <div class="bb"><div class="bf" :style="{ width: bossPct + '%' }"></div></div>
      </div>
    </div>

    <!-- 瞄准镜：圆形视野 + 十字线 + 暗角 -->
    <div v-if="scoped && hud.alive" class="scope">
      <div class="lens"></div>
      <i class="h"></i><i class="v"></i>
      <i class="mil" v-for="n in 4" :key="n" :style="{ left: `calc(50% + ${(n - 2.5) * 60}px)` }"></i>
    </div>

    <div v-if="hud.benchNear" class="prompt"><kbd>E</kbd>打开武器工坊</div>

    <!-- 左下：生命和体力 -->
    <div class="bl" :class="{ low: lowHp }">
      <div class="vit">
        <span class="cross-ico">✚</span>
        <span class="hp-num">{{ hud.hp }}</span>
        <span class="hp-max">/ {{ hud.maxHp }}</span>
        <span v-if="hud.healPop.life > 0.02" :key="hud.healPop.bump" class="pop heal" :style="{ opacity: Math.min(1, hud.healPop.life * 2) }">+{{ Math.round(hud.healPop.n) }}<small>嗜血</small></span>
      </div>
      <div class="hp">
        <div class="fill" :style="{ width: hpPct + '%' }"></div>
        <div class="ticks"></div>
      </div>
      <div class="stamina" :class="{ tired: stPct < 25 }"><div class="fill" :style="{ width: stPct + '%' }"></div></div>
    </div>

    <!-- 右下：武器与弹药 -->
    <div class="br">
      <div class="wrow">
        <div class="pips">
          <span v-for="i in MAX_TIER" :key="i" class="pip" :class="{ on: i <= hud.tier, late: i > 5 }"></span>
        </div>
        <div class="wname">{{ hud.weaponName }}</div>
      </div>
      <div class="ammo" :class="{ empty: hud.mag === 0, lowmag: lowMag }">
        <span v-if="hud.ammoPop.life > 0.02" :key="hud.ammoPop.bump" class="pop ammo-pop" :style="{ opacity: Math.min(1, hud.ammoPop.life * 2) }">+{{ hud.ammoPop.n }}<small>返弹</small></span>
        <span class="cur">{{ hud.mag }}</span><span class="max">/ {{ hud.magMax }}</span>
      </div>
      <div class="abar" :class="{ reloading: hud.reload >= 0 }">
        <div class="fill" :style="{ width: (hud.reload >= 0 ? hud.reload * 100 : magPct) + '%' }"></div>
      </div>
      <div class="meta">
        <span v-if="stance" class="stance">{{ stance }}</span>
        <span class="range">射程 <b>{{ hud.range }}</b> 米</span>
      </div>
      <div class="hint" :class="{ busy: hud.reload >= 0 }">
        <template v-if="hud.reload >= 0">换弹中…</template>
        <template v-else-if="hud.mag === 0"><kbd>R</kbd>换弹</template>
      </div>
    </div>

    <Radar v-if="hud.alive" />

    <!-- 受击方向：屏幕边缘的红色弧线指向打你的僵尸 -->
    <div v-for="(m, i) in hud.hurtMarks" :key="i" class="hurtdir" :style="{ transform: `translate(-50%, -50%) rotate(${m.a}rad)`, opacity: Math.min(1, m.life * 1.3) }"></div>

    <!-- 命中 / 击杀标记 -->
    <div v-if="hud.alive && (hud.hit > 0.02 || hud.kill > 0.02)" class="hitm" :class="{ crit: hud.hitCrit, head: hud.hitHead, kill: hud.kill > 0.02 }" :style="{ opacity: Math.max(hud.hit, hud.kill) }">
      <i v-for="n in 4" :key="n" :style="{ transform: `rotate(${45 + (n - 1) * 90}deg) translateY(${hud.kill > 0.02 ? -15 : -12}px)` }"></i>
    </div>

    <!-- 准星：固定在屏幕中心；建造模式下按能不能放置变色 -->
    <div v-if="hud.locked && hud.alive && !scoped && crossAlpha > 0.01" class="cross" :style="{ opacity: crossAlpha }" :class="{ ok: hud.buildMode && hud.buildOk, bad: hud.buildMode && !hud.buildOk }">
      <i class="t" :style="{ transform: `translate(-50%, ${-hud.spread - 8}px)` }"></i>
      <i class="b" :style="{ transform: `translate(-50%, ${hud.spread}px)` }"></i>
      <i class="l" :style="{ transform: `translate(${-hud.spread - 8}px, -50%)` }"></i>
      <i class="r" :style="{ transform: `translate(${hud.spread}px, -50%)` }"></i>
      <i class="dot"></i>
    </div>

    <div v-if="hud.locked && hud.alive && adsDot > 0.01" class="adsdot" :style="{ opacity: adsDot }"></div>

    <div v-if="!hud.locked && hud.alive && (ui.screen === 'play' || ui.screen === 'training')" class="lockhint">点击画面，继续游戏</div>
    <div v-if="!hud.alive" class="dead"><span>你倒下了</span></div>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  font-family: var(--hud-font);
  font-variant-numeric: tabular-nums;
  color: var(--hud-text);
  text-shadow: var(--hud-shadow);
}
kbd {
  display: inline-block;
  min-width: 18px;
  height: 18px;
  margin-right: 6px;
  padding: 0 4px;
  border: 1px solid var(--hud-line-strong);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  font: 600 11px/16px var(--hud-font);
  text-align: center;
  color: var(--hud-text);
  text-shadow: none;
  vertical-align: middle;
}

/* ---------- 屏幕效果 ---------- */
.hurt {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(120, 0, 0, 0) 45%, rgba(170, 10, 10, 0.9) 100%);
  transition: opacity 0.05s;
}
.low-hp {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 160px 36px rgba(140, 0, 0, 0.5);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

/* ---------- 左上：零件 / 击杀 / 零件箱 / 卡牌 ---------- */
.tlcol {
  position: absolute;
  left: 24px;
  top: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: min(360px, 30vw);
}
.tl {
  display: flex;
  transition: box-shadow 0.25s, border-color 0.25s;
  align-items: center;
  gap: 14px;
  padding: 6px 16px 6px 12px;
  background: linear-gradient(90deg, var(--hud-panel), rgba(9, 13, 18, 0));
  border-left: 2px solid var(--hud-accent);
}
.stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.sep {
  width: 1px;
  height: 20px;
  background: var(--hud-line);
}
.ico {
  font-size: 12px;
  color: var(--hud-muted);
}
.ico.scrap {
  color: var(--hud-accent);
  font-size: 14px;
}
.num {
  font-family: var(--hud-num);
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  color: var(--hud-text);
}
.num.sm {
  font-size: 20px;
  color: #d6dce2;
}
.lbl {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
/* 有零件进账：左边框和数字发光 */
.tl.gain {
  border-left-color: #ffd257;
  box-shadow: -6px 0 14px -6px rgba(255, 190, 40, 0.8);
}
.tl.gain .num:not(.sm) {
  color: #ffe08a;
  text-shadow: 0 0 10px rgba(255, 190, 40, 0.6), var(--hud-shadow);
}
.tl.gain .ico.scrap {
  animation: spin 0.5s ease-out;
}
@keyframes spin {
  from {
    transform: scale(1.6) rotate(-90deg);
  }
}
.gainchip {
  align-self: center;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin-left: 4px;
  padding: 1px 7px;
  font-family: var(--hud-num);
  font-size: 17px;
  font-weight: 700;
  color: #1a1203;
  text-shadow: none;
  background: linear-gradient(90deg, #ffd257, #f0a83a);
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
  animation: chip 0.28s ease-out;
}
.gainchip small {
  font-family: var(--hud-font);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
}
.gainchip.box {
  background: linear-gradient(90deg, #fff0b0, #ffc040);
}
@keyframes chip {
  from {
    transform: translateY(6px) scale(1.25);
    filter: brightness(1.6);
  }
}
/* 零件箱进度 */
.boxes {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 10px 0 8px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--hud-muted);
  background: linear-gradient(90deg, var(--hud-panel), rgba(9, 13, 18, 0));
}
.boxes b {
  font-family: var(--hud-num);
  font-size: 13px;
  font-weight: 600;
  color: var(--hud-text);
}
.boxes .of {
  font-family: var(--hud-num);
  color: var(--hud-dim);
}
.boxes .vr {
  width: 1px;
  height: 10px;
  background: var(--hud-line);
}
.boxes .bx {
  width: 9px;
  height: 7px;
  border: 1px solid var(--hud-accent);
  box-shadow: 0 0 5px rgba(240, 184, 58, 0.7);
}
.boxes.near {
  color: #ffe08a;
}
.boxes.near .bx {
  background: var(--hud-accent);
  animation: breathe 0.9s ease-in-out infinite;
}
/* 本局卡牌：按稀有度上色的小标签，触发时亮一下 */
.buffs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.buff {
  --c: #a8b4c0;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  height: 18px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  letter-spacing: 0.5px;
  color: var(--hud-text);
  background: rgba(9, 13, 18, 0.6);
  border-left: 2px solid var(--c);
  box-shadow: 0 0 calc(var(--proc) * 12px) var(--c);
  white-space: nowrap;
}
.buff em {
  font-style: normal;
  font-family: var(--hud-num);
  font-size: 11px;
  color: var(--c);
}
.buff.rare {
  --c: #5ab8f0;
}
.buff.epic {
  --c: #d08af0;
}
.buff.curse {
  --c: #e8553f;
}
.buff.proc {
  background: color-mix(in srgb, var(--c) calc(var(--proc) * 45%), rgba(9, 13, 18, 0.6));
}
/* 回血 / 返弹的小数字 */
.pop {
  align-self: center;
  margin-left: 8px;
  font-family: var(--hud-num);
  font-size: 16px;
  font-weight: 700;
  animation: chip 0.28s ease-out;
}
.pop small {
  margin-left: 3px;
  font-family: var(--hud-font);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
}
.pop.heal {
  color: #7dff9a;
  text-shadow: 0 0 8px rgba(80, 255, 120, 0.5), var(--hud-shadow);
}
.ammo-pop {
  margin: 0 8px 0 0;
  color: #66e0ff;
  text-shadow: 0 0 8px rgba(100, 220, 255, 0.5), var(--hud-shadow);
}
@media (prefers-reduced-motion: reduce) {
  .gainchip,
  .pop,
  .tl.gain .ico.scrap,
  .boxes.near .bx {
    animation: none;
  }
}

/* ---------- 上中：目标条 ---------- */
.tc {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  width: min(420px, 46vw);
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.obj-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--hud-cyan);
}
.obj-name::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 8px;
  vertical-align: 1px;
  background: var(--hud-cyan);
  transform: rotate(45deg);
  box-shadow: 0 0 6px var(--hud-cyan);
}
.obj-pct {
  font-family: var(--hud-num);
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--hud-text);
}
.obj-pct.hit {
  color: #ff7a64;
}
.core-bar {
  position: relative;
  height: 6px;
  background: rgba(0, 0, 0, 0.55);
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%);
  transition: box-shadow 0.15s;
}
.core-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #2b8fa8, #7fe8ff);
  transition: width 0.15s linear;
}
.core-bar.low .fill {
  background: linear-gradient(90deg, #a8452b, #ff8a5a);
}
.core-bar.hit .fill {
  background: linear-gradient(90deg, #c03a2a, #ff9a80);
}
.phase {
  align-self: center;
  margin-top: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--hud-muted);
  background: var(--hud-panel);
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%);
  white-space: nowrap;
}
.phase .vr {
  width: 1px;
  height: 14px;
  background: var(--hud-line);
}
.phase .p {
  font-size: 14px;
  font-weight: 600;
}
.phase .p.day {
  color: var(--hud-accent);
}
.phase .p.night {
  color: var(--hud-danger);
}
.phase .tm {
  font-family: var(--hud-num);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--hud-text);
}
.phase .k {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--hud-muted);
}
.boss {
  margin-top: 10px;
}
.boss-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.bmk {
  width: 7px;
  height: 7px;
  align-self: center;
  background: var(--hud-danger);
  transform: rotate(45deg);
  box-shadow: 0 0 6px rgba(232, 85, 63, 0.8);
}
.bn {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 4px;
  color: #f0a04b;
}
.bp {
  font-family: var(--hud-num);
  font-size: 13px;
  color: var(--hud-text);
}
.bb {
  height: 8px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(240, 140, 60, 0.45);
  padding: 1px;
}
.bf {
  height: 100%;
  background: linear-gradient(90deg, #8a2a18, #e8553f 60%, #f0a04b);
  transition: width 0.12s linear;
}

/* ---------- 交互提示 ---------- */
.prompt {
  position: absolute;
  left: 50%;
  top: 63%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  padding: 6px 16px 6px 8px;
  background: var(--hud-panel-strong);
  border-left: 2px solid var(--hud-accent);
  color: var(--hud-text);
  letter-spacing: 2px;
  font-size: 13px;
}
.prompt kbd {
  margin-right: 10px;
  border-color: var(--hud-accent);
  color: var(--hud-accent);
}

/* ---------- 左下：生命 / 体力 ---------- */
.bl {
  position: absolute;
  left: 28px;
  bottom: 28px;
  width: 280px;
}
.vit {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.cross-ico {
  font-size: 14px;
  color: var(--hud-text);
}
.hp-num {
  font-family: var(--hud-num);
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  color: var(--hud-text);
}
.hp-max {
  font-family: var(--hud-num);
  font-size: 14px;
  color: var(--hud-dim);
}
.bl.low .cross-ico,
.bl.low .hp-num {
  color: #ff5a45;
  animation: blink 1.1s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.45;
  }
}
.hp {
  position: relative;
  height: 10px;
  background: rgba(0, 0, 0, 0.55);
  clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
}
.hp .fill {
  height: 100%;
  background: linear-gradient(90deg, #c9d3d8, #ffffff);
  transition: width 0.12s linear;
}
.bl.low .hp .fill {
  background: linear-gradient(90deg, #a01010, #ff4a32);
}
/* 每 10% 一道分隔，像 3A 游戏的分段血条 */
.hp .ticks {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 2px), rgba(0, 0, 0, 0.55) calc(10% - 2px), rgba(0, 0, 0, 0.55) 10%);
}
.stamina {
  margin-top: 4px;
  width: 86%;
  height: 3px;
  background: rgba(0, 0, 0, 0.5);
}
.stamina .fill {
  height: 100%;
  background: var(--hud-cyan);
}
.stamina.tired .fill {
  background: #e8a03f;
}

/* ---------- 右下：武器 ---------- */
.br {
  position: absolute;
  right: 28px;
  bottom: 22px;
  width: 220px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.wrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wname {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 3px;
  color: var(--hud-text);
}
.pips {
  display: flex;
  gap: 3px;
}
.pip {
  width: 10px;
  height: 5px;
  background: rgba(255, 255, 255, 0.22);
  clip-path: polygon(2px 0, 100% 0, calc(100% - 2px) 100%, 0 100%);
}
.pip.on {
  background: var(--hud-accent);
}
.pip.late.on {
  background: #ff7a3a;
}
.ammo {
  display: flex;
  align-items: baseline;
  margin-top: 2px;
  font-family: var(--hud-num);
  line-height: 1;
}
.ammo .cur {
  font-size: 56px;
  font-weight: 600;
  color: var(--hud-text);
}
.ammo .max {
  margin-left: 6px;
  font-size: 20px;
  color: var(--hud-dim);
}
.ammo.lowmag .cur {
  color: var(--hud-accent);
}
.ammo.empty .cur {
  color: #ff5a45;
}
.abar {
  width: 100%;
  height: 3px;
  margin-top: 4px;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  justify-content: flex-end;
}
.abar .fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.85);
  transition: width 0.08s linear;
}
.abar.reloading {
  justify-content: flex-start;
}
.abar.reloading .fill {
  background: var(--hud-accent);
  box-shadow: 0 0 6px rgba(240, 184, 58, 0.7);
  transition: none;
}
.meta {
  margin-top: 5px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
.meta b {
  font-family: var(--hud-num);
  font-weight: 600;
  font-size: 12px;
  color: var(--hud-text);
}
.stance {
  padding: 0 6px;
  border: 1px solid var(--hud-line-strong);
  color: var(--hud-cyan);
  letter-spacing: 2px;
}
.hint {
  height: 20px;
  margin-top: 3px;
  font-size: 12px;
  letter-spacing: 2px;
  color: #ff8a6a;
}
.hint kbd {
  border-color: #ff8a6a;
  color: #ff8a6a;
}
.hint.busy {
  color: var(--hud-accent);
}

/* ---------- 瞄准镜 ---------- */
.scope {
  position: absolute;
  inset: 0;
}
.scope .lens {
  position: absolute;
  inset: 0;
  /* 圆形镜内视野，外面一圈黑 */
  background: radial-gradient(circle at center, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0) 36vmin, rgba(0, 0, 0, 0.55) 40vmin, #000 41vmin);
  box-shadow: inset 0 0 18vmin rgba(0, 0, 0, 0.5);
}
.scope .h,
.scope .v,
.scope .mil {
  position: absolute;
  background: rgba(10, 10, 10, 0.92);
}
.scope .h {
  left: 50%;
  top: 50%;
  width: 82vmin;
  height: 1px;
  transform: translate(-50%, -0.5px);
}
.scope .v {
  left: 50%;
  top: 50%;
  width: 1px;
  height: 82vmin;
  transform: translate(-0.5px, -50%);
}
.scope .mil {
  top: 50%;
  width: 2px;
  height: 10px;
  transform: translate(-1px, -5px);
}

/* ---------- 准星 / 命中标记 ---------- */
.cross {
  position: absolute;
  left: 50%;
  top: 50%;
}
.cross i {
  position: absolute;
  left: 0;
  top: 0;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
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
  width: 2px;
  height: 2px;
  margin: -1px 0 0 -1px;
  background: rgba(255, 255, 255, 0.9);
}
.cross.ok i {
  background: #7dff9a;
}
.cross.bad i {
  background: #ff6a5a;
}
.hitm {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
}
.hitm i {
  position: absolute;
  left: -1px;
  top: -5px;
  width: 2px;
  height: 10px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.hitm.crit i {
  background: #ffd04a;
}
.hitm.head i {
  background: #ffcf3a;
  box-shadow: 0 0 6px rgba(255, 190, 40, 0.9);
}
.hitm.kill i {
  background: #ff3a2a;
  width: 3px;
  height: 12px;
  left: -1.5px;
  top: -6px;
  box-shadow: 0 0 6px rgba(255, 40, 20, 0.7);
}
.adsdot {
  position: fixed;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: #ff5a3a;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  z-index: 21;
}

/* ---------- 受击方向：一段贴近屏幕边缘的弧，中间最亮、两头渐隐 ---------- */
.hurtdir {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 62vmin;
  height: 62vmin;
  border-radius: 50%;
  background: conic-gradient(from -20deg, rgba(232, 40, 24, 0) 0deg, rgba(240, 50, 30, 0.9) 20deg, rgba(232, 40, 24, 0) 40deg, transparent 40deg);
  -webkit-mask: radial-gradient(closest-side, transparent 94%, #000 95.5%, #000 98.5%, transparent 100%);
  mask: radial-gradient(closest-side, transparent 94%, #000 95.5%, #000 98.5%, transparent 100%);
  filter: drop-shadow(0 0 4px rgba(255, 30, 10, 0.7));
}

/* ---------- 状态提示 ---------- */
.lockhint {
  position: absolute;
  left: 50%;
  top: 44%;
  transform: translate(-50%, -50%);
  padding: 12px 36px;
  background: var(--hud-panel-strong);
  border-top: 1px solid var(--hud-accent);
  border-bottom: 1px solid var(--hud-accent);
  color: var(--hud-text);
  font-size: 16px;
  letter-spacing: 6px;
  animation: breathe 1.6s ease-in-out infinite;
}
@keyframes breathe {
  50% {
    opacity: 0.7;
  }
}
.dead {
  position: absolute;
  left: 0;
  right: 0;
  top: 40%;
  transform: translateY(-50%);
  padding: 18px 0;
  text-align: center;
  background: linear-gradient(90deg, rgba(40, 4, 4, 0), rgba(40, 4, 4, 0.75) 30%, rgba(40, 4, 4, 0.75) 70%, rgba(40, 4, 4, 0));
}
.dead span {
  font-size: 40px;
  font-weight: 600;
  letter-spacing: 16px;
  padding-left: 16px;
  color: #ff5a45;
  text-shadow: 0 0 24px rgba(216, 74, 58, 0.7);
}
</style>
