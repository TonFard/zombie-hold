<script setup lang="ts">
import { computed } from 'vue';
import { hud } from '../hud';
import { fmtTime, ui } from '../store';

const t = computed(() => hud.tdm);
const show = computed(() => t.value.on && (ui.screen === 'play' || ui.screen === 'pause' || ui.screen === 'result'));
const pct = (n: number) => `${Math.min(100, (n / t.value.target) * 100)}%`;
const res = computed(() => ui.tdmResult);
</script>

<template>
  <template v-if="show">
    <!-- 上中：比分条（替代发电机血条） -->
    <div v-if="ui.screen !== 'result'" class="score">
      <div class="side blue">
        <b>{{ t.score[0] }}</b>
        <i class="bar"><i :style="{ width: pct(t.score[0]) }"></i></i>
      </div>
      <div class="mid">
        <div class="tm">{{ fmtTime(t.time) }}</div>
        <small>先到 {{ t.target }}</small>
      </div>
      <div class="side red">
        <i class="bar"><i :style="{ width: pct(t.score[1]) }"></i></i>
        <b>{{ t.score[1] }}</b>
      </div>
    </div>

    <!-- 右上：击杀信息 -->
    <ul v-if="ui.screen === 'play'" class="feed" aria-live="polite">
      <li v-for="(f, i) in t.feed" :key="i" :style="{ opacity: Math.min(1, f.life * 3) }">
        <span :class="f.kt === 0 ? 'b' : 'r'">{{ f.killer }}</span>
        <em>{{ f.weapon }}<template v-if="f.head"> · 爆头</template></em>
        <span :class="f.vt === 0 ? 'b' : 'r'">{{ f.victim }}</span>
      </li>
    </ul>

    <!-- 自己的战绩 -->
    <div v-if="ui.screen === 'play'" class="me">击杀 <b>{{ t.kills }}</b> · 死亡 <b>{{ t.deaths }}</b></div>

    <!-- 阵亡 / 复活倒计时 -->
    <div v-if="ui.screen === 'play' && t.respawn > 0" class="dead">
      <b>阵亡</b>
      <span>{{ t.respawn.toFixed(1) }} 秒后复活</span>
    </div>
    <div v-else-if="ui.screen === 'play' && t.shield > 0" class="shield">出生保护 {{ t.shield.toFixed(1) }}s</div>

    <!-- Tab：计分板 -->
    <div v-if="hud.tab.open && ui.screen === 'play'" class="board">
      <div v-for="team in [0, 1] as const" :key="team" class="team" :class="team === 0 ? 'blue' : 'red'">
        <h3>{{ team === 0 ? '蓝队' : '红队' }} <b>{{ t.score[team] }}</b></h3>
        <table>
          <thead><tr><th>名字</th><th>武器</th><th>击杀</th><th>死亡</th></tr></thead>
          <tbody>
            <tr v-for="p in t.board.filter((x) => x.team === team)" :key="p.name" :class="{ you: p.you, down: !p.alive }">
              <td>{{ p.name }}</td><td>{{ p.weapon }}</td><td>{{ p.kills }}</td><td>{{ p.deaths }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 结算 -->
    <div v-if="ui.screen === 'result' && res" class="over" :class="res.winner === 0 ? 'win' : res.winner === 1 ? 'lose' : 'draw'">
      <div class="box">
        <h1>{{ res.winner === 0 ? '胜 利' : res.winner === 1 ? '失 败' : '平 局' }}</h1>
        <div class="final"><span class="b">{{ res.score[0] }}</span> : <span class="r">{{ res.score[1] }}</span></div>
        <p>你的战绩：击杀 {{ res.kills }} · 死亡 {{ res.deaths }} · K/D {{ (res.kills / Math.max(1, res.deaths)).toFixed(2) }}</p>
        <div class="btns">
          <button class="primary" @click="ui.actions.tdm()">再来一局</button>
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
  gap: 10px;
}
.side b {
  min-width: 42px;
  font-family: var(--hud-num);
  font-size: 30px;
  font-weight: 700;
  text-align: center;
}
.blue b {
  color: #5ab8ff;
}
.red b {
  color: #ff6a52;
}
.bar {
  display: block;
  width: 150px;
  height: 8px;
  background: rgba(0, 0, 0, 0.55);
}
.bar i {
  display: block;
  height: 100%;
}
.blue .bar {
  transform: scaleX(-1);
}
.blue .bar i {
  background: #4aa8ff;
}
.red .bar i {
  background: #ff5a3a;
}
.mid {
  min-width: 84px;
  padding: 4px 12px;
  text-align: center;
  background: var(--hud-panel);
}
.mid .tm {
  font-family: var(--hud-num);
  font-size: 22px;
  font-weight: 600;
}
.mid small {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--hud-muted);
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
  color: #ff5a45;
}
.dead span {
  font-size: 14px;
  color: var(--hud-text);
}
.shield {
  position: fixed;
  left: 50%;
  top: 60%;
  z-index: 21;
  transform: translateX(-50%);
  padding: 4px 14px;
  pointer-events: none;
  font-family: var(--hud-font);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-cyan);
  background: var(--hud-panel);
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
  width: min(880px, 92vw);
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
