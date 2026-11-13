<script setup lang="ts">
import { RARITY_NAME } from '../../game/data/cards';
import { hud } from '../hud';
import { ui } from '../store';

const barColor = (f: number) => (f > 0.6 ? 'var(--hud-ok)' : f > 0.3 ? 'var(--hud-accent)' : 'var(--hud-danger)');
const PAGES = ['属性', '武器', '战况'];
/** 来源种类的短标签（不同颜色区分是哪一类加成） */
const KIND: Record<string, string> = { meta: '局外', card: '卡牌', difficulty: '难度', chapter: '章节', mod: '词缀', bench: '武器台', weight: '重量', tier: '工坊', base: '' };
</script>

<template>
  <div v-if="hud.tab.open && (ui.screen === 'play' || ui.screen === 'training')" class="tab" role="dialog" aria-label="本局面板">
    <header>
      <b>第 {{ hud.night }} {{ hud.phase === 'night' ? '夜' : '天' }}</b>
      <nav class="pages" aria-label="面板分页">
        <span v-for="(p, i) in PAGES" :key="p" :class="{ on: hud.tab.page === i }">{{ p }}</span>
      </nav>
      <span><kbd>Q</kbd> / <kbd>E</kbd> 翻页 · 松开 <kbd>Tab</kbd> 关闭</span>
    </header>

    <!-- 属性：基础值 × 各来源 = 最终值 -->
    <div v-if="hud.tab.page === 0" class="cols two">
      <section class="ledger">
        <h3>属性 <small>基础 → 各项加成（相乘）→ 最终</small></h3>
        <div v-for="r in hud.tab.rows" :key="r.id" class="lrow">
          <span class="ln">{{ r.name }}</span>
          <span class="lb">{{ r.base }}</span>
          <span class="lp">
            <i v-for="p in r.parts" :key="p.name" :class="[p.kind, p.good ? 'g' : 'b']"><em>{{ KIND[p.kind] }}</em>{{ p.name.replace(/^局外·/, '') }} <b>{{ p.text }}</b></i>
            <i v-if="!r.parts.length" class="none">—</i>
          </span>
          <span class="lf" :class="r.trend">{{ r.final }}<small v-if="r.capped"> 已触顶</small></span>
        </div>
      </section>
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
        <h3 class="sub">生命</h3>
        <dl class="kv">
          <template v-for="r in hud.tab.stats.slice(0, 2)" :key="r.k">
            <dt>{{ r.k }}</dt>
            <dd>{{ r.v }}</dd>
          </template>
        </dl>
      </section>
    </div>

    <!-- 武器：身上每把枪的五项属性 -->
    <div v-else-if="hud.tab.page === 1" class="cols guns">
      <section v-for="g in hud.tab.guns" :key="g.kind">
        <h3>{{ g.name }} <small>{{ g.tier }} 级{{ g.hand ? ' · 手上' : ' · 背着' }} · 本局击杀 {{ g.kills }} · DPS {{ g.dps }}</small></h3>
        <div v-for="r in g.rows" :key="r.id" class="lrow">
          <span class="ln">{{ r.name }}</span>
          <span class="lb">{{ r.base }}</span>
          <span class="lp">
            <i v-for="p in r.parts" :key="p.name" :class="[p.kind, p.good ? 'g' : 'b']"><em>{{ KIND[p.kind] }}</em>{{ p.name.replace(/^(局外|武器台)·/, '') }} <b>{{ p.text }}</b></i>
            <i v-if="!r.parts.length" class="none">—</i>
          </span>
          <span class="lf" :class="r.trend">{{ r.final }}</span>
        </div>
      </section>
    </div>

    <!-- 战况 / 击杀 / 建筑 -->
    <div v-else class="cols">
      <section>
        <h3>战况</h3>
        <dl class="kv">
          <template v-for="r in hud.tab.run" :key="r.k">
            <dt>{{ r.k }}</dt>
            <dd>{{ r.v }}</dd>
          </template>
        </dl>
      </section>
      <section>
        <h3>击杀</h3>
        <dl v-if="hud.tab.kills.length" class="kv">
          <template v-for="r in hud.tab.kills" :key="r.name">
            <dt>{{ r.name }}</dt>
            <dd>{{ r.n }}</dd>
          </template>
        </dl>
        <p v-else class="empty">—</p>
        <template v-if="hud.metaLines.length">
          <h3 class="sub">局外成长</h3>
          <div class="tags"><span v-for="l in hud.metaLines" :key="l">{{ l }}</span></div>
        </template>
      </section>
      <section>
        <h3>建筑</h3>
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
.pages {
  display: flex;
  gap: 4px;
}
.pages span {
  padding: 2px 12px;
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--hud-muted);
  border: 1px solid var(--hud-line);
}
.pages span.on {
  color: var(--hud-accent);
  border-color: var(--hud-accent);
}
.cols.two {
  grid-template-columns: 1.9fr 1fr;
}
.cols.guns {
  grid-template-columns: 1fr 1fr;
}
h3 small {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--hud-muted);
}
.lrow {
  display: grid;
  grid-template-columns: 72px 62px 1fr 78px;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px dashed var(--hud-line);
  font-size: 13px;
}
.ln {
  color: var(--hud-muted);
}
.lb,
.lf {
  font-family: var(--hud-num);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.lb {
  color: var(--hud-muted);
}
.lf.up {
  color: var(--hud-ok);
}
.lf.down {
  color: var(--hud-danger);
}
.lf small {
  font-size: 10px;
  color: var(--hud-accent);
}
.lp {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 10px;
  font-size: 12px;
}
.lp i {
  font-style: normal;
  white-space: nowrap;
}
.lp i em {
  font-style: normal;
  font-size: 10px;
  margin-right: 3px;
  padding: 0 3px;
  border: 1px solid currentColor;
  opacity: 0.7;
}
.lp i b {
  font-family: var(--hud-num);
}
.lp i.g b {
  color: var(--hud-ok);
}
.lp i.b b {
  color: var(--hud-accent);
}
.lp i.none {
  color: var(--hud-muted);
}
.lp .card em {
  color: #d08af0;
}
.lp .meta em {
  color: var(--hud-cyan);
}
.lp .difficulty em,
.lp .chapter em,
.lp .mod em {
  color: var(--hud-accent);
}
.lp .weight em,
.lp .bench em,
.lp .tier em {
  color: #a8b4c0;
}
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
  --c: var(--t-red);
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
  color: var(--hud-muted);
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
