<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LEVELS } from '../../game/systems/tdm';
import { hud } from '../hud';
import { fmtTime, ui, type TdmLevel } from '../store';

const t = computed(() => hud.tdm);
/** 在场上（购买菜单开着也算：比分、金币都还要看得见） */
const playing = computed(() => ui.screen === 'play' || ui.screen === 'buy');
const show = computed(() => t.value.on && (playing.value || ui.screen === 'pause' || ui.screen === 'result'));
const res = computed(() => ui.tdmResult);
/** 每队一排小格子：亮的 = 还活着 */
const pips = (n: number): boolean[] => Array.from({ length: t.value.size }, (_, i) => i < n);
const phaseText = computed(() => (t.value.phase === 'freeze' ? '冻结时间' : t.value.phase === 'end' ? '本局结束' : `第 ${t.value.round} 局`));
const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
/** 结算页：下一场用哪一档人机（默认还是这一场的） */
const nextLevel = ref<TdmLevel>(1);
watch(res, (r) => {
  if (r) nextLevel.value = r.level;
});
</script>

<template>
  <template v-if="show">
    <!-- 上中：两队赢的局数、剩下的人、这一局的时间 -->
    <div v-if="ui.screen !== 'result'" class="score">
      <div class="side blue">
        <span class="pips"><i v-for="(on, i) in pips(t.alive[0])" :key="i" :class="{ on }"></i></span>
        <b>{{ t.score[0] }}</b>
      </div>
      <div class="mid" :class="t.phase">
        <div class="tm">{{ fmtTime(t.time) }}</div>
        <small>{{ phaseText }}</small>
      </div>
      <div class="side red">
        <b>{{ t.score[1] }}</b>
        <span class="pips"><i v-for="(on, i) in pips(t.alive[1])" :key="i" :class="{ on }"></i></span>
      </div>
    </div>
    <div v-if="ui.screen !== 'result'" class="goal">先赢 {{ t.target }} 局 · {{ t.alive[0] }} 对 {{ t.alive[1] }} · 人机 <b :class="`lv${t.level}`">{{ t.levelName }}</b></div>

    <!-- 局间提示：第几局、开打、这一局谁赢了 -->
    <div v-if="playing && ui.tdmNote.id" :key="ui.tdmNote.id" class="note" :class="ui.tdmNote.tone" role="status">
      <b>{{ ui.tdmNote.title }}</b>
      <span>{{ ui.tdmNote.sub }}</span>
    </div>

    <!-- 右上：击杀信息 -->
    <ul v-if="playing" class="feed" aria-live="polite">
      <li v-for="(f, i) in t.feed" :key="i" :style="{ opacity: Math.min(1, f.life * 3) }">
        <span :class="f.kt === 0 ? 'b' : 'r'">{{ f.killer }}</span>
        <!-- 自己的雷把自己炸死：没有"谁打死谁" -->
        <em v-if="f.self" class="nade">被自己的手雷炸死</em>
        <template v-else>
          <em :class="f.kind">{{ f.gun }}<template v-if="f.head"> · 爆头</template></em>
          <span :class="f.vt === 0 ? 'b' : 'r'">{{ f.victim }}</span>
        </template>
      </li>
    </ul>

    <!-- 左上：自己的战绩 -->
    <div v-if="playing" class="me">击杀 <b>{{ t.kills }}</b> · 死亡 <b>{{ t.deaths }}</b></div>

    <!-- 左下（血条上面）：金币、护甲 -->
    <div v-if="playing" class="wallet">
      <span class="money">{{ money(t.money) }}</span>
      <span class="armor" :class="{ none: t.armor <= 0 }">护甲 <b>{{ t.armor }}</b><em v-if="t.helmet">头盔</em></span>
      <span v-if="ui.screen === 'play' && t.canBuy" class="buyhint"><kbd>B</kbd>购买</span>
    </div>

    <!-- 右下（弹药上面）：身上带的东西，亮的那一格是手里拿的 -->
    <ul v-if="playing && !t.dead" class="slots" aria-label="武器栏">
      <li :class="{ on: t.held === 'primary', none: !t.primaryName }">
        <kbd>1</kbd><span class="sn">{{ t.primaryName || '主武器' }}</span><span class="sa">{{ t.primaryName ? t.primaryAmmo : '没有' }}</span>
      </li>
      <li :class="{ on: t.held === 'pistol' }">
        <kbd>2</kbd><span class="sn">{{ t.pistolName }}</span><span class="sa">{{ t.pistolAmmo }}</span>
      </li>
      <li :class="{ on: t.held === 'knife' }">
        <kbd>3</kbd><span class="sn">匕首</span><span class="sa"></span>
      </li>
      <li :class="{ on: t.throwing, none: t.nades <= 0 }">
        <kbd>G</kbd><span class="sn">手雷</span><span class="sa">{{ t.nades }} / {{ t.nadeMax }}</span>
      </li>
    </ul>

    <!-- 脚边有枪：按 E 捡（同一个枪位上原来的那把会扔在地上） -->
    <div v-if="ui.screen === 'play' && !t.dead && t.pickup" class="pick" role="status">
      <span>按<kbd>E</kbd>捡起 <b>{{ t.pickup }}</b></span>
      <span class="pa">{{ t.pickupMag }} / {{ t.pickupReserve }}</span>
      <small v-if="t.pickupSwap">换下 {{ t.pickupSwap }}</small>
    </div>

    <!-- 阵亡：先看自己倒下，然后跟着队友的镜头 -->
    <div v-if="ui.screen === 'play' && t.dead && !t.spectate" class="dead">
      <b>阵亡</b>
      <span>这一局不能复活 · 下一局再来</span>
    </div>
    <div v-else-if="ui.screen === 'play' && t.dead" class="watch">
      <small>观战</small>
      <b>{{ t.spectate }}</b>
      <span>{{ t.spectateGun }} · 生命 {{ t.spectateHp }}</span>
      <em>左键 换下一个队友</em>
    </div>

    <!-- Tab：计分板 -->
    <div v-if="hud.tab.open && ui.screen === 'play'" class="board">
      <div v-for="team in [0, 1] as const" :key="team" class="team" :class="team === 0 ? 'blue' : 'red'">
        <h3>{{ team === 0 ? '蓝队（我方）' : '红队' }} <b>{{ t.score[team] }}</b></h3>
        <table>
          <thead>
            <tr><th>名字</th><th>武器</th><th>金币</th><th>击杀</th><th>死亡</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in t.board.filter((x) => x.team === team)" :key="p.name" :class="{ you: p.you, down: !p.alive }">
              <td>{{ p.name }}</td>
              <td>{{ p.gun }}</td>
              <td>{{ team === 0 ? money(p.money) : '—' }}</td>
              <td>{{ p.kills }}</td>
              <td>{{ p.deaths }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 整场打完 -->
    <div v-if="ui.screen === 'result' && res" class="over" :class="res.winner === 0 ? 'win' : res.winner === 1 ? 'lose' : 'draw'">
      <div class="box">
        <h1>{{ res.winner === 0 ? '胜 利' : res.winner === 1 ? '失 败' : '平 局' }}</h1>
        <div class="final"><span class="b">{{ res.score[0] }}</span> : <span class="r">{{ res.score[1] }}</span></div>
        <p>你的战绩：击杀 {{ res.kills }} · 死亡 {{ res.deaths }} · K/D {{ (res.kills / Math.max(1, res.deaths)).toFixed(2) }}</p>
        <p class="lvline">人机难度 <b :class="`lv${res.level}`">{{ LEVELS[res.level].name }}</b> · 对战不吃局外加成</p>
        <div class="next">
          <span>下一场的人机</span>
          <div class="seg" role="group" aria-label="下一场的人机难度">
            <button v-for="(l, i) in LEVELS" :key="l.name" :class="{ on: nextLevel === i }" :aria-pressed="nextLevel === i" @click="nextLevel = i as TdmLevel">{{ l.name }}</button>
          </div>
        </div>
        <div class="btns">
          <button class="primary" @click="ui.actions.tdm(nextLevel)">再来一场</button>
          <button @click="ui.actions.toLobby()">回大厅</button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.score {
  position: fixed;
  left: 50%;
  top: 14px;
  z-index: 21;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  pointer-events: none;
  font-family: var(--hud-font);
  color: var(--hud-text);
  text-shadow: var(--hud-shadow);
}
.side {
  display: flex;
  align-items: center;
  gap: 12px;
}
.side b {
  min-width: 34px;
  font-family: var(--hud-num);
  font-size: 32px;
  font-weight: 700;
  text-align: center;
}
.blue b {
  color: #5ab8ff;
}
.red b {
  color: #ff6a52;
}
.pips {
  display: flex;
  gap: 4px;
}
.blue .pips {
  flex-direction: row-reverse;
}
.pips i {
  width: 12px;
  height: 16px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.blue .pips i.on {
  background: #4aa8ff;
  border-color: #9ad2ff;
}
.red .pips i.on {
  background: #ff5a3a;
  border-color: #ffa08c;
}
.mid {
  min-width: 96px;
  padding: 4px 12px;
  text-align: center;
  background: var(--hud-panel);
  border-top: 2px solid transparent;
}
.mid.freeze {
  border-top-color: var(--hud-accent);
}
.mid .tm {
  font-family: var(--hud-num);
  font-size: 24px;
  font-weight: 600;
}
.mid.freeze .tm {
  color: var(--hud-accent);
}
.mid small {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
.goal {
  position: fixed;
  left: 50%;
  top: 74px;
  z-index: 21;
  transform: translateX(-50%);
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--hud-muted);
  text-shadow: var(--hud-shadow);
}
.goal b {
  font-weight: 600;
  color: var(--hud-text);
}
.lv0 {
  color: #8fd66a !important;
}
.lv1 {
  color: var(--hud-accent) !important;
}
.lv2 {
  color: #ff6a52 !important;
}
.note {
  position: fixed;
  left: 0;
  right: 0;
  top: 22%;
  z-index: 22;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 0;
  pointer-events: none;
  font-family: var(--hud-font);
  color: var(--hud-text);
  text-shadow: var(--hud-shadow);
  background: linear-gradient(90deg, rgba(8, 12, 17, 0), rgba(8, 12, 17, 0.72) 30%, rgba(8, 12, 17, 0.72) 70%, rgba(8, 12, 17, 0));
  animation: note 3.2s ease forwards;
}
.note b {
  font-size: 30px;
  letter-spacing: 10px;
  padding-left: 10px;
}
.note span {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--hud-muted);
}
.note.win b {
  color: #5ab8ff;
}
.note.lose b {
  color: #ff6a52;
}
@keyframes note {
  0% {
    opacity: 0;
    transform: translateY(-8px);
  }
  8% {
    opacity: 1;
    transform: none;
  }
  78% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .note {
    animation-name: note-plain;
  }
}
@keyframes note-plain {
  0%,
  78% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.feed {
  position: fixed;
  right: 24px;
  top: 200px;
  z-index: 21;
  list-style: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 13px;
  text-shadow: var(--hud-shadow);
}
.feed li {
  display: flex;
  gap: 8px;
  padding: 3px 10px;
  background: rgba(9, 13, 18, 0.6);
}
.feed em {
  font-style: normal;
  font-size: 11px;
  color: var(--hud-muted);
}
.feed em.knife {
  color: var(--hud-accent);
}
.feed em.nade {
  color: #ff9a5a;
}
.b {
  color: #6ac0ff;
}
.r {
  color: #ff7a62;
}
.me {
  position: fixed;
  left: 28px;
  top: 22px;
  z-index: 21;
  padding: 6px 14px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 13px;
  color: var(--hud-muted);
  background: linear-gradient(90deg, var(--hud-panel), rgba(9, 13, 18, 0));
  border-left: 2px solid #4aa8ff;
}
.me b {
  font-family: var(--hud-num);
  font-size: 18px;
  color: var(--hud-text);
}
.wallet {
  position: fixed;
  left: 28px;
  bottom: 104px;
  z-index: 21;
  display: flex;
  align-items: baseline;
  gap: 16px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 13px;
  color: var(--hud-muted);
  text-shadow: var(--hud-shadow);
}
.money {
  font-family: var(--hud-num);
  font-size: 26px;
  font-weight: 700;
  color: #8fd66a;
}
.armor b {
  font-family: var(--hud-num);
  font-size: 18px;
  color: var(--hud-text);
}
.armor.none b {
  color: var(--hud-muted);
}
.armor em {
  margin-left: 6px;
  padding: 1px 6px;
  font-style: normal;
  font-size: 11px;
  color: var(--hud-text);
  border: 1px solid var(--hud-line-strong);
}
.buyhint {
  color: var(--hud-accent);
}
kbd {
  display: inline-block;
  min-width: 18px;
  margin-right: 5px;
  padding: 0 5px;
  font: inherit;
  font-size: 12px;
  text-align: center;
  color: var(--hud-text);
  border: 1px solid var(--hud-line-strong);
  background: rgba(9, 13, 18, 0.6);
}
.slots {
  position: fixed;
  right: 28px;
  bottom: 162px;
  z-index: 21;
  width: 220px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 12px;
  color: var(--hud-muted);
  text-shadow: var(--hud-shadow);
}
.slots li {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 4px;
  border-right: 2px solid transparent;
}
.slots li.on {
  color: var(--hud-text);
  background: linear-gradient(270deg, rgba(240, 184, 58, 0.2), rgba(240, 184, 58, 0));
  border-right-color: var(--hud-accent);
}
.slots li.none {
  opacity: 0.45;
}
.slots kbd {
  margin-right: 0;
  min-width: 0;
  color: var(--hud-muted);
}
.slots li.on kbd {
  color: var(--hud-accent);
  border-color: var(--hud-accent);
}
.sn {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 1px;
}
.sa {
  font-family: var(--hud-num);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.pick {
  position: fixed;
  left: 50%;
  top: 63%;
  z-index: 21;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 7px 16px 7px 12px;
  pointer-events: none;
  white-space: nowrap;
  font-family: var(--hud-font);
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--hud-text);
  background: var(--hud-panel-strong);
  border-left: 2px solid var(--hud-accent);
}
.pick kbd {
  margin: 0 8px;
  color: var(--hud-accent);
  border-color: var(--hud-accent);
}
.pick b {
  font-size: 15px;
  color: var(--hud-accent);
}
.pa {
  font-family: var(--hud-num);
  font-size: 15px;
  letter-spacing: 0;
}
.pick small {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--hud-muted);
}
.dead {
  position: fixed;
  left: 0;
  right: 0;
  top: 38%;
  z-index: 22;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 0;
  pointer-events: none;
  font-family: var(--hud-font);
  background: linear-gradient(90deg, rgba(40, 4, 4, 0), rgba(40, 4, 4, 0.7) 30%, rgba(40, 4, 4, 0.7) 70%, rgba(40, 4, 4, 0));
}
.dead b {
  font-size: 34px;
  letter-spacing: 14px;
  padding-left: 14px;
  color: #ff5a45;
}
.dead span {
  font-size: 14px;
  color: var(--hud-text);
}
.watch {
  position: fixed;
  left: 50%;
  bottom: 96px;
  z-index: 22;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 18px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 13px;
  color: var(--hud-text);
  background: var(--hud-panel-strong);
  border-top: 2px solid #4aa8ff;
}
.watch small {
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--hud-muted);
}
.watch b {
  font-size: 17px;
  color: #6ac0ff;
}
.watch em {
  font-style: normal;
  font-size: 11px;
  color: var(--hud-muted);
}
.board {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 60;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  width: min(960px, 94vw);
  padding: 18px 22px;
  pointer-events: none;
  font-family: var(--hud-font);
  color: var(--hud-text);
  background: rgba(7, 10, 14, 0.92);
  border-top: 2px solid var(--hud-accent);
}
.team h3 {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 15px;
  letter-spacing: 4px;
}
.team.blue h3 {
  color: #5ab8ff;
}
.team.red h3 {
  color: #ff6a52;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  padding: 4px 6px;
  font-weight: 400;
  font-size: 11px;
  text-align: left;
  color: var(--hud-muted);
  border-bottom: 1px solid var(--hud-line);
}
td {
  padding: 5px 6px;
  font-variant-numeric: tabular-nums;
}
tr.you td {
  color: var(--hud-accent);
  font-weight: 600;
}
tr.down td {
  opacity: 0.45;
}
.over {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--hud-font);
  background: rgba(3, 5, 8, 0.78);
}
.over .box {
  min-width: 420px;
  padding: 30px 40px;
  text-align: center;
  color: var(--hud-text);
  background: rgba(8, 11, 15, 0.94);
  border-top: 2px solid var(--hud-accent);
}
.over h1 {
  font-size: 40px;
  letter-spacing: 18px;
  padding-left: 18px;
}
.over.win h1 {
  color: #5ab8ff;
}
.over.lose h1 {
  color: #ff5a45;
}
.final {
  margin: 12px 0;
  font-family: var(--hud-num);
  font-size: 48px;
  font-weight: 700;
}
.over p {
  margin-bottom: 18px;
  color: var(--hud-muted);
}
.over p.lvline {
  margin-top: -10px;
  font-size: 13px;
}
.next {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 18px;
  font-size: 12px;
  color: var(--hud-muted);
}
.seg {
  display: flex;
  gap: 4px;
}
.seg button {
  padding: 5px 14px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: var(--hud-muted);
  font: inherit;
  letter-spacing: 2px;
  cursor: pointer;
}
.seg button:hover,
.seg button:focus-visible {
  color: var(--hud-text);
  border-color: rgba(255, 255, 255, 0.4);
  outline: none;
}
.seg button.on {
  color: var(--hud-accent);
  border-color: var(--hud-accent);
  background: rgba(240, 184, 58, 0.1);
}
.btns {
  display: flex;
  justify-content: center;
  gap: 10px;
}
.btns button {
  padding: 10px 26px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--hud-text);
  font: inherit;
  letter-spacing: 4px;
  cursor: pointer;
}
.btns button.primary {
  border-color: var(--hud-accent);
  color: var(--hud-accent);
}
.btns button:hover,
.btns button:focus-visible {
  background: #1d2a36;
  outline: none;
}
</style>
