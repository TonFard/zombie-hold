<script setup lang="ts">
import { hud } from '../hud';

/**
 * 守城模式里两个"要玩家看一眼"的提示：
 *   情报卡：第一次遇到的僵尸从左边滑进来，写它有什么能力、怎么对付（图鉴里有了击杀记录以后不再弹）
 *   空投武器箱：站在开着的箱子旁边时，显示箱里那把试用枪和现在用的型号的对比，按 E 换上，不要就走开
 */
</script>

<template>
  <div v-if="hud.intel.life > 0.005 && hud.alive" :key="hud.intel.id" class="intel" :class="{ boss: hud.intel.boss, out: hud.intel.life < 0.06 }" role="status">
    <div class="ih">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.6 22 20.4H2L12 2.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M12 9v5.4M12 17.1v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <span>{{ hud.intel.boss ? '首领出现' : '新的感染者' }}</span>
      <small>{{ hud.intel.boss ? 'BOSS CONTACT' : 'NEW CONTACT' }}</small>
    </div>
    <div class="in">
      <b>{{ hud.intel.name }}</b>
      <span>基础生命 {{ hud.intel.hp }}</span>
    </div>
    <div class="tags">
      <i v-for="t in hud.intel.tags" :key="t">{{ t }}</i>
    </div>
    <dl>
      <div>
        <dt>能力</dt>
        <dd>{{ hud.intel.ability }}</dd>
      </div>
      <div class="ct">
        <dt>对策</dt>
        <dd>{{ hud.intel.counter }}</dd>
      </div>
    </dl>
    <div class="life"><i :style="{ transform: `scaleX(${hud.intel.life})` }"></i></div>
  </div>

  <div v-if="hud.dropGun.on && hud.alive" class="dropgun" role="status">
    <div class="dh">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 8.5 12 4l9 4.5v8L12 21l-9-4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="M3 8.5 12 13l9-4.5M12 13v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <span>空投武器箱</span>
      <small>试用一局</small>
    </div>
    <div class="dbody">
      <div class="pic"><img v-if="hud.dropGun.icon" :src="hud.dropGun.icon" alt="" /></div>
      <div class="dn">
        <b>{{ hud.dropGun.name }}</b>
        <span>{{ hud.dropGun.cls }} · 换下这一局的「{{ hud.dropGun.cur }}」，等级和强化照旧</span>
      </div>
    </div>
    <div class="rows">
      <div v-for="r in hud.dropGun.rows" :key="r.k" :class="{ up: r.d > 0, down: r.d < 0 }">
        <span>{{ r.k }}</span>
        <em>{{ r.a }}</em>
        <i>▸</i>
        <b>{{ r.b }}</b>
      </div>
    </div>
    <div class="keys">
      <span class="take"><kbd>E</kbd>换上</span>
      <span class="skip">不要就走开 · 箱子留到入夜</span>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 情报卡：屏幕左侧，零件 / 卡牌栏的下面 ---------- */
.intel {
  position: absolute;
  left: 24px;
  top: 39%;
  width: 328px;
  padding: 10px 14px 12px;
  background: linear-gradient(90deg, var(--hud-panel-strong), rgba(9, 13, 18, 0.5));
  border-left: 3px solid var(--hud-accent);
  --c: var(--hud-accent);
  animation: intel-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition: opacity 0.4s;
}
.intel.boss {
  --c: var(--hud-danger);
  border-left-color: var(--hud-danger);
  background: linear-gradient(90deg, rgba(40, 8, 6, 0.88), rgba(9, 13, 18, 0.5));
}
.intel.out {
  opacity: 0;
}
@keyframes intel-in {
  from {
    opacity: 0;
    transform: translateX(-26px);
  }
}
.ih {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--c);
}
.ih svg {
  width: 17px;
  height: 17px;
  flex: none;
}
.ih small {
  margin-left: auto;
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--hud-dim);
}
.in {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 6px;
}
.in b {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #fff;
}
.in span {
  font-size: 11px;
  color: var(--hud-muted);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.tags i {
  padding: 1px 7px;
  font-style: normal;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--c);
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  background: color-mix(in srgb, var(--c) 12%, transparent);
}
dl {
  display: grid;
  gap: 5px;
  margin-top: 9px;
}
dl > div {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.5;
}
dt {
  font-size: 11px;
  letter-spacing: 1px;
  line-height: 19px;
  color: var(--hud-dim);
}
dd {
  color: #d6dce2;
}
.ct dt,
.ct dd {
  color: var(--hud-cyan);
}
.life {
  height: 2px;
  margin-top: 10px;
  background: rgba(255, 255, 255, 0.08);
}
.life i {
  display: block;
  height: 100%;
  background: var(--c);
  transform-origin: left;
}

/* ---------- 空投武器箱：准星下面 ---------- */
.dropgun {
  position: absolute;
  left: 50%;
  top: 60%;
  width: 430px;
  transform: translateX(-50%);
  padding: 9px 14px 11px;
  background: var(--hud-panel-strong);
  border-top: 2px solid var(--hud-cyan);
  animation: drop-in 0.2s ease-out both;
}
@keyframes drop-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
}
.dh {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--hud-cyan);
}
.dh svg {
  width: 17px;
  height: 17px;
}
.dh small {
  margin-left: auto;
  padding: 0 6px;
  font-size: 10px;
  letter-spacing: 1px;
  color: #06202a;
  background: var(--hud-cyan);
  text-shadow: none;
}
.dbody {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
/* 图标是异步画出来的：先把位置占住，画好了不会把字挤走 */
.pic {
  flex: none;
  width: 132px;
  height: 46px;
  background: radial-gradient(ellipse at center, rgba(200, 215, 230, 0.16), transparent 72%);
}
.pic img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(1.5) contrast(1.05);
}
.dn {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dn b {
  font-size: 19px;
  letter-spacing: 2px;
  color: #fff;
}
.dn span {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--hud-muted);
}
.rows {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 14px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--hud-line);
}
.rows > div {
  display: grid;
  grid-template-columns: 30px 1fr 10px 1fr;
  align-items: baseline;
  gap: 4px;
  font-size: 12px;
}
.rows span {
  color: var(--hud-dim);
}
.rows em {
  font-style: normal;
  text-align: right;
  font-family: var(--hud-num);
  color: var(--hud-muted);
}
.rows i {
  font-style: normal;
  font-size: 9px;
  color: var(--hud-dim);
}
.rows b {
  font-family: var(--hud-num);
  font-weight: 600;
  color: var(--hud-text);
}
.rows .up b {
  color: var(--hud-ok);
}
.rows .down b {
  color: var(--hud-danger);
}
.keys {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
  font-size: 13px;
  letter-spacing: 2px;
}
.take {
  color: #fff;
}
kbd {
  display: inline-block;
  min-width: 20px;
  height: 20px;
  margin-right: 8px;
  padding: 0 5px;
  border: 1px solid var(--hud-cyan);
  border-radius: 2px;
  background: rgba(111, 208, 232, 0.14);
  font: 600 12px/18px var(--hud-font);
  text-align: center;
  color: var(--hud-cyan);
  text-shadow: none;
}
.skip {
  font-size: 11.5px;
  letter-spacing: 1px;
  color: var(--hud-dim);
}
@media (prefers-reduced-motion: reduce) {
  .intel,
  .dropgun {
    animation: none;
  }
}
</style>
