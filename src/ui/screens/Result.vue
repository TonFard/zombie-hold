<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DIFFICULTIES } from '../../game/data/difficulty';
import { fmtTime, ui } from '../store';
import { WEAPONS, WEAPON_ORDER } from '../../game/data/weapons';
import { MASTERY_MAX, masteryProgress } from '../../game/data/mastery';

/** 结算页两页：总结 / 复盘 */
const page = ref<'sum' | 'replay'>('sum');
watch(
  () => ui.result,
  () => (page.value = 'sum'),
);
const rp = computed(() => r.value?.replay ?? null);
/** 时间线的柱子高度：按这局最多击杀的那一夜归一 */
const maxKills = computed(() => Math.max(1, ...(rp.value?.nights.map((n) => n.kills) ?? [1])));
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** 这一局练了哪些枪：击杀数、现在的熟练度和本级进度 */
const mastery = computed(() =>
  WEAPON_ORDER.filter((k) => (ui.masteryGain[k] ?? 0) > 0).map((k) => {
    const xp = ui.save.meta.mastery[k] ?? 0;
    const p = masteryProgress(k, xp);
    return { k, name: WEAPONS[k].name, kills: ui.masteryGain[k] ?? 0, lv: p.lv, left: p.to === null ? 0 : p.to - xp, prog: p.to === null ? 1 : (xp - p.from) / (p.to - p.from), icon: ui.gfx.icon(k) };
  }),
);

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
    ['风险事件', m.events],
  ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;
});
/** 逐个揭示：每一块按顺序晚 0.12 秒出现（--d 给 CSS 用） */
const d = (i: number) => ({ '--d': `${0.25 + i * 0.12}s` });
</script>

<template>
  <div v-if="ui.screen === 'result' && r" class="result" :class="{ won: r.won }">
    <div class="scan" aria-hidden="true"></div>
    <div class="box">
      <header>
        <small class="code">{{ r.won ? 'MISSION COMPLETE' : 'MISSION FAILED' }} · {{ DIFFICULTIES[r.difficulty].name }}</small>
        <h1>{{ r.won ? '你守住了' : '失 败' }}</h1>
        <h2>{{ reasonText }}</h2>
        <span v-if="r.newBest" class="best">新纪录</span>
      </header>

      <nav v-if="rp && rp.shares.length" class="t-seg tabs" aria-label="结算分页">
        <button type="button" :class="{ on: page === 'sum' }" :aria-pressed="page === 'sum'" @click="page = 'sum'">总结</button>
        <button type="button" :class="{ on: page === 'replay' }" :aria-pressed="page === 'replay'" @click="page = 'replay'">复盘</button>
      </nav>

      <!-- 复盘：伤害来源 / 每一夜 / 关键时刻 / 下一局建议 -->
      <div v-if="page === 'replay' && rp" class="t-panel replay t-enter">
        <div class="t-head">伤害来源 <small>DAMAGE · 共 {{ Math.round(rp.totalDamage) }}</small></div>
        <div v-for="s in rp.shares" :key="s.id" class="share">
          <span class="sn">{{ s.name }}</span>
          <span class="sb"><i :style="{ width: pct(s.share) }"></i></span>
          <span class="sv">{{ pct(s.share) }} · {{ s.kills }} 杀<template v-if="s.fire"> · 开火 {{ Math.round(s.fire) }} 秒</template></span>
        </div>
        <div class="t-head gap">每一夜 <small>TIMELINE</small></div>
        <div class="timeline">
          <div v-for="n in rp.nights" :key="n.night" class="tn" :title="`第 ${n.night} 夜：击杀 ${n.kills}、发电机最低 ${pct(n.coreLow)}、被拆 ${n.lost}、受伤 ${Math.round(n.hurt)}`">
            <span class="tk" :style="{ height: `${(n.kills / maxKills) * 100}%` }"></span>
            <span class="tc" :class="{ bad: n.coreLow < 0.5 }" :style="{ height: `${n.coreLow * 100}%` }"></span>
            <b>{{ n.night }}</b>
            <em v-if="n.boss">首领</em>
            <em v-else-if="n.lost" class="lost">−{{ n.lost }}</em>
          </div>
        </div>
        <p class="legend"><i class="k"></i>击杀 <i class="c"></i>发电机最低血量 · 「−n」= 这一夜被拆的建筑</p>
        <template v-if="rp.moments.length">
          <div class="t-head gap">关键时刻 <small>MOMENTS</small></div>
          <ul class="moments">
            <li v-for="m in rp.moments" :key="m">{{ m }}</li>
          </ul>
        </template>
        <template v-if="rp.tips.length">
          <div class="t-head gap">下一局 <small>ADVICE</small></div>
          <ul class="tips">
            <li v-for="t in rp.tips" :key="t">{{ t }}</li>
          </ul>
        </template>
      </div>

      <!-- 总结：四个大数字 → 勋章 → 熟练度 → 成就，一块一块出现 -->
      <template v-else>
        <div class="stats">
          <div class="t-panel reveal" :style="d(0)"><span>{{ r.won ? '撑过' : '止步于' }}</span><b>{{ r.won ? '10' : r.night }}<small> 夜</small></b></div>
          <div class="t-panel reveal" :style="d(1)"><span>击杀</span><b>{{ r.kills }}</b><em v-if="r.headshotKills">爆头 {{ r.headshotKills }}</em></div>
          <div class="t-panel reveal" :style="d(2)"><span>获得零件</span><b>{{ r.scrap }}</b></div>
          <div class="t-panel reveal" :style="d(3)"><span>用时</span><b>{{ fmtTime(r.time) }}</b></div>
        </div>
        <div class="cols">
          <div v-if="r.medals.total > 0" class="t-panel medals reveal" :style="d(4)">
            <div class="t-head">勋章 <small>MEDALS</small><b>+{{ r.medals.total }}</b></div>
            <div v-for="([k, v], i) in lines" :key="k" class="ml reveal" :style="d(5 + i * 0.5)"><span>{{ k }}</span><i>{{ v }}</i></div>
            <div v-if="r.medals.mult !== 1" class="ml"><span>难度倍率</span><i>×{{ r.medals.mult }}</i></div>
            <div class="ml own"><span>现有勋章</span><i class="gold">✦ {{ ui.save.meta.medals }}</i></div>
            <div v-if="r.supplies > 0" class="ml"><span>补给 +{{ r.supplies }}</span><i class="cyan">▣ {{ ui.save.meta.supplies }}</i></div>
          </div>
          <div v-if="mastery.length" class="t-panel medals reveal" :style="d(5)">
            <div class="t-head">熟练度 <small>MASTERY</small></div>
            <div v-for="x in mastery" :key="x.k" class="mrow">
              <img v-if="x.icon" :src="x.icon" alt="" />
              <span class="mn">{{ x.name }}<small>+{{ x.kills }} 杀</small></span>
              <span class="mbar"><i :style="{ width: pct(x.prog) }"></i></span>
              <span class="mlv">{{ x.lv >= MASTERY_MAX ? '精通' : `Lv ${x.lv} · 差 ${x.left}` }}</span>
            </div>
          </div>
        </div>
        <div v-if="ui.achievements.length" class="achv reveal" :style="d(7)">
          <span v-for="a in ui.achievements" :key="a"><i>★</i>成就达成 · {{ a }}</span>
        </div>
      </template>

      <div class="btns reveal" :style="d(page === 'sum' ? 8 : 0)">
        <button v-if="ui.canEndless" class="t-btn primary" @click="ui.actions.endless()">继续：无尽模式</button>
        <button class="t-btn" :class="{ primary: !ui.canEndless }" @click="ui.actions.restart()">再来一局</button>
        <button class="t-btn" @click="ui.actions.toLobby()">回大厅</button>
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
  overflow-y: auto;
  padding: 30px 0;
  color: var(--t-text);
  background: radial-gradient(ellipse at 50% 30%, rgba(60, 8, 4, 0.72), rgba(4, 2, 2, 0.95) 75%);
  animation: fade 0.8s var(--t-ease) both;
  --accent: var(--t-red);
}
.result.won {
  background: radial-gradient(ellipse at 50% 30%, rgba(60, 44, 8, 0.72), rgba(4, 3, 0, 0.95) 75%);
  --accent: var(--t-gold);
}
.scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.015) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
.box {
  position: relative;
  width: min(860px, 92vw);
  margin: auto;
}
header {
  text-align: center;
  margin-bottom: 22px;
}
.code {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 5px;
  color: var(--t-dim);
}
h1 {
  margin-top: 6px;
  font-size: 64px;
  letter-spacing: 22px;
  /* letter-spacing 会在最后一个字后面多一截：往右补回来，标题才真正居中 */
  padding-left: 22px;
  color: var(--accent);
  text-shadow: 0 0 40px color-mix(in srgb, var(--accent) 55%, transparent);
  font-weight: 800;
  animation: drop 0.6s var(--t-ease) both;
}
@keyframes drop {
  from {
    opacity: 0;
    transform: scale(1.12);
    letter-spacing: 34px;
  }
}
h2 {
  margin-top: 6px;
  font-size: 15px;
  letter-spacing: 8px;
  color: var(--t-muted);
  font-weight: 300;
}
.best {
  display: inline-block;
  margin-top: 12px;
  padding: 3px 18px;
  border: 1px solid var(--t-gold);
  color: var(--t-gold);
  letter-spacing: 8px;
  font-size: 12px;
  box-shadow: 0 0 16px rgba(240, 184, 58, 0.3);
}
.tabs {
  width: 240px;
  margin: 0 auto 16px;
}
/* 逐个揭示：淡入 + 上移，延迟由 --d 给 */
.reveal {
  animation: t-enter 0.4s var(--t-ease) both;
  animation-delay: var(--d, 0s);
}
@media (prefers-reduced-motion: reduce) {
  .reveal,
  h1 {
    animation: none;
  }
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.stats > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  --corner: color-mix(in srgb, var(--accent) 75%, transparent);
}
.stats span {
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--t-muted);
}
.stats b {
  font-family: var(--t-mono);
  font-size: 34px;
  font-weight: 600;
  line-height: 1.1;
  color: #f1e8cc;
  font-variant-numeric: tabular-nums;
}
.stats b small {
  font-size: 15px;
  color: var(--t-gold-soft);
}
.stats em {
  font-style: normal;
  font-size: 12px;
  color: #c8a85a;
}
.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.medals {
  padding: 14px 18px;
  font-size: 13px;
}
.medals .t-head b {
  margin-left: auto;
  font-family: var(--t-mono);
  font-size: 22px;
  letter-spacing: 0;
  color: var(--t-gold);
  text-shadow: 0 0 14px rgba(240, 184, 58, 0.4);
}
.ml {
  display: flex;
  justify-content: space-between;
  color: var(--t-muted);
  padding: 3px 0;
}
.ml i {
  font-style: normal;
  font-family: var(--t-mono);
  color: #e6dcc0;
}
.ml i.gold {
  color: var(--t-gold);
}
.ml i.cyan {
  color: var(--t-cyan);
}
.ml.own {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--t-line);
}
.mrow {
  display: grid;
  grid-template-columns: 48px 1fr 90px 92px;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.mrow img {
  width: 48px;
  height: 20px;
  object-fit: contain;
}
.mn {
  color: var(--t-text);
  white-space: nowrap;
}
.mn small {
  margin-left: 6px;
  font-size: 11px;
  color: var(--t-ok);
}
.mbar {
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
}
.mbar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(111, 208, 232, 0.4), var(--t-cyan));
}
.mlv {
  text-align: right;
  font-size: 12px;
  color: var(--t-gold-soft);
  white-space: nowrap;
}
.achv {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
}
.achv span {
  padding: 4px 14px;
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--t-gold);
  border: 1px solid rgba(240, 184, 58, 0.45);
  background: rgba(240, 184, 58, 0.07);
}
.achv i {
  font-style: normal;
  margin-right: 6px;
}
/* ---- 复盘 ---- */
.replay {
  margin-bottom: 16px;
  padding: 14px 20px;
  font-size: 13px;
  color: #c8d0d8;
  max-height: 56vh;
  overflow-y: auto;
}
.t-head.gap {
  margin-top: 16px;
}
.share {
  display: grid;
  grid-template-columns: 110px 1fr 200px;
  gap: 10px;
  align-items: center;
  padding: 3px 0;
}
.sn {
  color: var(--t-muted);
}
.sb {
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
}
.sb i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.5), var(--t-gold));
}
.sv {
  font-family: var(--t-mono);
  font-variant-numeric: tabular-nums;
  color: var(--t-muted);
  font-size: 12px;
}
.timeline {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  height: 90px;
  padding-top: 14px;
}
.tn {
  position: relative;
  flex: 1;
  max-width: 44px;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 2px;
}
.tk,
.tc {
  flex: 1;
  min-height: 2px;
}
.tk {
  background: var(--t-gold);
}
.tc {
  background: var(--t-cyan);
  opacity: 0.7;
}
.tc.bad {
  background: var(--t-red);
}
.tn b {
  position: absolute;
  bottom: -18px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  font-weight: 400;
  color: var(--t-dim);
}
.tn em {
  position: absolute;
  top: -14px;
  left: 0;
  right: 0;
  text-align: center;
  font-style: normal;
  font-size: 10px;
  color: var(--t-gold);
}
.tn em.lost {
  color: var(--t-red);
}
.legend {
  margin: 24px 0 0;
  font-size: 11px;
  color: var(--t-dim);
}
.legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin: 0 4px 0 10px;
  vertical-align: -1px;
}
.legend i.k {
  background: var(--t-gold);
}
.legend i.c {
  background: var(--t-cyan);
}
.moments,
.tips {
  margin: 0;
  padding-left: 18px;
  line-height: 1.7;
}
.tips li {
  color: #f0e2b8;
}
.btns {
  display: flex;
  gap: 14px;
  justify-content: center;
}
.btns .t-btn {
  padding: 12px 32px;
}
@media (max-width: 900px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
