<script setup lang="ts">
import { computed } from 'vue';
import { DIFFICULTIES } from '../../game/data/difficulty';
import { CHAPTERS, chapterUnlocked } from '../../game/data/chapters';
import { MASTERY_MAX, masteryProgress } from '../../game/data/mastery';
import { META_BY_ID, META_ITEMS, RANKS, metaDesc, rankFor, rankOf, type MetaSection } from '../../game/data/meta-catalog';
import { WEAPONS, WEAPON_ORDER } from '../../game/data/weapons';
import { ACHIEVEMENTS } from '../../game/meta/achievements';
import { canBuy, levelOf, masteryOf, nextPrice, totalMetaCost } from '../../game/meta/progress';
import { fmtTime, ui, type LobbyTab } from '../store';
import Settings from './Settings.vue';
import CodexPanel from './CodexPanel.vue';
import CloudPanel from './CloudPanel.vue';
import ArmoryBench from './ArmoryBench.vue';
import DeployPanel from './DeployPanel.vue';

const meta = computed(() => ui.save.meta);

/** 顶栏导航（6 个）：带英文代号，像终端里的频道。工程部 / 补给站 / 体能训练并进军械库 */
const tabs: Array<{ id: LobbyTab; name: string; code: string }> = [
  { id: 'deploy', name: '出征', code: 'DEPLOY' },
  { id: 'bench', name: '武器台', code: 'ARMORY' },
  { id: 'armory', name: '军械库', code: 'ARSENAL' },
  { id: 'records', name: '战绩', code: 'RECORDS' },
  { id: 'codex', name: '图鉴', code: 'CODEX' },
  { id: 'settings', name: '设置', code: 'SYSTEM' },
];

// ---- 军械库（四个子分类）----
const SECTIONS: Array<{ id: MetaSection; name: string; code: string; icon: string; desc: string }> = [
  { id: 'armory', name: '武器装备', code: 'WEAPONS', icon: '⌖', desc: '解锁新武器、手枪双持和随身武器。解锁要先把上一把枪练到精通' },
  { id: 'engineering', name: '工程设施', code: 'ENGINEERING', icon: '⛭', desc: '炮塔数量上限、新型炮塔和建筑强度，夜里守线靠它们' },
  { id: 'supply', name: '补给物资', code: 'SUPPLY', icon: '▣', desc: '开局零件、最大生命、发电机生命、零件收益和卡牌重抽' },
  { id: 'fitness', name: '体能训练', code: 'FITNESS', icon: '✚', desc: '减伤、自动回血、移动速度和射速，对每把枪都生效' },
];
const sec = computed(() => SECTIONS.find((x) => x.id === ui.shopTab) ?? SECTIONS[0]!);

const items = (sec: MetaSection) =>
  META_ITEMS.filter((m) => m.section === sec).map((m) => {
    const lv = levelOf(meta.value, m.id);
    const price = nextPrice(meta.value, m);
    const state = canBuy(meta.value, m.id);
    const needRank = price !== null ? RANKS[rankFor(m, lv)]?.name ?? '' : '';
    // 前置项目：「需要 解锁突击步枪」「需要 开局零件 2 级」
    const r = m.requires;
    const needPre = r ? `${META_BY_ID[r.id]?.name ?? r.id}${(META_BY_ID[r.id]?.prices.length ?? 1) > 1 ? ` ${r.level} 级` : ''}` : '';
    // 熟练度前置：「需要 手枪 熟练度 5（现在 3）」
    const ms = m.mastery;
    const needMastery = ms ? `${WEAPONS[ms.weapon].name} 熟练度 ${ms.level}（现在 ${masteryOf(meta.value, ms.weapon)}）` : '';
    return { id: m.id, name: m.name, lv, max: m.prices.length, price, state, needRank, needPre, needMastery, now: lv > 0 ? metaDesc(m, lv) : '', next: price !== null ? metaDesc(m, lv + 1) : '' };
  });
/** 已投入的勋章：全部 / 每个子分类 */
const paid = (pred: (s: MetaSection) => boolean): number => META_ITEMS.filter((m) => pred(m.section)).reduce((a, m) => a + m.prices.slice(0, levelOf(meta.value, m.id)).reduce((x, y) => x + y, 0), 0);
const priceOf = (s: MetaSection): number => META_ITEMS.filter((m) => m.section === s).reduce((a, m) => a + m.prices.reduce((x, y) => x + y, 0), 0);
const spent = computed(() => paid(() => true));
const total = totalMetaCost();
/** 每个子分类：已投入 / 总价 / 现在就能买的项目数（子 Tab 上的小角标） */
const secStats = computed(
  () => Object.fromEntries(SECTIONS.map((x) => [x.id, { spent: paid((s) => s === x.id), total: priceOf(x.id), ready: items(x.id).filter((i) => i.state === 'ok').length }])) as Record<MetaSection, { spent: number; total: number; ready: number }>,
);
const blocked: Record<string, string> = { requires: '需要先买前置项目', medals: '勋章不够', maxed: '已满级', rank: '军衔不够：累计获得的勋章够了自动晋升', mastery: '熟练度不够：用这把枪多杀僵尸' };

// ---- 军衔 ----
const rank = computed(() => {
  const i = rankOf(meta.value.medalsEarned);
  const next = RANKS[i + 1];
  const cur = RANKS[i] ?? RANKS[0];
  return { name: cur?.name ?? '', next: next?.name ?? '', need: next ? next.earned - meta.value.medalsEarned : 0, pct: next && cur ? (meta.value.medalsEarned - cur.earned) / (next.earned - cur.earned) : 1 };
});

// ---- 战绩 ----
const s = computed(() => ui.save);
const hsRate = computed(() => (s.value.totalKills > 0 ? Math.round((s.value.totalHeadshots / s.value.totalKills) * 100) : 0));
const winRate = computed(() => (s.value.runs > 0 ? Math.round((s.value.wins / s.value.runs) * 100) : 0));
/** 每把枪的熟练度经验（击杀 + 爆头击杀）：横条按经验最多的那把归一 */
const weaponRows = computed(() => {
  const rows = WEAPON_ORDER.map((k) => {
    const xp = meta.value.mastery[k] ?? 0;
    const owned = k === 'pistol' || levelOf(meta.value, `unlock-${k}`) > 0;
    return { k, name: WEAPONS[k].name, xp, lv: masteryProgress(k, xp).lv, owned, icon: ui.gfx.icon(k) };
  });
  const max = Math.max(1, ...rows.map((r) => r.xp));
  const top = rows.reduce((a, r) => (r.xp > a.xp ? r : a), rows[0]!);
  return rows.map((r) => ({ ...r, pct: r.xp / max, top: r.xp > 0 && r.k === top.k }));
});
const chapterRows = computed(() =>
  CHAPTERS.map((c) => ({ id: c.id, index: c.index, name: c.name.split('·')[1]?.trim() ?? c.name, place: c.place, done: meta.value.chapters.includes(c.id), open: chapterUnlocked(meta.value.chapters, c.id) })),
);
const achDone = computed(() => ACHIEVEMENTS.filter((a) => ui.save.codex.done.includes(a.id)).length);

const curTab = computed(() => tabs.find((t) => t.id === ui.lobbyTab) ?? tabs[0]!);
</script>

<template>
  <div v-if="ui.screen === 'lobby'" class="lobby">
    <div class="scan" aria-hidden="true"></div>
    <header>
      <div class="brand">
        <b>黎明</b>
        <span>指挥中心 <small>// {{ curTab.code }}</small></span>
      </div>
      <nav aria-label="大厅">
        <button v-for="t in tabs" :key="t.id" :class="{ on: ui.lobbyTab === t.id }" :aria-current="ui.lobbyTab === t.id ? 'page' : undefined" @click="ui.lobbyTab = t.id">{{ t.name }}</button>
      </nav>
      <div class="rank" :title="rank.next ? `累计勋章再得 ${rank.need} 晋升${rank.next}` : '已是最高军衔'">
        <b>{{ rank.name }}</b>
        <span class="bar"><i :style="{ width: `${Math.round(rank.pct * 100)}%` }"></i></span>
        <small>{{ rank.next ? `距${rank.next} ${rank.need}` : '最高军衔' }}</small>
      </div>
      <div class="medal" title="勋章：每局结束时按撑过的夜数、首领、击杀、爆头、通关和难度结算"><i>✦</i>{{ meta.medals }}<small>勋章</small></div>
      <div class="medal sup" title="补给：每局按撑过的夜数和击杀结算，用来买子弹和武器台强化"><i>▣</i>{{ meta.supplies }}<small>补给</small></div>
    </header>

    <!-- 出征（三栏指挥中心）、武器台（三栏武器展示）：铺满整页，不滚动 -->
    <DeployPanel v-if="ui.lobbyTab === 'deploy'" class="full" />

    <ArmoryBench v-else-if="ui.lobbyTab === 'bench'" class="full" />

    <!-- 军械库：四个子分类（武器装备 / 工程设施 / 补给物资 / 体能训练） -->
    <div v-else-if="ui.lobbyTab === 'armory'" class="full shop-page">
      <div class="subnav" role="tablist" aria-label="军械库分类">
        <button v-for="x in SECTIONS" :key="x.id" role="tab" :aria-selected="ui.shopTab === x.id" :class="{ on: ui.shopTab === x.id }" @click="ui.shopTab = x.id">
          <i aria-hidden="true">{{ x.icon }}</i>{{ x.name }}
          <em v-if="secStats[x.id].ready" :title="`${secStats[x.id].ready} 项现在就能买`">{{ secStats[x.id].ready }}</em>
        </button>
      </div>
      <div :key="sec.id" class="intro t-enter">
        <i aria-hidden="true">{{ sec.icon }}</i>
        <div>
          <b>{{ sec.name }} <small>{{ sec.code }}</small></b>
          <p>{{ sec.desc }}</p>
        </div>
        <span class="sec-sum">本类已投入 ✦ {{ secStats[sec.id].spent }} / {{ secStats[sec.id].total }}</span>
      </div>
      <section :key="sec.id + '-g'" class="shop t-enter">
        <div class="grid">
          <div
            v-for="it in items(sec.id)"
            :key="it.id"
            class="item t-panel"
            :class="{ maxed: it.state === 'maxed', locked: it.state === 'requires' || it.state === 'rank' || it.state === 'mastery', ready: it.state === 'ok' }"
          >
            <div class="top">
              <b>{{ it.name }}</b>
              <span class="pips" :aria-label="`${it.lv} / ${it.max} 级`"><i v-for="i in it.max" :key="i" :class="{ on: i <= it.lv }"></i></span>
            </div>
            <div v-if="it.needRank && it.state !== 'rank' && it.state !== 'maxed' && it.needRank !== RANKS[0]?.name" class="req">军衔：{{ it.needRank }}</div>
            <div v-if="it.now" class="now">当前：{{ it.now }}</div>
            <div v-if="it.next" class="next">{{ it.lv > 0 ? '下一级：' : '' }}{{ it.next }}</div>
            <button v-if="it.price !== null" class="buy" :disabled="it.state !== 'ok'" :title="blocked[it.state] ?? ''" @click="ui.actions.buyMeta(it.id)">
              <i>✦</i>{{ it.price }}<template v-if="it.state === 'requires'"> · 需要「{{ it.needPre }}」</template><template v-else-if="it.state === 'mastery'"> · 需要{{ it.needMastery }}</template><template v-else-if="it.state === 'rank'"> · 需要{{ it.needRank }}</template><template v-else-if="it.state === 'medals'"> · 还差 {{ (it.price ?? 0) - meta.medals }}</template>
            </button>
            <div v-else class="done">{{ it.max === 1 ? '已解锁 · 已生效' : '已满级' }}</div>
          </div>
        </div>
      </section>
      <div class="sum">
        <span>军械库总投入</span>
        <span class="sum-bar"><i :style="{ width: `${(spent / total) * 100}%` }"></i></span>
        <b>✦ {{ spent }} <small>/ {{ total }}</small></b>
      </div>
    </div>

    <!-- 战绩：总览 / 武器统计 / 章节记录 / 成就墙 -->
    <section v-else-if="ui.lobbyTab === 'records'" class="t-enter records-page">
      <div class="big">
        <div class="t-panel"><span>出征</span><b>{{ s.runs }}</b><small>次</small></div>
        <div class="t-panel"><span>通关</span><b>{{ s.wins }}</b><small>胜率 {{ winRate }}%</small></div>
        <div class="t-panel"><span>累计击杀</span><b>{{ s.totalKills }}</b><small>单局最多 {{ s.bestKills }}</small></div>
        <div class="t-panel"><span>爆头率</span><b>{{ hsRate }}<em>%</em></b><small>爆头击杀 {{ s.totalHeadshots }}</small></div>
      </div>
      <div class="cols">
        <div class="t-panel card">
          <div class="t-head">武器统计 <small>WEAPON MASTERY</small></div>
          <p class="hint">熟练度经验 = 击杀 + 爆头击杀</p>
          <div v-for="w in weaponRows" :key="w.k" class="wrow" :class="{ top: w.top, off: !w.owned && w.xp === 0 }">
            <img v-if="w.icon" :src="w.icon" alt="" />
            <span v-else class="noicon"></span>
            <span class="wn">{{ w.name }}<em v-if="w.top">最常用</em></span>
            <span class="wbar"><i :style="{ width: `${w.pct * 100}%` }"></i></span>
            <span class="wx">{{ w.xp }}</span>
            <span class="wl" :title="`熟练度 ${w.lv} / ${MASTERY_MAX}`">{{ w.lv >= MASTERY_MAX ? '精通' : `Lv ${w.lv}` }}</span>
          </div>
        </div>
        <div class="t-panel card">
          <div class="t-head">章节记录 <small>CAMPAIGN</small></div>
          <div v-for="c in chapterRows" :key="c.id" class="crow" :class="{ done: c.done, locked: !c.open }">
            <i>{{ String(c.index).padStart(2, '0') }}</i>
            <div>
              <b>{{ c.name }}</b><span>{{ c.place }}</span>
            </div>
            <em>{{ c.done ? '已通关' : c.open ? '可出征' : '未解锁' }}</em>
          </div>
          <dl class="misc">
            <div><dt>最远</dt><dd>第 {{ s.bestNight }} 夜</dd></div>
            <div><dt>最快通关</dt><dd>{{ s.bestWinTime > 0 ? fmtTime(s.bestWinTime) : '—' }}</dd></div>
            <div><dt>通关的难度</dt><dd>{{ meta.cleared.length ? meta.cleared.map((d) => DIFFICULTIES[d].name).join('、') : '—' }}</dd></div>
            <div><dt>累计勋章</dt><dd>✦ {{ meta.medalsEarned }}</dd></div>
          </dl>
        </div>
      </div>
      <div class="t-panel card">
        <div class="t-head">成就墙 <small>ACHIEVEMENTS · {{ achDone }} / {{ ACHIEVEMENTS.length }}</small></div>
        <div class="badges">
          <div v-for="a in ACHIEVEMENTS" :key="a.id" class="badge" :class="{ done: ui.save.codex.done.includes(a.id) }">
            <i aria-hidden="true">{{ ui.save.codex.done.includes(a.id) ? '★' : '☆' }}</i>
            <b>{{ a.name }}</b>
            <span>{{ a.desc }}</span>
            <em>✦ {{ a.medals }}</em>
          </div>
        </div>
      </div>
    </section>

    <!-- 图鉴 -->
    <section v-else-if="ui.lobbyTab === 'codex'" class="t-enter">
      <CodexPanel />
    </section>

    <!-- 设置：音频 / 画面 / 操控 / 系统，每组可折叠，默认全展开（标题页不再放滑块） -->
    <section v-else class="t-enter settings-page">
      <div class="col">
      <details class="t-panel group" open>
        <summary class="t-head">音频 <small>AUDIO</small></summary>
        <Settings part="audio" />
      </details>
      <details class="t-panel group" open>
        <summary class="t-head">操控 <small>CONTROLS</small></summary>
        <Settings part="controls" />
      </details>
      </div>
      <div class="col">
      <details class="t-panel group" open>
        <summary class="t-head">画面 <small>VIDEO</small></summary>
        <Settings part="video" />
      </details>
      <details class="t-panel group" open>
        <summary class="t-head">系统 <small>ACCOUNT · CLOUD SAVE</small></summary>
        <CloudPanel />
      </details>
      </div>
    </section>

    <footer>
      <button class="t-btn back" @click="ui.screen = 'menu'">◂ 返回标题</button>
      <span class="sys">SURVIVAL PROTOCOL · {{ ui.cloud.name ? `OPERATOR ${ui.cloud.name.toUpperCase()}` : 'OFFLINE' }}</span>
    </footer>
  </div>
</template>

<style scoped>
.lobby {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  padding: 22px 3.5vw 16px;
  background: radial-gradient(ellipse at 50% 45%, rgba(5, 8, 12, 0.55), rgba(5, 8, 12, 0.88) 75%), linear-gradient(180deg, rgba(5, 8, 12, 0.6), transparent 30%, rgba(5, 8, 12, 0.6));
  color: var(--t-text);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  overflow: hidden;
}
.scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.015) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 22px;
  padding-bottom: 12px;
  border-bottom: 1px solid transparent;
  border-image: linear-gradient(90deg, rgba(240, 184, 58, 0.5), rgba(255, 255, 255, 0.1) 40%, rgba(255, 255, 255, 0.1)) 1;
}
.brand {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 12px;
  white-space: nowrap;
}
.brand b {
  font-size: 24px;
  letter-spacing: 8px;
  color: var(--t-red);
  font-weight: 800;
}
.brand span {
  font-size: 14px;
  letter-spacing: 4px;
  color: var(--t-gold-soft);
}
.brand small {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--t-dim);
}
nav {
  display: flex;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
nav button {
  position: relative;
  flex: none;
  white-space: nowrap;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  color: var(--t-muted);
  font: inherit;
  font-size: 14px;
  letter-spacing: 3px;
  cursor: pointer;
  transition: color 0.15s var(--t-ease);
}
/* 选中：底下一道金线（压在顶栏的分隔线上） */
nav button::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -13px;
  height: 2px;
  background: var(--t-gold);
  transform: scaleX(0);
  transition: transform 0.15s var(--t-ease);
}
nav button:hover,
nav button:focus-visible {
  outline: none;
  color: var(--t-text);
}
nav button.on {
  color: var(--t-gold);
}
nav button.on::after {
  transform: scaleX(1);
}
.medal {
  flex: none;
  white-space: nowrap;
  font-family: var(--t-mono);
  font-size: 20px;
  color: var(--t-gold);
}
.medal i,
.buy i {
  font-style: normal;
  margin-right: 6px;
}
.medal small {
  margin-left: 6px;
  font-family: var(--hud-font);
  font-size: 12px;
  color: var(--t-muted);
  letter-spacing: 3px;
}
.medal.sup {
  color: var(--t-cyan);
}
.rank {
  flex: none;
  display: grid;
  grid-template-columns: auto 90px;
  column-gap: 10px;
  align-items: center;
  margin-left: auto;
}
.rank b {
  grid-row: span 2;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 3px;
  color: var(--t-gold-soft);
}
.rank .bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
}
.rank .bar i {
  display: block;
  height: 100%;
  background: var(--t-gold-soft);
}
.rank small {
  font-size: 11px;
  color: var(--t-muted);
}
section,
.full {
  position: relative;
  flex: 1;
  min-height: 0;
  margin-top: 18px;
}
section {
  overflow-y: auto;
  overflow-x: hidden;
}
/* ---- 军械库：子分类 + 分类说明 + 卡片网格 + 底部投入进度 ---- */
.shop-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.subnav {
  display: flex;
  gap: 6px;
}
.subnav button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--t-line);
  color: var(--t-muted);
  font: inherit;
  font-size: 14px;
  letter-spacing: 3px;
  cursor: pointer;
  transition: 0.15s var(--t-ease);
}
.subnav button i {
  font-style: normal;
  font-size: 15px;
  color: var(--t-dim);
}
.subnav button:hover,
.subnav button:focus-visible {
  outline: none;
  color: var(--t-text);
  border-color: var(--t-line-strong);
}
.subnav button.on {
  color: var(--t-gold);
  border-color: rgba(240, 184, 58, 0.6);
  background: rgba(240, 184, 58, 0.09);
}
.subnav button.on i {
  color: var(--t-gold);
}
/* 能买的项目数：右上角小角标 */
.subnav em {
  min-width: 18px;
  padding: 0 5px;
  font-style: normal;
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 0;
  line-height: 18px;
  text-align: center;
  color: #0b0f14;
  background: var(--t-gold);
}
.intro {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-left: 2px solid var(--t-gold);
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.08), transparent 70%);
}
.intro > i {
  font-style: normal;
  font-size: 26px;
  color: var(--t-gold);
}
.intro b {
  font-size: 16px;
  letter-spacing: 4px;
  color: var(--t-text);
}
.intro b small {
  margin-left: 8px;
  font-family: var(--t-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--t-dim);
}
.intro p {
  margin-top: 3px;
  font-size: 13px;
  color: var(--t-muted);
}
.sec-sum {
  margin-left: auto;
  font-family: var(--t-mono);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-gold-soft);
  white-space: nowrap;
}
.shop {
  flex: 1;
  margin-top: 0;
  padding-right: 4px;
}
.req {
  font-size: 12px;
  color: var(--t-gold-soft);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 升级后文字长短会变：卡片高度固定下来，免得整排跟着跳 */
  min-height: 176px;
  padding: 14px 16px;
  --corner: rgba(255, 255, 255, 0.25);
  transition: border-color 0.15s var(--t-ease), box-shadow 0.15s var(--t-ease);
}
.item:hover {
  border-color: var(--t-line-strong);
}
.item.ready {
  --corner: rgba(240, 184, 58, 0.85);
}
/* 满级：蓝绿边框 + 淡辉光 */
.item.maxed {
  --corner: var(--t-cyan);
  border-color: rgba(111, 208, 232, 0.45);
  box-shadow: inset 0 0 24px rgba(111, 208, 232, 0.07), 0 0 14px rgba(111, 208, 232, 0.08);
}
.item.locked {
  opacity: 0.55;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.top b {
  font-size: 15px;
  letter-spacing: 2px;
}
/* 进度：金色圆点 */
.pips {
  display: flex;
  gap: 4px;
}
.pips i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.pips i.on {
  background: var(--t-gold);
  border-color: var(--t-gold);
  box-shadow: 0 0 6px rgba(240, 184, 58, 0.6);
}
.maxed .pips i.on {
  background: var(--t-cyan);
  border-color: var(--t-cyan);
  box-shadow: 0 0 6px rgba(111, 208, 232, 0.6);
}
.now {
  font-size: 12px;
  color: var(--t-cyan);
}
.next {
  font-size: 13px;
  color: #aeb8c2;
  line-height: 1.5;
  flex: 1;
  min-height: 3em;
}
.buy {
  align-self: flex-start;
  margin-top: auto;
  max-width: 100%;
  text-align: left;
  line-height: 1.4;
  padding: 6px 16px;
  background: rgba(240, 184, 58, 0.05);
  border: 1px solid var(--t-gold);
  color: var(--t-gold);
  font: inherit;
  font-size: 14px;
  letter-spacing: 1px;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
  transition: 0.15s var(--t-ease);
}
.buy:hover:not(:disabled),
.buy:focus-visible {
  outline: none;
  background: var(--t-gold);
  color: #0b0f14;
  box-shadow: 0 0 18px rgba(240, 184, 58, 0.35);
}
.buy:disabled {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.18);
  color: var(--t-dim);
  cursor: not-allowed;
}
.done {
  margin-top: auto;
  line-height: 33px;
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--t-cyan);
}
.sum {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--t-muted);
}
.sum-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
}
.sum-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.5), var(--t-gold));
  box-shadow: 0 0 8px rgba(240, 184, 58, 0.4);
}
.sum b {
  font-family: var(--t-mono);
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--t-gold);
}
.sum b small {
  color: var(--t-dim);
}
/* ---- 战绩 ---- */
.records-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}
.big {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.big > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 18px;
}
.big span {
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--t-muted);
}
.big b {
  font-family: var(--t-mono);
  font-size: 38px;
  font-weight: 600;
  line-height: 1.1;
  color: #f1e8cc;
  font-variant-numeric: tabular-nums;
}
.big b em {
  font-style: normal;
  font-size: 20px;
  color: var(--t-gold-soft);
}
.big small {
  font-size: 12px;
  color: #c8a85a;
}
.cols {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
}
.card {
  padding: 16px 20px;
}
.hint {
  margin: -6px 0 10px;
  font-size: 11px;
  color: var(--t-dim);
}
.wrow {
  display: grid;
  grid-template-columns: 54px 110px 1fr 54px 44px;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}
.wrow img,
.wrow .noicon {
  width: 54px;
  height: 22px;
  object-fit: contain;
}
.wrow.off {
  opacity: 0.4;
}
.wn {
  color: var(--t-text);
  letter-spacing: 2px;
  white-space: nowrap;
}
.wn em {
  margin-left: 6px;
  padding: 0 4px;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 1px;
  color: #0b0f14;
  background: var(--t-gold);
}
.wbar {
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
}
.wbar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(111, 208, 232, 0.35), rgba(111, 208, 232, 0.8));
  transition: width 0.3s var(--t-ease);
}
.wrow.top .wbar i {
  background: linear-gradient(90deg, rgba(240, 184, 58, 0.5), var(--t-gold));
}
.wx {
  text-align: right;
  font-family: var(--t-mono);
  color: var(--t-text);
  font-variant-numeric: tabular-nums;
}
.wl {
  font-size: 11px;
  color: var(--t-gold-soft);
  text-align: right;
}
.crow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--t-line);
}
.crow > i {
  font-style: normal;
  font-family: var(--t-mono);
  font-size: 18px;
  color: var(--t-dim);
}
.crow div {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.crow b {
  font-size: 14px;
  letter-spacing: 2px;
}
.crow span {
  font-size: 11px;
  color: var(--t-muted);
}
.crow em {
  font-style: normal;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.crow.done > i,
.crow.done em {
  color: var(--t-cyan);
}
.crow.locked {
  opacity: 0.45;
}
.misc {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin-top: 14px;
}
.misc div {
  padding-left: 10px;
  border-left: 2px solid rgba(240, 184, 58, 0.35);
}
.misc dt {
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--t-muted);
}
.misc dd {
  margin-top: 2px;
  font-size: 15px;
  color: #f1e8cc;
}
.badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--t-dim);
}
.badge i {
  font-style: normal;
  font-size: 22px;
}
.badge b {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--t-muted);
}
.badge span {
  font-size: 11px;
  line-height: 1.4;
}
.badge em {
  font-style: normal;
  font-size: 11px;
  color: var(--t-dim);
}
.badge.done {
  border-color: rgba(240, 184, 58, 0.4);
  background: radial-gradient(circle at 50% 20%, rgba(240, 184, 58, 0.12), transparent 70%);
  color: #aeb8c2;
}
.badge.done i,
.badge.done em {
  color: var(--t-gold);
}
.badge.done b {
  color: var(--t-text);
}
/* ---- 设置：四个可折叠分组 ---- */
/* 两列：左边音频 + 操控，右边画面 + 系统（分组高度差很多，grid 会留大块空白；
   CSS columns 会让毛玻璃面板糊掉，所以用两个列容器） */
.settings-page {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
  max-width: 1100px;
}
.settings-page .col {
  flex: 1 1 420px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.group {
  padding: 14px 20px 18px;
}
.group summary {
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.group summary::-webkit-details-marker {
  display: none;
}
.group summary::before {
  content: '▾';
  color: var(--t-gold);
  transition: transform 0.15s var(--t-ease);
}
.group:not([open]) summary {
  margin-bottom: 0;
}
.group:not([open]) summary::before {
  transform: rotate(-90deg);
}
.group summary:focus-visible {
  outline: 1px solid var(--t-gold);
  outline-offset: 2px;
}
/* CloudPanel 自带的上边框 / 标题在分组里多余 */
.group :deep(.cloud) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.group :deep(.cloud h3) {
  display: none;
}
footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
}
.back {
  padding: 7px 18px;
  font-size: 13px;
}
.sys {
  font-family: var(--t-mono);
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--t-dim);
}
@media (max-width: 1440px) {
  .brand span {
    display: none;
  }
  .rank {
    grid-template-columns: auto 60px;
  }
  .rank small {
    display: none;
  }
  .medal {
    font-size: 17px;
  }
}
</style>

