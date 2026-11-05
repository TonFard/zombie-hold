<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../../game/data/difficulty';
import { META_BY_ID, META_ITEMS, RANKS, SECTION_NAME, metaDesc, rankFor, rankOf, type MetaSection } from '../../game/data/meta-catalog';
import { WEAPONS, WEAPON_ORDER, type WeaponKind } from '../../game/data/weapons';
import { bonusesOf, canBuy, difficultyUnlocked, levelOf, nextPrice, totalMetaCost } from '../../game/meta/progress';
import { sidearmOk } from '../../game/meta/loadout';
import { fmtTime, ui, type LobbyTab } from '../store';
import Settings from './Settings.vue';
import CodexPanel from './CodexPanel.vue';
import CloudPanel from './CloudPanel.vue';
import { dailyFor, todayKey } from '../../game/meta/achievements';
import { nightMod } from '../../game/data/modifiers';

const meta = computed(() => ui.save.meta);
const bonuses = computed(() => bonusesOf(meta.value));

const tabs: Array<{ id: LobbyTab; name: string }> = [
  { id: 'deploy', name: '出征' },
  { id: 'armory', name: SECTION_NAME.armory },
  { id: 'engineering', name: SECTION_NAME.engineering },
  { id: 'supply', name: SECTION_NAME.supply },
  { id: 'fitness', name: SECTION_NAME.fitness },
  { id: 'records', name: '战绩' },
  { id: 'codex', name: '图鉴' },
  { id: 'settings', name: '设置' },
];

// ---- 出征 ----
const difficulty = ref<Difficulty>(meta.value.lastDifficulty);
const sidearm = ref<WeaponKind | null>(meta.value.lastSidearm);
// 组件比存档先创建：每次进大厅时按存档里上次的选择重新填一遍
watch(
  () => ui.screen === 'lobby',
  (open) => {
    if (!open) return;
    const m = meta.value;
    difficulty.value = difficultyUnlocked(m, m.lastDifficulty) ? m.lastDifficulty : 'normal';
    // 上次带的枪现在带不了（存档被改过 / 换了档）时退回「不带」，免得一个按钮都没选中
    sidearm.value = sidearmOk(bonuses.value, m.lastSidearm) ? m.lastSidearm : null;
  },
  { immediate: true },
);
const sidearms = computed<WeaponKind[]>(() => WEAPON_ORDER.filter((k) => sidearmOk(bonuses.value, k)));
const diffNote = (d: Difficulty): string => {
  const def = DIFFICULTIES[d];
  if (!difficultyUnlocked(meta.value, d)) return `通关${DIFFICULTIES[def.requires as Difficulty].name}后解锁`;
  if (d === 'normal') return '标准难度';
  return `僵尸生命 ×${def.hp}、数量 ×${def.count}、伤害 ×${def.damage} · 勋章 ×${def.medals}`;
};
/** 有检查点时出征要二次确认：会放弃上一局 */
const confirming = ref(false);
const deploy = (): void => {
  if (ui.checkpoint && !confirming.value) {
    confirming.value = true;
    return;
  }
  confirming.value = false;
  const side = sidearm.value && sidearms.value.includes(sidearm.value) ? sidearm.value : null;
  ui.actions.deploy(difficulty.value, side);
};

// ---- 商店 ----
const items = (sec: MetaSection) =>
  META_ITEMS.filter((m) => m.section === sec).map((m) => {
    const lv = levelOf(meta.value, m.id);
    const price = nextPrice(meta.value, m);
    const state = canBuy(meta.value, m.id);
    const needRank = price !== null ? RANKS[rankFor(m, lv)]?.name ?? '' : '';
    // 前置项目：「需要 解锁突击步枪」「需要 开局零件 2 级」
    const r = m.requires;
    const needPre = r ? `${META_BY_ID[r.id]?.name ?? r.id}${(META_BY_ID[r.id]?.prices.length ?? 1) > 1 ? ` ${r.level} 级` : ''}` : '';
    return { id: m.id, name: m.name, lv, max: m.prices.length, price, state, needRank, needPre, now: lv > 0 ? metaDesc(m, lv) : '', next: price !== null ? metaDesc(m, lv + 1) : '' };
  });
const shopSection = computed(() => (ui.lobbyTab === 'armory' || ui.lobbyTab === 'engineering' || ui.lobbyTab === 'supply' || ui.lobbyTab === 'fitness' ? ui.lobbyTab : null));
const spent = computed(() => META_ITEMS.reduce((a, m) => a + m.prices.slice(0, levelOf(meta.value, m.id)).reduce((x, y) => x + y, 0), 0));
const total = totalMetaCost();
const blocked: Record<string, string> = { requires: '需要先买前置项目', medals: '勋章不够', maxed: '已满级', rank: '军衔不够：累计获得的勋章够了自动晋升' };

// ---- 军衔 ----
const rank = computed(() => {
  const i = rankOf(meta.value.medalsEarned);
  const next = RANKS[i + 1];
  const cur = RANKS[i] ?? RANKS[0];
  return { name: cur?.name ?? '', next: next?.name ?? '', need: next ? next.earned - meta.value.medalsEarned : 0, pct: next && cur ? (meta.value.medalsEarned - cur.earned) / (next.earned - cur.earned) : 1 };
});
const hsRate = computed(() => (ui.save.totalKills > 0 ? Math.round((ui.save.totalHeadshots / ui.save.totalKills) * 100) : 0));

/** 出征页的"当前加成一览" */
const summary = computed(() => {
  const b = bonuses.value;
  const out: string[] = [];
  out.push(`可用武器：${[...b.weapons].map((k) => WEAPONS[k].name).join('、')}`);
  out.push(`炮塔上限 ${b.turretCap} 座`);
  if (b.structures.size > 3) out.push(`新炮塔 ${b.structures.size - 3} 种`);
  if (b.startScrap) out.push(`开局零件 +${b.startScrap}`);
  if (b.maxHp) out.push(`生命 +${b.maxHp}`);
  if (b.coreHp) out.push(`发电机 +${b.coreHp}`);
  if (b.turretDamage > 1) out.push(`炮塔伤害 +${Math.round((b.turretDamage - 1) * 100)}%`);
  if (b.structHp > 1) out.push(`建筑生命 +${Math.round((b.structHp - 1) * 100)}%`);
  if (b.scrapGain > 1) out.push(`零件收益 +${Math.round((b.scrapGain - 1) * 100)}%`);
  if (b.rerolls) out.push('卡牌可重抽');
  if (b.cardChoices > 3) out.push('卡牌四选一');
  return out;
});

const s = computed(() => ui.save);
const daily = dailyFor(todayKey());
const dailyBest = computed(() => ui.save.codex.daily[daily.key]);
const savedAt = computed(() => (ui.checkpoint?.savedAt ? new Date(ui.checkpoint.savedAt).toLocaleString() : ''));
</script>

<template>
  <div v-if="ui.screen === 'lobby'" class="lobby">
    <header>
      <div class="brand">黎明 · <span>据点</span></div>
      <nav>
        <button v-for="t in tabs" :key="t.id" :class="{ on: ui.lobbyTab === t.id }" @click="ui.lobbyTab = t.id">{{ t.name }}</button>
      </nav>
      <div class="rank" :title="rank.next ? `累计勋章再得 ${rank.need} 晋升${rank.next}` : '已是最高军衔'">
        <b>{{ rank.name }}</b>
        <span class="bar"><i :style="{ width: `${Math.round(rank.pct * 100)}%` }"></i></span>
        <small>{{ rank.next ? `距${rank.next} ${rank.need}` : '最高军衔' }}</small>
      </div>
      <div class="medal" title="勋章：每局结束时按撑过的夜数、首领、击杀、爆头、通关和难度结算"><i>✦</i>{{ meta.medals }}<small>勋章</small></div>
    </header>

    <!-- 出征 -->
    <section v-if="ui.lobbyTab === 'deploy'" class="deploy">
      <div v-if="ui.checkpoint" class="card cont">
        <h3>继续上一局</h3>
        <p>第 {{ ui.checkpoint.night }} 天 · {{ DIFFICULTIES[ui.checkpoint.difficulty].name }} · 零件 {{ ui.checkpoint.scrap }} · 生命 {{ ui.checkpoint.hp }} / {{ ui.checkpoint.maxHp }}<template v-if="savedAt"> · 保存于 {{ savedAt }}</template></p>
        <button class="go" @click="ui.actions.continueRun()">继 续</button>
      </div>

      <div class="card">
        <h3>难度</h3>
        <div class="diffs">
          <button v-for="d in DIFFICULTY_ORDER" :key="d" class="diff" :class="{ on: difficulty === d }" :disabled="!difficultyUnlocked(meta, d)" @click="difficulty = d">
            <b>{{ DIFFICULTIES[d].name }}</b>
            <span>{{ diffNote(d) }}</span>
          </button>
        </div>

        <h3>随身武器</h3>
        <div v-if="!bonuses.sidearm" class="hint">军械库解锁</div>
        <div v-else class="sides">
          <button :class="{ on: sidearm === null }" @click="sidearm = null">不带</button>
          <button v-for="k in sidearms" :key="k" :class="{ on: sidearm === k }" @click="sidearm = k">{{ WEAPONS[k].name }}</button>
        </div>

        <h3>当前加成</h3>
        <div class="tags"><span v-for="x in summary" :key="x">{{ x }}</span></div>

        <div class="row">
          <button class="go" @click="deploy()">{{ confirming ? '确认放弃上一局并出征' : '出 征' }}</button>
          <button v-if="confirming" class="ghost" @click="confirming = false">取消</button>
          <button class="ghost" @click="ui.actions.training()">训练场</button>
        </div>
      </div>

      <div class="card">
        <h3>每日挑战 · {{ daily.key }}</h3>
        <p class="dl">「{{ nightMod(daily.mod).name }}」· {{ WEAPONS[daily.weapon].name }}</p>
        <div class="row">
          <button class="ghost" @click="ui.actions.daily()">挑 战</button>
          <span class="hint">最好 {{ dailyBest !== undefined ? `${dailyBest} 夜` : '—' }}</span>
        </div>
      </div>
    </section>

    <!-- 军械库 / 工程部 / 补给站 -->
    <section v-else-if="shopSection" class="shop">
      <div class="progress">已投入 {{ spent }} / {{ total }} 勋章</div>
      <div class="grid">
        <div v-for="it in items(shopSection)" :key="it.id" class="item" :class="{ maxed: it.state === 'maxed', locked: it.state === 'requires' || it.state === 'rank' }">
          <div class="top">
            <b>{{ it.name }}</b>
            <span class="pips"><i v-for="i in it.max" :key="i" :class="{ on: i <= it.lv }"></i></span>
          </div>
          <div v-if="it.needRank && it.state !== 'rank' && it.state !== 'maxed' && it.needRank !== RANKS[0]?.name" class="req">军衔：{{ it.needRank }}</div>
          <div v-if="it.now" class="now">当前：{{ it.now }}</div>
          <div v-if="it.next" class="next">{{ it.lv > 0 ? '下一级：' : '' }}{{ it.next }}</div>
          <button v-if="it.price !== null" class="buy" :disabled="it.state !== 'ok'" :title="blocked[it.state] ?? ''" @click="ui.actions.buyMeta(it.id)">
            <i>✦</i>{{ it.price }}<template v-if="it.state === 'requires'"> · 需要「{{ it.needPre }}」</template><template v-else-if="it.state === 'rank'"> · 需要{{ it.needRank }}</template><template v-else-if="it.state === 'medals'"> · 还差 {{ (it.price ?? 0) - meta.medals }}</template>
          </button>
          <div v-else class="done">{{ it.max === 1 ? '已解锁 · 已生效' : '已满级' }}</div>
        </div>
      </div>
    </section>

    <!-- 战绩 -->
    <section v-else-if="ui.lobbyTab === 'records'" class="card records">
      <div><span>出征</span><b>{{ s.runs }} 次</b></div>
      <div><span>通关</span><b>{{ s.wins }} 次</b></div>
      <div><span>最远</span><b>第 {{ s.bestNight }} 夜</b></div>
      <div><span>最快通关</span><b>{{ s.bestWinTime > 0 ? fmtTime(s.bestWinTime) : '—' }}</b></div>
      <div><span>单局最多击杀</span><b>{{ s.bestKills }}</b></div>
      <div><span>累计击杀</span><b>{{ s.totalKills }}</b></div>
      <div><span>累计爆头击杀</span><b>{{ s.totalHeadshots }}<small> · {{ hsRate }}%</small></b></div>
      <div><span>累计勋章</span><b>{{ meta.medalsEarned }}</b></div>
      <div><span>通关的难度</span><b>{{ meta.cleared.length ? meta.cleared.map((d) => DIFFICULTIES[d].name).join('、') : '—' }}</b></div>
    </section>

    <!-- 图鉴 / 成就 -->
    <section v-else-if="ui.lobbyTab === 'codex'">
      <CodexPanel />
    </section>

    <!-- 设置 -->
    <section v-else class="card settings">
      <Settings />
      <CloudPanel />
    </section>

    <footer>
      <button class="ghost" @click="ui.screen = 'menu'">返回标题</button>
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
  padding: 28px 6vw 22px;
  background: linear-gradient(180deg, rgba(5, 8, 12, 0.9), rgba(5, 8, 12, 0.72) 40%, rgba(5, 8, 12, 0.9));
  color: #d8dee4;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.brand {
  font-size: 22px;
  letter-spacing: 8px;
  color: #e8553f;
  font-weight: 700;
}
.brand span {
  color: #d9c9a0;
  font-weight: 300;
}
nav {
  display: flex;
  gap: 4px;
  flex: 1;
}
nav button {
  padding: 8px 18px;
  background: transparent;
  border: 1px solid transparent;
  color: #8f9aa6;
  font: inherit;
  font-size: 14px;
  letter-spacing: 4px;
  cursor: pointer;
}
nav button:hover {
  color: #d8dee4;
}
nav button.on {
  color: #f0b83a;
  border-color: rgba(240, 184, 58, 0.45);
  background: rgba(240, 184, 58, 0.07);
}
.medal {
  font-size: 22px;
  color: #f0b83a;
}
.medal i,
.buy i {
  font-style: normal;
  margin-right: 6px;
}
.medal small {
  margin-left: 6px;
  font-size: 12px;
  color: #8f9aa6;
  letter-spacing: 3px;
}
.rank {
  display: grid;
  grid-template-columns: auto 90px;
  column-gap: 10px;
  align-items: center;
  margin-left: auto;
}
.rank b {
  grid-row: span 2;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 3px;
  color: #d9c9a0;
}
.rank .bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
}
.rank .bar i {
  display: block;
  height: 100%;
  background: #d9c9a0;
}
.rank small {
  font-size: 11px;
  color: #8f9aa6;
}
.req {
  font-size: 12px;
  color: #d9c9a0;
}
section {
  flex: 1;
  min-height: 0;
  margin-top: 22px;
  overflow-y: auto;
}
.card {
  background: rgba(10, 14, 18, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 18px 22px;
}
h3 {
  font-size: 12px;
  letter-spacing: 8px;
  color: #6fd0e8;
  margin: 4px 0 12px;
  font-weight: 400;
}
.deploy {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
}
.cont {
  border-color: rgba(240, 184, 58, 0.45);
}
.cont p {
  margin-bottom: 12px;
  color: #c8ced4;
}
.diffs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
.diff {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  text-align: left;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #d8dee4;
  font: inherit;
  cursor: pointer;
}
.diff b {
  font-size: 16px;
  letter-spacing: 6px;
}
.diff span {
  font-size: 12px;
  color: #8f9aa6;
  line-height: 1.5;
}
.diff.on {
  border-color: #e8553f;
  background: rgba(232, 85, 63, 0.1);
}
.diff:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sides {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.sides button {
  padding: 7px 16px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #c8ced4;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.sides button.on {
  border-color: #6fd0e8;
  color: #6fd0e8;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 18px;
}
.tags span {
  padding: 3px 10px;
  font-size: 12px;
  color: #aeb8c2;
  background: rgba(111, 208, 232, 0.07);
  border: 1px solid rgba(111, 208, 232, 0.2);
}
.row {
  display: flex;
  gap: 14px;
  margin-top: 8px;
}
.go {
  padding: 13px 54px;
  background: transparent;
  border: 1px solid #e8553f;
  color: #ffb4a4;
  font: inherit;
  font-size: 16px;
  letter-spacing: 10px;
  cursor: pointer;
  transition: 0.15s;
}
.go:hover {
  background: #e8553f;
  color: #fff;
  box-shadow: 0 0 30px rgba(232, 85, 63, 0.5);
}
.ghost {
  padding: 10px 28px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #c8ced4;
  font: inherit;
  font-size: 14px;
  letter-spacing: 6px;
  cursor: pointer;
}
.ghost:hover {
  border-color: #6fd0e8;
  color: #fff;
}
.dl {
  font-size: 13px;
  color: #aeb8c2;
  margin-bottom: 10px;
}
.row .hint {
  align-self: center;
  margin: 0;
}
.hint {
  margin-top: 10px;
  font-size: 12px;
  color: #7e8a96;
  line-height: 1.6;
}
.progress {
  font-size: 12px;
  letter-spacing: 3px;
  color: #8f9aa6;
  margin-bottom: 12px;
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
  padding: 14px 16px;
  background: rgba(10, 14, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.item.maxed {
  border-color: rgba(111, 208, 232, 0.35);
}
.item.locked {
  opacity: 0.55;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.top b {
  font-size: 15px;
  letter-spacing: 2px;
}
.pips {
  display: flex;
  gap: 3px;
}
.pips i {
  width: 10px;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
}
.pips i.on {
  background: #f0b83a;
}
.now {
  font-size: 12px;
  color: #6fd0e8;
}
.next {
  font-size: 13px;
  color: #aeb8c2;
  line-height: 1.5;
  flex: 1;
}
.buy {
  align-self: flex-start;
  margin-top: 4px;
  padding: 6px 16px;
  background: transparent;
  border: 1px solid #f0b83a;
  color: #f0b83a;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.buy:hover:not(:disabled) {
  background: #f0b83a;
  color: #0b0f14;
}
.buy:disabled {
  border-color: rgba(255, 255, 255, 0.18);
  color: #6f7c88;
  cursor: not-allowed;
}
.done {
  font-size: 12px;
  letter-spacing: 4px;
  color: #6fd0e8;
}
.records {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr));
  gap: 14px 30px;
  max-width: 860px;
  flex: none;
}
.records div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.records span {
  font-size: 12px;
  letter-spacing: 3px;
  color: #7e8a96;
}
.records b {
  font-size: 18px;
  color: #f1e8cc;
}
.records small {
  font-size: 12px;
  color: #c8a85a;
}
.settings {
  max-width: 420px;
  flex: none;
}
footer {
  padding-top: 14px;
}
</style>
