<script setup lang="ts">
import { RARITY_NAME } from '../../game/data/cards';
import { hud } from '../hud';
import { ui } from '../store';

const barColor = (f: number) => (f > 0.6 ? 'var(--hud-ok)' : f > 0.3 ? 'var(--hud-accent)' : 'var(--hud-danger)');
</script>

<template>
  <div v-if="hud.tab.open && (ui.screen === 'play' || ui.screen === 'training')" class="tab" role="dialog" aria-label="本局面板">
    <header>
      <b>第 {{ hud.night }} {{ hud.phase === 'night' ? '夜' : '天' }}</b>
      <span>松开 <kbd>Tab</kbd> 关闭</span>
    </header>

    <div class="cols">
      <!-- 属性 -->
      <section>
        <h3>属性</h3>
        <dl class="kv">
          <template v-for="r in hud.tab.stats" :key="r.k">
            <dt>{{ r.k }}</dt>
            <dd :class="{ up: r.up, down: r.down }">{{ r.v }}</dd>
          </template>
        </dl>
      </section>

      <!-- 加成 -->
      <section>
        <h3>本局卡牌</h3>
        <ul v-if="hud.buffs.length" class="cards">
          <li v-for="b in hud.buffs" :key="b.id" :class="b.rarity">
            <div class="ch">
              <b>{{ b.name }}</b><em v-if="b.n > 1">×{{ b.n }}</em><span class="rar">{{ RARITY_NAME[b.rarity] }}</span>
            </div>
            <div class="cd">{{ b.desc }}</div>
          </li>
        </ul>
        <p v-else class="empty">每个黎明三选一</p>
        <template v-if="hud.metaLines.length">
          <h3 class="sub">局外成长</h3>
          <div class="tags"><span v-for="l in hud.metaLines" :key="l">{{ l }}</span></div>
        </template>
      </section>

      <!-- 战况 / 击杀 / 建筑 -->
      <section>
        <h3>战况</h3>
        <dl class="kv">
          <template v-for="r in hud.tab.run" :key="r.k">
            <dt>{{ r.k }}</dt>
            <dd>{{ r.v }}</dd>
          </template>
        </dl>
        <h3 class="sub">击杀</h3>
        <dl v-if="hud.tab.kills.length" class="kv">
          <template v-for="r in hud.tab.kills" :key="r.name">
            <dt>{{ r.name }}</dt>
            <dd>{{ r.n }}</dd>
          </template>
        </dl>
        <p v-else class="empty">—</p>
        <h3 class="sub">建筑</h3>
        <ul v-if="hud.tab.structs.length" class="structs">
          <li v-for="s in hud.tab.structs" :key="s.name">
            <span class="sn">{{ s.name }} <em>×{{ s.n }}</em></span>
            <span class="bar" :title="`平均 ${Math.round(s.avg * 100)}%，最低 ${Math.round(s.low * 100)}%`">
              <i :style="{ width: s.avg * 100 + '%', background: barColor(s.avg) }"></i>
            </span>
            <span class="lo" :style="{ color: barColor(s.low) }">{{ Math.round(s.low * 100) }}%</span>
          </li>
        </ul>
        <p v-else class="empty">还没建造</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tab {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 60;
  transform: translate(-50%, -50%);
  width: min(1040px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  font-family: var(--hud-font);
  color: var(--hud-text);
  background: rgba(7, 10, 14, 0.9);
  border-top: 2px solid var(--hud-accent);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 22px 10px;
  border-bottom: 1px solid var(--hud-line);
}
header b {
  font-size: 18px;
  letter-spacing: 6px;
  color: var(--hud-accent);
}
header span {
  font-size: 12px;
  color: var(--hud-muted);
}
kbd {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid var(--hud-line-strong);
  border-radius: 2px;
  font: 600 11px/16px var(--hud-font);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1.15fr 1fr;
  gap: 0;
  overflow: hidden;
  min-height: 0;
}
section {
  padding: 14px 22px 18px;
  overflow-y: auto;
  min-height: 0;
}
section + section {
  border-left: 1px solid var(--hud-line);
}
h3 {
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 5px;
  color: var(--hud-cyan);
}
h3.sub {
  margin-top: 16px;
}
.kv {
  display: grid;
  grid-template-columns: auto 1fr;
  row-gap: 5px;
  column-gap: 12px;
  font-size: 13px;
}
.kv dt {
  color: var(--hud-muted);
}
.kv dd {
  text-align: right;
  font-family: var(--hud-num);
  font-variant-numeric: tabular-nums;
}
.kv dd.up {
  color: var(--hud-ok);
}
.kv dd.down {
  color: var(--hud-danger);
}
.cards {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cards li {
  --c: #a8b4c0;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid var(--c);
}
.cards li.rare {
  --c: #5ab8f0;
}
.cards li.epic {
  --c: #d08af0;
}
.cards li.curse {
  --c: #e8553f;
}
.ch {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
}
.ch em {
  font-style: normal;
  color: var(--c);
}
.rar {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--c);
}
.cd {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.5;
  color: #9aa6b2;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tags span {
  padding: 2px 8px;
  font-size: 11px;
  background: rgba(111, 208, 232, 0.1);
  border: 1px solid rgba(111, 208, 232, 0.3);
}
.empty {
  font-size: 12px;
  color: var(--hud-dim);
}
.structs {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.structs li {
  display: grid;
  grid-template-columns: 1fr 80px 38px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.sn em {
  font-style: normal;
  font-family: var(--hud-num);
  color: var(--hud-muted);
}
.bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
}
.bar i {
  display: block;
  height: 100%;
}
.lo {
  text-align: right;
  font-family: var(--hud-num);
  font-size: 12px;
}
</style>
